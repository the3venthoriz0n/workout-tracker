#!/bin/sh
# Tests deploy/self-hosted/update.sh against stub `docker` and `deploy.sh`.
# Run: sh deploy/test/update.test.sh
# Stub controls: STUB_DIGEST (what the registry reports), FAIL_INSPECT, FAIL_DEPLOY.
set -u

HERE=$(cd "$(dirname "$0")" && pwd)
SRC=$(cd "$HERE/../self-hosted" && pwd)
ROOT=$(mktemp -d)
trap 'rm -rf "$ROOT"' EXIT INT TERM

STUBS="$ROOT/stubs"
mkdir -p "$STUBS"
cat > "$STUBS/docker" <<'STUB'
#!/bin/sh
echo "docker $*" >> "$STUB_LOG"
case "$*" in
  "buildx imagetools inspect"*)
    [ -z "${FAIL_INSPECT:-}" ] || { echo "registry says no (token=SECRETTOKEN)" >&2; exit 1; }
    echo "${STUB_DIGEST:-}" ;;
esac
exit 0
STUB
cat > "$STUBS/deploy.sh" <<'STUB'
#!/bin/sh
echo "deploy.sh $* [COMPOSE_FILE=${COMPOSE_FILE:-}]" >> "$STUB_LOG"
[ -z "${FAIL_DEPLOY:-}" ] || { echo "deploy exploded" >&2; exit 1; }
STUB
chmod +x "$STUBS/docker" "$STUBS/deploy.sh"

PASS=0
FAIL=0
ok() { PASS=$((PASS + 1)); echo "ok   - $1"; }
bad() { FAIL=$((FAIL + 1)); echo "FAIL - $1"; }
check() { desc=$1; shift; if "$@"; then ok "$desc"; else bad "$desc"; fi; }
has() { grep -q -- "$1" "$2"; }
hasnt() { ! grep -q -- "$1" "$2"; }
no_secrets() { ! grep -q -e hunter2 -e sekrit -e SECRETTOKEN "$1"; }
no_lock() { [ ! -e "$W/.update.lock" ]; }

DIGEST_A=sha256:$(printf 'a%.0s' $(seq 1 64))
DIGEST_B=sha256:$(printf 'b%.0s' $(seq 1 64))
REPO=example/app

n=0
new_case() {
  n=$((n + 1))
  W="$ROOT/case$n"
  mkdir -p "$W"
  cp "$SRC/update.sh" "$W/"
  STUB_LOG="$W/calls.log"
  : > "$STUB_LOG"
  export STUB_LOG
  unset FAIL_INSPECT FAIL_DEPLOY STUB_DIGEST
  printf 'POSTGRES_PASSWORD=hunter2hunter2\nBETTER_AUTH_SECRET=sekrit\n' > "$W/.env"
  [ -z "${1:-}" ] || echo "IMAGE_REF=ghcr.io/$REPO@$1" >> "$W/.env"
}
run() { # output in $W/out, status in $RC
  ( cd "$W" && UPDATE_NO_FLOCK="${NO_FLOCK-}" REPO="${REPO_VAR-$REPO}" DEPLOY_SH="$STUBS/deploy.sh" PATH="$STUBS:$PATH" sh "$W/update.sh" ) > "$W/out" 2>&1
  RC=$?
}

echo "# unchanged digest"
new_case "$DIGEST_A"
STUB_DIGEST=$DIGEST_A run
check "exits 0" [ "$RC" -eq 0 ]
check "prints nothing" [ ! -s "$W/out" ]
check "does not deploy" hasnt 'deploy.sh' "$STUB_LOG"
check "asks the registry for the staging tag" has "inspect.*ghcr.io/$REPO:staging" "$STUB_LOG"

echo "# new digest"
new_case "$DIGEST_A"
STUB_DIGEST=$DIGEST_B run
check "exits 0" [ "$RC" -eq 0 ]
check "deploys repo@digest" has "^deploy.sh ghcr.io/$REPO@$DIGEST_B " "$STUB_LOG"
check "points deploy.sh at the self-hosted compose file" has "COMPOSE_FILE=.*/compose.yaml\]" "$STUB_LOG"
check "logs the deploy" has "$DIGEST_B" "$W/out"
check "log has no secrets" no_secrets "$W/out"
check "releases the lock" no_lock

echo "# first run (no IMAGE_REF yet)"
new_case ""
STUB_DIGEST=$DIGEST_B run
check "deploys" has "^deploy.sh ghcr.io/$REPO@$DIGEST_B " "$STUB_LOG"

