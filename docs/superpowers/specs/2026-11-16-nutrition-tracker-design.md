# Nutrition tracker (N1): design

> **Status: draft for the owner's approval (2026-11-16, revised the same day for any-provider AI and choosable metrics). Nothing is built.** It replaces the earlier draft plan in PR #37 and keeps only that plan's cost and privacy guardrails. The owner's words below are marked as decided; everything else is a proposed call, listed so it can be changed.

## Intent

Log food by typing it the way you would say it ("1 chicken burrito, 1 yogurt") and let an AI work out the estimated nutrition and add it to the day's log. Set daily targets for calories and other nutrients, and see the day against them. It should feel as light as logging a set: one box, one button, edit only when the estimate is off.

For now it lives in the **Nutrition** tab. It may later move into **Today**, so the pieces (the add box, the day log, the totals) are built as components that do not depend on the tab.

## Decided by the owner

- The Nutrition tab has two sub-tabs, **Track** and **Goals**.
- **Goals:** per-day targets for calories, protein, fat and more, all configurable.
- **Which metrics to track is a choice**: switch each nutrient on or off (for example only calories and protein). Calories and protein are on by default.
- **Any AI service can be plugged in**: any model or API key, with a free option usable today.
- **Track:** type what you ate; the AI estimates calories and other nutrients and adds them to the log.
- **Sign-in only.** Guests see a prompt to create an account.
- Tracked inside the Nutrition tab for now, possibly Today later.

## Goals

