#!/bin/sh
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
must_pass "noreply addresses" e.txt "noreply@anthropic.com 123+bot@users.noreply.github.com"
must_pass "package versions and scopes" e.txt "pnpm@10.1.0 esbuild@0.25.0 @scope/pkg image@sha256:abc"
must_pass "URL userinfo fixtures in the origin policy test" apps/api/test/origins.test.ts "'http://localhost@evil.com'"

echo "# personal paths"
must_fail "a /home path" p.txt "cd /home/someone/project"
must_fail "a /root path" p.txt "cp x /root/_dev/y"
must_pass "URLs and relative paths that contain home" p.txt "https://example.com/home/ and ./home/x and src/root/y"

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
