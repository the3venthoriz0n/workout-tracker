# M3 Production Behind Cloudflare Implementation Plan

> **Status: On hold (2026-10-26). Not started and no date; a self-hosted staging stack at home comes first. Nothing here has been applied to any account.**

> **For agentic workers:** Use superpowers:subagent-driven-development (lean variant: one implementer per task, tests or validation commands first, controller reads the diff; independent review only for Tasks 2, 3 and the final pass) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. **Nothing in this plan is applied to a real account until the owner says so**: agents write code, tests and docs only; `terraform apply`, DNS changes, tags and pushes are manual steps in the runbook.

> Note: a self-hosted staging environment exists (`deploy/self-hosted/`); this plan is still on hold.

**Goal:** Run the app on one DigitalOcean Droplet that is reachable only through Cloudflare, with the real client IP preserved for rate limiting, Resend mail configured, and every secret seeded through scripted, no-echo commands.

**Architecture:** Cloudflare proxies the domain (SSL mode Full (strict)). Caddy keeps its own Let's Encrypt certificate (HTTP-01 validates through the proxy; bring-up order below avoids the chicken-and-egg), trusts Cloudflare's published ranges and rewrites `X-Forwarded-For` to the real client IP, which the API already uses for rate limiting. The DigitalOcean firewall accepts 80/443 only from Cloudflare's ranges. Cloudflare settings and DNS are managed by Terraform (provider token stays local, like the DigitalOcean one). Runtime secrets live in the server's `.env`; CI secrets live in the GitHub `production` environment.

**Tech Stack:** Terraform (existing, plus the Cloudflare provider, exact-pinned), Caddy 2.11.7, deploy.sh (POSIX sh), GitHub Actions, `gh`, Just.

**Spec:** `docs/spec.md` §2, §11 (hosting), §13, §14, §15. Email app code is a separate plan: `docs/superpowers/plans/2026-10-25-m2b-email-auth.md`; this plan only carries its two secrets to the server.

## Global Constraints

- No domain name, IP, token, key or email address appears in the repo, in commits or in workflow logs. The domain enters only as the `DOMAIN` environment variable and the `DOMAIN`/`TF_VAR_domain` inputs at run time.
- Cloudflare SSL mode **Full (strict)**, never Flexible. Minimum TLS 1.2, Always Use HTTPS on. Do not cache `/api/*`.
- The origin firewall allows 80 and 443 (and 443/udp is dropped, since Cloudflare does not use HTTP/3 to origin) only from Cloudflare's IPv4 and IPv6 ranges; SSH stays key-only as today.
- Caddy trusts only Cloudflare's ranges for `CF-Connecting-IP`; a request from anywhere else cannot choose the IP the API sees.
- The API's own auth rate limits stay on in production (second layer behind Cloudflare). A new `AUTH_RATE_LIMIT=off` switch exists for development only and the process refuses to start with it in production.
- Secrets are only ever read with `read -rs` or from stdin, never as arguments, never echoed. Tokens use least privilege and an expiry.
- Everything runs through `just`; exact pins; existing conventions in `deploy/`, `infra/terraform/`, `.github/workflows/`.

## Review Focus

- A request that reaches the origin directly (bypassing Cloudflare) with a forged `CF-Connecting-IP` or `X-Forwarded-For`: must be refused by the firewall; if it ever arrives, Caddy must not trust the header.
- Cloudflare's ranges change: the committed list goes stale and Caddy starts distrusting real Cloudflare traffic (everyone shares one IP bucket) or the firewall blocks real traffic. A refresh recipe and a CI freshness check catch this.
- First deploy: certificate issuance while the record is proxied and Always Use HTTPS is on.
- `deploy.sh` re-run with missing or empty Resend values must not write empty secrets into `.env` or wipe existing ones.
- A rotated `RESEND_API_KEY` must reach the server without recreating `.env` or the database password.
- Terraform state holds sensitive values (tokens are not stored, but zone and record ids are): it stays gitignored and backed up.

---

## Runbook (manual, owner, in this order; the plan's tasks produce the tooling for it)

