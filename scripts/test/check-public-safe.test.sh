#!/bin/sh
# shellcheck disable=SC2016  # fixtures deliberately contain unexpanded ${VAR} and $(cmd) text
# Tests scripts/check-public-safe.sh against throwaway git repos. Run: sh scripts/test/check-public-safe.test.sh
# Fixtures are written at run time; this file and the script are excluded from the scan by path.
set -u

HERE=$(cd "$(dirname "$0")" && pwd)
SCRIPT="$HERE/../check-public-safe.sh"
ROOT=$(mktemp -d)
trap 'rm -rf "$ROOT"' EXIT INT TERM

PASS=0
FAIL=0
ok() { PASS=$((PASS + 1)); echo "ok   - $1"; }
bad() { FAIL=$((FAIL + 1)); echo "FAIL - $1"; }

n=0
# repo_with <path> <content>: new git repo with one tracked file; sets R.
repo_with() {
  n=$((n + 1))
  R="$ROOT/r$n"
  mkdir -p "$R"
  git -C "$R" init -q
  mkdir -p "$R/$(dirname "$1")"
  printf '%s\n' "$2" > "$R/$1"
  git -C "$R" add -A
}
scan() { sh "$SCRIPT" "$R" > "$R.out" 2>&1; RC=$?; }

must_fail() { # must_fail <description> <path> <content> [secret text that must not be echoed]
  repo_with "$2" "$3"
  scan
  if [ "$RC" -ne 0 ] && grep -q -- "$2" "$R.out"; then ok "flags $1"; else bad "flags $1 (rc=$RC)"; fi
  if [ -n "${4:-}" ] && grep -q -F -- "$4" "$R.out"; then bad "$1: output must not echo the secret"; fi
}
must_pass() { # must_pass <description> <path> <content>
  repo_with "$2" "$3"
  scan
  if [ "$RC" -eq 0 ]; then ok "allows $1"; else bad "allows $1 (rc=$RC): $(cat "$R.out")"; fi
}

PFX_GH=ghp
PFX_PAT=github_pat
PFX_RE=re
PFX_JWT=eyJ
TOK="abcdefghij0123456789ABCDEFGH"

echo "# IPv4"
must_fail "a LAN address" a.txt "host 192.168.1.50 here"
must_fail "a public address" a.txt "ssh 8.8.4.4"
must_fail "an address in a URL" a.txt "http://45.33.12.9:8080/x"
must_pass "0.0.0.0 and 127.0.0.1" a.txt "bind 0.0.0.0 and 127.0.0.1:3000"
must_pass "documentation ranges" a.txt "192.0.2.4 198.51.100.7 203.0.113.250"
must_pass "version-like strings with five parts" a.txt "build 1.2.3.4.5 and v10.20.30"
must_pass "numbers above 255 (not an address)" a.txt "id 300.400.500.600"
must_fail "IPv4 in a test file that is not allow-listed" apps/x/other.test.ts "'10.1.2.3'"
must_pass "private-range fixtures in the origin policy test" apps/api/test/origins.test.ts "'http://10.0.0.1:5173' '192.168.1.1'"
must_pass "version strings in the lockfile" pnpm-lock.yaml "version: 1.2.3.4 and 9.9.9.9"

echo "# tokens"
must_fail "a GitHub token" t.txt "x ${PFX_GH}_${TOK}" "$TOK"
must_fail "a fine-grained GitHub token" t.txt "x ${PFX_PAT}_${TOK}" "$TOK"
must_fail "an email-provider key" t.txt "key=${PFX_RE}_${TOK}" "$TOK"
must_fail "a JWT-like string" t.txt "Bearer ${PFX_JWT}${TOK}" "$TOK"
must_fail "a PEM block" t.txt "-----BEGIN PRIVATE KEY-----"
must_pass "a short re_ identifier" t.txt "const pre_x = re_short"
must_pass "base64 integrity hashes" t.txt "integrity: sha512-AAAA${PFX_JWT}${TOK}BBBB=="

