# Workout Tracker

A free, very simple lifting tracker: exercise library, gear, plans with per-plan overrides, set logging, and automatic progression. Guest mode works without an account. Web plus iOS/Android from one codebase.

## Source of truth

[docs/spec.md](docs/spec.md) covers the data model, core logic, API, screens and deploy, plus a decisions log, open questions and unverified facts. Read it before making design decisions.

Diagrams of the system, repo layout, Repo contract and sign-in flow: [docs/architecture.md](docs/architecture.md).

When a decision changes, update the spec. Don't leave it only in chat.

## Working style

- Keep answers brief. Only state things that are verified, and say so when something is uncertain.
- Keep the build "very very simple". Don't add a dependency, layer or service unless the spec calls for it.
- Check the facts in the spec's "Unverified" list before building the part that depends on them.
- This is a public repo. Never commit personal info, secrets, IPs, domains, tokens or state files.

## Commands

Run everything through `just` (Docker + just only; Node/pnpm live in containers). `just` lists the recipes.
- `just dev`: hot-reload dev stack. `just check`: what CI runs. `just preview`: production image locally.
- `just pnpm <args>`: any pnpm command, e.g. `just pnpm --filter @workout/api add <pkg>`.
- The justfile forces `DOCKER_CONTEXT=default` (the local engine) because the machine's active context may be remote.

## Stack (decided; don't relitigate)

pnpm monorepo, all TypeScript:
- `apps/web`: React + Vite static SPA, Tailwind + shadcn/ui, TanStack Query, Dexie (guest/offline), Capacitor (`ios/`, `android/`)
- `apps/api`: Hono on Node, Better Auth (email/password with email verification and reset via Resend, plus the bearer plugin for mobile), Drizzle + Postgres. Bundled with esbuild, so the runtime image has no node_modules.
- `packages/shared`: zod schemas, types, the progression engine, `entitlements.ts`

There is one Docker image (Hono serves both `/api/*` and the SPA) plus Postgres, deployed with Docker Compose and Caddy on a DigitalOcean Droplet. A later split into separate frontend and backend containers is possible, so keep every API route under `/api/*` and the SPA's API base URL in env.
Rejected options: Supabase, Next.js/SSR, a separate frontend container (v1), App Platform, PWA-only, social login in v1, and full two-way sync in v1.

## CI/CD and infra

- All builds and deploys run in GitHub Actions. PRs and `main` run CI. A `vX.Y.Z` tag publishes to GHCR and deploys by digest to the `production` environment.
- Pin actions by commit SHA and images by digest; Dependabot updates them.
- Workflows: default to `permissions: {}` or `contents: read`, and pass inputs to `run:` steps only through `env:`.
- `infra/terraform` provisions the Droplet; the DigitalOcean token comes only from the environment. Production secrets are generated on the server by `deploy/deploy.sh`.

## Invariants

- IDs are client-generated UUIDs from `newId()` in packages/shared (never call `crypto.randomUUID` directly: it breaks over plain http). Every user-owned table has `user_id`, `created_at`, `updated_at`, `deleted_at`.
- The UI only talks to the `repo` interface, which has two implementations: `LocalRepo` (Dexie) and `ApiRepo`.
- Progression is a pure function in `packages/shared`: `progress(item, rule, state, setLogs) → { targets, state }`. Guests and the server must compute identical results.
- `set_log` snapshots its values, so history never changes when a plan does.
- Features are checked only through `can()` / `limit()` from `entitlements.ts`.
- The API is versioned at `/api/v1`, and changes are additive only, because old mobile builds hit the new API.
- Authorization checks live in the API layer. Don't rely on DB row-level security.
- Deleting an exercise soft-deletes its live plan items; deleting gear removes it from live exercises' required gear. The UI always confirms first and states the impact; history keeps snapshotted names.
- The "progression step" (smallest weight jump, `profile.weight_increment`), the app default rule (`profile.default_rule`) and per-exercise defaults live in the Progression tab; never call it "weight increment" in the UI. Defaults apply live to inheriting items: the UI never copies a default into an override (re-enabling progression or "Use default" calls `clearRule`).
- Today and History render only from set-log snapshots (`seq`, `superset_label`, `angle`, `amrap`), never from the current plan (only the day colour is looked up from the live day; a deleted day shows none). Day colours come from `--day-*` tokens and always sit next to the day name.
- REST/isolation (M2): every `/api/v1/*` route needs a session and scopes every query by the session user id; a missing or foreign id is `404 {"error":"not_found"}`, never 403. Primary keys are `(user_id, id)` and foreign keys `(user_id, parent_id)`. Creates are idempotent `PUT /resource/:id` upserts. State-changing requests need a trusted Origin and `application/json`. One origin policy (`apps/api/src/origins.ts`) serves both Better Auth and the CSRF guard; the API refuses to start without `NODE_ENV`. Errors never leak internals (`500 {"error":"internal_error"}`).
- Migrations: the committed `apps/api/drizzle/` folder is applied by the API on boot (and by `migrate.js` in the deploy script); both are idempotent and a failure stops the process. Migrations must stay backward compatible with the previous release.
- Outbox (M2): only set edits are queued while offline (`PATCH /sets/:id` with the client `updated_at`); replay is in order, the server applies a set update only if it is newer, a 4xx other than 401 drops the item and tells the user, a 401 pauses the queue. Never queue starting or finishing a workout.

