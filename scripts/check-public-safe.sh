#!/bin/sh
# Fails if a git-tracked file contains something that must not be in a public repository:
# an IPv4 address, a token-looking string, an email address, a /home or /root path, a Windows
# or WSL home path (C:\Users\<name>, /mnt/c/Users/<name>), an assignment of a secret variable
# (BETTER_AUTH_SECRET, POSTGRES_PASSWORD, RESEND_API_KEY, *_TOKEN, *_SECRET, *_PASSWORD,
# *_API_KEY with a value of 20+ characters), or the word "unraid" (this project never names the
# owner's hardware). Findings are reported as file:line and rule only, never the matched text,
# so CI logs do not repeat a leaked secret.
# Usage: sh scripts/check-public-safe.sh [repo-dir]     (default: current directory)
#
# It fails closed: outside a git work tree, or when git ls-files fails, it exits non-zero.
#
# PUBLIC_SAFE_DENYLIST=/path/to/file (optional, keep the file untracked and private): one term
# per line, matched case-insensitively as a plain string in every tracked text file, for things
# only the owner knows (a real name, a hostname, a street). Blank lines are ignored. Hits are
# reported as file:line only; the terms are never printed. A set but unreadable file is an error.
#
# Allow-lists are deliberately narrow; add to them only with a comment saying why.
# This script and its test are never scanned: they necessarily spell out the patterns.
set -u

