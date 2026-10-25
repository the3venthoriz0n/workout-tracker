#!/bin/sh
# Pull-based updater for the self-hosted stack; run it from cron or any scheduler, e.g.
#   REPO=<owner>/<repo> sh /path/to/deploy/self-hosted/update.sh >> update.log 2>&1
# Resolves the digest of ghcr.io/$REPO:$TAG (default tag: staging). Exits quietly when it is the
# one already deployed (IMAGE_REF in .env); otherwise calls ../deploy.sh with repo@digest, which
# backs up, migrates and rolls back on failure. Needs the docker buildx plugin.
# REPO: lowercase GHCR path, owner/repo. DEPLOY_SH: override for tests.
# A failed digest is recorded in .failed-digest (next to .env) and skipped on later runs.
# Prints timestamps and image digests only, never .env contents.
set -eu

HERE=$(cd "$(dirname "$0")" && pwd)
REPO=${REPO:-}
TAG=${TAG:-staging}
DEPLOY_SH=${DEPLOY_SH:-$HERE/../deploy.sh}

log() { printf '%s update: %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }

# grep works per line, so reject newlines and carriage returns first.
CR=$(printf '\r')
NL='
'
case "$REPO" in
  *"$NL"* | *"$CR"*) log "REPO must be a lowercase GHCR path like owner/repo" >&2; exit 1 ;;
esac
if ! printf '%s\n' "$REPO" | grep -Eq '^[a-z0-9][a-z0-9._-]*/[a-z0-9][a-z0-9._/-]*$' \
  || printf '%s\n' "$REPO" | grep -q '\.\.'; then
  log "REPO must be a lowercase GHCR path like owner/repo" >&2
  exit 1
fi
case "$TAG" in
  ''|*[!A-Za-z0-9._-]*) log "TAG is not a valid image tag" >&2; exit 1 ;;
esac

# One run at a time. flock (released by the kernel when the process dies) when available;
# otherwise mkdir, which is atomic, and a lock whose process is gone is taken over.
# UPDATE_NO_FLOCK=1 forces the mkdir fallback (used by the tests).
LOCK="$HERE/.update.lock"
if [ -z "${UPDATE_NO_FLOCK:-}" ] && command -v flock >/dev/null 2>&1; then
  exec 9> "$HERE/.update.flock"
  flock -n 9 || exit 0
else
  if ! mkdir "$LOCK" 2>/dev/null; then
    holder=$(cat "$LOCK/pid" 2>/dev/null || true)
    if [ -n "$holder" ] && kill -0 "$holder" 2>/dev/null; then
      exit 0
    fi
    rm -rf "$LOCK"
    mkdir "$LOCK" 2>/dev/null || exit 0
  fi
  echo "$$" > "$LOCK/pid"
  trap 'rm -rf "$LOCK"' EXIT
fi
trap 'exit 1' INT TERM HUP

REF="ghcr.io/$REPO:$TAG"
# Registry errors may echo credentials or URLs, so only a fixed message is logged.
if ! digest=$(docker buildx imagetools inspect "$REF" --format '{{.Manifest.Digest}}' 2>/dev/null); then
  log "could not resolve the digest of $REF (is the package public, or the host logged in to ghcr.io?)" >&2
  exit 1
fi
case "$digest" in
  sha256:*) hex=${digest#sha256:} ;;
  *) hex= ;;
esac
if [ "${#hex}" -ne 64 ] || [ -n "$(printf '%s' "$hex" | tr -d '0-9a-f')" ]; then
  log "registry returned something that is not a sha256 digest" >&2
  exit 1
fi

current=
if [ -f "$HERE/.env" ]; then
  current=$(sed -n 's/^IMAGE_REF=//p' "$HERE/.env" | tail -n 1)
fi
NEW="ghcr.io/$REPO@$digest"
if [ "$current" = "$NEW" ]; then
  exit 0
fi

# A digest whose deploy failed is not retried every run (each retry would rotate out the
# pre-migration backup). Remove the file, or publish a different digest, to try again.
FAILED_FILE="$HERE/.failed-digest"
if [ -f "$FAILED_FILE" ] && [ "$(cat "$FAILED_FILE" 2>/dev/null)" = "$digest" ]; then
  log "skipping $digest: its deploy failed earlier; remove $FAILED_FILE to retry"
  exit 0
fi

log "deploying $NEW"
if COMPOSE_FILE="$HERE/compose.yaml" sh "$DEPLOY_SH" "$NEW"; then
  rm -f "$FAILED_FILE"
  log "done"
else
  printf '%s\n' "$digest" > "$FAILED_FILE"
  log "deploy failed (see output above; deploy.sh restores the previous image when it can and keeps the pre-migration dump as backups/*.keep); $digest is skipped until $FAILED_FILE is removed or a new digest appears" >&2
  exit 1
fi
