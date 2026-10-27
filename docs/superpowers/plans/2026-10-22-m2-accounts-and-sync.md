# M2 Accounts and Sync Implementation Plan

> **Status: Done (2026-10-26). M2 shipped; the checkboxes below were not ticked as work went, so they are not a progress record. Email verification and reset followed in M2b.**

> **For agentic workers:** Use superpowers:subagent-driven-development (lean variant, see "How to run") to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user sign up, log in and use the same workout data from any device: a Postgres-backed REST API with Better Auth sessions, an `ApiRepo` client, one-time guest-data upload, and an offline set-log queue.

**Architecture:** The app's `Repo` interface becomes a shared contract (`packages/shared`). Three implementations satisfy it: `LocalRepo` (Dexie, guest mode, exists), a server **service layer** (Postgres via Drizzle, scoped to one user) behind thin REST routes, and `ApiRepo` (fetch client). A single **contract test suite** runs against all three, so behavior cannot drift. Auth is Better Auth (email + password, HttpOnly cookies, same origin).

**Tech Stack:** Hono 4.13.13, Drizzle ORM 0.45.4 + drizzle-kit 0.31.11, postgres 3.4.9, Better Auth 1.7.12 (add as an exact version), zod 4.6.7, Vitest 5.0.5, React/Dexie/TanStack Query as in M1.

**Spec:** `docs/spec.md` (§5 Postgres mapping, §7 sync rules, §9 REST surface, §13 decisions). Read §5, §7 and §9 first.

## Global Constraints

- Exact dependency versions only (no `^`/`~`). Run everything through `just`; Node is not on the host. Never run `docker compose up/down` on the default project from agents except `up -d --wait <service>` for the services named in Task 1.
- Every `/api/v1/*` route except `/healthz` requires a session; every query is scoped by the session user id; a foreign or missing id returns `404 {"error":"not_found"}` (never 403).
- Primary keys are `(user_id, id)` on every domain table; foreign keys are composite `(user_id, parent_id)`.
- Creates are idempotent `PUT /resource/:id` upserts with client-generated UUIDs (`newId()`); the server sets `user_id` and timestamps.
- State-changing requests need an Origin check (Hono `csrf`) and `application/json`; body limit 1 MB, 10 MB for `/import`.
- Errors never leak internals: `500 {"error":"internal_error"}`; validation `400 {"error":"invalid","issues":[...]}`.
- Passwords 10-128 characters; Better Auth rate limiting on; no email sending, verification or reset.
- Soft deletes (`deleted_at`) filtered on every read; multi-row writes in one transaction.
- Public repo: no secrets, hostnames, IPs or local paths in code, fixtures, commits or docs. `BETTER_AUTH_SECRET` comes only from the environment (`just setup` already generates one locally; the production deploy script generates its own).
- Tap targets, error toasts (`notifyError`), `formatWeight` etc. follow the M1 conventions in `.superpowers/.../batch2-context.md` when touching UI.
- Commits: Conventional Commits with the trailer `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`; never commit report files.

## Review Focus

Failure modes the spec implies that are most likely to bite (each is pinned by a test in the owning task):
1. **Cross-user access.** User B sending user A's ids to any route must get 404 and change nothing; lists never include A's rows. (Task 4: table-driven isolation matrix over every route with an id or list.)
2. **No session / hostile origin.** Every route returns 401 without a cookie; a state-changing request with a foreign `Origin` is rejected. (Task 3, Task 4.)
3. **Offline replay.** Duplicate and out-of-order replays are safe: upserts are idempotent and a stale `updated_at` never overwrites newer server data. (Task 2c server side, Task 7 client side.)
4. **Import.** All-or-nothing in one transaction; retry-safe; `409 already_has_data` when the account has a profile; dangling references (a set log pointing at a missing item) give `400`, not `500`; oversized body gives `413`. (Task 2c, Task 4.)
5. **Concurrency on start.** Two simultaneous `startSession` calls leave exactly one active session (partial unique index) and the loser gets `409 session_in_progress`. (Task 1 schema, Task 2c.)
6. **Parity.** Unit conversion (defaults, overrides, targets, set logs, rule amounts), cascades and progression give the same answers on the server as in `LocalRepo`. (Contract suite, Tasks 2a-2c.)

## How to run (lean process, owner's request)

