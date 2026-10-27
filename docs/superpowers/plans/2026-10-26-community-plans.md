# Community Plans Implementation Plan

> **Status: Done (2026-10-26). Community plan sharing shipped (v0.0.4).**

> **For agentic workers:** Use superpowers:subagent-driven-development (lean variant: one implementer per task, fail-before/pass-after tests, controller reads the diff; independent review of Task 1 only) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Signed-in users can publish a plan to a public community list (versioned, frozen until re-published); anyone, signed in or not, can browse, search and filter it; signed-in users can upvote; anyone can take a copy that is theirs to edit and that never affects the original.

**Architecture:** A published plan is an immutable JSON **snapshot** (names only, no ids from the sharer's library) stored per version in Postgres, behind a `shared_plan` listing row that owns the counts. Reads are served from a new public, session-less API area (`/api/public/*`) with a field whitelist; writes (publish, unpublish, vote, adopt) are normal authenticated `/api/v1` routes. "Use this plan" is a new `Repo.adoptSharedPlan` operation implemented by LocalRepo (guest, from a fetched snapshot) and the server service (signed in, snapshot loaded server-side, never trusted from the client), so both produce the same copy. Copies keep a `source` pointer (listing id, version, title, author name) for "based on X by Y" and "update available".

**Tech Stack:** As in the repo: Hono, Drizzle/Postgres, Better Auth, zod, Dexie, React, TanStack Query, Vitest.

**Spec:** `docs/spec.md` §3, §5, §9, §13 (update them as part of Task 1).

## Global Constraints

- Everything via `just`; exact dependency pins; no personal info in the repo.
- Existing invariants stay: every `/api/v1/*` route needs a session and foreign ids give the identical `404 {"error":"not_found"}`; the public area lives only under `/api/public/*`, is GET-only, and never needs or reads a session.
- Public responses use an explicit field whitelist: never `owner_id`, email, notes, video URLs, timestamps of private rows or anything from the sharer's library beyond the snapshot. A test walks every public response and fails on any key outside the whitelist.
- A snapshot contains: plan name, units, days (name, colour) and items (exercise name, required gear names, `supports_angle`, sets, reps, weight, angle, `amrap_last`, superset key, effective rule or null). It contains NO exercise notes, video URLs, history, ids or personal data. Every string is length-bounded and control characters stripped.
- Title 3-60 chars, description 0-500, `level` null | beginner | intermediate | advanced. Title and description may not contain URLs (`http://`, `https://`, `www.`). A public `display_name` (2-30 chars, letters, digits, spaces, `_` `-` `.`) is required to publish and is the only identity shown.
- Per account: at most 5 publish operations (new listing or new version) per rolling 24 hours and at most 20 live listings. Exceeding either is `429 {"error":"publish_limit"}`.
- One upvote per (user, listing); one counted download per (signed-in user, listing). Guests can copy but are not counted. Counts are denormalized on the listing and updated in the same transaction.
- Adopting converts weights and rule amounts from the snapshot's units to the adopter's units (existing conversion helpers), reuses the adopter's exercises and gear by case-insensitive name and creates the missing ones, and never overwrites existing data. Unknown or over-limit values are rejected, not clamped silently.
- Listing status: `published | unpublished | hidden`. `hidden` is set by the owner of the service in the database (documented in the release checklist) and behaves like unpublished everywhere but cannot be reversed by the sharer.

## Review Focus

- A guest or another user trying to read, vote on, adopt or unpublish something they should not: unpublished/hidden listings are 404 publicly, only the owner can unpublish, and the list never shows them.
- Publishing a plan that has deleted exercises, empty days, zero items or a superset of one: rejected with a clear message or normalized, never a half-written listing.
- Adopting the same listing twice, two versions in a row, or while offline: second adopt creates a second independent copy, counts stay once per user, the offline queue is not involved (adoption needs a connection when signed in).
- Search input: empty query, SQL wildcard characters (`%`, `_`), very long strings, unicode: no errors, no scans of unbounded size (limit 20 per page, cursor paging).
- Counts drift: two simultaneous votes or an unpublish during a vote leave the counters equal to the real row counts (assert in a test).
- A snapshot version taken in kg adopted by a lb user and back: weights round to the user's progression step and rule amounts stay valid.

---

## File Structure

- `packages/shared/src/community.ts`: zod schemas (`sharedSnapshotSchema`, listing, filters), `snapshotFromPlanTree`, `planFromSnapshot` (pure), constants.
- `packages/shared/src/repo.ts`: new profile field `display_name`, plan `source`, and the methods below.
- `apps/api/src/db/schema/community.ts`, `apps/api/src/service/community.ts`, `apps/api/src/routes/community.ts` (authenticated) and `apps/api/src/routes/public.ts` (public).
- `apps/web/src/repo/local-repo.ts` (+ Dexie v3 upgrade), `apps/web/src/screens/community*.tsx`, `components/share-sheet.tsx`, settings and plan-detail changes.

---

### Task 1: Data layer, API and contract (independent review after)

**Files:** create the files above (shared, API); modify `repo.ts`, `schemas.ts`, `export.ts`, Drizzle schema + generated migration, `routes/table.ts`/isolation tests, `api-repo.ts`, `local-repo.ts` (Dexie v3: default `display_name` and `source` on existing data), `docs/spec.md`.

**Interfaces:**
- Profile gains `display_name: string | null`; `updateProfile` accepts it with the validation above. Plan gains `source: { shared_plan_id: string; version: number; title: string; author: string } | null` (nullable, default null in imports and exports) and `published: { shared_plan_id: string; version: number; status } | null` (server only; local plans always null).
- `Repo` additions: `publishPlan(planId, { title, description, level }): Promise<{ shared_plan_id; version }>`; `unpublishPlan(planId): Promise<void>`; `listMyShared(): Promise<SharedListing[]>`; `adoptSharedPlan(input: { shared_plan_id: string; version?: number; snapshot?: SharedSnapshot }): Promise<{ plan_id: string }>` (signed-in implementations ignore `snapshot` and load by id; LocalRepo requires it); `setVote(sharedPlanId, voted: boolean): Promise<{ upvotes: number }>`; `hasVoted(sharedPlanId)`. LocalRepo implements publish/unpublish/vote as `UnauthenticatedError` (guests cannot) and adopt for real.
- Public client functions (not on `Repo`; plain fetch in `packages/shared`): `fetchCommunityList(params)`, `fetchCommunityPlan(id)`, with the same error mapping as ApiRepo.
- Routes: `POST /api/v1/plans/:id/publish`, `DELETE /api/v1/plans/:id/publish`, `GET /api/v1/shared-plans/mine`, `PUT|DELETE /api/v1/shared-plans/:id/vote`, `POST /api/v1/shared-plans/:id/adopt`; public `GET /api/public/plans?q&days&level&gear=none&sort=top|new|used&cursor&limit` and `GET /api/public/plans/:id` (listing + latest snapshot) and `GET /api/public/plans/:id/versions/:n`. Public responses carry `Cache-Control: public, max-age=30`.
- Search: `q` matches title, description and exercise names in the snapshot (case-insensitive, wildcard characters escaped); `days` = number of days in the snapshot; `gear=none` = no required gear in any exercise; `sort` default `top` (upvotes desc, then downloads, then newest).

- [ ] **Step 1: Write failing tests** (shared unit tests for schemas, `snapshotFromPlanTree` and `planFromSnapshot` incl. unit conversion and name matching; contract cases for adopt on LocalRepo and the server service; API tests: publish limits and validation, versioning and freezing (edit the plan after publishing; public snapshot unchanged; republish makes v2), unpublish/hidden visibility, vote idempotency and counter integrity under concurrent votes, download counted once per user and not for guests, adopt twice creates two copies, public whitelist walk, search wildcard escaping, isolation matrix rows for every new authenticated route, `source` and `display_name` round-trip through export/import and old exports still import).
- [ ] **Step 2: Run them; expected FAIL.**
- [ ] **Step 3: Implement** per the interfaces and constraints; Drizzle tables `shared_plan` (id uuid pk, owner_id fk cascade, title, description, level, status, latest_version, upvote_count, download_count, created_at, updated_at), `shared_plan_version` ((shared_plan_id, version) pk, snapshot jsonb, created_at), `plan_vote` ((user_id, shared_plan_id) pk, created_at), `plan_download` ((user_id, shared_plan_id) pk, first_version, created_at), and `plan` gains `source` jsonb and `shared_plan_id` uuid null; indexes for list sorts and for `q`. Migration via drizzle-kit only. Update spec sections.
- [ ] **Step 4: Run tests; expected PASS;** `just check`.
- [ ] **Step 5: Commit** `feat: community plan sharing data layer and API`.
- [ ] **Step 6: Independent opus review** of authorization, public leakage, limits, counter integrity and the adopt path.

### Task 2: Web: Community, share flow, settings

**Files:** create `apps/web/src/screens/community.tsx`, `community-plan.tsx`, `components/share-sheet.tsx`, `components/community-filters.tsx`; modify Plans screen (toggle `My plans | Community`), plan-detail (Share / Publish update / Unpublish with counts), plans list ("Based on X by Y · v1 · Update available"), Settings ("Public name" field), router, hooks.

- [ ] **Step 1: Write failing component tests:** toggle shows Community without a session; list renders cards (title, author, days, level, upvotes, downloads) from a stubbed public API; filters (text, days, level, no gear, sort) change the request; detail shows days/exercises preview, upvote button (guest sees "Sign in to upvote"), "Use this plan" (guest: copies locally via `LocalRepo.adoptSharedPlan` with the fetched snapshot; signed in: adopt by id) and navigates to the new plan; share sheet validates title/description/links/level, blocks until a public name exists (links to Settings), shows publish limit and success, "Publish update" appears after edits and v2 is created; unpublish confirm; plans list shows source line and "Update available" (compared with the public latest version, fails quietly offline); Settings public name validation.
- [ ] **Step 2: Run; expected FAIL.**
- [ ] **Step 3: Implement** in the current visual language (soft surfaces, pill controls, 44px targets, mobile first, empty and loading states, no tracking). Empty community: "Nothing shared yet. Publish one of your plans." with the action.
- [ ] **Step 4: Run tests; expected PASS;** `just check`; headless screenshots at 375px light/dark of the list, filters, detail, share sheet (guest mode / seeded API data as feasible), not committed.
- [ ] **Step 5: Commit** `feat(web): community plans: browse, share, upvote, use`.

### Task 3: Docs and final pass

- [ ] Update README, CLAUDE.md invariants (public area rules, snapshot privacy, counters), spec §3/§8/§13, `docs/release-checklist.md` (hiding a listing: `update shared_plan set status='hidden' where id=...`; open sign-up note; M2b verification recommended before wide exposure). Leave `SIGNUP_ALLOWLIST` unset (open sign-up) in docs for staging with the note that the allowlist code stays.
- [ ] `just check` once; one short independent review of Task 2's handling of untrusted public data (rendering escaped text only, no HTML injection, no links followed).
- [ ] Commit `docs: community plans`.
