# Release checklist

Nothing here is automated: do it in the GitHub and DigitalOcean UIs. Deploy access is effectively root on the server, so the controls below matter.

## Before the first release

### GitHub repository

- [ ] **Tag ruleset** for `refs/tags/v*`: restrict creation, update and deletion to repository admins, with no bypass list. Anyone who can push a `v*` tag can ship code to the Droplet.
- [ ] **`production` environment** (created by `just github-setup`): add a required reviewer and confirm the deployment policy allows only `v*` tags. Re-running `just github-setup` can reset UI-configured settings, so verify both again afterwards.
- [ ] **Branch protection on `main`**: require a pull request; require the checks `check`, `docker`, `prod-config`, `deploy-script` and `analyze`; block force pushes and deletion.
- [ ] **Actions settings**: default workflow token read-only; "Allow GitHub Actions to create and approve pull requests" off; require approval for fork pull requests.
- [ ] **Security settings**: secret scanning and push protection on; private vulnerability reporting on; Dependabot alerts and security updates on. Leave CodeQL "default setup" off, because `.github/workflows/codeql.yml` already runs it.
- [ ] **GHCR package**: after the first image push the package is private and the first deploy's pull is denied. Make it public (Package settings, Danger zone; this is one-way) and link it to the repository. Then re-run the failed deploy job.

### Accounts and migrations (M2)

- [ ] **Sign-up is open to anyone** who can reach the site: no email verification, no password reset, only Better Auth's rate limiting. Decide whether that is acceptable for the first release, and do the off-box backups below first, because the database now holds real accounts.
- [ ] **`BETTER_AUTH_SECRET` and `BETTER_AUTH_URL`** are generated into `/opt/workout-tracker/.env` on the first deploy (`BETTER_AUTH_URL` is `https://<DOMAIN>`). The compose file refuses to start without them. After a domain change edit both `DOMAIN` and `BETTER_AUTH_URL` in that file. Rotating the secret signs every user out.
- [ ] **`TRUSTED_ORIGINS`** (optional, comma separated, exact origins such as `https://example.com`): leave unset for the web app, which is the `BETTER_AUTH_URL` origin. Add the Capacitor origins only when the mobile builds ship, after verifying their exact strings.
- [ ] **Migrations** run twice per deploy by design: `deploy.sh` runs `migrate.js` after the pre-migration dump (the old app keeps serving), and the new app runs them again on boot (a no-op). A failing migration aborts the deploy before anything changes. Keep migrations backward compatible.

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

## Later

- [ ] **Decide whether `TRUSTED_ORIGINS` should be required** in `deploy/compose.yaml` (currently optional, `${TRUSTED_ORIGINS:-}`, because `deploy.sh` does not generate it). Revisit when the Capacitor mobile builds ship and need extra origins.