echo "# emails"
must_fail "a real-looking address" e.txt "mail someone@gmail.com"
must_fail "a custom domain" e.txt "mail me@mydomain.dev"
must_pass "example domains" e.txt "a@example.com b@example.org c@sub.example.net"
must_pass "the .invalid and .example TLDs" e.txt "a@host.invalid b@evil.example"
must_pass "the GitHub noreply address" e.txt "123+bot@users.noreply.github.com"
must_fail "a noreply local part on an arbitrary domain" e.txt "mail noreply@mydomain.dev"
must_fail "a +noreply local part on an arbitrary domain" e.txt "mail me+noreply@mydomain.dev"
must_fail "a fake users.noreply look-alike domain" e.txt "me@users.noreply.mydomain.dev"
must_pass "the commit trailer address in the M2 plan" docs/superpowers/plans/2026-10-22-m2-accounts-and-sync.md "Co-Authored-By: Claude <noreply@anthropic.com>"
must_fail "the commit trailer address elsewhere" docs/other.md "Co-Authored-By: Claude <noreply@anthropic.com>"
must_pass "package versions and scopes" e.txt "pnpm@10.1.0 esbuild@0.25.0 @scope/pkg image@sha256:abc"
must_pass "URL userinfo fixtures in the origin policy test" apps/api/test/origins.test.ts "'http://localhost@evil.com'"

echo "# personal paths"
must_fail "a /home path" p.txt "cd /home/someone/project"
must_fail "a /root path" p.txt "cp x /root/_dev/y"
must_pass "URLs and relative paths that contain home" p.txt "https://example.com/home/ and ./home/x and src/root/y"

echo "# Windows and WSL home paths"
must_fail "a Windows profile path" w.txt 'open C:\Users\someone\Documents'
must_fail "a doubled-backslash Windows path" w.txt '"C:\\Users\\someone\\x"'
must_fail "a forward-slash Windows path" w.txt 'D:/Users/someone/x'
must_fail "a WSL mount path" w.txt 'cd /mnt/c/Users/someone/code'
must_pass "placeholder <name>" w.txt 'C:\Users\<name>\x and /mnt/c/Users/<name>/y'
must_pass "placeholder USER and username" w.txt 'C:\Users\USER\x /mnt/c/Users/username/y C:\Users\%USERNAME%\z'
must_pass "a shell variable" w.txt '/mnt/c/Users/$USER/x'
must_pass "Users in an unrelated path" w.txt 'src/Users/list.ts and /srv/Users/x'

echo "# secret assignments"
LONG="Zx9qLm4Tt7Rv2Wk8Pa3Nc6Yd1Hb5Je0F"
must_fail "BETTER_AUTH_SECRET with a real value" s.env "BETTER_AUTH_SECRET=$LONG" "$LONG"
must_fail "POSTGRES_PASSWORD with a real value" s.env "POSTGRES_PASSWORD=$LONG" "$LONG"
must_fail "RESEND_API_KEY with a real value" s.env "RESEND_API_KEY=$LONG" "$LONG"
must_fail "a *_TOKEN assignment" s.env "DEPLOY_TOKEN=$LONG" "$LONG"
must_fail "a quoted *_SECRET in TypeScript" s.ts "const x = { SESSION_SECRET: '$LONG' }" "$LONG"
must_fail "a YAML *_PASSWORD" s.yaml "  DB_PASSWORD: $LONG" "$LONG"
must_pass "a short value" s.env "POSTGRES_PASSWORD=short"
must_pass "the .env.example placeholders" deploy/self-hosted/.env.example "POSTGRES_PASSWORD=replace-with-random-hex
BETTER_AUTH_SECRET=replace-with-random-hex"
must_pass "compose variable references" c.yaml 'BETTER_AUTH_SECRET: ${BETTER_AUTH_SECRET:?run just setup}'
must_pass "shell command substitutions" c.sh 'POSTGRES_PASSWORD=$(openssl rand -hex 24)'
must_pass "a password reference inside a URL" c.yaml 'DATABASE_URL: postgres://${POSTGRES_USER:?}:${POSTGRES_PASSWORD:?}@db:5432/${POSTGRES_DB:?}'
must_pass "a sed expression that rewrites the variable" j.txt 's/^POSTGRES_PASSWORD=.*/POSTGRES_PASSWORD=x/'
must_pass "angle-bracket placeholders" c.md "BETTER_AUTH_SECRET=<generate with openssl rand -hex 32>"
must_pass "the dummy API test secret" apps/api/test/helpers.ts "BETTER_AUTH_SECRET: 'test-secret-test-secret-test-secret-0000'"
must_fail "the dummy test secret anywhere else" other.ts "BETTER_AUTH_SECRET: 'test-secret-test-secret-test-secret-0000'"
must_pass "the fake session token in the hardening test" apps/api/test/hardening.test.ts "const TOKEN = 'FAKE-SESSION-TOKEN-77d0e5b4'"

