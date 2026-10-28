# workout-tracker

A free, simple lifting tracker: build an exercise library, make plans, log sets, and let progression rules set the next session's targets. It works without an account and runs on web, iOS and Android from one codebase.

See [docs/spec.md](docs/spec.md) for the full design and [docs/design-guide.md](docs/design-guide.md) for the UI rules.

## Local development

Requires [Docker](https://docs.docker.com/get-docker/) and [just](https://github.com/casey/just). Node and pnpm run inside containers.

```sh
just dev        # Postgres + API (:3000) + web with hot reload: http://localhost:5173
just check      # typecheck, test, build (same as CI)
just preview    # run the production image locally: http://localhost:8080
just            # list all recipes
```

The first run creates `.env` with random local-only secrets (database password, `BETTER_AUTH_SECRET`). It is gitignored. The API applies the database migrations itself on every start and exits if they fail.

### Accounts and sync

The app works as a guest with all data on the device. Signing up (email + password, 10-128 characters) creates an account and mails a verification link; you can sign in only after confirming the address. Your guest data stays untouched on the device until the first successful sign-in, which uploads it once. From then on the data lives in Postgres behind the REST API (`/api/v1`) and is the same on every device you sign in on. While signed in, set logging keeps working offline: set edits are queued on the device and replayed when the connection returns (last write wins). Starting or finishing a workout needs a connection. Signing out returns to a fresh guest database; the account's data stays on the server.

Settings → Delete account (signed in) exports your data first if you like, then deletes the account immediately after you enter your password and type DELETE; plans you shared stay in Community as "Deleted user".

A forgotten password is reset by email ("Forgot password?"). Resetting also confirms the address and signs out every session. Mail goes through Resend in production and staging (`RESEND_API_KEY`, `MAIL_FROM`); the API refuses to start in production without both.

### Testing email flows locally

`just dev` needs no mail account: the API prints every verification and reset link in its log, on lines starting with `[mail]` (development only; follow them with `just logs dev`). `just preview` runs in production mode with placeholder mail settings, so emails cannot be sent there and new accounts cannot verify; to try the sign-up and reset flows, use `just dev`.

Dev accounts created before email verification existed are unverified and cannot sign in. Either wipe them (`just psql`, then `truncate "user" cascade;`) or follow the verification link logged when you request one again (sign up with the address, or use "Forgot password?").

State-changing API requests must come from a trusted origin: the origin of `BETTER_AUTH_URL`, plus `TRUSTED_ORIGINS` (comma separated) if set. In development, `localhost` and private-network addresses on the Vite port are also accepted so a phone on the same Wi-Fi can sign up.

### Community plans

The Plans tab has a "Community" view with plans other people have shared. Anyone can browse, search and filter the public list without an account. Sign in to publish one of your plans (you pick a public name first; only that name is shown), to upvote, and to have your copies counted. "Use this plan" gives you your own copy, as a guest too. A copy is independent: editing it never changes the original, and the sharer's later edits or unpublishing never change your copy.

### Testing on a phone (same Wi-Fi)

The dev web port (5173) listens on all interfaces; Postgres and the API stay on loopback, and the Vite dev server only serves the web app's own files. Set `DEV_BIND=127.0.0.1` to keep it loopback-only, or `DEV_ALLOWED_HOSTS=name.local` to also allow opening it by machine name. None of this applies to production (`deploy/` publishes only ports 80/443, and CI enforces that).

Run `just lan` for the address to open on the phone and, on Windows with WSL2, the one-time port-forward and firewall commands (WSL2 sits on a private network that other devices cannot reach directly).

## Repository layout

```
apps/
  api/            Hono API (Node), Drizzle schema and migrations
  web/            React + Vite SPA (Capacitor iOS/Android later)
packages/
  shared/         zod schemas, types and logic shared by api and web
deploy/           production compose stack, Caddyfile, deploy script (runs on the server); self-hosted/ staging stack
infra/terraform/  DigitalOcean Droplet, firewall and reserved IP
docs/             spec, architecture diagrams (docs/architecture.md), plans, release checklist
.github/          CI, release/deploy, CodeQL, Dependabot
```

## Releases and deployment

Builds and deploys run only in GitHub Actions:

- **Every PR and push to `main`:** typecheck, test, build, Docker build, dependency review, CodeQL.
- **Pushing a tag `vX.Y.Z`:** runs CI, then publishes a signed-provenance image to GHCR and deploys it by digest to the `production` environment. Only `v*` tags can deploy there.

```sh
git tag v0.1.0 && git push origin v0.1.0
```

## Staging (self-hosted)

Every push to `main` publishes `ghcr.io/<owner>/<repo>:staging` (`.github/workflows/staging.yml`; no deploy step, no secrets beyond `GITHUB_TOKEN`). A self-hosted Docker host that already runs a Cloudflare Tunnel pulls it on a schedule with `deploy/self-hosted/update.sh`. The stack there (`deploy/self-hosted/compose.yaml`) is the app and Postgres only, publishes only on `127.0.0.1`, joins the tunnel's existing Docker network, and can limit sign-up to `SIGNUP_ALLOWLIST` (open when empty, the default). Setup: [deploy/self-hosted/README.md](deploy/self-hosted/README.md). The allowlist is optional: when `SIGNUP_ALLOWLIST` is empty, sign-up is open (the default). Known limits of the invite list: it checks an address, not a person (email verification narrows this: a sign-up for an existing unverified address mails its owner a "choose your password" link, but the first verification mail from an attacker's sign-up still reaches the victim), and other containers on the shared tunnel network can bypass per-IP rate limits, so only put trusted containers on that network. Site-specific values (domain, network name, secrets) live only in the host's `.env`; `just public-check` fails if personal info slips into a tracked file (it fails closed outside a work tree). Set `PUBLIC_SAFE_DENYLIST=/path/to/file` (untracked, one case-insensitive term per line, never printed) to also scan for terms only you know.

## First-time infrastructure setup

You need `gh` (logged in), an SSH key at `~/.ssh/id_ed25519.pub` (or set `WORKOUT_ADMIN_SSH_KEY`), and a DigitalOcean API token. A custom-scoped token is best.

```sh
read -rs DIGITALOCEAN_TOKEN && export DIGITALOCEAN_TOKEN   # never written to disk or history
just infra-plan                 # review
just infra-apply                # Droplet + firewall + reserved IP (safe to re-run)
just server-wait                # wait for first-boot hardening and Docker install
# point your domain's A record at `just tf output -raw ip`
just github-setup example.com   # production environment, deploy key, host, domain
```

Before the first release, work through [docs/release-checklist.md](docs/release-checklist.md) (tag ruleset, environment reviewers, GHCR visibility, DNS, backups, rollback).

Production secrets (database password, `BETTER_AUTH_SECRET`) and `BETTER_AUTH_URL` (`https://<domain>`) are generated on the server during the first deploy and never leave it. Terraform state is local and gitignored, so back up `infra/terraform/terraform.tfstate`. The Droplet ignores later changes to its SSH keys and cloud-init (`ignore_changes`), so rotating the admin or deploy key is a manual step on the server.

## Security

See [SECURITY.md](SECURITY.md) to report a vulnerability.

## License

MIT
