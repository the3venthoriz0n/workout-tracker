# Nutrition tracker (N1): design

> **Status: draft for the owner's approval (2026-11-16). Nothing is built.** It replaces the earlier draft plan in PR #37 and keeps only that plan's cost and privacy guardrails. The owner's words below are marked as decided; everything else is a proposed call, listed so it can be changed.

## Intent

Log food by typing it the way you would say it ("1 chicken burrito, 1 yogurt") and let an AI work out the estimated nutrition and add it to the day's log. Set daily targets for calories and other nutrients, and see the day against them. It should feel as light as logging a set: one box, one button, edit only when the estimate is off.

For now it lives in the **Nutrition** tab. It may later move into **Today**, so the pieces (the add box, the day log, the totals) are built as components that do not depend on the tab.

## Decided by the owner

- The Nutrition tab has two sub-tabs, **Track** and **Goals**.
- **Goals:** per-day targets for calories, protein, fat and more, all configurable.
- **Track:** type what you ate; the AI estimates calories and other nutrients and adds them to the log.
- **Sign-in only.** Guests see a prompt to create an account.
- Tracked inside the Nutrition tab for now, possibly Today later.

## Goals

- Typing a meal and tapping Add puts estimated entries in today's log in one step.
- Every entry is editable and deletable afterwards; estimates are always labelled as estimates.
- Goals are optional per nutrient; progress shows for the nutrients that have one.
- A day can be opened by date (yesterday's catch-up works).
- Cost is bounded per user per day. Meal text is private.

## Non-goals (for N1)

Guests or offline logging; photos, barcodes or a food database lookup; meal templates, favourites or recent foods; charts or weekly views; showing food in the History tab; sharing; micronutrients beyond the seven below; manual "add by hand" entry (editing an AI entry covers corrections; manual add can follow).

## Anti-goals

A number that looks exact when it is a guess. An AI bill nobody bounded. Meal text in a log, an error message or a backup that outlives the account.

## Constraints

- Public repo: the Anthropic key is `ANTHROPIC_API_KEY` in the host's gitignored `.env` only; `just public-check` must pass.
- Same ownership rules as the rest of the app: every table has `user_id`, `created_at`, `updated_at`, `deleted_at`; primary key `(user_id, id)`; ids from `newId()`; creates are idempotent `PUT /resource/:id`; every `/api/v1` route needs a session and scopes by it; a foreign or missing id is `404 {"error":"not_found"}`.
- API changes are additive; the migration is backward compatible with the previous release.
- The UI talks only to the `Repo` interface. 44 px targets, quiet icon-only delete, no swipe-only gestures, 375 px light and dark.
- A new dependency, `@anthropic-ai/sdk`, is needed and is recorded in CLAUDE.md. Model calls follow the `claude-api` skill (structured outputs, typed errors, a handled refusal, no forced `tool_choice`).
- Account deletion leaves no nutrition data; the account export includes it and restore replaces it.

## Approaches considered

1. **Server-side AI (chosen).** The app posts the text to our server; the server asks Claude for a structured result, validates it and returns drafts; the app saves entries with idempotent `PUT`s. The key never reaches the phone, the pattern matches the rest of the API, and validation lives in one place. Cost: sign-in only and online only, which the owner already wants.
2. **AI called from the phone.** Puts a paid key in a public app. Rejected.
3. **A nutrition database lookup instead of (or before) the AI.** More accurate for plain foods, but it adds a service and a key and handles "1 chicken burrito" worse. A reasonable later addition if estimates prove too loose; not N1.

## Design

### Data

- `nutrition_entry(id, user_id, date, name, quantity, calories, protein_g, carbs_g, fat_g, fiber_g, sugar_g, sodium_mg, source 'ai'|'manual', created_at, updated_at, deleted_at)`. `date` is a `YYYY-MM-DD` calendar date chosen by the client (its local day). There is no separate "day" row: a day is the entries sharing a date, and totals are computed.
- `profile.nutrition_goals` (jsonb, nullable): `{ calories?, protein_g?, carbs_g?, fat_g?, fiber_g?, sugar_g?, sodium_mg? }`, each optional, validated by one zod schema. Goals live on the profile; changing a goal changes how every day is measured against it (no per-day snapshot in N1).
- `ai_usage(user_id, usage_date, count)`, primary key `(user_id, usage_date)`: the per-user daily counter for parses.
- Limits (one `NUTRITION_LIMITS` table in `packages/shared`): calories 0 to 10000, protein/carbs/fat/fiber/sugar 0 to 1000 g, sodium 0 to 20000 mg per entry; name 1 to 120 characters, quantity at most 60, meal text at most 500, 300 entries per day. Names pass the existing public-text cleaning (controls and bidi stripped).
- Date window: any real date from one year back to two days ahead.
- Totals are a pure function in `packages/shared` (`dayTotals(entries, goals)`: each nutrient's sum, its goal, and what is left or over), used by the app so it works the same for any screen; the server stores entries and never needs totals.

### API (all under `/api/v1`, session required)

| Method | Path | Notes |
|---|---|---|
| GET | `/nutrition/entries?from&to` | Entries in a date range, at most 366 days; sorted by date then created time |
| PUT / PATCH / DELETE | `/nutrition/entries/:id` | Idempotent create or replace, partial update, soft delete |
| POST | `/nutrition/parse` `{ text }` | Returns `{ items: MealDraft[], remaining_today }`. Writes nothing. Order of checks: session, entitlement, body, daily cap, parser available, parse |
| PATCH | `/me` | Gains `nutrition_goals` |

Errors added: `429 {"error":"ai_limit"}`, `503 {"error":"ai_unavailable"}` (no key configured), `502 {"error":"ai_failed"}`. Errors never include model output or the meal text.

### The AI step

- `MealParser` interface with a Claude implementation; the factory returns null when `ANTHROPIC_API_KEY` is unset (the feature reports unavailable; nothing else breaks).
- Model from env `NUTRITION_MODEL`, default `claude-haiku-5-5` (cheapest; a parse is small). Not hard-coded in logic.
- Structured output equal to `mealDraftSchema` (name, quantity, and the seven nutrients, all numbers). The system prompt states the task, the units, and "estimate when unsure"; the meal text appears only in the user turn. No tools.
- Output is validated against the limits; one retry on invalid output, then `502 ai_failed` and nothing saved. A refusal is handled as a failure, not a crash. Unrecognised input ("asdf", "skipped lunch") returns an empty list and the app says nothing was found; it still counts against the cap.
- Prompt injection: no tools, schema-validated output, extra keys stripped, nothing the model wrote reaches the client except validated fields.
- Cap: `aiMealsPerDay` entitlement (default 30 on free, 100 on pro), counted atomically before the model call and not refunded on failure. `can(profile, 'ai_nutrition')` gates the route.

### Screens

```
Nutrition                         [ Track | Goals ]

Track
  < Sun 15 Nov >                        (arrows; today by default)
  830 / 2400 kcal   44 / 160 g protein  (nutrients with a goal; calories always)
  [ 1 chicken burrito, 1 yogurt      ] [Add]
  Chicken burrito   1 burrito   ~680 kcal · 32 g P     [edit] [delete]
  Yogurt            1 cup       ~150 kcal · 12 g P     [edit] [delete]

Goals
  Calories [2400]  Protein [160 g]  Carbs [   ]  Fat [   ]
  Fiber [   ]  Sugar [   ]  Sodium [   ]    (blank = no goal; saves as you leave a field)
```

- Guests see "Create an account to track nutrition" with a link to Settings, in both sub-tabs.
- Add disables while a parse runs (a double tap costs one parse). Entries from the AI are saved with idempotent `PUT`s using client ids. Empty result: "Nothing found. Try describing the food." `ai_limit` and `ai_unavailable` show their own messages. Offline: "Needs a connection."
- An entry opens in a sheet to edit its name, quantity and every nutrient; delete asks first. Entries from the AI have `source: 'ai'` and show a small "estimate" mark; saving an edit sets `source: 'manual'`, which removes the mark.
- Progress is numbers first ("830 / 2400"), with a bar as a second cue; over a goal is shown by wording as well as colour.
- Sub-tab state is in the URL (`?section=goals`), like Library.

### Repo, sync and privacy

- `Repo` gains `listNutrition(from, to)`, `parseMeal(text)`, `saveNutritionEntry`, `deleteNutritionEntry`; goals go through the existing profile update. `LocalRepo` throws `UnauthenticatedError` for all of them (as community publishing does); `ApiRepo` calls the routes. Nothing is queued in the offline outbox.
- Meal text goes only from the server to Anthropic, is never logged, and is not stored (only the returned entries are). Account export includes entries and goals; restore replaces them; deletion cascades.
- Release checklist gains: create an Anthropic key with a spend limit, set it in the host `.env`, and add "meal text is sent to Anthropic" to the privacy notice.

## Left to the builder

Exact copy and spacing within the design guide; the prompt wording; the progress-bar styling; component names so the add box, log and totals can move to Today later; the order of tasks (suggested: shared schemas and totals, tables and service, parser, routes, repo and hooks, screens, config and docs); whether the usage counter is its own service file.

## Open for the owner

1. **Model and cost.** Default is Haiku 5.5 with a 30-a-day cap. Accuracy is unmeasured; every number is labelled an estimate. The earlier plan had a paid accuracy test before building; this design skips it. Say if you want it.
2. **The seven nutrients** (calories, protein, carbs, fat, fiber, sugar, sodium) and the units are a proposal. More can be added later as one more field each.
