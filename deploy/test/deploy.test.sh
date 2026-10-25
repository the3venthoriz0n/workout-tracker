#!/bin/sh
# Tests deploy/deploy.sh against a stub `docker`. Run: sh deploy/test/deploy.test.sh
# Control the stub with env vars: FAIL_PULL, FAIL_MIGRATE, FAIL_UP, FAIL_DUMP, DB_RUNNING, FAIL_GREP.
set -u

HERE=$(cd "$(dirname "$0")" && pwd)
SRC=$(cd "$HERE/.." && pwd)
ROOT=$(mktemp -d)
trap 'rm -rf "$ROOT"' EXIT INT TERM

REAL_GREP=$(command -v grep)
STUBS="$ROOT/stubs"
mkdir -p "$STUBS"

cat > "$STUBS/docker" <<'STUB'
#!/bin/sh
# Logs every call; fails selected subcommands.
echo "docker $* [IMAGE_REF=${IMAGE_REF:-}]" >> "$STUB_LOG"
echo "COMPOSE_FILE=${COMPOSE_FILE:-} PWD=$(pwd -P)" >> "$STUB_LOG.ctx"
case "$*" in
  "compose pull"*) [ -z "${FAIL_PULL:-}" ] || exit 1 ;;
  "compose ps"*) [ -z "${DB_RUNNING:-}" ] || echo abc123 ;;
  "compose exec"*pg_dump*)
    [ -z "${FAIL_DUMP:-}" ] || exit 1
    echo "PGDMP-stub" ;;
  "compose run"*migrate.js) [ -z "${FAIL_MIGRATE:-}" ] || exit 1 ;;
  "compose up"*--remove-orphans*) [ -z "${FAIL_UP:-}" ] || exit 1 ;;
esac
exit 0
STUB

# grep wrapper: fails with exit 2 when asked to filter IMAGE_REF out of .env (a "real" error).
cat > "$STUBS/grep" <<STUB
#!/bin/sh
if [ -n "\${FAIL_GREP:-}" ]; then
  case "\$*" in *IMAGE_REF*) exit 2 ;; esac
fi
exec "$REAL_GREP" "\$@"
STUB
chmod +x "$STUBS/docker" "$STUBS/grep"

PASS=0
FAIL=0
ok() { PASS=$((PASS + 1)); echo "ok   - $1"; }
bad() { FAIL=$((FAIL + 1)); echo "FAIL - $1"; }
check() { # check <description> <command...>
  desc=$1; shift
  if "$@"; then ok "$desc"; else bad "$desc"; fi
}

DIGEST_A=$(printf 'a%.0s' $(seq 1 64))
DIGEST_B=$(printf 'b%.0s' $(seq 1 64))
REF_A="ghcr.io/example/app@sha256:$DIGEST_A"
REF_B="ghcr.io/example/app@sha256:$DIGEST_B"

n=0
new_case() {
  n=$((n + 1))
  W="$ROOT/case$n"
  mkdir -p "$W"
  cp "$SRC/deploy.sh" "$W/"
  cp "$SRC/compose.yaml" "$W/"
  STUB_LOG="$W/docker.log"
  : > "$STUB_LOG"
  export STUB_LOG
  unset FAIL_PULL FAIL_MIGRATE FAIL_UP FAIL_DUMP DB_RUNNING FAIL_GREP
}
run() { # run <DOMAIN or ""> <ref>; output in $W/out, status in $RC
  ( cd "$W" && DOMAIN="$1" PATH="$STUBS:$PATH" sh deploy.sh "$2" ) > "$W/out" 2>&1
  RC=$?
}
mode() { stat -c '%a' "$1" 2>/dev/null || stat -f '%Lp' "$1"; }
has() { "$REAL_GREP" -q -- "$1" "$2"; }
hasnt() { ! "$REAL_GREP" -q -- "$1" "$2"; }
line_of() { "$REAL_GREP" -n -- "$1" "$STUB_LOG" | head -n 1 | cut -d: -f1; }
before() { a=$(line_of "$1"); b=$(line_of "$2"); [ -n "$a" ] && [ -n "$b" ] && [ "$a" -lt "$b" ]; }
seed_env() { # seed_env <image ref or ""> [previous ref]
  cat > "$W/.env" <<ENV
DOMAIN=example.com
POSTGRES_USER=workout
POSTGRES_PASSWORD=$(printf 'c%.0s' $(seq 1 64))
POSTGRES_DB=workout
BETTER_AUTH_SECRET=$(printf 'd%.0s' $(seq 1 64))
BETTER_AUTH_URL=https://example.com
ENV
  [ -z "$1" ] || echo "IMAGE_REF=$1" >> "$W/.env"
  [ -z "${2:-}" ] || echo "PREVIOUS_IMAGE_REF=$2" >> "$W/.env"
  chmod 600 "$W/.env"
}