- Typing a meal and tapping Add puts estimated entries in today's log in one step.
- Every entry is editable and deletable afterwards; estimates are always labelled as estimates.
- The lifter chooses which nutrients to track. Only those are asked of the AI, shown in the log and totalled; each can also have a goal.
- A day can be opened by date (yesterday's catch-up works).
- Cost is bounded per user per day. Meal text is private.

## Non-goals (for N1)

Guests or offline logging; photos, barcodes or a food database lookup; meal templates, favourites or recent foods; charts or weekly views; showing food in the History tab; sharing; micronutrients beyond the seven below; manual "add by hand" entry (editing an AI entry covers corrections; manual add can follow).

## Anti-goals

A number that looks exact when it is a guess. An AI bill nobody bounded. Meal text in a log, an error message or a backup that outlives the account.

## Constraints

- Public repo: the AI key is `AI_API_KEY` in the host's gitignored `.env` only; `just public-check` must pass.
- Same ownership rules as the rest of the app: every table has `user_id`, `created_at`, `updated_at`, `deleted_at`; primary key `(user_id, id)`; ids from `newId()`; creates are idempotent `PUT /resource/:id`; every `/api/v1` route needs a session and scopes by it; a foreign or missing id is `404 {"error":"not_found"}`.
- API changes are additive; the migration is backward compatible with the previous release.
- The UI talks only to the `Repo` interface. 44 px targets, quiet icon-only delete, no swipe-only gestures, 375 px light and dark.
- **No new dependency**: the AI step uses plain `fetch` against the provider's HTTP API, so the app stays "very simple" and works with any service. Any Claude adapter follows the `claude-api` skill's request shape.
- Account deletion leaves no nutrition data; the account export includes it and restore replaces it.

## Approaches considered

1. **Server-side AI behind one small provider interface (chosen).** The app posts the text to our server; the server asks whichever provider is configured, validates the answer and returns drafts; the app saves entries with idempotent `PUT`s. The key never reaches the phone, validation lives in one place, and switching provider is a settings change. Cost: sign-in only and online only, which the owner already wants.
2. **AI called from the phone, or a key typed in by each user.** Puts keys in a public app, or needs per-user secret storage. Rejected for N1; a per-user key can be added later behind the same interface.
3. **A nutrition database lookup instead of (or before) the AI.** More accurate for plain foods, but it adds a service and a key and handles "1 chicken burrito" worse. A reasonable later addition if estimates prove too loose; not N1.

## Design

### Data

- `nutrition_entry(id, user_id, date, name, quantity, calories, protein_g, carbs_g, fat_g, fiber_g, sugar_g, sodium_mg, source 'ai'|'manual', created_at, updated_at, deleted_at)`, where **each nutrient is nullable**: null means "not estimated" (it was not tracked when the entry was logged). `date` is a `YYYY-MM-DD` calendar date chosen by the client (its local day). There is no separate "day" row: a day is the entries sharing a date, and totals are computed.
- `profile.nutrition` (jsonb, nullable; absent means the defaults): `{ tracked: NutrientKey[], goals: { calories?, protein_g?, carbs_g?, fat_g?, fiber_g?, sugar_g?, sodium_mg? } }`, validated by one zod schema. `tracked` defaults to calories and protein. Turning a nutrient off hides it and stops asking for it but keeps what was stored; turning one on later leaves older entries blank for it (shown as a dash and left out of that nutrient's total). Goals live on the profile; changing a goal changes how every day is measured against it (no per-day snapshot in N1).
- `ai_usage(user_id, usage_date, count)`, primary key `(user_id, usage_date)`: the per-user daily counter for parses.
- Limits (one `NUTRITION_LIMITS` table in `packages/shared`): calories 0 to 10000, protein/carbs/fat/fiber/sugar 0 to 1000 g, sodium 0 to 20000 mg per entry; name 1 to 120 characters, quantity at most 60, meal text at most 500, 300 entries per day. Names pass the existing public-text cleaning (controls and bidi stripped).
- Date window: any real date from one year back to two days ahead.
- Totals are a pure function in `packages/shared` (`dayTotals(entries, goals)`: each nutrient's sum, its goal, and what is left or over), used by the app so it works the same for any screen; the server stores entries and never needs totals.

### API (all under `/api/v1`, session required)

| Method | Path | Notes |
|---|---|---|
| GET | `/nutrition/entries?from&to` | Entries in a date range, at most 366 days; sorted by date then created time |
| PUT / PATCH / DELETE | `/nutrition/entries/:id` | Idempotent create or replace, partial update, soft delete |
| POST | `/nutrition/parse` `{ text }` | The server reads the caller's tracked metrics from the profile and asks only for those. | Returns `{ items: MealDraft[], remaining_today }`. Writes nothing. Order of checks: session, entitlement, body, daily cap, parser available, parse |
| PATCH | `/me` | Gains `nutrition` (tracked metrics and goals) |

Errors added: `429 {"error":"ai_limit"}`, `503 {"error":"ai_unavailable"}` (no key configured), `502 {"error":"ai_failed"}`. Errors never include model output or the meal text.

### The AI step (any provider)

- A `MealParser` interface with two small adapters, both plain `fetch`, no SDK:
  - **OpenAI-compatible chat completions** (works with Groq, OpenRouter, Gemini's compatible endpoint, Ollama, Cloudflare, NVIDIA and many more): `POST {AI_BASE_URL}/chat/completions` with the key as a bearer token.
  - **Anthropic Messages** (`AI_PROVIDER=anthropic`) for a Claude key.
- Configured by the host's `.env`, never in code: `AI_PROVIDER` (`openai` default | `anthropic`), `AI_BASE_URL`, `AI_API_KEY`, `AI_MODEL`. Unset key means the feature reports unavailable and nothing else breaks. Plugging in a different service is changing these four values.
- Providers differ in how strictly they enforce a schema, so the contract is ours: the prompt asks for JSON in a fixed shape listing only the tracked nutrients, JSON mode is requested where the provider has it, and the answer is parsed and validated with zod. Invalid output gets one retry, then `502 ai_failed` and nothing saved. A refusal is a failure, not a crash.
- The system prompt states the task, the units, and "estimate when unsure"; the meal text appears only in the user turn. No tools. Unrecognised input ("asdf", "skipped lunch") returns an empty list and the app says nothing was found; it still counts against the cap. Prompt injection: no tools, schema-validated output, extra keys stripped, nothing the model wrote reaches the client except validated fields.
- Cap: `aiMealsPerDay` entitlement (default 30 on free, 100 on pro), counted atomically before the call and not refunded on failure. `can(profile, 'ai_nutrition')` gates the route. A provider's own rate limit comes back as `429 ai_limit` too.
- **Free options today** (limits from comparison articles in Nov 2026; check each provider's page): Groq (no card, roughly 1,000 requests a day per model), OpenRouter's free models (small daily cap, changes often), and Ollama on the host (free and fully private, uses your hardware). Gemini's free tier is free but its terms let Google use and human-review the content, so it is not recommended for meal text.
- **Privacy depends on the provider.** Meal text goes from our server to whichever provider is configured. The privacy notice and the release checklist say which; a self-hosted Ollama keeps it on your own machine.

### Screens

```
Nutrition                         [ Track | Goals ]

Track
  < Sun 15 Nov >                        (arrows; today by default)
  830 / 2400 kcal   44 / 160 g protein  (tracked nutrients; a goal adds "/ goal")
  [ 1 chicken burrito, 1 yogurt      ] [Add]
  Chicken burrito   1 burrito   ~680 kcal · 32 g P     [edit] [delete]
  Yogurt            1 cup       ~150 kcal · 12 g P     [edit] [delete]

Goals                                   (one row per nutrient)
  Calories   [on]   goal [2400]
  Protein    [on]   goal [ 160 g]
  Carbs      [off]
  Fat        [off]
  Fiber / Sugar / Sodium  [off]          (a goal is optional; saves as you change it)
```

- Guests see "Create an account to track nutrition" with a link to Settings, in both sub-tabs.
- Add disables while a parse runs (a double tap costs one parse). Entries from the AI are saved with idempotent `PUT`s using client ids. Empty result: "Nothing found. Try describing the food." `ai_limit` and `ai_unavailable` show their own messages. Offline: "Needs a connection."
- An entry opens in a sheet to edit its name, quantity and every nutrient; delete asks first. Entries from the AI have `source: 'ai'` and show a small "estimate" mark; saving an edit sets `source: 'manual'`, which removes the mark.
- Progress is numbers first ("830 / 2400"), with a bar as a second cue; over a goal is shown by wording as well as colour.
- The UI is built with the Impeccable skill, in the app's existing design (DESIGN.md) rather than a new look.
- Sub-tab state is in the URL (`?section=goals`), like Library.

### Repo, sync and privacy

- `Repo` gains `listNutrition(from, to)`, `parseMeal(text)`, `saveNutritionEntry`, `deleteNutritionEntry`; goals go through the existing profile update. `LocalRepo` throws `UnauthenticatedError` for all of them (as community publishing does); `ApiRepo` calls the routes. Nothing is queued in the offline outbox.
- Meal text goes only from the server to the configured provider, is never logged, and is not stored (only the returned entries are). Account export includes entries and goals; restore replaces them; deletion cascades.
- Release checklist gains: pick a provider, set `AI_PROVIDER`, `AI_BASE_URL`, `AI_API_KEY` and `AI_MODEL` in the host `.env` (with a spend limit if it is paid), and name that provider in the privacy notice ("meal text is sent to <provider>").

## Left to the builder

Exact copy and spacing within the design guide; the prompt wording; the progress-bar styling; component names so the add box, log and totals can move to Today later; the order of tasks (suggested: shared schemas and totals, tables and service, parser, routes, repo and hooks, screens, config and docs); whether the usage counter is its own service file.

## Open for the owner

1. **Which provider to start with.** I'd start with Groq's free plan (no card, OpenAI-compatible) or Ollama on the host if you want it fully private. Say which and I will note it in the checklist; nothing in the code depends on the choice.
2. **Accuracy.** Estimates are unmeasured and labelled as such. The earlier plan had a paid accuracy test; this design skips it.
3. **The seven nutrients** (calories, protein, carbs, fat, fiber, sugar, sodium) are a proposal. More can be added later as one more field each.
