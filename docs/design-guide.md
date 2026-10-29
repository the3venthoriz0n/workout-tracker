# Frontend design guide

Simple rules for every screen in `apps/web`. They come from the owner's feedback on the real app and from [spec §8](spec.md#8-screens) (tokens, contrast, UX rules). When a rule and a new idea disagree, ask before breaking the rule.

## 1. The feel

Warm, minimal and quick to use in a gym with one thumb. Soft surfaces instead of outlined boxes, pills for controls, one accent colour, generous space, no decoration. If something does not help the person log a set, plan a day or understand their progress, leave it out.

## 2. One thing per row, one place per thing

- **Far right means "go".** A row that opens something ends in a chevron. Nothing else sits next to it, and never a destructive action.
- **Show a thing once.** A colour dot, a label or a count appears one time per row. If a dot is also the control (the day colour dot opens the colour picker), it is not repeated elsewhere.
- **Controls that need a lot of room stay hidden until asked for** (a palette, extra options). Collapse them again after use.
- **Name what a control does.** A field and its button read as a pair: placeholder "New plan name", button "Add plan". Avoid labels a person could mistake for something else (for example a button that looks like it opens premade plans).

## 3. Buttons

- **One primary action per screen or card.** It is the filled near-black pill. Everything else is quiet (soft fill or outline).
- **A primary button that cannot work yet looks disabled**: muted, no hover, `aria-disabled`, and it becomes primary only when its input is valid (for example an empty name). Do not make people tap to find out.
- **Text or icon, not both, unless the icon adds meaning.** "Add plan" is text only. "+ Add exercise" keeps its plus because it adds something to a list. Icon-only buttons always have an `aria-label` and a 44 px hit area.
- **Enter submits** a single-field form.
- Labels are verbs or short noun phrases in sentence case. No all-caps.

## 4. Destructive actions

- **Delete is quiet.** An icon-only trash button (`Trash2`), muted by default and red only on hover, focus or in the confirm step. It never looks like the call to action.
- **Same icon everywhere**: every row-level delete (exercise, day, library item) uses the same trash icon. Mixed text "Delete" and icon "Delete" in one place is a bug.
- **Where it lives**: row actions go at the end of the row's own header, away from the chevron. Deleting a whole thing (a plan) lives inside that thing's own page, at the bottom, not on the list row.
- **Always confirm, and say what will happen** ("Removes it from 2 plans. Past workouts keep their records"). Where it makes sense, offer undo instead of a second prompt.
- **No swipe-only gestures.** Anything a swipe can do must also be reachable by a visible control. Do not add swipe-to-delete.
- The most destructive things (delete account, restore from a file) need typed confirmation, and the password when signed in. Offer "Export first" before them.

## 5. Layout and touch

- Mobile first, one column, 375 px wide is the design target. The tab bar is docked to the bottom edge; content stays clear of content (`--nav-space`).
- Tap targets at least **44 px** (the drawn shape may be smaller than its hit area).
- Inputs at least 16 px text (no iOS zoom). `inputmode="decimal"` for weight, `numeric` for reps.
- Never more than one sheet or modal open. Edit in place when a sheet is not needed.
- The primary action while working out (Start, Finish) is docked above the tab bar.

## 6. Colour, type and shape

- Use the tokens in `apps/web/src` (page `#FDFCFC` / dark `#090F15`, soft surface, hairline, text, muted, brand blue). Never hard-code a hex in a component.
- The blue accent is only for focus, the active tab and done states, and links.
- Inter variable. Titles 28 px semibold, body 16 px, tabular numerals, no all-caps.
- Radii: pills for buttons, chips, tabs and segmented controls; inputs 14; list and set rows 16; cards 22; sheets 24 with a grabber.
- Follow the system light and dark mode. Check both for every change.
- Colour is never the only signal: the day name is always shown, and done sets show a check.

## 7. States and feedback

- Every list has a loading skeleton, an empty state with the next action, and an error state with "Try again".
- Say what happened in plain words. Errors end with whether anything changed ("Nothing was changed."). Never show a raw server message.
- Offline is a normal state in guest mode; only say "You're offline" when a network request actually failed.
- Toasts are short dark pills. Motion is limited to sheet transitions and a 150 ms colour change, and is off under reduced motion.

## 8. Text and data from other people

Community titles, descriptions and names are untrusted: render them as plain text only, never as links or HTML, and never put them into URLs without validating them.

## 9. Checklist before a UI change is done

1. Looks right at 375 px in light and dark (take a screenshot).
2. One primary action; disabled states look disabled.
3. Delete follows section 4; the far right of a row is only a chevron or the main action.
4. Targets 44 px, labels on icon-only buttons, keyboard and Enter work.
5. Loading, empty and error states exist.
6. Nothing is shown twice on the same row.
7. Tests cover the behaviour (disabled until valid, confirm before delete).