echo "# (a) first deploy"
new_case
run example.com "$REF_A"
check "first deploy succeeds" [ "$RC" -eq 0 ]
for k in DOMAIN POSTGRES_USER POSTGRES_PASSWORD POSTGRES_DB BETTER_AUTH_SECRET BETTER_AUTH_URL IMAGE_REF PREVIOUS_IMAGE_REF; do
  check ".env has $k" has "^$k=" "$W/.env"
done
check ".env mode is 600" [ "$(mode "$W/.env")" = 600 ]
check "POSTGRES_PASSWORD is 64 hex" has '^POSTGRES_PASSWORD=[0-9a-f]\{64\}$' "$W/.env"
check "BETTER_AUTH_SECRET is 64 hex" has '^BETTER_AUTH_SECRET=[0-9a-f]\{64\}$' "$W/.env"
check "BETTER_AUTH_URL derives from DOMAIN" has '^BETTER_AUTH_URL=https://example.com$' "$W/.env"
check "IMAGE_REF recorded" has "^IMAGE_REF=$REF_A$" "$W/.env"
check "no leftover .env.new" [ ! -e "$W/.env.new" ]
check "no backup on first deploy" [ ! -e "$W/backups" ]

new_case
FAIL_UP=1 run example.com "$REF_A"
check "failed first deploy exits non-zero" [ "$RC" -ne 0 ]
check "failed first deploy does not record IMAGE_REF" hasnt '^IMAGE_REF=' "$W/.env"
check "failed first deploy keeps generated secrets" has '^POSTGRES_PASSWORD=' "$W/.env"

new_case
FAIL_PULL=1 run example.com "$REF_A"
check "pull failure exits non-zero" [ "$RC" -ne 0 ]
check "pull failure hints at public GHCR package" has 'make the GHCR package public' "$W/out"
check "pull failure does not record IMAGE_REF" hasnt '^IMAGE_REF=' "$W/.env"

echo "# (b) input validation"
new_case
run example.com "ghcr.io/example/app:latest"
check "tag ref refused" [ "$RC" -ne 0 ]
check "tag ref: docker never called" [ ! -s "$STUB_LOG" ]
check "tag ref: no .env created" [ ! -e "$W/.env" ]
run example.com "docker.io/library/app@sha256:$DIGEST_A"
check "non-ghcr ref refused" [ "$RC" -ne 0 ]
run example.com "ghcr.io/example/app@sha256:abc123"
check "short digest refused" [ "$RC" -ne 0 ]
run example.com "ghcr.io/example/app@sha256:$(printf 'G%.0s' $(seq 1 64))"
check "non-hex digest refused" [ "$RC" -ne 0 ]
for d in 'Example.com' '-bad.com' 'bad.com-' 'a b.com' 'a;b.com' 'a/b.com' "a\$(id).com"; do
  new_case
  run "$d" "$REF_A"
  check "bad DOMAIN refused: $d" [ "$RC" -ne 0 ]
  check "bad DOMAIN: docker never called: $d" [ ! -s "$STUB_LOG" ]
done
new_case
run "" "$REF_A"
check "first deploy without DOMAIN refused" [ "$RC" -ne 0 ]
new_case
seed_env "$REF_A"
run other.example.org "$REF_B"
check "domain change refused" [ "$RC" -ne 0 ]
check "domain change message" has 'requires editing .env manually' "$W/out"
check "domain change: docker never called" [ ! -s "$STUB_LOG" ]

echo "# (c) migration failure"
new_case
seed_env "$REF_A"
cp "$W/.env" "$ROOT/env.before"
FAIL_MIGRATE=1 run example.com "$REF_B"
check "migration failure exits non-zero" [ "$RC" -ne 0 ]
check ".env unchanged after migration failure" cmp -s "$ROOT/env.before" "$W/.env"
check "no 'up' after failed migrate" sh -c "! sed -n '/migrate.js/,\$p' '$STUB_LOG' | grep -q 'compose up --detach --wait --wait-timeout'"