1. **Domain:** choose and buy one (Cloudflare Registrar sells at cost) or point an existing one at Cloudflare; the zone must show Active.
2. **Resend:** add the sending domain (use a subdomain such as `mail.<domain>`), copy the SPF/DKIM records into Cloudflare DNS as **DNS only (grey cloud)**, wait for "Verified", add a DMARC record (`p=none` first), create an API key restricted to "Sending access" for that domain.
3. **Cloudflare API token** (local env var only): scopes Zone:DNS:Edit, Zone:Zone Settings:Edit, Zone:Zone:Read, Zone:Rulesets/Firewall:Edit, limited to the one zone, with an expiry.
4. `just secrets-setup` (Task 4) seeds the GitHub `production` environment; `just infra-plan` then `just infra-apply` (DNS record starts **DNS only**).
5. Push the first `v*` tag (deploy). Confirm the site loads over HTTPS and Caddy obtained its certificate.
6. Flip the DNS record to **proxied** (`just infra-apply` with `TF_VAR_proxied=true`), set SSL mode Full (strict), verify Task 5's checks.

---

### Task 1: Development rate-limit switch

**Files:** Modify `apps/api/src/env.ts`, `apps/api/src/auth.ts`, `compose.yaml` (dev service), `apps/api/test/auth.test.ts`, `apps/api/test/env.test.ts`.

**Interfaces:** Produces `env.AUTH_RATE_LIMIT: 'on' | 'off'` (default `'on'`); `createAuth` reads `env.AUTH_RATE_LIMIT !== 'off'` for `rateLimit.enabled`.

- [ ] **Step 1: Failing tests:** `off` disables the 429 after 5 failed sign-ins in test/development; `NODE_ENV=production` with `AUTH_RATE_LIMIT=off` exits at startup; default stays `on` (existing 429 test unchanged).
- [ ] **Step 2: Run; expect FAIL.**
- [ ] **Step 3: Implement;** dev compose sets `AUTH_RATE_LIMIT: off` so phone and browser testing share no bucket.
- [ ] **Step 4: Run; expect PASS;** commit `feat(api): development-only switch for auth rate limits`.

### Task 2: Real client IP behind Cloudflare (Caddy)

**Files:** Create `deploy/cloudflare-ips.caddy` (generated), `deploy/test/caddy.test.sh`; Modify `deploy/Caddyfile`, `deploy/compose.yaml` (mount the list), `justfile` (`cf-ips`), `.github/workflows/ci.yml`.

**Interfaces:** `just cf-ips` fetches `https://www.cloudflare.com/ips-v4` and `/ips-v6` and rewrites `deploy/cloudflare-ips.caddy` as a `trusted_proxies static ...` fragment (sorted, deterministic).

- [ ] **Step 1: Failing validation first:** `caddy.test.sh` runs `caddy validate` (official image, pinned digest as in compose) on the Caddyfile with a dummy `DOMAIN`, and asserts the adapted JSON contains `client_ip_headers: ["CF-Connecting-IP"]`, `trusted_proxies` equal to the committed list, and that the reverse proxy sets `X-Forwarded-For` to `{client_ip}`.
- [ ] **Step 2: Run; expect FAIL.**
- [ ] **Step 3: Implement:** global options `servers { trusted_proxies static <list>; client_ip_headers CF-Connecting-IP }`; `reverse_proxy app:3000 { header_up X-Forwarded-For {client_ip} }`; commit the first generated list. CI runs `caddy.test.sh` and a `cf-ips --check` job that fails if the live ranges differ from the committed file (scheduled weekly as well, so staleness shows up as a failing run, not an outage).
- [ ] **Step 4: Run; expect PASS;** commit `feat(deploy): trust Cloudflare ranges and forward the real client IP`.
- [ ] **Step 5: Independent opus review** with Task 3.

### Task 3: Terraform: Cloudflare settings and origin lockdown

**Files:** Modify `infra/terraform/{versions,variables,main,outputs}.tf`, `justfile` (`infra-*` pass `CLOUDFLARE_API_TOKEN`), `.gitignore` check; Create `infra/terraform/cloudflare.tf`.

**Interfaces:** variables `domain` (string, validated lowercase hostname), `proxied` (bool, default `false`); the DigitalOcean firewall's 80/443 `source_addresses` come from Cloudflare's ranges (`data "cloudflare_ip_ranges"` or an equivalent data source in the pinned provider version, verified against its docs); removes the udp/443 rule.

