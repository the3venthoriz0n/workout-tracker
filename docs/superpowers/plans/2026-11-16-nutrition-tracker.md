# Nutrition Tracker (N1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A signed-in user opens Nutrition, chooses which nutrients to track and sets optional goals, types what they ate, and an AI (any provider, Gemini to start) estimates the tracked nutrients and adds entries to the day's log, where they can be edited, deleted and totalled against goals.

**Architecture:** A `nutrition_entry` table and a per-user daily `ai_usage` counter (one additive migration), tracked metrics and goals in a `profile.nutrition` jsonb, a pure `dayTotals` in `packages/shared`, and a server-only `MealParser` with two plain-`fetch` adapters (OpenAI-compatible, Anthropic) configured by `AI_*` env. `POST /nutrition/parse` returns drafts and writes nothing; the app saves entries with idempotent `PUT`s. Guests see a sign-in prompt; `LocalRepo` throws `UnauthenticatedError`.

**Tech Stack:** The existing stack. No new dependency.

**Spec:** [docs/superpowers/specs/2026-11-16-nutrition-tracker-design.md](../specs/2026-11-16-nutrition-tracker-design.md)

## Global Constraints

- Public repo: no key, domain, host or personal data in tracked files; the key is `AI_API_KEY` in the host's gitignored `.env`. `just public-check` must pass.
- No new dependency; the AI step is `fetch` only.
- Every table has `user_id`, `created_at`, `updated_at`, `deleted_at`; primary key `(user_id, id)`; ids from `newId()`; creates are idempotent `PUT /resource/:id`; every `/api/v1` route needs a session and scopes by it; a foreign or missing id is `404 {"error":"not_found"}`. State-changing requests need a trusted Origin and JSON. Errors never contain model output or meal text (`500 {"error":"internal_error"}`).
- API changes are additive; the migration is backward compatible with the previous release.
- Features are gated only through `can()` / `limit()` in `entitlements.ts` (`ai_nutrition`, `aiMealsPerDay`: 30 free, 100 pro).
- The UI talks only to `Repo`. 44 px targets, quiet icon-only delete, no swipe-only gestures, check 375 px light and dark. The UI is built with the Impeccable skill in the app's existing design (PRODUCT.md, DESIGN.md).
- Limits (one `NUTRITION_LIMITS`): calories 0 to 10000; protein/carbs/fat/fiber/sugar 0 to 1000 g; sodium 0 to 20000 mg per entry; name 1 to 120 characters; quantity at most 60; meal text at most 500; 300 entries per day; date from one year back to two days ahead; at most 366 days per list request.
- Nutrient keys, in this order: `calories` (kcal), `protein_g`, `carbs_g`, `fat_g`, `fiber_g`, `sugar_g` (g), `sodium_mg` (mg). Default tracked: `calories`, `protein_g`.
- New error codes: `429 ai_limit`, `503 ai_unavailable`, `502 ai_failed`.
- Account deletion removes nutrition data; the account export includes entries and goals; restore replaces them.
- Run everything through `just` (`just check` is what CI runs). Commit on `feat/nutrition`; never push or tag unless asked.

## Review Focus

