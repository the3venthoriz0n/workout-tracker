# Architecture

Diagrams of what exists today, with parts that are not built yet marked "planned". The spec ([spec.md](spec.md) §4, §7, §9, §11) is the source of truth.

## 1. System context

One Droplet runs Caddy, the app container (Hono serving the SPA and `/api`) and Postgres; images are built and deployed from GitHub Actions, and Cloudflare and Resend are planned for M3/M2b.

```mermaid
flowchart LR
  user["Phone or browser"] --> cf["Cloudflare (planned)"]
  cf --> caddy
  user -. "until Cloudflare is set up" .-> caddy
  subgraph droplet["DigitalOcean Droplet (compose)"]
    caddy["Caddy: TLS, reverse proxy"] --> app["Hono app: SPA and /api"]
    app --> db[("Postgres")]
  end
  app -. "verification and reset email" .-> resend["Resend (planned)"]
  tag["vX.Y.Z tag"] --> gha["GitHub Actions"]
  gha --> ghcr["GHCR image"]
  gha -- "deploy by digest over SSH" --> droplet
  ghcr -- "image pulled" --> droplet
```

## 2. Repo layout and dependencies

The pnpm monorepo has two apps that both depend on `packages/shared`, and the web app never imports the API.

```mermaid
flowchart TD
  web["apps/web: React SPA, Dexie, Capacitor"] --> shared
  api["apps/api: Hono, Better Auth, Drizzle"] --> shared
  shared["packages/shared: zod schemas, progression engine, entitlements, ApiRepo, contract tests"]
  web -. "HTTP /api/v1 at runtime" .-> api
  deploy["deploy/: production compose, Caddyfile, deploy.sh"] -. "runs the image of" .-> api
  infra["infra/terraform: Droplet, firewall, reserved IP"]
```

## 3. The Repo contract

The UI only talks to the `Repo` interface, which has a local guest implementation and an API implementation, and one contract test suite runs against all three layers.

```mermaid
flowchart TD
  ui["UI via TanStack Query hooks"] --> repo{{"Repo interface"}}
  repo --> local["LocalRepo (Dexie, guest)"]
  repo --> outbox["Offline outbox wrapper: queued set edits"]
  outbox --> apirepo["ApiRepo (fetch)"]
  apirepo --> routes["REST routes /api/v1"]
  routes --> service["Service layer (Drizzle)"]
  service --> pg[("Postgres")]
  contract["Shared contract test suite"] -.-> local
  contract -.-> apirepo
  contract -.-> service
```

## 4. Sign-up, sign-in and guest data upload

On sign-up the guest data is uploaded once and the local database is cleared only after the server confirms; on sign-in an account that already has data replaces the guest data after confirmation.

```mermaid
sequenceDiagram
  actor U as User
  participant W as Web app (LocalRepo)
  participant A as API
  participant D as Postgres
  Note over U,D: Sign up
  U->>W: Create account
  W->>A: POST /api/auth/sign-up
  A->>D: Create user and session
  A-->>W: Session cookie
  W->>A: POST /api/v1/import (exportAll JSON)
  A->>D: Store rows with user_id set by server
  A-->>W: Confirmed
  W->>W: Clear local database, switch to ApiRepo
  Note over W: If the upload fails, guest data stays and can be retried from Settings
  Note over U,D: Sign in
  U->>W: Sign in
  W->>A: POST /api/auth/sign-in
  A-->>W: Session cookie
  W->>A: POST /api/v1/me/init
  alt Account already has data
    W->>U: Confirm discarding guest data (JSON export offered)
    W->>W: Discard guest data, switch to ApiRepo
  else Account is new and empty
    W->>A: POST /api/v1/import
    A-->>W: Confirmed, switch to ApiRepo
  end
```
