# Release checklist

Nothing here is automated: do it in the GitHub and DigitalOcean UIs. Deploy access is effectively root on the server, so the controls below matter.

## Before the first release

### GitHub repository

- [ ] **Tag ruleset** for `refs/tags/v*`: restrict creation, update and deletion to repository admins, with no bypass list. Anyone who can push a `v*` tag can ship code to the Droplet.
- [ ] **`production` environment** (created by `just github-setup`): add a required reviewer and confirm the deployment policy allows only `v*` tags. Re-running `just github-setup` can reset UI-configured settings, so verify both again afterwards.
- [ ] **Branch protection on `main`**: require a pull request; require the checks `check`, `docker`, `prod-config`, `self-hosted-config`, `deploy-script`, `public-safe` and `analyze`; block force pushes and deletion.
- [ ] **Actions settings**: default workflow token read-only; "Allow GitHub Actions to create and approve pull requests" off; require approval for fork pull requests.
- [ ] **Security settings**: secret scanning and push protection on; private vulnerability reporting on; Dependabot alerts and security updates on. Leave CodeQL "default setup" off, because `.github/workflows/codeql.yml` already runs it.
- [ ] **GHCR package**: after the first image push the package is private and the first deploy's pull is denied. Make it public (Package settings, Danger zone; this is one-way) and link it to the repository. Then re-run the failed deploy job.

### Accounts and migrations (M2)

- [ ] **Sign-up is open to anyone** who can reach the site, unless `SIGNUP_ALLOWLIST` is set. Email must be verified before the first sign-in, and password reset works by email; abuse limits are Better Auth's rate limiting plus the mail throttle (see "Accepted risks" below). Do the off-box backups below first, because the database now holds real accounts.
- [ ] **`BETTER_AUTH_SECRET` and `BETTER_AUTH_URL`** are generated into `/opt/workout-tracker/.env` on the first deploy (`BETTER_AUTH_URL` is `https://<DOMAIN>`). The compose file refuses to start without them. After a domain change edit both `DOMAIN` and `BETTER_AUTH_URL` in that file. Rotating the secret signs every user out.
- [ ] **`RESEND_API_KEY` and `MAIL_FROM`** are not generated: add both to `/opt/workout-tracker/.env` by hand before the first deploy. The compose file and the API refuse to start without them in production. Set up Resend first (see "Resend (production and staging)" below).
- [ ] **`TRUSTED_ORIGINS`** (optional, comma separated, exact origins such as `https://example.com`): leave unset for the web app, which is the `BETTER_AUTH_URL` origin. Add the Capacitor origins only when the mobile builds ship, after verifying their exact strings.
- [ ] **Migrations** run twice per deploy by design: `deploy.sh` runs `migrate.js` after the pre-migration dump (the old app keeps serving), and the new app runs them again on boot (a no-op). A failing migration aborts the deploy before anything changes. Keep migrations backward compatible.

### Data protection basics

- [ ] **Export and deletion exist** (M2c): a signed-in user can download everything the account holds (Settings, "Export my data": library, plans, history, profile and public name, email, listings, votes, downloads) and delete the account (password + DELETE). Deletion is immediate and leaves no personal data in the database; published listings stay as "Deleted user". Mention both in the privacy notice before opening sign-up. Restore from a file (`POST /api/v1/import/replace`) replaces the account's library and history; it needs the password (same per-account limit as deletion) and is refused while a listing is published.
- [ ] **Backups still hold deleted accounts** until they rotate out (pre-deploy dumps keep the newest 5; set the off-box retention to match and say so in the privacy notice).

### Resend (production and staging)

Do this once per sending domain; production and staging can share the account (use separate API keys).

- [ ] Create a Resend account.
- [ ] Add the sending domain (a subdomain such as `mail.<your domain>` keeps it apart from your normal mail) and wait for it to show as verified.
- [ ] Add the DNS records Resend lists: DKIM (a TXT or CNAME record), SPF (a TXT record, plus the MX record on the sending subdomain if Resend asks for it). Optional: a DMARC record.
- [ ] Create an API key with sending access only, scoped to that domain if the plan allows it. Put it in the host's `.env` as `RESEND_API_KEY`; never commit it.
- [ ] Set `MAIL_FROM` to an address on that verified domain, for example `Workout Tracker <no-reply@mail.example.invalid>` (use your own domain).
- [ ] After the first deploy, sign up with an address you control and confirm the verification mail arrives and the link opens `https://<DOMAIN>/verified`; then try "Forgot password?".

### DigitalOcean

- [ ] API token with custom scopes and an expiry; 2FA on the account.
- [ ] DNS `A` record for the domain pointing at the reserved IP (`just tf output -raw ip`) **before** pushing the first tag, so Caddy can obtain a certificate.
- [ ] Optional: a `CAA` record limiting issuance to the CA you use.
- [ ] Back up `infra/terraform/terraform.tfstate` somewhere private (it is gitignored).

### After the Droplet boots (`just server-wait`)

On the server as `admin`:

```sh
sudo sshd -T | grep -Ei 'passwordauth|permitroot|allowusers|allowtcp'
sudo fail2ban-client status sshd
```