DENYLIST=${PUBLIC_SAFE_DENYLIST:-}
case "$DENYLIST" in '' | /*) ;; *) DENYLIST="$PWD/$DENYLIST" ;; esac

cd "${1:-.}" || exit 2
if ! git rev-parse --is-inside-work-tree > /dev/null 2>&1; then
  echo "Public-safety check cannot run: $PWD is not inside a git work tree (refusing to pass)." >&2
  exit 2
fi
TMP=$(mktemp)
FILES=$(mktemp)
TERMS=$(mktemp)
trap 'rm -f "$TMP" "$FILES" "$TERMS"' EXIT INT TERM
FOUND=0

# The tracked files, listed once so a git failure cannot look like "nothing found".
if ! git ls-files -z > "$FILES"; then
  echo "Public-safety check cannot run: git ls-files failed (refusing to pass)." >&2
  exit 2
fi
if [ -n "$DENYLIST" ]; then
  if [ ! -r "$DENYLIST" ] || [ -d "$DENYLIST" ]; then
    echo "PUBLIC_SAFE_DENYLIST is set but the file is not readable (refusing to pass)." >&2
    exit 2
  fi
  tr -d '\r' < "$DENYLIST" | grep -v '^[[:space:]]*$' > "$TERMS" || true
fi

# "path:line:match" for every match of an ERE (case-sensitive unless $2 is -i) in tracked text
# files; binary files are skipped.
matches() {
  xargs -0 grep -IHnoE ${2:+"$2"} -e "$1" -- < "$FILES" 2>/dev/null \
    | grep -v -e '^scripts/check-public-safe\.sh:' -e '^scripts/test/check-public-safe\.test\.sh:' || true
}

# Splits a "path:line:match" row into $path, $line and $found.
split_row() {
  path=${1%%:*}
  rest=${1#*:}
  line=${rest%%:*}
  found=${rest#*:}
}

fail() { # fail <rule>   (uses $path and $line)
  printf '%s:%s: %s\n' "$path" "$line" "$1"
  FOUND=1
}

# Files where a rule is expected to fire (exact paths).
# pnpm-lock.yaml: package versions look like addresses; maintainer emails may appear.
# origins.test.ts / hardening.test.ts: they test that private-range and user-info-spoofed
#   origins are rejected, so they need such literals.
allowed_file() { # allowed_file <rule> <path>
  case "$1:$2" in
    ipv4:pnpm-lock.yaml | ipv4:apps/api/test/origins.test.ts | ipv4:apps/api/test/hardening.test.ts) return 0 ;;
    email:pnpm-lock.yaml | email:apps/api/test/origins.test.ts) return 0 ;;
    # The commit trailer (Co-Authored-By: ... <noreply@anthropic.com>) quoted in the M2 plan.
    email:docs/superpowers/plans/2026-10-22-m2-accounts-and-sync.md) return 0 ;;
  esac
  return 1
}

# IPv4: allow 0.0.0.0, 127.0.0.1 and the documentation ranges (RFC 5737). Candidates are
# dotted numbers with exactly four parts, so versions such as 1.2.3.4.5 are not addresses.
matches '[0-9]+(\.[0-9]+){3,}' > "$TMP"
while IFS= read -r row; do
  split_row "$row"
  allowed_file ipv4 "$path" && continue
  case "$found" in
    *.*.*.*.*) continue ;;
  esac
  valid=1
  for octet in $(printf '%s' "$found" | tr '.' ' '); do
    [ "$octet" -le 255 ] || valid=0
  done
  [ "$valid" -eq 1 ] || continue
  case "$found" in
    0.0.0.0 | 127.0.0.1 | 192.0.2.* | 198.51.100.* | 203.0.113.*) continue ;;
  esac
  fail "IPv4 address"
done < "$TMP"

# Tokens and key material.
for pattern in \
  '(^|[^A-Za-z0-9_])gh[pousr]_[A-Za-z0-9]{20,}' \
  '(^|[^A-Za-z0-9_])github_pat_[A-Za-z0-9_]{20,}' \
  '(^|[^A-Za-z0-9_])re_[A-Za-z0-9]{20,}' \
  '(^|[^A-Za-z0-9+/=_-])eyJ[A-Za-z0-9_-]{20,}' \
  '-----BEGIN'; do
  matches "$pattern" > "$TMP"
  while IFS= read -r row; do
    split_row "$row"
    fail "token or key material"
  done < "$TMP"
done

# Email addresses: only example.*, *.example, *.invalid and GitHub's users.noreply.github.com
# are fine. A "noreply" local part on any other domain is a real address like any other.
matches '[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}' > "$TMP"
while IFS= read -r row; do
  split_row "$row"
  allowed_file email "$path" && continue
  domain=$(printf '%s' "${found#*@}" | tr '[:upper:]' '[:lower:]')
  case ".$domain" in
    .example.* | *.example.* | *.example | *.invalid | .users.noreply.github.com) continue ;;
  esac
  fail "email address"
done < "$TMP"

# Personal filesystem paths.
matches '(^|[^A-Za-z0-9_.-])/(home|root)/' > "$TMP"
while IFS= read -r row; do
  split_row "$row"
  fail "/home or /root path"
done < "$TMP"

# Windows and WSL home paths (C:\Users\name, C:/Users/name, /mnt/c/Users/name). Obvious
# placeholders are fine: <name>, $VAR, %USERNAME%, {name}, USER, username, yourname, Public, Default.
matches '(^|[^A-Za-z0-9_])([A-Za-z]:[\\/]+|/mnt/[a-z]/)Users[\\/]+[^\\/[:space:]"'"'"'`]+' -i > "$TMP"
while IFS= read -r row; do
  split_row "$row"
  name=$(printf '%s' "${found##*[\\/]}" | tr '[:upper:]' '[:lower:]')
  case "$name" in
    '<'* | '$'* | '%'* | '{'* | user | username | yourname | public | default) continue ;;
  esac
  fail "Windows or WSL home path"
done < "$TMP"

# Assignments of secret variables with a value of 20+ characters (name=value, name: value,
# quoted or not). Anything that only refers to a value is fine: ${VAR}, $(cmd), <placeholder>,
# process.env.X, and the documented replace-with-... placeholders of .env.example files.
matches '(^|[^A-Za-z0-9_{$])(BETTER_AUTH_SECRET|POSTGRES_PASSWORD|RESEND_API_KEY|[A-Z0-9_]*(TOKEN|SECRET|PASSWORD|API_KEY))["'"'"']?[[:space:]]*[:=][[:space:]]*["'"'"']?[^[:space:]"'"'"']{20,}' > "$TMP"
while IFS= read -r row; do
  split_row "$row"
  value=$(printf '%s' "${found#*[:=]}" | sed "s/^[[:space:]]*[\"']*//")
  case "$value" in
    '$'* | '<'* | replace-with-* | process.env*) continue ;;
    # A sed/regex fragment, not a value (the justfile `setup` recipe rewrites .env.example).
    '.*'*) continue ;;
  esac
  # Dummy values used by tests (exact path and exact value; not real credentials).
  case "$path:$value" in
    apps/api/test/helpers.ts:test-secret-test-secret-test-secret-0000) continue ;;
    apps/api/test/hardening.test.ts:FAKE-SESSION-TOKEN-77d0e5b4) continue ;;
    deploy/test/update.test.sh:hunter2hunter2*) continue ;; # canary values the test greps the log for
  esac
  fail "secret variable with a literal value"
done < "$TMP"

# Terms from the owner's private denylist (PUBLIC_SAFE_DENYLIST); only the location is printed.
if [ -s "$TERMS" ]; then
  xargs -0 grep -IHnoiF -f "$TERMS" -- < "$FILES" 2>/dev/null \
    | grep -v -e '^scripts/check-public-safe\.sh:' -e '^scripts/test/check-public-safe\.test\.sh:' > "$TMP" || true
  while IFS= read -r row; do
    split_row "$row"
    fail "denylisted term"
  done < "$TMP"
fi

# The owner's hardware is not named anywhere in the repository.
matches 'unraid' -i > "$TMP"
while IFS= read -r row; do
  split_row "$row"
  fail "forbidden word"
done < "$TMP"

if [ "$FOUND" -ne 0 ]; then
  echo "Public-safety check failed. Remove the above, or narrow-allow a deliberate fixture in scripts/check-public-safe.sh." >&2
  exit 1
fi
echo "Public-safety check passed."