echo "# failures"
new_case "$DIGEST_A"
FAIL_INSPECT=1 STUB_DIGEST=$DIGEST_B run
check "registry error: non-zero" [ "$RC" -ne 0 ]
check "registry error: no deploy" hasnt 'deploy.sh' "$STUB_LOG"
check "registry error: no secrets logged" no_secrets "$W/out"
for bad_digest in "" "latest" "sha256:abc" "sha256:$(printf 'G%.0s' $(seq 1 64))"; do
  new_case "$DIGEST_A"
  STUB_DIGEST=$bad_digest run
  check "refuses digest '$bad_digest'" [ "$RC" -ne 0 ]
  check "no deploy for digest '$bad_digest'" hasnt 'deploy.sh' "$STUB_LOG"
done
new_case "$DIGEST_A"
FAIL_DEPLOY=1 STUB_DIGEST=$DIGEST_B run
check "deploy failure: non-zero" [ "$RC" -ne 0 ]
check "deploy failure: lock released" no_lock
NL='
'
for r in '' 'Example/App' 'a;b/c' '../x' 'noslash' "example/app${NL}\$(id)" "example/app$(printf '\r')" "${NL}example/app"; do
  new_case "$DIGEST_A"
  REPO_VAR="$r"
  STUB_DIGEST=$DIGEST_B run
  check "bad or missing REPO refused: '$r'" [ "$RC" -ne 0 ]
  check "bad REPO: docker never called: '$r'" [ ! -s "$STUB_LOG" ]
done
unset REPO_VAR

echo "# failed digests are not retried"
new_case "$DIGEST_A"
FAIL_DEPLOY=1 STUB_DIGEST=$DIGEST_B run
check "failed deploy: non-zero" [ "$RC" -ne 0 ]
check "failed deploy: digest recorded next to .env" [ "$(cat "$W/.failed-digest")" = "$DIGEST_B" ]
: > "$STUB_LOG"
STUB_DIGEST=$DIGEST_B run
check "same failed digest: exits 0" [ "$RC" -eq 0 ]
check "same failed digest: no deploy" hasnt 'deploy.sh' "$STUB_LOG"
check "same failed digest: one-line reminder" [ "$(wc -l < "$W/out")" -eq 1 ]
check "same failed digest: reminder names digest and file" sh -c "grep -q '$DIGEST_B' '$W/out' && grep -q '.failed-digest' '$W/out'"
check "same failed digest: .env untouched" has "^IMAGE_REF=ghcr.io/$REPO@$DIGEST_A$" "$W/.env"
DIGEST_C=sha256:$(printf 'c%.0s' $(seq 1 64))
STUB_DIGEST=$DIGEST_C run
check "a different digest is deployed" has "^deploy.sh ghcr.io/$REPO@$DIGEST_C " "$STUB_LOG"
check "success clears the failed marker" [ ! -e "$W/.failed-digest" ]
new_case "$DIGEST_A"
FAIL_DEPLOY=1 STUB_DIGEST=$DIGEST_B run
: > "$STUB_LOG"
rm "$W/.failed-digest"
FAIL_DEPLOY='' STUB_DIGEST=$DIGEST_B run
check "removing the marker allows a retry" has "^deploy.sh ghcr.io/$REPO@$DIGEST_B " "$STUB_LOG"
new_case "$DIGEST_A"
STUB_DIGEST=$DIGEST_B run
check "success leaves no marker" [ ! -e "$W/.failed-digest" ]

echo "# locking (mkdir fallback)"
NO_FLOCK=1
new_case "$DIGEST_A"
mkdir "$W/.update.lock"
echo $$ > "$W/.update.lock/pid"
STUB_DIGEST=$DIGEST_B run
check "live lock: exits 0 quietly" [ "$RC" -eq 0 ]
check "live lock: no deploy" hasnt 'deploy.sh' "$STUB_LOG"
check "live lock: lock left alone" [ -d "$W/.update.lock" ]
new_case "$DIGEST_A"
mkdir "$W/.update.lock"
echo 999999 > "$W/.update.lock/pid"
STUB_DIGEST=$DIGEST_B run
check "stale lock is taken over" has "^deploy.sh " "$STUB_LOG"

NO_FLOCK=

if command -v flock >/dev/null 2>&1; then
  echo "# locking (flock)"
  new_case "$DIGEST_A"
  sh -c 'flock 8 && exec sleep 5' 8> "$W/.update.flock" &
  holder=$!
  sleep 0.3
  STUB_DIGEST=$DIGEST_B run
  check "flock held: exits 0" [ "$RC" -eq 0 ]
  check "flock held: prints nothing" [ ! -s "$W/out" ]
  check "flock held: no deploy" hasnt 'deploy.sh' "$STUB_LOG"
  kill "$holder" 2>/dev/null
  wait "$holder" 2>/dev/null
  STUB_DIGEST=$DIGEST_B run
  check "flock released (holder gone): deploys" has "^deploy.sh " "$STUB_LOG"
  check "flock mode uses no lock directory" no_lock
fi

echo
echo "$PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
