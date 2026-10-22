# Workout Tracker

A free, very simple lifting tracker: exercise library, gear, plans with per-plan overrides, set logging, and automatic progression. Guest mode works without an account. Web plus iOS/Android from one codebase.

## Source of truth

[docs/spec.md](docs/spec.md) covers the data model, core logic, API, screens and deploy, plus a decisions log, open questions and unverified facts. Read it before making design decisions.

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
- `apps/api`: Hono on Node, Better Auth (email/password, plus the bearer plugin for mobile), Drizzle + Postgres. Bundled with esbuild, so the runtime image has no node_modules.
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

## Open questions (ask before assuming)

See the spec's "Open questions" section. The exercise library is decided: each user owns their own, seeded from a starter list.

## Status

The scaffold (Docker, compose, CI, infra) and M1, the local guest-mode MVP, are done (plan: [docs/superpowers/plans/2026-10-22-m1-local-mvp.md](docs/superpowers/plans/2026-10-22-m1-local-mvp.md)). Next is whatever the owner picks; M2 (accounts, sync, Drizzle schema, Better Auth) is the planned follow-up.

Production is still on hold: don't run `infra-*` or `github-setup`, and don't push `v*` tags. Work through [docs/release-checklist.md](docs/release-checklist.md) before the first release. Verify features with `just dev` / `just preview`.