echo "# (d) up --wait failure with rollback"
new_case
seed_env "$REF_A"
cp "$W/.env" "$ROOT/env.before"
FAIL_UP=1 run example.com "$REF_B"
check "bring-up failure exits non-zero" [ "$RC" -ne 0 ]
check "rollback up invoked with previous image" has "compose up --detach --wait --wait-timeout 120 app \[IMAGE_REF=$REF_A\]" "$STUB_LOG"
check "new image used for the failed up" has "--remove-orphans \[IMAGE_REF=$REF_B\]" "$STUB_LOG"
check ".env IMAGE_REF still previous" has "^IMAGE_REF=$REF_A$" "$W/.env"
check ".env unchanged after rollback" cmp -s "$ROOT/env.before" "$W/.env"
new_case
FAIL_UP=1 run example.com "$REF_A"
check "no rollback when there is no previous image" hasnt 'wait-timeout 120 app' "$STUB_LOG"

echo "# successful upgrade records previous image"
new_case
seed_env "$REF_A"
run example.com "$REF_B"
check "upgrade succeeds" [ "$RC" -eq 0 ]
check "IMAGE_REF updated" has "^IMAGE_REF=$REF_B$" "$W/.env"
check "PREVIOUS_IMAGE_REF recorded" has "^PREVIOUS_IMAGE_REF=$REF_A$" "$W/.env"
check "single IMAGE_REF line" [ "$("$REAL_GREP" -c '^IMAGE_REF=' "$W/.env")" -eq 1 ]

echo "# (e) secrets survive"
new_case
seed_env "$REF_A"
"$REAL_GREP" -e '^POSTGRES_PASSWORD=' -e '^BETTER_AUTH_SECRET=' "$W/.env" > "$ROOT/secrets.before"
run example.com "$REF_B"
"$REAL_GREP" -e '^POSTGRES_PASSWORD=' -e '^BETTER_AUTH_SECRET=' "$W/.env" > "$ROOT/secrets.after"
check "secrets byte-identical after deploy" cmp -s "$ROOT/secrets.before" "$ROOT/secrets.after"
check ".env mode stays 600" [ "$(mode "$W/.env")" = 600 ]

new_case
seed_env "$REF_A"
cp "$W/.env" "$ROOT/env.before"
FAIL_GREP=1 run example.com "$REF_B"
check "grep error exits non-zero" [ "$RC" -ne 0 ]
check "grep error does not clobber .env" cmp -s "$ROOT/env.before" "$W/.env"
check "grep error leaves no .env.new" [ ! -e "$W/.env.new" ]

new_case
mkdir "$W/.env"
run example.com "$REF_B"
check ".env unreadable (directory) exits non-zero" [ "$RC" -ne 0 ]
check ".env directory untouched" [ -d "$W/.env" ]
check "unreadable .env: docker never called" [ ! -s "$STUB_LOG" ]

echo "# (f) pre-migration backup"
new_case
seed_env "$REF_A"
mkdir "$W/backups"
for i in 1 2 3 4 5 6 7; do : > "$W/backups/pre-2026010${i}T000000Z-old.dump"; done
DB_RUNNING=1 run example.com "$REF_B"
check "deploy with db running succeeds" [ "$RC" -eq 0 ]
check "pg_dump uses .env user and db" has 'exec -T db pg_dump -Fc -U workout workout' "$STUB_LOG"
check "backups dir mode 700" [ "$(mode "$W/backups")" = 700 ]
check "only 5 dumps kept" [ "$(find "$W/backups" -type f | wc -l)" -eq 5 ]
newest=$(find "$W/backups" -type f | sort | tail -n 1 | xargs basename)
check "newest dump is the fresh one" sh -c "echo '$newest' | grep -q 'bbbbbbbbbbbb.dump$'"
check "oldest dumps removed" [ ! -e "$W/backups/pre-20260101T000000Z-old.dump" ]
check "dump is not world-readable" [ "$(mode "$W/backups/$newest")" = 600 ]
check "dump has content" [ -s "$W/backups/$newest" ]

new_case
seed_env "$REF_A"
DB_RUNNING=1 FAIL_DUMP=1 run example.com "$REF_B"
check "dump failure aborts deploy" [ "$RC" -ne 0 ]
check "dump failure: no migration" hasnt 'migrate.js' "$STUB_LOG"
check "dump failure: no partial dump left" [ -z "$(find "$W/backups" -type f)" ]