- Community plans, public area: `/api/public/*` is GET-only, never reads a session or sets a cookie, and returns only whitelisted fields (a test walks every response). Its rate limiter is per client IP, keyed on the right-most forwarded value (the one the nearest proxy appended) and only when it parses as an IP; its map is bounded. Writes (publish, unpublish, vote, adopt) are normal `/api/v1` routes with the usual session and 404 rules.
- Community plans, data: a snapshot holds names only (plan, day, exercise and gear names, numbers, colours, effective rule); never notes, video URLs, history, ids or personal data. Listing counters (upvotes, downloads) change only in the same transaction as the vote or download row. All public text (title, description, display name, every snapshot string, `source`) goes through the one public-text rule in `packages/shared`: controls and format characters stripped, NFKC, no links, no IP addresses. Signed-in adoption loads the snapshot by id on the server; a client never supplies a snapshot to an account.
- Version info (Settings → About) is build-time only: `APP_VERSION`, `APP_COMMIT`, `APP_REPO` Docker build args → Vite `define` (`apps/web/src/lib/about.ts` validates them). Never fetch it at runtime or hardcode the owner or repo name.
- Environments: local dev, self-hosted staging (`deploy/self-hosted/`, behind the owner's existing Cloudflare Tunnel, pulled by `update.sh`), production on DigitalOcean (on hold). CI's staging workflow only publishes `:staging`; it never deploys and uses no secrets beyond `GITHUB_TOKEN`. The self-hosted compose publishes no ports and does not include `cloudflared`.
- Public repo: no real domain, hostname, IP, network or tunnel name, token, email, server path or hardware name in any tracked file. Site-specific values are `${VAR:?}` placeholders or live in the host's gitignored `.env`; use `example.invalid` in examples. `just public-check` enforces it and is a CI job; `PUBLIC_SAFE_DENYLIST=<untracked file>` adds your own terms (see the script header).
- `SIGNUP_ALLOWLIST` (invite-only sign-up, empty = open, which is the default) and `CLIENT_IP_HEADER` (set only behind a trusted proxy) are API settings in `apps/api/src/env.ts`; the allowlist code stays even while sign-up is open. Known limits: the allowlist checks an address, not a person; other containers on the shared tunnel network can bypass per-IP rate limits, so only trusted containers go on it. The self-hosted compose requires `SIGNUP_ALLOWLIST` to be present (empty means open) and exposes the app on the tunnel network as `workout-tracker-app`.
- Account deletion (M2c): `DELETE /api/v1/account` needs the password (Better Auth's `verifyPassword`, 5 checks a minute per account) and runs in one transaction that leaves no personal data: no email, display name, auth rows, sessions or reset links. Published listings stay with `owner_id` null and the author "Deleted user"; unpublished and hidden ones are deleted; copies elsewhere get the author "Deleted user". Community counters always equal their real row counts: deletion removes votes and downloads itself and decrements exactly those listings. Every code path that reads `shared_plan.owner_id` must handle null. Better Auth endpoints the web app does not use stay in `disabledPaths` (`apps/api/src/auth.ts`); enable one only together with its own per-user limit. The web forgets the account on the device only after the server confirmed.
- Email auth (M2b): sign-in needs a verified email, so verify before the first sign-in (no session is issued at sign-up or at verification). Never await a mail send in a request path; failures are logged sanitized (name and code only, never a link). Responses are uniform for known and unknown addresses (sign-up, resend, forgot password). Links are built from `BETTER_AUTH_URL` only, never the request `Host`. Every mailed reset or set-up link stays valid (1 hour) until one is used; then `onPasswordReset` kills all the others, marks the email verified and revokes every session. Resending verification for an unverified account goes through `request-password-reset` (the "choose your password" set-up link), never `send-verification-email`. Reset tokens are stored hashed (`verification.storeIdentifier: 'hashed'`). Production requires `RESEND_API_KEY` and `MAIL_FROM`; in development the console mailer prints links to the API log with a `[mail]` prefix. Per-recipient throttle (3 per hour) is in memory.

## Open questions (ask before assuming)

See the spec's "Open questions" section. The exercise library is decided: each user owns their own, seeded from a starter list.

## Status

Done: the scaffold (Docker, compose, CI, infra), M1 (local guest-mode MVP), M2 (accounts, REST API, `ApiRepo`, guest import, offline set-log outbox), the restyle and feature batch (angles, AMRAP, supersets, layered rules, day colours), the self-hosted staging stack, community plan sharing (v0.0.4), M2b (email verification and password reset) and M2c (account deletion and full account export). Plans: [docs/superpowers/plans/](docs/superpowers/plans/), each with a status line at the top.

Goals, in order: staging deployed at home behind an existing tunnel (generic self-hosted stack), then M3 production on DigitalOcean (on hold, no date). Later ideas are listed in the spec's milestones table.

Production is still on hold: don't run `infra-*` or `github-setup`, and a `v*` tag builds and publishes a versioned image, but its deploy job targets the (not yet existing) production server and fails until M3 is done; tag only when the owner asks. Work through [docs/release-checklist.md](docs/release-checklist.md) before the first release. Verify features with `just dev` / `just preview`.
