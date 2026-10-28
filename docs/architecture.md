# Architecture

Diagrams of what exists today, with parts that are not built yet marked "planned" (production and Cloudflare's proxy). The spec ([spec.md](spec.md) §4, §7, §9, §11) is the source of truth.

## 1. System context

Staging runs on a self-hosted Docker host behind an existing Cloudflare Tunnel (app and Postgres only, the app port published on `127.0.0.1` only, pulled by `update.sh`). Production is planned for one Droplet running Caddy, the app and Postgres (M3, on hold). Both run the same image: Hono serving the SPA, `/api/v1` (session required) and the public community area `/api/public/*` (GET only, no session). Set-up and reset email goes out through Resend (built); production and staging refuse to start without its settings, and in development the console mailer prints links to the API log instead.

```mermaid
flowchart LR
  user["Phone or browser"] --> cf["Cloudflare: tunnel (staging), proxy (production, planned)"]
  cf --> app
  subgraph host["Self-hosted staging host (compose)"]
    app["Hono app: SPA, /api/v1, /api/public"] --> db[("Postgres")]
  end
  app -- "set-up and reset email (never awaited)" --> mailer["Mailer: Resend (console in dev)"]
  mailer --> resend["Resend"]
  main["push to main"] --> gha["GitHub Actions"]
  gha -- "publishes :staging" --> ghcr["GHCR image"]
  host -- "update.sh pulls by digest" --> ghcr
  gha -. "vX.Y.Z tag: deploy by digest over SSH (M3, on hold)" .-> prod["Production Droplet: Caddy, app, Postgres (planned)"]
```

## 2. Repo layout and dependencies

The pnpm monorepo has two apps that both depend on `packages/shared`, and the web app never imports the API.

```mermaid
flowchart TD
  web["apps/web: React SPA, Dexie, Capacitor"] --> shared
  api["apps/api: Hono, Better Auth, Drizzle"] --> shared
  shared["packages/shared: zod schemas, progression engine, entitlements, ApiRepo, contract tests"]
  web -. "HTTP /api/v1 at runtime" .-> api
  deploy["deploy/: production compose, Caddyfile, deploy.sh, self-hosted/ staging stack"] -. "runs the image of" .-> api
  infra["infra/terraform: Droplet, firewall, reserved IP"]
```

## 3. The Repo contract

The UI only talks to the `Repo` interface, which has a local guest implementation and an API implementation, and one contract test suite runs against all three layers.

```mermaid
flowchart TD
  ui["UI via TanStack Query hooks"] --> repo{{"Repo interface"}}
  ui --> community
  repo --> local["LocalRepo (Dexie, guest)"]
  repo --> outbox["Offline outbox wrapper: queued set edits"]
  outbox --> apirepo["ApiRepo (fetch)"]
  apirepo --> routes["REST routes /api/v1"]
  community["Community browse: fetchCommunityList (no session)"] --> publicroutes["Public routes /api/public (GET only, whitelist)"]
  publicroutes --> service
  routes --> service["Service layer (Drizzle)"]
  service --> pg[("Postgres")]
  contract["Shared contract test suite"] -.-> local
  contract -.-> apirepo
  contract -.-> service
```

## 4. Sign-up, set-up link, sign-in and guest data upload

Sign-up takes the email only, creates no session and uploads nothing: the password is chosen through the mailed set-up link, which confirms the address, and guest data stays on the device until the first successful sign-in. A new account is imported once and the local database is cleared only after the server confirms; an account that already has data replaces the guest data after confirmation. The same screens handle "forgot password"; a reset (or the set-up link mailed for an unverified account) verifies the address and revokes every session.

```mermaid
sequenceDiagram
  actor U as User
  participant W as Web app (LocalRepo)
  participant A as API
  participant D as Postgres
  participant M as Mailer (Resend, console in dev)
  Note over U,M: Sign up, then choose the password
  U->>W: Create account (email only)
  W->>A: POST /api/auth/sign-up/email (random throwaway password)
  A->>D: Create unverified user (no session)
  A-->>M: Set-up link /reset-password?setup=1 (not awaited)
  A-->>W: Uniform 200 (same for known addresses)
  W->>U: Check your email (guest data untouched)
  U->>W: Open link (any device), choose password
  W->>A: POST /api/auth/reset-password
  A->>D: Set password, verify email, delete other links, revoke sessions
  Note over U,M: Forgot password
  U->>W: Forgot password
  W->>A: POST /api/auth/request-password-reset
  A-->>M: Reset link, or set-up link if unverified (not awaited)
  A-->>W: Uniform answer
  U->>A: Open link, choose password
  A->>D: Set password, verify email, delete other links, revoke sessions
  Note over U,D: Sign in
  U->>W: Sign in
  W->>A: POST /api/auth/sign-in/email
  A-->>W: Session cookie (403 until verified)
  W->>A: POST /api/v1/me/init
  alt Account already has data
    W->>U: Confirm discarding guest data (JSON export offered)
    W->>W: Discard guest data, switch to ApiRepo
  else Account is new and empty
    W->>A: POST /api/v1/import (exportAll JSON)
    A->>D: Store rows with user_id set by server
    A-->>W: Confirmed, clear local database, switch to ApiRepo
    Note over W: If the upload fails, guest data stays and can be retried from Settings
  end
```
