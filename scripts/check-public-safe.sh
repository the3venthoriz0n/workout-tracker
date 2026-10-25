#!/bin/sh
# Fails if a git-tracked file contains something that must not be in a public repository:
# an IPv4 address, a token-looking string, an email address, a /home or /root path, or the
# word "unraid" (this project never names the owner's hardware). Findings are reported as
# file:line and rule only, never the matched text, so CI logs do not repeat a leaked secret.
# Usage: sh scripts/check-public-safe.sh [repo-dir]     (default: current directory)
#
# Allow-lists are deliberately narrow; add to them only with a comment saying why.
# This script and its test are never scanned: they necessarily spell out the patterns.
set -u

cd "${1:-.}" || exit 2
TMP=$(mktemp)
trap 'rm -f "$TMP"' EXIT INT TERM
FOUND=0

# "path:line:match" for every match of an ERE (case-sensitive unless $2 is -i) in tracked text
# files; binary files are skipped.
matches() {
  git ls-files -z \
    | xargs -0 grep -IHnoE ${2:+"$2"} -e "$1" -- 2>/dev/null \
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

# Email addresses: only example.*, *.example, *.invalid and noreply addresses are fine.
matches '[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}' > "$TMP"
while IFS= read -r row; do
  split_row "$row"
  allowed_file email "$path" && continue
  local_part=${found%%@*}
  domain=$(printf '%s' "${found#*@}" | tr '[:upper:]' '[:lower:]')
  case "$local_part" in noreply | *+noreply | *-noreply) continue ;; esac
  case ".$domain" in
    .example.* | *.example.* | *.example | *.invalid | *.noreply.*) continue ;;
  esac
  fail "email address"
done < "$TMP"

# Personal filesystem paths.
matches '(^|[^A-Za-z0-9_.-])/(home|root)/' > "$TMP"
while IFS= read -r row; do
  split_row "$row"
  fail "/home or /root path"
done < "$TMP"

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
