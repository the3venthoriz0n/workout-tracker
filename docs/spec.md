# Workout Tracker — Spec

Revised 2026-10-22, after the scaffold (build step 1) landed. Earlier version: 2026-10-21.

## 1. Overview

A free, very simple lifting tracker. You build your own exercise library, pick the gear you own, make plans, log sets in the gym, and let progression rules set next session's targets. It works without an account. Web and mobile (Capacitor) run from one codebase, and a Pro tier can be added later without refactoring.

**Goals**

- Logging a set takes seconds on a phone in the gym.
- Guest use with no signup. An account only adds sync and backup.
- Exercises are defined once (the "vars") and reused in plans with per-plan overrides.
- Weight and rep progression is automatic, driven by user-defined rules.
- One TypeScript codebase and one Docker image, deployed on a DigitalOcean Droplet.

**Non-goals (v1)**: social features, AI-generated exercises, nutrition, wearables, two-way offline sync for signed-in users, ad-hoc exercises inside a workout, per-set rep schemes (pyramids, AMRAP).

**Anti-goals**: anything that adds taps to logging a set; requiring an account to try the app; complexity a solo developer can't maintain.

## 2. Milestones

**M1 and M2 are done** (M1 completed 2026-10-22: built, reviewed task by task and as a whole branch, and exercised in a real browser against both the dev server and the production image; M2: the API is verified against the production image in an isolated compose project). Production deploy (M3) stays on hold until the owner decides to ship it.

| Milestone | Contents | Runs |
| --- | --- | --- |
| **M1: Local MVP (guest mode)** ✅ done | Gear (a section of Library), exercise library, plans, progression rules, Today logging, progression engine, history, settings and export. Everything runs on-device through `LocalRepo`. | `just dev`, `just preview` |
| **M2: Accounts and sync** ✅ done | Postgres schema (Drizzle), Better Auth email + password, the REST API in §9, `ApiRepo`, guest-data import on signup, offline set-log queue. Plan: `docs/superpowers/plans/2026-10-22-m2-accounts-and-sync.md`. | `just dev`, `just preview` |
| M3: Production | Droplet via Terraform, GitHub production environment, first `v*` release, nightly `pg_dump` backups | DigitalOcean |
| M4: Mobile | Capacitor wrap, bearer auth, store builds | iOS / Android |
| Later | Google/Apple sign-in, charts/PRs, AI plan helper, Pro gating, frontend/backend container split | |

M1 is deliberately client-only: guest mode is a v1 requirement anyway, and it is the fastest path to something usable in the gym. The API stayed as scaffolded (`/healthz`, empty `/api/v1`) until M2.

M2 scope decisions (owner): REST resources as in §9 (not a single RPC endpoint); email + password only, with no email verification or password reset yet (both need an email provider).

## 3. Features

| Feature | Scope | Milestone |
| --- | --- | --- |
| Gear | Pick owned equipment from a seeded list; add custom items. Filters the exercise picker. | M1 |
| Exercise library | Name, notes, video/instruction URL, required gear, default sets/reps/weight, active toggle. Per user, seeded from a starter list. | M1 |
| Plans | Named plans → ordered days → ordered items. Each item references an exercise, with optional overrides and a progression rule. | M1 |
| Session logging | Pick a plan day, then mark sets done with one tap. Edit actual reps and weight in place. Per-set and per-session notes. Resumes if the app closes. | M1 |
| Progression | Runs when a session is finished. See §6. Has its own tab: the progression step, defaults for new plan items, and every plan item's rule. | M1 |
| History | Completed sessions by date, with the exact sets, reps and weights (skipped sets show their planned numbers, marked "skipped"). Past workouts are editable (sets, set notes, session note) without affecting plan targets or progression. | M1 |
| Units | lb or kg, chosen in Settings; changing it converts stored weights. | M1 |
| Export | Download all data as JSON. | M1 |
| Accounts + sync | Email/password; guest data uploaded once on signup. | M2 |
| Google / Apple sign-in | Native plugin flow on mobile. | Later |
| Charts / PRs | Volume and estimated 1RM over time. | Later (Pro candidate) |
| AI plan helper | Drafts a plan from goal, gear and active exercises. | Later (Pro candidate) |