- [ ] **Step 1: Validation first:** `just tf validate` and `just tf plan` fail with the new variables unset; add a `terraform test` or a `plan` assertion that no inbound rule other than 22 has `0.0.0.0/0`.
- [ ] **Step 2: Implement:** provider pinned exactly; `A` record to the reserved IP with `proxied = var.proxied`; zone settings: `ssl = strict`, `min_tls_version = 1.2`, `always_use_https = on`; a rate-limit ruleset for `/api/auth/*` using only what the free plan allows (verify the plan's limits in the provider docs and note them in a comment); a cache rule bypassing `/api/*`. Resource names differ between provider major versions: use the pinned version's documentation, not memory.
- [ ] **Step 3:** `just infra-plan` against a throwaway/empty configuration must produce a readable plan; **do not apply**. Commit `feat(infra): Cloudflare DNS and settings, origin firewall limited to Cloudflare`.
- [ ] **Step 4: Independent opus review** (with Task 2): bypass paths, port 80 reachability for ACME, state contents, token scopes in docs.

### Task 4: Secrets seeding and mail settings on the server

**Files:** Modify `deploy/deploy.sh`, `deploy/compose.yaml`, `deploy/test/deploy.test.sh`, `.github/workflows/release.yml`, `justfile`; Create nothing else.

**Interfaces:** `deploy.sh` accepts `RESEND_API_KEY` and `MAIL_FROM` from the environment of the SSH call and upserts them into `.env` (mode 600, atomic temp-file move, never empty, never printed); compose passes both to `app` with `${RESEND_API_KEY:?}` and `${MAIL_FROM:?}` and sets `AUTH_RATE_LIMIT` unset. `just secrets-setup domain` prompts (`read -rs`) for `RESEND_API_KEY` and reads `MAIL_FROM` as a plain prompt, then `gh secret set RESEND_API_KEY --env production` (stdin) and `gh variable set MAIL_FROM --env production`; `just secrets-check` prints the names present versus required in the `production` environment (names only, never values).

- [ ] **Step 1: Failing tests** in `deploy.test.sh` (stubbed docker): first deploy with both values writes them to `.env` with mode 600; a later deploy without them keeps the existing values; a later deploy with a different key replaces only that line; empty values are rejected and leave `.env` byte-identical; values never appear in the script's output.
- [ ] **Step 2: Run; expect FAIL.**
- [ ] **Step 3: Implement.** The release workflow passes the key through the SSH command's stdin (not the command line) so it is not in the process list or logs; the smoke test also checks `/healthz`.
- [ ] **Step 4: Run tests and `shellcheck`; expect PASS;** commit `feat(deploy): carry Resend settings to the server; scripted secret seeding`.

### Task 5: Verification tooling, docs, final review

**Files:** Create `deploy/verify-origin.sh` (run by the owner after step 6 of the runbook); Modify `docs/release-checklist.md`, `docs/spec.md`, `README.md`, `CLAUDE.md`.

- [ ] **Step 1:** `verify-origin.sh <domain> <ip>` checks, using only `curl`: (a) `https://<domain>/healthz` is 200 through Cloudflare and the response has Cloudflare headers; (b) `curl --resolve <domain>:443:<ip>` straight to the origin times out or is refused; (c) a request through Cloudflare with a forged `X-Forwarded-For` shows in the API the real client IP (via a one-off `GET /api/auth/get-session` log line is not available, so assert by timing two bursts of failed sign-ins from the same client: they share one rate-limit bucket, not one bucket per forged value); (d) HTTP redirects to HTTPS; (e) `/api/v1/me` is not cached (`cf-cache-status` is not `HIT`). Exits non-zero with a readable reason.
- [ ] **Step 2:** Update the release checklist with the runbook above (including the bring-up order, token scopes, Resend DNS records as DNS-only, and a quarterly check that `cf-ips` CI is green), spec §11/§13/§14, CLAUDE.md invariants.
- [ ] **Step 3:** `just check` once; shellcheck; `terraform validate`. One final independent review of the whole plan's diff for secret handling and bypass paths.
- [ ] **Step 4:** Commit `docs: production runbook behind Cloudflare`. **Stop. Do not run `infra-apply`, push tags, or touch DNS; hand the runbook to the owner.**