echo "# fail closed"
n=$((n + 1))
R="$ROOT/r$n"
mkdir -p "$R"
printf '%s\n' "fine" > "$R/a.txt"
scan
if [ "$RC" -ne 0 ] && grep -qi 'git' "$R.out"; then ok "fails with a message outside a work tree"; else bad "fails outside a work tree (rc=$RC)"; fi
if [ "$RC" -ne 0 ] && ! grep -q 'passed' "$R.out"; then ok "does not report success outside a work tree"; else bad "reported success outside a work tree"; fi

echo "# optional denylist"
DENY="$ROOT/deny.txt"
printf '%s\n' 'Secret Name' '' 'another-term' > "$DENY"
deny_scan() { PUBLIC_SAFE_DENYLIST="$DENY" sh "$SCRIPT" "$R" > "$R.out" 2>&1; RC=$?; }
repo_with d.txt "met someone called secret NAME yesterday"
deny_scan
if [ "$RC" -ne 0 ] && grep -q 'd.txt' "$R.out"; then ok "flags a denylisted term (case-insensitive)"; else bad "flags a denylisted term (rc=$RC)"; fi
if grep -qi -e 'secret name' -e 'another-term' "$R.out"; then bad "denylist: output must not echo the term"; else ok "denylist: the term is never printed"; fi
repo_with d.txt "an unrelated sentence"
deny_scan
if [ "$RC" -eq 0 ]; then ok "denylist: clean repo passes"; else bad "denylist: clean repo passes (rc=$RC)"; fi
repo_with d.txt "contains another-term here"
scan
if [ "$RC" -eq 0 ]; then ok "denylist is off when the variable is unset"; else bad "denylist is off when the variable is unset"; fi
repo_with d.txt "fine"
PUBLIC_SAFE_DENYLIST="$ROOT/missing.txt" sh "$SCRIPT" "$R" > "$R.out" 2>&1; RC=$?
if [ "$RC" -ne 0 ]; then ok "an unreadable denylist fails closed"; else bad "an unreadable denylist fails closed"; fi
printf '\n\n' > "$DENY"
repo_with d.txt "anything"
deny_scan
if [ "$RC" -eq 0 ]; then ok "blank lines in the denylist do not match everything"; else bad "blank denylist lines match everything"; fi

echo "# the word unraid"
must_fail "unraid in lowercase" w.txt "runs on unraid"
must_fail "unraid in mixed case" w.txt "Runs on UnRAID boxes"

echo "# scope"
n=$((n + 1))
R="$ROOT/r$n"
mkdir -p "$R"
git -C "$R" init -q
printf '%s\n' "host 8.8.4.4" > "$R/untracked.txt"
printf '%s\n' "fine" > "$R/tracked.txt"
git -C "$R" add tracked.txt
scan
if [ "$RC" -eq 0 ]; then ok "ignores untracked files"; else bad "ignores untracked files"; fi

n=$((n + 1))
R="$ROOT/r$n"
mkdir -p "$R"
git -C "$R" init -q
printf '\000\001 8.8.4.4 \000' > "$R/blob.bin"
git -C "$R" add blob.bin
scan
if [ "$RC" -eq 0 ]; then ok "ignores binary files"; else bad "ignores binary files"; fi

must_pass "a clean file" c.txt "nothing to see: user@example.com 127.0.0.1"

n=$((n + 1))
R="$ROOT/r$n"
mkdir -p "$R/scripts/test"
git -C "$R" init -q
printf '%s\n' "8.8.4.4 /home/x unraid" > "$R/scripts/check-public-safe.sh"
printf '%s\n' "8.8.4.4 /home/x unraid" > "$R/scripts/test/check-public-safe.test.sh"
git -C "$R" add -A
scan
if [ "$RC" -eq 0 ]; then ok "does not scan itself or its test"; else bad "does not scan itself or its test"; fi

echo "# reports every file"
n=$((n + 1))
R="$ROOT/r$n"
mkdir -p "$R"
git -C "$R" init -q
echo "8.8.4.4" > "$R/one.txt"
echo "cd /home/u" > "$R/two.txt"
git -C "$R" add -A
scan
if [ "$RC" -ne 0 ] && grep -q one.txt "$R.out" && grep -q two.txt "$R.out"; then ok "lists all offending files"; else bad "lists all offending files"; fi

echo
echo "$PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
