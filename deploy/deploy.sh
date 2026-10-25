#!/bin/sh
# Runs on the Droplet as the 'deploy' user; CI calls it after uploading this directory.
# Usage: DOMAIN=example.com sh deploy.sh ghcr.io/<owner>/<repo>@sha256:<digest>
#
# Order: pull -> (pre-migration dump) -> migrate -> bring up. The previous image keeps
# serving while migrations run, so migrations must stay backward compatible.
# .env is only updated after everything succeeded; if bring-up fails the previous
# image is restored (best effort) and the script exits non-zero.
# Self-hosted mode: COMPOSE_FILE=self-hosted/compose.yaml (relative to this script, or absolute)
# runs everything in that file's directory (its .env, backups/). There the .env is written by
# hand (the tunnel network and sign-up list are site specific), never generated, and DOMAIN
# is optional.
# Manual rollback: sh deploy.sh <previous image@sha256:...>   (see PREVIOUS_IMAGE_REF in .env)
set -eu

NEW="${1:?usage: deploy.sh <image@sha256:digest>}"
case "$NEW" in
  ghcr.io/*@sha256:*) ;;
  *) echo "Refusing to deploy a non-digest image reference: $NEW" >&2; exit 1 ;;
esac
DIGEST="${NEW##*@sha256:}"
case "$DIGEST" in
  *[!0-9a-f]*) echo "Refusing to deploy: digest is not lowercase hex: $NEW" >&2; exit 1 ;;
esac
if [ "${#DIGEST}" -ne 64 ]; then
  echo "Refusing to deploy: digest must be 64 hex characters: $NEW" >&2
  exit 1
fi

valid_domain() {
  printf '%s\n' "$1" | grep -Eq '^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$'
}
if [ -n "${DOMAIN:-}" ] && ! valid_domain "$DOMAIN"; then
  echo "Refusing to deploy: DOMAIN is not a valid lowercase hostname." >&2
  exit 1
fi

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
if [ -n "${COMPOSE_FILE:-}" ]; then
  case "$COMPOSE_FILE" in
    /*) ;;
    *) COMPOSE_FILE="$SCRIPT_DIR/$COMPOSE_FILE" ;;
  esac
  cd "$(dirname "$COMPOSE_FILE")"
  COMPOSE_FILE=$(basename "$COMPOSE_FILE")
  export COMPOSE_FILE
  SELF_HOSTED=1
else
  cd "$SCRIPT_DIR"
  SELF_HOSTED=
fi
umask 077

# Value of KEY in .env (empty if absent). sed fails loudly if .env is unreadable.
envval() {
  sed -n "s/^$1=//p" .env | tail -n 1
}

# First deploy: generate production secrets here, so they never exist anywhere else.
# Written to a temp file first so an interruption can't leave a partial .env.
if [ ! -e .env ] && [ -n "$SELF_HOSTED" ]; then
  echo "Create .env first (copy .env.example in $(pwd) and fill it in); self-hosted mode never generates one." >&2
  exit 1
fi
if [ ! -e .env ]; then
  : "${DOMAIN:?DOMAIN is required on first deploy}"
  cat > .env.new <<ENVEOF
DOMAIN=$DOMAIN
POSTGRES_USER=workout
POSTGRES_PASSWORD=$(openssl rand -hex 32)
POSTGRES_DB=workout
BETTER_AUTH_SECRET=$(openssl rand -hex 32)
BETTER_AUTH_URL=https://$DOMAIN
ENVEOF
  mv .env.new .env
  echo "Created .env with generated secrets."
fi

ENV_DOMAIN=$(envval DOMAIN)
if [ -n "${DOMAIN:-}" ] && [ "$DOMAIN" != "$ENV_DOMAIN" ]; then
  echo "DOMAIN '$DOMAIN' differs from the one in .env: a domain change requires editing .env manually (DOMAIN and BETTER_AUTH_URL)." >&2
  exit 1
fi

PREV=$(envval IMAGE_REF)
PREV_RECORDED=$(envval PREVIOUS_IMAGE_REF)

# A shell variable overrides .env for every compose command below.
IMAGE_REF="$NEW"
export IMAGE_REF
echo "==> Deploying $NEW (current: ${PREV:-none})"

echo "==> Pulling image"
if ! docker compose pull app; then
  echo "Image pull failed. If this is the first deploy, make the GHCR package public (see docs/release-checklist.md)." >&2
  exit 1
fi

# Pre-migration backup, only when a database is already running.
if [ -n "$(docker compose ps --status running --quiet db)" ]; then
  DB_USER=$(envval POSTGRES_USER)
  DB_NAME=$(envval POSTGRES_DB)
  mkdir -p backups
  chmod 700 backups
  DUMP="backups/pre-$(date -u +%Y%m%dT%H%M%SZ)-$(printf '%.12s' "$DIGEST").dump"
  echo "==> Backing up database to $DUMP"
  if ! docker compose exec -T db pg_dump -Fc -U "$DB_USER" "$DB_NAME" > "$DUMP"; then
    rm -f "$DUMP"
    echo "Database backup failed; aborting before migrations." >&2
    exit 1
  fi
  # Keep the newest 5 (names sort by timestamp).
  set -- backups/pre-*.dump
  if [ "$#" -gt 5 ]; then
    drop=$(($# - 5))
    for old in "$@"; do
      [ "$drop" -gt 0 ] || break
      rm -f "$old"
      drop=$((drop - 1))
    done
  fi
else
  echo "==> No running database; skipping backup (first deploy)"
fi

echo "==> Starting database"
docker compose up --detach --wait db

echo "==> Running migrations (the current app keeps serving)"
if ! docker compose run --rm --no-deps app node migrate.js; then
  echo "Migration failed. Nothing was changed: .env and the running app are untouched." >&2
  exit 1
fi

echo "==> Bringing up the new version"
if ! docker compose up --detach --wait --wait-timeout 120 --remove-orphans; then
  echo "Bring-up failed." >&2
  if [ -n "$PREV" ]; then
    echo "==> Rolling back app to $PREV" >&2
    IMAGE_REF="$PREV" docker compose up --detach --wait --wait-timeout 120 app \
      || echo "Rollback also failed; intervene manually." >&2
  else
    echo "No previous image to roll back to." >&2
  fi
  exit 1
fi

# Success: record the image in .env so manual `docker compose` commands use it.
if [ "$PREV" = "$NEW" ]; then PREV=$PREV_RECORDED; fi
if ! { grep -v -e '^IMAGE_REF=' -e '^PREVIOUS_IMAGE_REF=' .env || [ $? -eq 1 ]; } > .env.new; then
  rm -f .env.new
  echo "Could not read .env; it was left untouched. The new version is running but .env still names the old image." >&2
  exit 1
fi
if ! grep -q '^POSTGRES_PASSWORD=' .env.new || ! grep -q '^BETTER_AUTH_SECRET=' .env.new; then
  rm -f .env.new
  echo "Refusing to rewrite .env: secrets missing from the new file. The new version is running but .env still names the old image." >&2
  exit 1
fi
{
  echo "IMAGE_REF=$NEW"
  echo "PREVIOUS_IMAGE_REF=$PREV"
} >> .env.new
mv .env.new .env

docker image prune --force || echo "image prune failed (ignored)" >&2
echo "Deployed $NEW"