## 4. Stack and architecture

One pnpm monorepo, all TypeScript. A single app container (Hono serves the API and the built SPA) plus Postgres. The same SPA build is bundled into iOS and Android with Capacitor.

| Layer | Choice | Why |
| --- | --- | --- |
| UI | React + Vite static SPA | Simplest for Capacitor to bundle; works offline |
| Routing | React Router (declarative/SPA mode) | Small, standard; nested plan screens need URLs |
| Styling | Tailwind + shadcn/ui | Modern look with little effort; components are our own code |
| Client data | TanStack Query over the `repo` interface; Dexie (IndexedDB) for `LocalRepo` | One data API for both guest and signed-in modes |
| Mobile | Capacitor (M4) | Wraps the same `dist/` |
| API | Hono on Node, bundled with esbuild | Small and fast; the runtime image has no node_modules |
| Auth | Better Auth + bearer plugin (M2) | Self-hosted; Drizzle adapter; bearer tokens for mobile |
| DB | Postgres + Drizzle ORM (M2) | Typed schema and migrations in TS |
| Validation | zod 4 | Shared by client and server |

**Repo layout**

```
apps/api          Hono server; Drizzle schema + migrations (M2)
apps/web          React SPA: routes/, components/, repo/ (LocalRepo, later ApiRepo)
packages/shared   zod schemas + types, progression engine, effective-value helpers,
                  seed data, units, entitlements
deploy/           production compose stack, Caddyfile, deploy.sh
infra/terraform   Droplet, firewall, reserved IP
```

Rule of thumb: anything that guests and the server must compute identically lives in `packages/shared` as a pure function with unit tests.

Excluded: Next.js/SSR, Supabase, a separate frontend container (v1), App Platform, PWA-only.

## 5. Data model

Each user owns their own exercise library, seeded from a starter list on first use; there is no shared global library. All IDs are client-generated UUIDs from the shared `newId()` helper, which falls back to `crypto.getRandomValues` because `crypto.randomUUID` is unavailable on plain-http LAN origins, so guest records keep their IDs when uploaded. Every user-owned record has `user_id`, `created_at`, `updated_at` and `deleted_at` (soft delete, for sync). Deleting an exercise soft-deletes its live plan items in the same transaction; deleting gear removes it from every live exercise's required gear. Timestamps are ISO strings on the client and `timestamptz` in Postgres. In M2, Better Auth adds its own `user`, `session`, `account` and `verification` tables.

The zod schemas in `packages/shared` are the single definition. Dexie (M1) and Drizzle (M2) mirror them.

| Table | Key columns | Notes |
| --- | --- | --- |
| `profile` | user_id, plan (`free`\|`pro`), units (`lb`\|`kg`), weight_increment, default_rule? | `weight_increment` is the progression step: the smallest weight change you can load (default 5 lb / 2.5 kg), used for rounding. `default_rule` (optional rule shape) is what new plan items start with; absent means the default rule in §6 |
| `gear` | id, user_id, name, owned | Seeded list plus custom items; `owned` drives the picker |
| `exercise` | id, user_id, name, notes, video_url, required_gear_ids[], active, default_sets, default_reps, default_weight | The reusable "var" |
| `plan` | id, user_id, name, archived | A routine |
| `plan_day` | id, plan_id, name, position | e.g. "Push A" |
| `plan_item` | id, plan_day_id, exercise_id, position, sets?, reps?, weight?, target_reps?, target_weight? | Overrides and targets are nullable; see §6 |
| `progression_rule` | plan_item_id, success_action (`add_weight`\|`add_reps`), success_amount, fail_streak_limit, deload_pct, rep_ceiling? | At most one per item; none = no progression |
| `item_state` | plan_item_id, fail_streak | Progression bookkeeping |
| `workout_session` | id, user_id, plan_day_id, plan_name, day_name, started_at, completed_at?, note | `completed_at` null = in progress (at most one). Names are snapshots. |
| `set_log` | id, session_id, plan_item_id, exercise_id, exercise_name, set_no, position, target_reps, target_weight, actual_reps, weight, done, note | Created when the session starts; snapshots values, so history never changes when plans or exercises do. `position`: plan item position at session start (ordering snapshot) |