new_case
seed_env "$REF_A"
run example.com "$REF_B"
check "no pg_dump when db is not running" hasnt 'pg_dump' "$STUB_LOG"

echo "# (g) call order"
new_case
seed_env "$REF_A"
DB_RUNNING=1 run example.com "$REF_B"
check "pull before dump" before 'compose pull' 'pg_dump'
check "dump before migrate" before 'pg_dump' 'migrate.js'
check "migrate before up" before 'migrate.js' 'remove-orphans'
check "pull before up" before 'compose pull' 'remove-orphans'
check "all compose calls ran with new IMAGE_REF" sh -c "! grep '^docker compose' '$STUB_LOG' | grep -v 'IMAGE_REF=$REF_B'"

echo "# (h) self-hosted mode (COMPOSE_FILE)"
sh_case() { # a deploy/ tree with self-hosted/compose.yaml and a hand-made .env there
  new_case
  mkdir -p "$W/self-hosted"
  cp "$SRC/self-hosted/compose.yaml" "$W/self-hosted/"
  cat > "$W/self-hosted/.env" <<ENV
DOMAIN=example.invalid
POSTGRES_USER=workout
POSTGRES_PASSWORD=$(printf 'c%.0s' $(seq 1 64))
POSTGRES_DB=workout
BETTER_AUTH_SECRET=$(printf 'd%.0s' $(seq 1 64))
TUNNEL_NETWORK=tunnel
ENV
  [ -z "${1:-}" ] || echo "IMAGE_REF=$1" >> "$W/self-hosted/.env"
  chmod 600 "$W/self-hosted/.env"
}
sh_run() { # sh_run <ref>
  ( cd "$W" && COMPOSE_FILE=self-hosted/compose.yaml PATH="$STUBS:$PATH" sh deploy.sh "$1" ) > "$W/out" 2>&1
  RC=$?
}
sh_case "$REF_A"
sh_run "$REF_B"
check "self-hosted upgrade succeeds" [ "$RC" -eq 0 ]
check "compose runs inside the compose file's directory" has "PWD=$W/self-hosted\$" "$STUB_LOG.ctx"
check "compose always gets COMPOSE_FILE" sh -c "! grep -v 'COMPOSE_FILE=compose.yaml' '$STUB_LOG.ctx'"
check "self-hosted: IMAGE_REF recorded in its own .env" has "^IMAGE_REF=$REF_B$" "$W/self-hosted/.env"
check "self-hosted: previous image recorded" has "^PREVIOUS_IMAGE_REF=$REF_A$" "$W/self-hosted/.env"
check "self-hosted: no .env next to deploy.sh" [ ! -e "$W/.env" ]
check "self-hosted: needs no DOMAIN" hasnt 'DOMAIN' "$W/out"

sh_case "$REF_A"
( cd "$W" && DB_RUNNING=1 COMPOSE_FILE=self-hosted/compose.yaml PATH="$STUBS:$PATH" sh deploy.sh "$REF_B" ) > "$W/out" 2>&1
check "self-hosted: pre-migration dump lands beside the .env" [ -n "$(find "$W/self-hosted/backups" -name 'pre-*.dump' 2>/dev/null)" ]
check "self-hosted: dump before migrate before up" sh -c "[ \$(grep -n pg_dump '$STUB_LOG' | head -1 | cut -d: -f1) -lt \$(grep -n migrate.js '$STUB_LOG' | head -1 | cut -d: -f1) ]"

sh_case "$REF_A"
FAIL_UP=1 sh_run "$REF_B"
check "self-hosted: failed bring-up exits non-zero" [ "$RC" -ne 0 ]
check "self-hosted: rolls back to the previous image" has "wait-timeout 120 app \[IMAGE_REF=$REF_A\]" "$STUB_LOG"
check "self-hosted: .env still names the previous image" has "^IMAGE_REF=$REF_A$" "$W/self-hosted/.env"

sh_case "$REF_A"
FAIL_MIGRATE=1 sh_run "$REF_B"
check "self-hosted: migration failure exits non-zero" [ "$RC" -ne 0 ]

sh_case ""
rm "$W/self-hosted/.env"
sh_run "$REF_A"
check "self-hosted: never generates a .env" [ "$RC" -ne 0 ] 
check "self-hosted: missing .env explained" has 'Create .*env' "$W/out"
check "self-hosted: missing .env: docker never called" [ ! -s "$STUB_LOG" ]

echo
echo "$PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