Expect password authentication `no`, root login `no`, `allowusers admin deploy`, TCP forwarding `no`, and an active `sshd` jail.

## Rollback

The previous app keeps serving while migrations run, so **migrations must stay backward compatible** with the previous release (add before use, remove one release later).

If bring-up of a new version fails, `deploy.sh` restores the previous image itself and exits non-zero; `.env` keeps naming the old image. To roll back by hand, log in as `admin` and run the deploy script **as the `deploy` user** with the earlier image (see `PREVIOUS_IMAGE_REF` in `/opt/workout-tracker/.env`, or the earlier release's digest):

```sh
sudo -u deploy sh /opt/workout-tracker/deploy.sh ghcr.io/<owner>/<repo>@sha256:<previous digest>
```

Do not run it as root: it would rewrite `.env` and `backups/` as root-owned files, and the next automatic deploy (which runs as `deploy`) could no longer read them.

A rollback does not undo migrations. Restore from a pre-deploy dump only if a migration damaged data.

## Backups

- `deploy.sh` takes a `pg_dump -Fc` into `/opt/workout-tracker/backups/` before each migration (newest 5 kept). That lives on the same disk as the database, so it protects against bad migrations only.
- **TODO before real users (accounts are live in M2):** nightly `pg_dump` to DigitalOcean Spaces (or another off-box location) with a restore test.
- **Back up `/opt/workout-tracker/.env` off the server** (password manager or encrypted storage). Losing the Droplet loses `BETTER_AUTH_SECRET`, which invalidates all sessions, and the database password.

## Staging (self-hosted, separate from production)

Staging runs on a self-hosted Docker host behind an existing Cloudflare Tunnel; see `deploy/self-hosted/README.md`. Nothing here deploys to production.

- [ ] **GHCR package access**: the first push of `:staging` creates a private package. Either make it public (Package settings, Danger zone; one-way), or create a read-only token (`read:packages`) yourself and run `docker login ghcr.io` on the host. Without one of these, `update.sh` cannot resolve or pull the image.
- [ ] **Host `.env`** created from `deploy/self-hosted/.env.example` (mode 600, never committed): `DOMAIN`, `TUNNEL_NETWORK`, generated secrets, `SIGNUP_ALLOWLIST`, `RESEND_API_KEY` and `MAIL_FROM` (sign-in needs a verified email, so staging must be able to send). Back it up privately.
- [ ] **Tunnel public hostname** points at `http://app:3000` on the shared network. Do not publish any port on the host.
- [ ] **Branch protection**: add the checks `self-hosted-config` and `public-safe` to the required list for `main`.
- [ ] **Scheduler** runs `update.sh` with `REPO=<owner>/<repo>`; check its log after the first merge to `main`.
- [ ] **Backups**: copy a `pg_dump` off the host before trusting staging with data you care about.

## Community plans

- [ ] **Public area**: `/api/public/*` is reachable by anyone who can reach the site. Check it through the tunnel before announcing: `GET /api/public/plans` works signed out and returns no private fields.
- [ ] **Sign-up is open**: leave `SIGNUP_ALLOWLIST` unset (empty) for staging while community plans are tried out; the allowlist code stays and can be turned back on at any time by setting it. Anyone can then create an account and publish.
- [ ] **Email verification (M2b) is in place**: an account needs a verified address before it can sign in, so publishing and upvoting are not free to abuse, but verified throwaway addresses still work. Watch the listing count after announcing.
- [ ] **Hiding a listing** (moderation is by hand): `update shared_plan set status='hidden' where id='<listing id>';`. A hidden listing is gone from the public list and 404s everywhere, and its owner cannot reverse it. Set it back to `published` to restore.

## Known limits (staging)

- Community plans: public names can imitate someone else (nothing checks look-alike names; moderation is hiding a listing). A listing kept after its owner deleted the account ("Deleted user") can only be taken down by hiding it.

- The sign-up allowlist (when set) checks an address, not a person. Email verification narrows the old takeover risk: a sign-up for an existing unverified address mails its owner a "choose your password" link, and using it sets their password and signs everyone else out.
- Other containers on the shared tunnel network can bypass per-IP rate limits; only put trusted containers on that network.

## Accepted risks (email auth)

- The first verification mail from an attacker's sign-up still reaches the victim (it is a real mail to a real address; the link only confirms the address and does not sign anyone in).
- Mail bombing through plus-addressing: `name+1@`, `name+2@`, ... are different recipients for the throttle (3 per recipient per hour), so one inbox can still be sent many mails, bounded by the per-IP limits (10 sign-ups and 5 reset or resend requests per hour).
- The mail throttle is in memory and resets when the API restarts.

## Later

- [ ] **Decide whether `TRUSTED_ORIGINS` should be required** in `deploy/compose.yaml` (currently optional, `${TRUSTED_ORIGINS:-}`, because `deploy.sh` does not generate it). Revisit when the Capacitor mobile builds ship and need extra origins.
- [ ] **Verify attestations in `update.sh`**: the staging image is built with provenance and an attestation, but the self-hosted updater does not verify them yet (e.g. `gh attestation verify` against the repository) before deploying a digest.