Weights are stored in the profile's unit as decimals. Changing units converts every stored weight in one transaction, rounded to 0.1, and resets the progression step (`weight_increment`) to that unit's default and converts an `add_weight` `default_rule` amount like plan-item rules.

**Postgres mapping (M2).** Drizzle tables mirror the zod schemas, with these rules:
- Every domain table has the primary key `(user_id, id)`, so two accounts can never collide on a client-generated UUID and a foreign ID never resolves to another user's row. `user_id` is `text` (Better Auth's user id) with a foreign key to the auth user and `ON DELETE CASCADE`; `id` and all other ids are `uuid`.
- Timestamps are `timestamptz`; `required_gear_ids` is `uuid[]`; `default_rule` is `jsonb` validated by the shared zod schema on every write; weights are `numeric(8,2)`.
- Soft deletes use `deleted_at timestamptz null`, exactly as in the client; every query filters it. Foreign keys are composite `(user_id, parent_id)` so a child can never point at another user's parent.
- Better Auth owns `user`, `session`, `account` and `verification`. The `profile` row is created on first use, not at signup.

## 6. Core logic (`packages/shared`, pure functions)

**Effective values** for a plan item:

- `sets = item.sets ?? exercise.default_sets`
- `baseReps = item.reps ?? exercise.default_reps`
- `baseWeight = item.weight ?? exercise.default_weight`
- `targetReps = item.target_reps ?? baseReps`
- `targetWeight = item.target_weight ?? baseWeight`

Sessions pre-fill from `targetReps` and `targetWeight`. Overriding a plan item never changes the exercise. Editing an exercise default changes every item that has neither an override nor a target for that field. **Editing an item's reps or weight override clears both targets and resets `fail_streak`**, so a manual change always takes effect and progression continues from it.

**Exercise picker**: show an exercise only if it is `active` and every `required_gear_id` is owned. Exercises with no required gear always show.

**Progression** runs once per plan item when a session is finished: `progress({ targetReps, targetWeight, baseReps, plannedSets }, rule, failStreak, sets, increment) → { targetReps, targetWeight, failStreak, outcome }`, where `outcome` is `skipped | success | miss | deload`.

1. No rule, or no set marked done for the item: nothing changes.
2. **Success** = the item's planned number of sets are all `done` with `actual_reps >= targetReps` and `weight >= targetWeight`. Anything else is a **miss**.
3. On success, reset `fail_streak` and apply the rule:
   - `add_weight`: `targetWeight += success_amount`, rounded to the increment and never smaller than one increment.
   - `add_reps`: `targetReps += success_amount`. If `rep_ceiling` is set and `targetReps` would exceed it, set `targetReps = baseReps` and `targetWeight += increment` instead (double progression).
4. On a miss, `fail_streak += 1`. If `fail_streak >= fail_streak_limit`, set `targetWeight = roundToIncrement(targetWeight × (1 − deload_pct/100))`, reset `targetReps` to `baseReps`, and reset the streak.
5. Weights are rounded to the nearest `increment` and never go below 0. A successful `add_weight` step is rounded to the increment and is never smaller than one increment.
6. Write the new `target_reps`, `target_weight` and `item_state`.

**Default rule** for a new plan item (unless the profile sets `default_rule`): `add_weight` by the progression step, `fail_streak_limit = 3`, `deload_pct = 10`, no rep ceiling.

## 7. Data access, guest mode and sync