One implementer per task; tests first with a failing-then-passing run shown in the report; the implementer runs `just check` once; the controller reads the diff. Independent review only for **Task 3 and Task 4** (auth and isolation, security-critical) and one final pass over the whole M2 diff. No re-reviews of small fixes; log minor findings instead of fixing them. No browser runs unless the owner asks. Questions to the owner only for real product forks.

## File Structure

```
packages/shared/src/repo.ts            Repo interface, view types (PlanTree, SessionDetail, FinishSummary, ExportData,
                                       ProgressionRow), SessionInProgressError (moved from apps/web/src/repo/types.ts)
packages/shared/src/api.ts             zod request/response schemas for the REST bodies (shared by routes and ApiRepo)
packages/shared/src/api-repo.ts        ApiRepo (fetch-based; injectable fetch; no DOM dependency)
packages/shared/src/testing/repo-contract.ts   runRepoContract(...) used by all three implementations
apps/api/src/db/schema/{auth,domain}.ts        Drizzle tables; db/index.ts re-exports
apps/api/drizzle/                      generated SQL migrations (committed)
apps/api/src/service/{index,profile,gear,exercises,plans,progression,sessions,transfer}.ts   createService(db, userId): Service
apps/api/src/auth.ts, src/middleware.ts        Better Auth instance; requireUser, csrf, error mapping
apps/api/src/routes/*.ts               thin REST handlers (validate -> service -> JSON)
apps/api/test/*                        harness (per-file schema), service/route/auth tests
apps/web/src/repo/{local-repo,api-repo-factory,offline,outbox}.ts   existing LocalRepo; offline queue + active-session mirror
apps/web/src/auth/{client,auth-provider,import-flow}.ts(x)          auth calls, session state, repo switching
apps/web/src/screens/settings.tsx + components/account-card.tsx      Account UI
```

---

### Task 0: Shared `Repo` contract and the contract test suite

**Files:**
- Create: `packages/shared/src/repo.ts`, `packages/shared/src/testing/repo-contract.ts`, `apps/web/test/repo-contract.local.test.ts`
- Modify: `apps/web/src/repo/types.ts` (re-export from `@workout/shared`, keep all current import paths working), `packages/shared/src/index.ts`, `packages/shared/package.json` (add `"./testing": "./src/testing/repo-contract.ts"` to `exports`)

**Interfaces — Produces:**
- `Repo` and every view type exactly as in the current `apps/web/src/repo/types.ts`, exported from `@workout/shared`.
- `type RepoHarness = { repo: Repo; cleanup(): Promise<void> }`
- `type ContractGroup = 'profile' | 'gear' | 'exercises' | 'plans' | 'progression' | 'sessions' | 'transfer'`
- `runRepoContract(label: string, make: () => Promise<RepoHarness>, opts?: { groups?: ContractGroup[] }): void` — registers a `describe(label)` with one fresh harness per test (`make()` then `cleanup()` in `afterEach`).

- [ ] **Step 1:** Move the `Repo` interface, view types and `SessionInProgressError` into `packages/shared/src/repo.ts`; make `apps/web/src/repo/types.ts` re-export them. `just check` still passes unchanged.
- [ ] **Step 2: Write the suite** (`repo-contract.ts`) covering, via the `Repo` interface only, the spec §5/§6 behaviors. Required cases (names are the `it` titles): `init is idempotent and seeds 8 gear and 16 exercises` · `unit switch converts exercise defaults, item weights/targets, set-log weights and add_weight rule amounts, and resets the step` (135 lb → 61.2 kg; step 5 → 2.5) · `saveGear renames and keeps the id; listGear is sorted by name` · `deleteGear removes the id from live exercises' required gear` · `deleteExercise cascades to its live plan items and keeps history names` · `exerciseUsage counts live items and distinct live plan names` · `getPlan sorts days and items by position and move swaps neighbours` · `addPlanItem uses default_rule when set, else the default rule` · `editing an item's reps or weight clears targets and the fail streak` · `setRule(null) removes the rule` · `listProgression is ordered and skips deleted items` · `startSession pre-fills sets from effective targets and rejects a second active session` · `updateSet validates and merges only defined keys` · `finishSession: success adds the step and rounds to it, never by less than one step; miss increments the streak; deload at the limit; no rule or no sets done leaves targets untouched; deleted items are skipped` · `discardSession removes an unfinished session and rejects a finished one` · `listSessions is completed-only, newest first; getSession returns snapshots` · `exportAll then importing into a fresh harness reproduces the data` (the import case runs only when the harness exposes `import`; see Task 2c) . Each group tag from `ContractGroup` is applied to its cases so `opts.groups` filters them.
- [ ] **Step 3:** `apps/web/test/repo-contract.local.test.ts` calls `runRepoContract('LocalRepo', ...)` with `new LocalRepo(new AppDb(<unique name>))` (call `repo.init()` in `make`). Run `just pnpm --filter @workout/web exec vitest run test/repo-contract.local.test.ts` until it passes; any failure here is a real `LocalRepo` bug or a wrong expectation — fix whichever is wrong and say which in the report.
- [ ] **Step 4:** `just check`; commit `refactor(shared): move Repo into the shared package and add the contract test suite`.

