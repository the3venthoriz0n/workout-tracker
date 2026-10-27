# Account Deletion and Export (M2c) Plan

> **Status: In progress (2026-10-27).**

**Goal:** A signed-in user can download all their data and delete their account from Settings.

**Decisions (owner):**
- Deletion is immediate, confirmed with the current password (no grace period, no email step).
- The user's **published** community listings stay, shown with the author "Deleted user". Unpublished and hidden listings are deleted.
- Nothing personal stays behind: no email, no display name, no auth rows, no sessions.

**Approach:** One custom route, `DELETE /api/v1/account` with `{ password }`, instead of Better Auth's `deleteUser`. Better Auth's endpoint deletes without a password when the session is fresh and runs outside our transaction, so it can neither require the password nor fix the counters atomically. The password is checked with Better Auth's own `verifyPassword` (server-only endpoint, same hash code as sign-in); attempts are limited per user (5 a minute, like sign-in). Everything else happens in one transaction.

## Tasks

1. **API** (tests first, fail before):
   - Migration (drizzle-kit): `shared_plan.owner_id` nullable, `ON DELETE SET NULL`.
   - `deleteAccount` service, one transaction: lock the user row; delete the user's votes and downloads and decrement the counters of those listings; anonymise kept listings (`owner_id = null`) and delete the rest; set `source.author` to "Deleted user" on copies of the user's listings; delete the user row (cascades profile, library, plans, history, sessions, accounts) and its verification rows.
   - Route: 204 on success with the session cookie cleared; wrong password `403 {"error":"invalid_password"}`; `429 {"error":"rate_limited"}` over the limit.
   - Public area and adoption: listings with no owner are shown with author "Deleted user"; voting and adopting still work; nobody can publish or unpublish them.
   - Export gains the account email and the user's listings (with versions), votes and downloads (optional fields; import ignores them).
   - Tests: counters equal row counts (including a concurrent vote), isolation matrix row, old cookie 401, the same email signs up again with an empty account, a second user untouched, public whitelist walk over an anonymised listing.
2. **Web** (tests first): Settings > Account: "Export my data", then a "Delete account" card (what is removed, shared plans stay as "Deleted user", password + type DELETE). Success clears query cache, outbox, mirror and hints, returns to an empty guest library and shows a toast. Errors keep the form.
3. **Docs:** spec §3/§5/§9/§13/§14, CLAUDE.md invariants, README, release checklist, roadmap.

## Review focus

- Counter integrity under concurrent votes/downloads during a deletion.
- No personal data left: email, display name, sessions, verification rows; kept listings carry no owner.
- Wrong password, rate limit and a stolen session: nothing deleted, nothing revealed.
- Every code path that reads `owner_id` handles null (own-listing check, `listMyShared`, publish limits, public joins).
- Web: after deletion nothing of the account remains on the device (queries, outbox, mirror, hint).
