# Progression: reduced sets and a max weight (notes)

Status: notes for the `feat/progression-caps` branch.

**Decided (2026-11-17):**
- Sets edited down: keep today's behaviour (a lighter weight is a miss). No `hold` outcome, no per-set counting (sections 1 and the options below are kept as history only).
- The weight limit lives on the **gear** (optional, in the app unit), not on the exercise; an exercise uses the lowest limit among its required gear.
- At the limit: add 1 rep per success up to the rep ceiling, then hold (fixed step, not a setting).
- Built and recorded in [spec §6](../../spec.md#6-core-logic-packagesshared-pure-functions) (Gear weight limit) and the decisions log.

The rest of this file is the original thinking; sections 2 and 3 describe the exercise-level version that was replaced by the gear-level one above.

Two small features, both inside the pure `progress()` function in `packages/shared/src/progression.ts` (shared by guests and the server, so they cannot drift):

1. A planned set that gets edited down in weight for some of the sets.
2. A max weight per exercise (you have no dumbbells over 45 lb), after which progression adds reps instead.

## 1. Sets edited down: what happens today

`progress()` counts a session as a **success** only if every planned set is `done` with `actual_reps >= targetReps` **and** `weight >= targetWeight`. Anything else is a **miss** (spec §6: "a lighter weight is a miss, not a new baseline").

So if you plan 3 × 8 at 40 lb and lower the weight on set 3 to 35 to finish it:

- the exercise is a **miss**, even though all the reps were done;
- `fail_streak` goes up by one; after `fail_streak_limit` (default 3) in a row it **deloads** by `deload_pct` (10%), even if you were really only a little tired on the last set;
- the target stays at 40, so next time the same thing happens.

That is probably too harsh when the lighter set was deliberate (fatigue, a back-off set, a different dumbbell pair) rather than a failed lift.

### Options

| Option | Behaviour | Cost |
| --- | --- | --- |
| A. `hold` outcome | If every planned set is done, all reps are met, but some weight was below target, the result is neither success nor miss: target unchanged, `fail_streak` unchanged. A set that misses reps is still a miss. | One new `Outcome` value, shown in the finish summary and history ("Held at 40 lb"). No schema change. |
| B. Count the heavy sets | Success if at least N of the planned sets met the target (a rule field, default = all). Progress from the lowest weight among those that did. | New rule field, migration, editor UI. More to explain. |
| C. Ask when editing | When a set's weight is edited down, offer "apply to the remaining sets" (and optionally "this is a back-off set, don't count it"). | UI only, plus a per-set flag if "don't count" is kept. |

Leaning: **A**, with the "apply to remaining sets" prompt from C as a separate small UI change. B only if A turns out too blunt.

Details to settle for A:

- A set `done` with fewer reps than the target is still a miss, whatever its weight.
- If only one set was lighter and you then hold three times, is that still a deload risk? Proposed: `hold` never counts towards `fail_streak`, so no.
- What "lifted weight" means when held: unchanged, because nothing progresses.
- History and the finish summary need a wording for `hold`.

## 2. A max weight

### Where it lives

A cap describes equipment, not a rule, so it should not go through rule layering (item, exercise, profile, built-in).

- Proposed: `exercise.max_weight` (nullable, in the exercise's own unit, like `exercise.unit`).
- Possible later extension: `gear.max_weight` (Dumbbells: 45), inherited by every exercise that requires that gear, with a per-exercise override. Needs a decision on which gear wins when an exercise requires two pieces.

### What progression does at the cap

For `add_weight`, when the next weight would exceed the cap:

- clamp the weight to the cap and switch that step to **add reps** instead, by `cap_rep_step` (default 1 rep; the rule's `success_amount` is a weight amount, so it cannot be reused as reps);
- keep adding reps each success until `rep_ceiling` (if the rule has one);
- at the ceiling: hold (nothing changes), and say so in the summary. Adding a set is a possible later option, not part of this.

For `add_reps` with a `rep_ceiling` (double progression): when reps pass the ceiling the rule resets reps and adds one increment of weight. If that weight would exceed the cap, **don't reset**: stay at the cap and the ceiling and hold.

A deload from the cap works as today (weight drops by `deload_pct`, reps reset to `baseReps`) and the climb back is normal until it reaches the cap again.

### Interactions to check

- **Unit flips** (the work merged as PR #48): `max_weight` converts with the exercise's other weights when its unit flips, and the app-wide unit switch skips exercises that keep their own unit. Snap to 0.5 kg / 1 lb like the others.
- **Manual weight above the cap**: allowed (you may have a heavier pair after all); progression just stops adding weight and a warning could suggest raising the cap. It must not silently clamp what was logged.
- **A target already above the cap** when the cap is set: leave it, warn, and clamp only on the next progression.
- **Community plans**: a cap is personal equipment, so it is not part of a published snapshot and adopting a plan never sets one.
- **Export and import**: `max_weight` goes in the export schema (additive, optional, so older files still import).
- **Server and device**: both implementations of the Repo interface, the Dexie version bump, and the contract tests that run against `LocalRepo`, the service layer and `ApiRepo`.

### Where it shows

- Exercise sheet, under Optional details next to the Unit override: "Max weight (heaviest you can load)". Empty means no cap.
- Today: when a set is at the cap, a small note like "At your max: reps go up next time" (not colour alone).
- Finish summary and history: "Maxed at 45 lb: 9 reps next".
- Progress tab: show the cap in the exercise's rule row.

## 3. Tests to write first

Pure `progress()` cases, in `packages/shared/test`:

- all sets heavy enough: unchanged behaviour (regression);
- one set lighter, reps met: `hold`, target and streak unchanged;
- one set lighter and reps short: `miss`;
- `add_weight` that lands exactly on the cap, one step below it, and past it;
- cap reached then reps added up to the ceiling, then hold;
- double progression at the ceiling with and without room under the cap;
- deload from the cap, then climbing back;
- unit flip converts the cap; no cap behaves exactly as today.

Then the contract suite for the schema and repo changes, and a web test for the exercise sheet field.

## 4. Open questions

1. Is option A (a `hold` outcome) the right answer for a deliberately lighter set, or do you want B (count N of the sets)?
2. Should the cap be per exercise only, or also on gear?
3. At the cap and the rep ceiling, hold forever, or add a set?
4. When you edit one set's weight on Today, should it offer to apply the new weight to the remaining sets?
5. What is the rep step at the cap: always 1, or a setting?