### Task 1: Database schema, migrations and the API test database

**Files:**
- Create: `apps/api/src/db/schema/{auth,domain}.ts`, `apps/api/drizzle/*` (generated), `apps/api/test/harness.ts`
- Modify: `apps/api/src/db/schema.ts` (re-export), `apps/api/package.json` (add `better-auth` exact; scripts), `compose.yaml` (service `db-test`), `justfile` (`test`/`check` start `db-test` and pass `DATABASE_URL_TEST`), `.github/workflows/ci.yml` (Postgres `services:` for the test job, image pinned by digest, `DATABASE_URL_TEST`), `apps/api/src/env.ts` (`BETTER_AUTH_SECRET` min 32 chars, `BETTER_AUTH_URL` url, optional `TRUSTED_ORIGINS` comma list, optional `DATABASE_URL_TEST` only read by tests)

**Interfaces — Produces:**
- Drizzle tables (snake_case, `uuid` ids, composite PKs/FKs per spec §5): `profile, gear, exercise, plan, planDay, planItem, progressionRule, itemState, workoutSession, setLog` plus Better Auth's `user, session, account, verification` (generate with the Better Auth CLI/schema docs for the Drizzle adapter, `provider: 'pg'`).
- Partial unique index: one active session per user (`workout_session (user_id) WHERE completed_at IS NULL AND deleted_at IS NULL`).
- `withTestDb(): Promise<{ db: Db; schemaName: string; cleanup(): Promise<void> }>` in `harness.ts`: creates a uniquely named Postgres schema in `DATABASE_URL_TEST`, applies the committed migrations into it, returns a Drizzle client with `search_path` set, and drops the schema in `cleanup`.
- `db-test`: Postgres (same pinned image as `db`), `tmpfs` data dir, **no published port**, throwaway credentials fixed in the compose file; `just test`/`just check` run `docker compose up -d --wait db-test` (a no-op if running) and give the dev container `DATABASE_URL_TEST`.

- [ ] **Step 1: Failing test** `apps/api/test/schema.test.ts`: via `withTestDb`, (a) inserting two users' rows with the same `id` succeeds (composite PK); (b) a `plan_item` whose `plan_day_id` belongs to another user is rejected by the FK; (c) a second active `workout_session` for one user fails with a unique violation while a different user's succeeds; (d) deleting a user cascades to all their rows.
- [ ] **Step 2:** Run it; expected FAIL (no tables). Implement the schema; generate the migration (`just db-generate`); commit the SQL. Make the test pass.
- [ ] **Step 3:** Add the `db-test` service, the `just` wiring and the CI service; verify `just check` runs the API tests against it and that `just dev`'s database is untouched.
- [ ] **Step 4:** `just check`; commit `feat(api): Postgres schema, migrations and an isolated test database`.

### Task 2a: Service layer part 1 — profile, gear, exercises

**Files:** Create `apps/api/src/service/{index,profile,gear,exercises}.ts`, `apps/api/test/service.contract.test.ts`

**Interfaces:**
- Consumes: `Repo`, `ContractGroup`, `runRepoContract` (Task 0); `withTestDb`, the schema (Task 1).
- Produces: `type Service = Repo & { importAll(data: ExportData): Promise<void> }` and `createService(db: Db, userId: string): Service`. Unimplemented methods throw `new Error('not implemented')` until Tasks 2b/2c. `init()` creates the profile row and the seed gear/exercises if no profile exists (idempotent, safe under concurrent calls via `INSERT … ON CONFLICT DO NOTHING` inside one transaction).