1. **Provider answers that are not clean JSON** (a ```json fence, prose around it, numbers as strings, a missing tracked key, a value over its limit): the parser strips fences, validates, retries once, then fails with `ai_failed` and saves nothing. (Task 3)
2. **Input that is not food** ("asdf", "I skipped lunch", only spaces): an empty result, the app says "Nothing found. Try describing the food.", and it still counts against the daily cap. (Task 3, 4, 6)
3. **A nutrient switched on after entries exist**: older entries have `null` for it, it shows as a dash and is left out of that total, never counted as zero. (Task 1, 6)
4. **Provider failures**: its own 429 maps to `429 ai_limit`; a rejected or missing key to `503 ai_unavailable`; a timeout or a bad answer to `502 ai_failed`; none of them leak the key, the text or the provider's message. (Task 3, 4)
5. **Double tap, guests, and the day boundary**: Add disables during a parse so a double tap costs one call; a guest never reaches the API; a date outside the window is refused and a date inside it opens that day's log. (Task 4, 5, 6)

---

## File structure

| File | Responsibility |
|---|---|
| `packages/shared/src/nutrition.ts` (new) | nutrient list, limits, zod schemas, `dayTotals`, date check |
| `packages/shared/src/entitlements.ts` | `ai_nutrition`, `aiMealsPerDay` |
| `packages/shared/src/schemas.ts`, `api.ts`, `repo.ts`, `api-repo.ts`, `export.ts`, `index.ts` | profile `nutrition`, request bodies, `Repo` methods, error classes, export arrays |
| `apps/api/src/db/schema/nutrition.ts` (new), `schema/domain.ts`, `db/schema.ts` | tables and the profile column |
| `apps/api/drizzle/0007_*.sql` (generated) | the migration |
| `apps/api/src/service/nutrition.ts` (new), `service/index.ts`, `service/mappers.ts`, `service/transfer.ts`, `service/ownership.ts`, `service/profile.ts` | entries, usage counter, export/import, ownership, profile patch |
| `apps/api/src/ai/meal-parser.ts` (new) | `MealParser`, the two adapters, `createMealParser` |
| `apps/api/src/env.ts`, `apps/api/src/app.ts`, `routes/types.ts` | `AI_*` settings, parser wiring |
| `apps/api/src/routes/nutrition.ts` (new), `routes/index.ts`, `routes/table.ts`, `routes/me.ts`, `routes/http.ts` | endpoints, isolation table, error mapping |
| `apps/web/src/repo/local-repo.ts`, `repo/hooks.ts` | guest stubs, hooks |
| `apps/web/src/screens/nutrition.tsx`, `components/nutrition-*.tsx` (new) | the UI |
| compose files, `.env.example`, `README.md`, `docs/release-checklist.md`, `docs/spec.md`, `CLAUDE.md` | config and docs |

---

### Task 1: Shared model, totals, entitlements

**Files:**
- Create: `packages/shared/src/nutrition.ts`, `packages/shared/test/nutrition.test.ts`
- Modify: `packages/shared/src/entitlements.ts`, `schemas.ts` (profile), `api.ts`, `export.ts`, `index.ts`

**Interfaces:**
- Produces: `NUTRIENTS: readonly { key: NutrientKey; label: string; unit: string }[]`; `type NutrientKey`; `DEFAULT_TRACKED: NutrientKey[]`; `NUTRITION_LIMITS`; `nutritionSettingsSchema` (`{ tracked: NutrientKey[] (1 to 7, unique, kept in canonical order), goals: Partial<Record<NutrientKey, number>> (positive, within the nutrient's limit) }`) and `type NutritionSettings`; `nutritionEntryInputSchema` (`id?`, `date`, `name`, `quantity`, the seven nutrients each `number | null`, `source: 'ai' | 'manual'`), `nutritionEntrySchema` (adds owner and sync columns), `mealDraftSchema` (name, quantity, the seven nutrients, each `number | null`); `isNutritionDate(date: string, today: string): boolean`; `dayTotals(entries: Pick<NutritionEntry, NutrientKey>[], settings: NutritionSettings): Record<NutrientKey, { total: number; counted: number; goal: number | null; left: number | null }>` (entries with `null` for a nutrient are not counted in it; `left` is negative when over); `can(profile, 'ai_nutrition')`, `limit(profile, 'aiMealsPerDay')`; profile gains optional `nutrition` (absent means `{ tracked: DEFAULT_TRACKED, goals: {} }`); `PatchProfileBody` accepts `nutrition`; `PutNutritionEntryBody`, `ParseMealBody` (`{ text }`, trimmed, 1 to 500); `ExportData` gains optional `nutrition_entries` defaulting to `[]`.

- [ ] **Step 1: Failing tests** in `nutrition.test.ts`: `tracked defaults to calories and protein and is kept in canonical order`; `settings reject an empty tracked list, an unknown key, a duplicate and a goal above the limit`; `dayTotals sums only tracked-and-present values and leaves null entries out of that nutrient's count`; `dayTotals left is goal minus total and negative when over, null without a goal`; `entry schema rejects calories above 10000, a name with control characters and a bad date`; `isNutritionDate accepts one year back and two days ahead, rejects 2093-01-01 and 2026-02-30`; `free and pro can ai_nutrition with limits 30 and 100`; `an export without nutrition_entries still parses`.
- [ ] **Step 2: Run** `just pnpm --filter @workout/shared test`; expect FAIL (module missing).
- [ ] **Step 3: Implement** the interfaces above. Names use the existing public-text cleaning rule (controls and bidi stripped).
- [ ] **Step 4: Run** the shared tests and `just typecheck`; expect PASS.
- [ ] **Step 5: Commit** `feat(shared): nutrition model, totals and entitlements`.

### Task 2: Tables, migration and service

**Files:**
- Create: `apps/api/src/db/schema/nutrition.ts`, `apps/api/src/service/nutrition.ts`, `apps/api/test/service.nutrition.test.ts`, the generated migration
- Modify: `db/schema/domain.ts` (profile `nutrition` jsonb), `db/schema.ts`, `service/mappers.ts`, `service/index.ts`, `service/ownership.ts`, `service/profile.ts`, `service/transfer.ts`

**Interfaces:**
- Consumes: Task 1 schemas.
- Produces on `Service`: `listNutrition(from: string, to: string): Promise<NutritionEntry[]>` (range of at most 366 days, sorted by date then `created_at`), `saveNutritionEntry(input: NutritionEntryInput): Promise<NutritionEntry>` (idempotent upsert, date window enforced, 300 per day enforced), `deleteNutritionEntry(id: string): Promise<void>` (soft delete), `takeAiMeal(dailyLimit: number, today: string): Promise<number | null>` (atomically counts one parse and returns how many remain, or `null` at the cap); `owns('nutrition_entry', id)`; `updateProfile` accepts `nutrition`.

- [ ] **Step 1: Failing tests** in `service.nutrition.test.ts` (use the existing harness): `save is idempotent for one id`; `a foreign user's entry is NotFound on delete and is never listed`; `delete soft-deletes and list ignores it`; `a date outside the window is a ValidationError`; `the 301st entry on a date is a ValidationError`; `list orders by date then created time and rejects a range over 366 days`; `takeAiMeal at the limit returns null and two parallel calls at limit minus one allow exactly one` ; `account deletion removes entries and usage`; `export then replace-import round-trips entries and nutrition settings`; `updateProfile stores and returns nutrition settings`.
- [ ] **Step 2: Run** `just test`; expect FAIL.
- [ ] **Step 3: Implement.** Tables per the design (`nutrition_entry` with nullable nutrient columns as `numeric`; `ai_usage` primary key `(user_id, usage_date)`; profile `nutrition` jsonb nullable). Run `just db-generate` for the migration and confirm it is additive only. `takeAiMeal` is one `INSERT ... ON CONFLICT DO UPDATE SET count = count + 1 WHERE count < limit RETURNING count`. Include entries in export and in the replace-import (delete-then-insert like the other tables).
- [ ] **Step 4: Run** `just test`; expect PASS.
- [ ] **Step 5: Commit** `feat(api): nutrition tables, service and usage counter`.

### Task 3: The meal parser (any provider)

**Files:**
- Create: `apps/api/src/ai/meal-parser.ts`, `apps/api/test/ai.meal-parser.test.ts`
- Modify: `apps/api/src/env.ts`, `apps/api/test/env.test.ts`

**Interfaces:**
- Consumes: `mealDraftSchema`, `NutrientKey` (Task 1).
- Produces: `interface MealParser { parse(text: string, tracked: NutrientKey[]): Promise<MealDraft[]> }`; `createMealParser(env: Pick<Env, 'AI_PROVIDER' | 'AI_BASE_URL' | 'AI_API_KEY' | 'AI_MODEL'>, fetchFn?: typeof fetch): MealParser | null` (null without a key); errors `AiLimitError`, `AiUnavailableError`, `AiFailedError` (in `packages/shared/src/repo.ts` with the other errors, no payload). Env: `AI_PROVIDER` (`openai` default | `anthropic`), `AI_BASE_URL` (default per provider: none for `openai`, `https://api.anthropic.com` for `anthropic`; required for `openai` when a key is set), `AI_API_KEY` (optional, whitespace-free, never echoed), `AI_MODEL` (required when a key is set).

- [ ] **Step 1: Failing tests** with a stub `fetch` (no network): `openai adapter posts to {base}/chat/completions with a bearer key, JSON mode and only the tracked keys in the prompt`; `anthropic adapter posts to /v1/messages with x-api-key and anthropic-version`; `a fenced json answer is parsed`; `prose around the json is rejected then retried once, then AiFailedError`; `a number as a string, a missing tracked key and calories over 10000 are rejected`; `keys the model adds beyond the tracked ones are stripped`; `a non-food input yields an empty list`; `provider 429 is AiLimitError, 401 and 403 are AiUnavailableError, a timeout or 5xx is AiFailedError`; `no key means createMealParser returns null`; `the meal text and the key never appear in a thrown error or in anything logged`; `an injection attempt in the text cannot add fields or change the schema`; env test: `AI_API_KEY without AI_MODEL (or an openai provider without AI_BASE_URL) is a startup error that names the variable but not the key`.
- [ ] **Step 2: Run** `just test`; expect FAIL.
- [ ] **Step 3: Implement** both adapters with a 30 s timeout and one retry on invalid output only (not on 429, 401 or a timeout). The system prompt states the task, units (kcal, grams, milligrams of sodium) and "estimate when unsure"; the meal text appears only in the user turn; no tools. Extract JSON by stripping a code fence and taking the outermost object; validate with zod.
- [ ] **Step 4: Run** `just test`; expect PASS.
- [ ] **Step 5: Commit** `feat(api): meal parser with OpenAI-compatible and Anthropic adapters`.

### Task 4: Routes

**Files:**
- Create: `apps/api/src/routes/nutrition.ts`, `apps/api/test/routes.nutrition.test.ts`
- Modify: `routes/index.ts`, `routes/types.ts` (`mealParser` and `now` in `RouteDeps`), `app.ts`, `routes/table.ts`, `routes/me.ts`, `routes/http.ts` (error mapping)

**Interfaces:**
- Consumes: Tasks 2 and 3.
- Produces: `GET /nutrition/entries?from&to`, `PUT|PATCH|DELETE /nutrition/entries/:id`, `POST /nutrition/parse` (`{ items: MealDraft[], remaining_today: number }`), `PATCH /me` with `nutrition`. `parse` checks, in order: session, `can(profile,'ai_nutrition')` (403), body (400), the cap (`429 ai_limit`), parser configured (`503 ai_unavailable`), then the parse (errors mapped to `429 ai_limit`, `503 ai_unavailable`, `502 ai_failed`). The cap is taken before the call and not refunded. `parse` writes no entries.

- [ ] **Step 1: Failing tests:** every new route appears in `table.ts` so the generated isolation tests cover 401, 404 and cross-user; `parse returns drafts for the tracked nutrients only and writes nothing`; `parse over the daily limit is 429 ai_limit and does not call the parser`; `parse without a configured parser is 503 ai_unavailable`; `parser failures map to 502, 429 and 503 with no provider text in the body`; `parse with empty or whitespace text is 400`; `entries respect the date window and the per-day cap with 400`; `PATCH /me nutrition validates tracked and goals`; `state-changing requests still need a trusted Origin and JSON`.
- [ ] **Step 2: Run** `just test`; expect FAIL.
- [ ] **Step 3: Implement** the routes with the existing `body`, `param` and `service` helpers; read tracked metrics from the caller's profile (default when absent).
- [ ] **Step 4: Run** `just test`; expect PASS.
- [ ] **Step 5: Commit** `feat(api): nutrition routes`.

### Task 5: Repo interface, `ApiRepo`, guest stubs, hooks

**Files:**
- Modify: `packages/shared/src/repo.ts`, `api-repo.ts`, `testing/repo-contract.ts`, `apps/web/src/repo/local-repo.ts`, `apps/web/src/repo/hooks.ts`
- Test: `apps/web/test/local-repo.nutrition.test.ts`, the shared contract (a `nutrition` group enabled for `ApiRepo` only)

**Interfaces:**
- Consumes: Task 4 routes.
- Produces on `Repo`: `listNutrition(from, to)`, `saveNutritionEntry(entry)`, `deleteNutritionEntry(id)`, `parseMeal(text)`; goals and tracked metrics go through `updateProfile({ nutrition })`. Hooks in `hooks.ts`: `useNutrition(date: string)` (the day's entries), `useSaveNutritionEntry()`, `useDeleteNutritionEntry()`, `useParseMeal()`. `ApiRepo` maps `429 ai_limit` to `AiLimitError`, `503` to `AiUnavailableError`, `502` to `AiFailedError`. `LocalRepo` methods throw `UnauthenticatedError`.

- [ ] **Step 1: Failing tests:** `LocalRepo nutrition methods all throw UnauthenticatedError`; contract (ApiRepo): `save then listNutrition returns the entry`, `saving the same id twice keeps one entry`, `deleteNutritionEntry removes it`, `parseMeal maps ai_limit, ai_unavailable and ai_failed to typed errors`, `updateProfile stores tracked and goals`.
- [ ] **Step 2: Run** `just test`; expect FAIL.
- [ ] **Step 3: Implement** the interface, `ApiRepo`, stubs and hooks. Invalidate the day's query after a save or delete.
- [ ] **Step 4: Run** `just test`; expect PASS.
- [ ] **Step 5: Commit** `feat: nutrition repo methods and hooks`.

### Task 6: The Nutrition screen (use the Impeccable skill)

**Files:**
- Create: `apps/web/src/components/nutrition-add.tsx`, `nutrition-log.tsx`, `nutrition-totals.tsx`, `nutrition-entry-sheet.tsx`, `nutrition-goals.tsx`; tests `apps/web/test/nutrition.test.tsx`
- Modify: `apps/web/src/screens/nutrition.tsx` (replaces the placeholder)

**Interfaces:**
- Consumes: Task 5 hooks, `dayTotals`, `NUTRIENTS`, `useSignedIn`.
- Produces: `NutritionScreen` with a Track | Goals segmented control (`?section=goals`, like Library). The add box, log and totals take `date` and have no dependency on the screen, so they can move to Today later.

Invoke the Impeccable skill before writing any UI (shape the screen, then build it in the existing design; read PRODUCT.md and DESIGN.md; run its detector on the changed files at the end).

- [ ] **Step 1: Failing tests:** `a guest sees "Create an account to track nutrition" with a Settings link and no add box`; `Track shows only tracked nutrients; a goal adds "/ goal" and over-goal is said in words`; `typing a meal and tapping Add saves the returned items and shows them; the button is disabled while the parse runs (a double tap makes one parse call)`; `an empty result shows "Nothing found. Try describing the food."`; `ai_limit, ai_unavailable and offline each show their own message and keep the log usable`; `a null nutrient shows a dash and is not counted`; `editing an entry updates the totals and sets source to manual; delete asks first`; `arrows move between days and a day outside the window is not reachable`; `Goals: a switch per nutrient (calories and protein on by default), at least one stays on, a goal field appears when on, and changes save`; `turning a nutrient off hides it but keeps stored values`.
- [ ] **Step 2: Run** `just pnpm --filter @workout/web test`; expect FAIL.
- [ ] **Step 3: Implement** the components. Entries are saved with client-generated ids (`newId()`) so a retried save is idempotent. Totals show numbers first with a bar as a second cue.
- [ ] **Step 4: Run** the web tests; then check 375 px light and dark with `just dev`.
- [ ] **Step 5: Commit** `feat(web): Nutrition screen with Track and Goals`.

### Task 7: Config, docs and Gemini setup

**Files:**
- Modify: `compose.yaml`, `deploy/compose.yaml`, `deploy/self-hosted/compose.yaml`, `.env.example`, `README.md`, `docs/release-checklist.md`, `docs/spec.md` (features, data model, API, entitlements, decisions log), `CLAUDE.md` (invariants: nutrition rules, `AI_*`)

- [ ] **Step 1:** pass `AI_PROVIDER`, `AI_BASE_URL`, `AI_API_KEY`, `AI_MODEL` through each compose file as optional values (`${AI_API_KEY:-}`; unset turns the feature off), and document them in `.env.example` with the Gemini values: `AI_PROVIDER=openai`, `AI_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai`, `AI_API_KEY=<your key from Google AI Studio>`, `AI_MODEL=<a Flash or Flash-Lite model from AI Studio>`.
- [ ] **Step 2:** add the release-checklist items (pick a provider, set the four values in the host `.env`, name the provider in the privacy notice) and a note that Gemini's free tier lets Google use and review content.
- [ ] **Step 3:** update the spec and CLAUDE.md; run `just check` and `just public-check`; expect PASS.
- [ ] **Step 4: Commit** `docs: nutrition config, checklist and spec`.

---

## Self-review

- **Spec coverage:** Track and Goals (6); choosable metrics (1, 4, 6); AI any provider with the four settings (3, 7); Gemini first (7); sign-in only (5, 6); cap and entitlement (1, 2, 4); privacy and deletion/export (2, 7); Impeccable UI (6); log by date with day navigation (4, 6); estimate mark and source (1, 6); future move to Today (6 interfaces).
- **Types:** `NutrientKey`, `NutritionSettings`, `NutritionEntry`, `MealDraft` are defined in Task 1 and used unchanged in 2 to 6; `MealParser.parse(text, tracked)` in 3 is what 4 calls; the error classes in 3 are what 4 and 5 map.
- **Not verified:** that Gemini's compatible endpoint honours JSON mode for the chosen model (the parser does not rely on it); the free-tier limits and the current model names (read from AI Studio).
- **Out of scope:** manual add, photos, barcodes, a food database, templates, charts, per-user keys, guests and offline.