- The UI talks only to a `Repo` interface (for example `listExercises()`, `startSession(dayId)`, `logSet()`, `finishSession()`), always through TanStack Query hooks. Mutations invalidate the affected queries.
- **M1**: `LocalRepo` uses Dexie. On first launch it creates a guest profile (`user_id` = a local UUID) and the seed gear and exercises. Multi-record writes, such as finishing a session or changing units, run in one Dexie transaction.
- **M2**: `ApiRepo` implements the same `Repo` interface over the REST API in §9. The app uses `LocalRepo` when signed out and `ApiRepo` when signed in; the UI never knows which. One shared **contract test suite** runs against `LocalRepo`, the server's service layer, and `ApiRepo` (through the real HTTP routes), so the three cannot drift.
  - **Sign up**: create the account, then upload the guest data once with `POST /api/v1/import` (the same JSON as `exportAll()`; ids are kept; `user_id` is set server-side) and, only after the server confirms, clear the local database and switch to `ApiRepo`. If the upload fails the guest data stays untouched and the upload can be retried from Settings → Account.
  - **Log in**: if the account already has data, local guest data is discarded after an explicit confirmation that offers a JSON export first; there is no merge, because seed data would duplicate. If the account is new and empty, the guest data is imported as in sign up.
  - **Sign out**: clears the session and local caches and returns to a fresh guest database; the account's data stays on the server.
  - **Offline while signed in**: only set logs are queued. `ApiRepo` mirrors the active session locally; set toggles and edits update the mirror immediately and are queued as `PATCH /sets/:id` calls carrying the client `updated_at`, replayed in order when the connection returns (on the `online` event, at app start, and every 30 s while the queue is non-empty). The server applies a set update only if its `updated_at` is newer than the stored one (last write wins). A replayed update the server rejects with a 4xx other than 401 is dropped and the user is told; a 401 pauses the queue until the user signs in again. Starting or finishing a workout needs a connection.
- **Web auth (M2)**: Better Auth email + password with HttpOnly, SameSite=Lax session cookies (Secure in production), same origin so no CORS. Passwords are 10-128 characters. Better Auth's rate limiting is on for sign in and sign up. No email verification or password reset yet.
- **Mobile auth (M4)**: Better Auth bearer plugin; token in Capacitor Preferences, sent as `Authorization: Bearer`. Capacitor origins are added to CORS and `trustedOrigins` (exact strings unverified).
- **Social login (later)**: Google blocks OAuth in WebViews (`disallowed_useragent`), so mobile needs a native plugin (`@capgo/capacitor-social-login`, which handles both Google and Apple), with the ID token verified server-side. Offering Google means also offering Sign in with Apple (App Store Guideline 4.8), so ship both together.
  - Apple setup: enable Sign in with Apple on the App ID that matches the Capacitor `appId`, then regenerate its provisioning profiles. iOS uses the native sheet. Android and web need a Services ID plus an HTTPS return URL on the API (Apple rejects `localhost`).
  - Server verification: check the JWT signature against `https://appleid.apple.com/auth/keys`, issuer `https://appleid.apple.com`, audience equal to the bundle ID or the Services ID, and the nonce. Key accounts on `sub`, not email.

## 8. Screens

Six tabs (Today, Plans, Library, Progression, History, Settings): a bottom nav on phones and a sidebar on desktop. **Today** is home. Mobile-first, one column.

| Route | Screen | What it does |
| --- | --- | --- |
| `/` | Today | No session: pick a plan day, then Start. In progress: exercises with their sets pre-filled from targets. Tap a set to mark it done; tap again to undo. Long-press (or an edit button) edits reps and weight. Each exercise has a video link and notes. Finish runs progression and shows a short summary of the new targets. |
| `/plans`, `/plans/:id` | Plans | List and create plans; inside a plan, manage days and items. Inline edit of sets/reps/weight overrides and the progression rule per item. Reorder with up/down buttons. Add items via the exercise picker. |
| `/library` | Library | One Add button in the header (same place and look for both sections; opens an exercise or gear sheet). Two sections: Exercises (list, active toggle, notes, video link, required gear, defaults) and Gear (owned toggles). Every row has pencil (edit in the sheet; gear can be renamed) and trash row actions. Delete asks for inline confirmation that states the impact and cascades: deleting an exercise also removes it from plans (past workouts keep their records); deleting gear unlinks it from exercises that required it. Section is kept in `?section=gear`. |
| `/progression` | Progression | Three cards: the progression step (smallest weight change you can load; steps and deloads snap to it), defaults for new plan items (the `default_rule`, which only affects items added afterwards), and every live plan item's rule grouped by plan and day, each editable in place. |
| `/history`, `/history/:id` | History | Completed sessions, newest first; tap one for exact sets, reps and weights; skipped sets show planned numbers. An Edit toggle on finished workouts allows editing reps, weight, done/skipped, set notes and the session note (no date edit or delete); edits never change plan targets or progression. |
| `/settings` | Settings | Units, export JSON, and an Account card: sign up, log in, log out, and (after a failed upload) retry the guest-data upload. Signed out, the app is in guest mode. |