- [ ] **Step 1:** `service.contract.test.ts` runs `runRepoContract('Service (Postgres)', make, { groups: ['profile','gear','exercises'] })` where `make` uses `withTestDb()` and a fresh user id; run it (expected: FAIL).
- [ ] **Step 2:** Implement `profile` (including unit conversion in one transaction, rule/default-rule conversion identical to the LocalRepo rules: amount equal to the old step becomes the new step, otherwise rounded conversion with a floor of the new step), `gear` (save/delete with required-gear removal), `exercises` (save validated by the shared zod schema, cascade delete, usage). Reuse `convertWeight`, `roundToIncrement`, `defaultRule`, `seedExercises`, `DEFAULT_INCREMENT` from `@workout/shared`.
- [ ] **Step 3:** Contract subset passes; `just check`; commit `feat(api): service layer for profile, gear and exercises`.

### Task 2b: Service layer part 2 — plans, items, rules, progression list

**Files:** Create `apps/api/src/service/{plans,progression}.ts`; modify `service/index.ts`, `service.contract.test.ts` (groups add `'plans','progression'`).

- [ ] **Step 1:** Extend the groups; run (expected FAIL on the new groups).
- [ ] **Step 2:** Implement `listPlans/getPlan` (days and items sorted by position, with `exercise`, `rule`, `effective` via `effectiveValues`), `savePlan/deletePlan`, `savePlanDay/deletePlanDay`, `addPlanItem` (append position, default rule per `profile.default_rule`), `updatePlanItem` (reps/weight edits clear targets and `fail_streak`), `deletePlanItem`, `setRule`, `move` (swap with the adjacent live sibling in one transaction), `listProgression`. All soft-delete cascades as in `LocalRepo`.
- [ ] **Step 3:** Contract subset passes; commit `feat(api): service layer for plans, items, rules and progression`.

### Task 2c: Service layer part 3 — sessions, export and import

**Files:** Create `apps/api/src/service/{sessions,transfer}.ts`; modify `service/index.ts`, `service.contract.test.ts` (all groups), add `apps/api/test/service.transfer.test.ts`.