UX rules: tap targets at least 44 px; `inputmode="decimal"` for weight and `inputmode="numeric"` for reps; never more than one modal or sheet open; edit in place; works in light and dark mode.

## 9. API surface (M2)

REST under `/api/v1`, JSON bodies validated by the shared zod schemas. Changes are additive only, so older mobile builds keep working. Authorization lives in the API layer, not in DB row-level security.

**Rules for every route**
- Every `/api/v1/*` route (except `/healthz`) needs a valid session cookie, otherwise `401 {"error":"unauthorized"}`.
- Every query is scoped by the session's user id. An id that does not exist **or belongs to another user** returns `404 {"error":"not_found"}` (never 403, so existence is not leaked).
- Resources have client-generated UUIDs, so creates are idempotent `PUT /resource/:id` upserts (re-sending the same request is safe, which the offline queue relies on). The server sets `user_id` and timestamps.
- State-changing requests (anything but GET/HEAD) must pass an Origin check (Hono `csrf`), in addition to SameSite=Lax cookies; bodies must be `application/json`.
- Errors: `400 {"error":"invalid","issues":[...]}` for validation, `404`, `409 {"error":"conflict"|"session_in_progress"|"already_has_data"}`, `413` over the body limit (1 MB; 10 MB for `/import`), `500 {"error":"internal_error"}` (never internal messages).

| Method | Path | Purpose |
| --- | --- | --- |
| \* | `/api/auth/**` | Better Auth (sign up, sign in, sign out, session) |
| POST | `/api/v1/me/init` | Create the profile and seed gear/exercises on first use; returns the profile (idempotent) |
| GET / PATCH | `/api/v1/me` | Profile; PATCH takes `units`, `weight_increment`, `default_rule` (a unit change converts stored weights and rules, as in §5/§6) |
| GET | `/api/v1/gear` | List gear (sorted by name) |
| PUT / DELETE | `/api/v1/gear/:id` | Create/rename/own-toggle gear; delete also removes it from exercises' required gear |
| GET | `/api/v1/exercises` | List exercises (sorted by name) |
| PUT / DELETE | `/api/v1/exercises/:id` | Create/update; delete cascades to its live plan items |
| GET | `/api/v1/exercises/:id/usage` | `{ planItemCount, plans }` for the delete confirmation |
| GET | `/api/v1/plans`, `/api/v1/plans/:id` | Plans; one plan as a tree (days, items, rules, effective values) |
| PUT / DELETE | `/api/v1/plans/:id` | Create/rename; delete cascades to days and items |
| PUT / DELETE | `/api/v1/days/:id` | Create/rename a day (`plan_id` in the body); delete cascades to items |
| POST | `/api/v1/days/:dayId/items` | Add an exercise to a day (`exercise_id`, optional `id`); gets the profile's default rule |
| PATCH / DELETE | `/api/v1/items/:id` | Edit `sets`/`reps`/`weight` overrides (null clears; reps/weight edits clear targets); delete |
| PUT | `/api/v1/items/:id/rule` | Set a rule, or `null` for no progression |
| POST | `/api/v1/move` | `{ kind: 'day' \| 'item', id, direction: -1 \| 1 }` |
| GET | `/api/v1/progression` | Every live plan item with its rule, in plan/day/item order |
| GET | `/api/v1/sessions` | Completed sessions, newest first |
| GET | `/api/v1/sessions/active` | The in-progress session, or `null` |
| POST | `/api/v1/sessions` | Start from a plan day (`plan_day_id`); `409 session_in_progress` if one is active |
| GET / PATCH / DELETE | `/api/v1/sessions/:id` | Detail; PATCH edits the note; DELETE discards an unfinished session (`409` if completed) |
| POST | `/api/v1/sessions/:id/complete` | Finish; runs progression, returns the summary |
| PATCH | `/api/v1/sets/:id` | Edit a set (`done`, `actual_reps`, `weight`, `note`); optional client `updated_at` for last-write-wins replays |
| GET | `/api/v1/export` | All of the account's data as the `exportAll()` JSON |
| POST | `/api/v1/import` | One-time guest upload; `409 already_has_data` if the account already has a profile |
| GET | `/healthz` | Health check (exists) |

## 10. Pro plan structure

Everything is free at launch. Gating later is a config change, not a refactor.

- `packages/shared/entitlements.ts` maps each plan to limits and flags, e.g. `free: { maxPlans: Infinity, aiPlansPerDay: 0, charts: true }`.
- `can(profile, feature)` and `limit(profile, key)` are the only places features are checked: on the client to hide or disable UI, and on the server to enforce.
- `profile.plan` defaults to `free`. A future billing webhook only updates that column.
- Unverified: Apple's rules for selling subscriptions inside iOS apps changed recently. Check them before selling Pro on iOS.

## 11. Local development, CI/CD and deploy

**Local** (exists): Docker + `just` only. `just dev` starts Postgres, the API on :3000 and Vite on :5173 with hot reload. `just check` runs what CI runs. `just preview` runs the production image on :8080. The justfile forces the local Docker engine.

**CI/CD** (exists): PRs and `main` run typecheck, tests, build, Docker build, dependency review and CodeQL. A `vX.Y.Z` tag pushes to GHCR with provenance and an SBOM, then deploys by digest over SSH to the `production` environment, which only `v*` tags may use. Actions are pinned by SHA and images by digest, and Dependabot keeps them current.

**Production (M3)**: one DigitalOcean Droplet running Caddy, the app and Postgres via compose. `infra/terraform` creates the Droplet, a firewall and a reserved IP, and is safe to re-run. cloud-init creates an `admin` user (sudo) and a `deploy` user (docker only), disables root and password SSH, and installs Docker, fail2ban and unattended upgrades. The DO token stays local in env vars and is never sent to GitHub. Production secrets are generated on the server on the first deploy. Before launch: nightly `pg_dump` to DO Spaces.

**Future frontend/backend split** (only if scaling requires it): Caddy serves `apps/web/dist` and proxies `/api/*` to several API replicas, which are already stateless because sessions live in Postgres. Then move to Managed Postgres and serve the SPA from Spaces + CDN. To keep this cheap: every API route lives under `/api/*`, the SPA reads its API base URL from env, and routing stays same-origin.

## 12. AI plan helper (later)

- Server-only `ai/generatePlan({ goal, daysPerWeek, gear, activeExercises })`, behind a provider interface so the model vendor is swappable in one file.
- Output must match the plan zod schema and use only the user's active exercise IDs. Invalid output is rejected and retried once.
- The result opens as an editable draft. Nothing saves until the user accepts.
- Gated by `can(profile, 'ai_plan')` with a daily cap.
- Gemini free tier was considered. Its terms (commercial use, training on inputs, rate limits) are unverified and volatile; recheck them before building.

## 13. Decisions log