- [ ] **Step 1: Tests first** in `service.transfer.test.ts` (Review Focus 3-5): two concurrent `startSession` calls → exactly one succeeds, the other throws `SessionInProgressError`; `importAll` of a valid `ExportData` into a fresh user reproduces it (ids kept, `user_id` rewritten, no seed duplicates); `importAll` is all-or-nothing (inject a bad row at the end → nothing persisted); `importAll` into a user that already has a profile throws `AlreadyHasDataError` (define it in `repo.ts`); a set log referencing a missing plan item → `ImportInvalidError`; re-running the same import after a failure succeeds; `updateSet` with a stale client `updated_at` leaves the stored row unchanged and returns it, a newer one applies.
- [ ] **Step 2:** Implement `getActiveSession/startSession/updateSet/updateSessionNote/finishSession/discardSession/listSessions/getSession/exportAll/importAll`. `finishSession` runs the shared `progress()` per item in one transaction with the same rules as `LocalRepo` (skipped items write nothing; deleted items count as skipped). `updateSet` accepts an optional `updated_at` (add it to `Repo.updateSet`'s patch type, optional; `LocalRepo` ignores it).
- [ ] **Step 3:** Full contract suite (`import` case enabled for this harness) and the new tests pass; commit `feat(api): service layer for sessions, export and import`.

### Task 3: Authentication, session middleware, CSRF

**Files:** Create `apps/api/src/auth.ts`, `apps/api/src/middleware.ts`, `apps/api/test/auth.test.ts`; modify `apps/api/src/app.ts`.

**Interfaces — Produces:** `createAuth(db: Db, env)` returning a Better Auth instance (Drizzle adapter, `provider: 'pg'`, email + password enabled, `emailVerification` off, password length 10-128, rate limiting enabled, `trustedOrigins` from `BETTER_AUTH_URL` + `TRUSTED_ORIGINS`, secure cookies when `NODE_ENV=production`); `requireUser` Hono middleware setting `c.var.userId` and returning `401 {"error":"unauthorized"}`; `csrfGuard` (Hono `csrf` with the same trusted origins) applied to all non-GET `/api/*` routes; `/api/auth/*` mounted before the v1 router.

- [ ] **Step 1: Tests first** (use `app.request` with a test db): sign up → 200 and a `Set-Cookie` that is `HttpOnly; SameSite=Lax`; sign in with a wrong password → generic failure (no "user not found" wording); a 9-character password and a 129-character password are rejected; sign out invalidates the cookie; `GET /api/v1/me` without a cookie → 401 and with a valid cookie → not 401; a `POST` with `Origin: https://evil.example` → rejected; a `POST` with a non-JSON content type → rejected; repeated failed sign-ins eventually return 429.
- [ ] **Step 2:** Implement; run; **independent review of this task** (security).
- [ ] **Step 3:** commit `feat(api): Better Auth email/password sessions, CSRF guard and requireUser`.

### Task 4: REST routes and the isolation matrix

**Files:** Create `packages/shared/src/api.ts`, `apps/api/src/routes/*.ts`, `apps/api/test/routes.test.ts`, `apps/api/test/isolation.test.ts`; modify `app.ts`.

**Interfaces:** Consumes `createService`, `requireUser`. Produces every route in spec §9 with the status codes in the "Rules for every route" list; request/response bodies defined once in `api.ts` as zod schemas (`PutGearBody`, `PatchProfileBody`, `PatchSetBody` with optional `updated_at`, `MoveBody`, `StartSessionBody`, `ImportBody = ExportData`, …).

- [ ] **Step 1: Tests first.** `routes.test.ts`: table-driven happy path per route (including idempotent re-`PUT`, `409 session_in_progress`, `409 already_has_data`, `413` on an oversized body, `400 invalid` with `issues`, `404` for a missing id). `isolation.test.ts` (Review Focus 1-2): sign up users A and B; A creates gear, an exercise, a plan with a day and item, a session with sets; then for EVERY route that takes an id (`PUT/DELETE gear/:id`, `exercises/:id`, `exercises/:id/usage`, `plans/:id`, `days/:id`, `days/:dayId/items`, `items/:id`, `items/:id/rule`, `sessions/:id`, `sessions/:id/complete`, `sets/:id`, `move`) B gets `404` and A's data is byte-identical afterwards; B's list endpoints never contain A's rows; and every route returns `401` without a cookie. Generate the cases from one exported route table so a new route cannot be forgotten (add a test that fails if a registered route is missing from the table).
- [ ] **Step 2:** Implement thin handlers: parse with zod, call the service for `c.var.userId`, map `SessionInProgressError`/`AlreadyHasDataError`/`ImportInvalidError`/not-found to the status codes above, hide internal errors.
- [ ] **Step 3:** All tests pass; **independent review of this task** (security: authz and error leakage); commit `feat(api): REST routes for all resources with authorization tests`.

### Task 5: `ApiRepo` and the contract suite over HTTP

**Files:** Create `packages/shared/src/api-repo.ts`, `apps/api/test/api-repo.contract.test.ts`; modify `packages/shared/src/index.ts`, `repo.ts` (add `UnauthorizedError`, `OfflineError`).

**Interfaces — Produces:** `createApiRepo(opts: { baseUrl?: string; fetchImpl?: typeof fetch }): Repo & { importAll(data: ExportData): Promise<void> }`. Maps `401 → UnauthorizedError`, network failure → `OfflineError`, `409 session_in_progress → SessionInProgressError`, `404` on gets → `undefined`/`null` where the `Repo` signature allows it, other failures → `Error`. Sends `credentials: 'same-origin'`, JSON bodies, and idempotent `PUT`s using the same ids the caller passes (generating ids with `newId()` when absent).

- [ ] **Step 1:** `api-repo.contract.test.ts` runs the FULL `runRepoContract` against `createApiRepo({ fetchImpl })` where `fetchImpl` forwards to the in-process Hono `app.request` with a signed-in user's cookie jar and a fresh `withTestDb` schema per test. Run (expected FAIL: no client).
- [ ] **Step 2:** Implement `ApiRepo`; fix any contract failure at the right layer (client, route or service) and say which in the report.
- [ ] **Step 3:** `just check`; commit `feat(shared): ApiRepo client verified by the contract suite over real routes`.

### Task 6: Web auth, repo switching and the Account card

**Files:** Create `apps/web/src/auth/{client,auth-provider,import-flow}.ts(x)`, `apps/web/src/components/account-card.tsx`, tests; modify `apps/web/src/main.tsx`, `apps/web/src/repo/provider.tsx`, `apps/web/src/screens/settings.tsx`, spec §8 is already updated.

**Interfaces — Produces:** `authClient: { signUp(email, password), signIn(email, password), signOut(), session(): Promise<{ userId: string; email: string } | null> }` (plain `fetch` to `/api/auth/sign-up/email`, `/sign-in/email`, `/sign-out`, `/get-session`; injectable for tests); `AuthProvider` exposing `{ status: 'guest' | 'signed-in' | 'loading', email?, signUp, signIn, signOut, retryUpload }` and choosing the repo (`LocalRepo` for guest, `createApiRepo` for signed in); on a repo switch all queries are cleared. `import-flow.ts` implements spec §7: sign up → `exportAll()` of the guest DB → `importAll` → on success clear the guest DB; on failure keep guest data and expose `retryUpload`; sign in → `GET /me` (via `ApiRepo.getProfile`, treat 404-before-init as "new account") → if the account has data, require the explicit confirmation (offer the JSON export first) before discarding guest data; sign out → fresh guest database.

- [ ] **Step 1: Tests first** with a fake `authClient` and an in-memory fake API repo: sign up uploads and clears the guest DB and switches repos; a failed upload leaves guest data intact and shows Retry; login into an account with data shows the confirm (and the export button) and discards only after confirming; cancelling keeps the user in guest mode with data intact; sign out returns to an empty guest DB and the server data is not present locally (Review Focus: no leakage); wrong password shows a friendly generic error; the form validates email shape and password length 10-128 before sending; Account card states (guest, signed in, uploading, error) render with accessible labels and 44 px targets.
- [ ] **Step 2:** Implement; `just check`; commit `feat(web): sign up, log in and out, guest-data upload and repo switching`.

### Task 7: Offline set-log queue and active-session mirror

**Files:** Create `apps/web/src/repo/{offline,outbox}.ts`, `apps/web/test/offline.test.ts(x)`; modify the repo factory used by `AuthProvider`.

**Interfaces — Produces:** `withOffline(api: Repo, store: OutboxStore): Repo & { pending(): number; flush(): Promise<void> }` where `OutboxStore` is a small Dexie database (`workout-tracker-outbox`: `ops` keyed by sequence, `activeSession` single row). Behavior per spec §7: online → pass through and refresh the mirror; on `OfflineError` for `updateSet` → apply to the mirror, enqueue `{ id, patch, updated_at }`, resolve with the mirrored set; `getActiveSession` falls back to the mirror when offline; `startSession`/`finishSession` rethrow `OfflineError`; `flush()` replays in order, drops ops that get a 4xx other than 401 (and reports them through an `onDropped` callback), pauses on 401; triggers: `online` event, app start, every 30 s while `pending() > 0`.

- [ ] **Step 1: Tests first** (fake-indexeddb, controllable `fetch`): offline toggle persists to the mirror and survives a reload; replay on reconnect applies in order; a duplicate replay is harmless; a stale `updated_at` loses to a newer server value (server stub returns the newer row; mirror is updated to it); a 400 on replay drops the op and calls `onDropped`; a 401 pauses and resumes after re-auth; finishing offline throws `OfflineError` and the UI shows "Reconnect to finish"; the queue survives an app restart.
- [ ] **Step 2:** Implement; `just check`; commit `feat(web): offline set-log queue with an active-session mirror`.

### Task 8: Wiring, docs and final verification

**Files:** Modify `compose.yaml` (dev: `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `DATABASE_URL` to the API process; run migrations before the API starts, e.g. a `predev` script in `apps/api`), `deploy/compose.yaml` (already passes the auth env; verify and add `TRUSTED_ORIGINS` if needed), `.env.example`, `README.md`, `CLAUDE.md` (status, M2 invariants), `docs/spec.md` (status, any decisions that changed), `docs/release-checklist.md` (open sign-up warning: no email verification, rate limiting only; DB backups matter now), `docs/superpowers/plans/2026-10-22-m1-local-mvp.md` (add a "Completed" line).

- [ ] **Step 1:** `just dev` brings up db, migrates, starts API and web; `curl` the sign-up endpoint with the dev stack's Origin from the API container and confirm `Set-Cookie` and a `GET /api/v1/me` round trip (a single scripted check; record the output in the report).
- [ ] **Step 2:** Run the production image locally in an isolated compose project (`-p wt-m2`) with a throwaway database, hit `/healthz`, sign up and `GET /api/v1/me` through Caddy-less port 3000; tear down only that project.
- [ ] **Step 3:** Personal-data and secrets sweep over tracked files; `just check`; update docs; commit `docs: M2 status, runbook notes and release checklist additions`.
- [ ] **Step 4:** Final independent review of the whole M2 diff (strongest model, security + parity focus), fix findings in one wave, then mark M2 done in the spec.