| Decision | Why |
| --- | --- |
| No Supabase | Lock-in through `supabase-js` in the UI and RLS tied to `auth.uid()` |
| One app container, no separate frontend container (v1) | One image, one deploy, no CORS on web; split later only if scaling requires it |
| React + Vite SPA, not SSR | Easiest for Capacitor; works offline |
| Capacitor bundles the SPA | A real mobile app; API base URL from env |
| Email/password only in v1 | Google blocks OAuth in WebViews |
| Bearer tokens on mobile | Cookies from Capacitor's origin weren't verified |
| Authorization in the API layer | No reliance on row-level security |
| Per-user exercise library | Simpler ownership and sync; users customize freely |
| Droplet, not App Platform | Cheaper; same compose setup as dev |
| GHCR, not DOCR | CI pushes with `GITHUB_TOKEN`; no long-lived registry secret |
| Deploy on version tags | Only a deliberate `vX.Y.Z` reaches production |
| Terraform for the Droplet | Safe to re-run; `prevent_destroy` protects the database |
| M1 is guest-only (`LocalRepo`) | Fastest usable MVP; guest mode is required anyway; Drizzle and auth wait for M2 |
| Targets win over overrides; editing an override clears targets | Progression drives the numbers, but a manual edit always takes effect |
| `weight_increment` (progression step) on the profile | Needed for deload rounding and double progression; plates differ by gym and unit |
| Weights stored in the user's unit | No float drift on display; changing units converts once |
| Set logs created at session start | Pre-filled rows make logging one tap; resume works for free |
| Exercise and day names snapshotted into history | History never changes when plans or exercises do |
| No ad-hoc exercises or per-set schemes in v1 | Keeps logging and progression simple |
| IDs via `newId()` | `crypto.randomUUID` needs a secure context; LAN phone testing over http would otherwise fail at startup |
| REST resources for the M2 API (owner's choice) | Conventional and easy to inspect; costs about 30 routes, so a shared contract test suite guards against drift between `LocalRepo`, the server and `ApiRepo` |
| Email + password only in M2, no email sending (owner's choice) | Verification and password reset need an email provider; deferred |
| Composite primary keys `(user_id, id)` | Client-generated ids can't collide across accounts or reveal another user's rows |
| 404 (not 403) for ids owned by someone else | Doesn't leak which ids exist |
| Guest import only into an account with no profile; logging into an existing account discards local guest data after confirmation | Seed data would duplicate on merge; a JSON export is offered first |
| Sign out returns to a fresh guest database | Server data stays safe on the server; nothing sensitive lingers on a shared device |
| Offline queue limited to set edits (+ a local mirror of the active session) | Matches the gym use case; starting or finishing a workout needs a connection |
| `Repo` interface and view types move to `packages/shared` | Web (`LocalRepo`, `ApiRepo`) and API (server service) implement and test against one contract |

## 14. Open questions

None block M3, but resolve these before opening sign-up to real users (sign-up is open, with rate limiting only):

- Email verification and password reset (need an email provider; until then a forgotten password means a lost account), account deletion and per-account data export endpoints, off-box database backups, CSV export.
- M3: Domain name, and the DigitalOcean region (`sfo2` in Terraform may not accept new Droplets; `just infra-plan` will tell).

**Unverified; check before building the part that depends on them**: Capacitor origin strings for CORS and `trustedOrigins`; Apple's in-app payment rules; App Store stance on web wrappers; Gemini free-tier terms and limits; Capacitor live-update terms; whether Dependabot supports the pnpm 12 lockfile; whether new GHCR packages default to private.

## 15. Sources

[Google: OAuth in embedded webviews](https://developers.googleblog.com/2021/06/upcoming-security-changes-to-googles-oauth-2.0-authorization-endpoint.html) · [Capgo: Google Sign-In with Capacitor](https://capgo.app/blog/how-to-sign-in-with-google-using-capacitor/) · [Capgo: Sign in with Apple with Capacitor](https://capgo.app/blog/how-to-sign-in-with-apple-using-capacitor/) · [DigitalOcean App Platform pricing](https://docs.digitalocean.com/products/app-platform/details/pricing/) · [Hono + Better Auth + Drizzle](https://www.mintlify.com/rifandani/be-monorepo/api/hono/auth) · [Gemini API free tier](https://geotoolbox.ai/blog/gemini-api-pricing.md)
