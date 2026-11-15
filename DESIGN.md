---
name: Workout Tracker
description: A calm, warm, utilitarian lifting log where the numbers are the interface; clean, simple, clear and thumb-friendly in light and dark.
colors:
  ink: "#090f15"
  paper: "#fdfcfc"
  surface: "#f5f3f1"
  fill: "#ebe8e4"
  border-strong: "#d7d2cc"
  warm-grey: "#6b655d"
  brand-blue: "#1a66e0"
  focus-blue: "#2b7fff"
  success-green: "#1f7a4d"
  destructive-red: "#c2362b"
  night: "#090f15"
  night-surface: "#11181f"
  night-fill: "#1b232c"
  night-text: "#f5f3f1"
  night-grey: "#a59f97"
  night-blue: "#4d93ff"
  night-green: "#4cc38a"
  night-red: "#ff7b6b"
typography:
  title:
    fontFamily: "Inter Variable, system-ui, sans-serif"
    fontSize: "28px"
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: "-0.025em"
  headline:
    fontFamily: "Inter Variable, system-ui, sans-serif"
    fontSize: "20px"
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: "-0.015em"
  numeral:
    fontFamily: "Inter Variable, system-ui, sans-serif"
    fontSize: "26px"
    fontWeight: 600
    lineHeight: 1
    letterSpacing: "-0.02em"
    fontFeature: "tnum"
  body:
    fontFamily: "Inter Variable, system-ui, sans-serif"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "Inter Variable, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 500
    lineHeight: 1.4
rounded:
  field: "14px"
  row: "16px"
  card: "22px"
  sheet: "24px"
  pill: "9999px"
spacing:
  gutter: "16px"
  row-gap: "8px"
  section-gap: "28px"
  tap: "44px"
  set-row: "68px"
components:
  button-primary:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper}"
    rounded: "{rounded.pill}"
    height: "56px"
    padding: "0 24px"
  button-secondary:
    backgroundColor: "{colors.fill}"
    textColor: "{colors.ink}"
    rounded: "{rounded.pill}"
    height: "44px"
    padding: "0 16px"
  set-row:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.row}"
    height: "68px"
    padding: "0 14px"
  set-row-done:
    backgroundColor: "{colors.brand-blue}"
    textColor: "{colors.paper}"
  card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.card}"
    padding: "10px"
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.field}"
    height: "48px"
---

# Design System: Workout Tracker

## Overview

**Creative North Star: "The Training Log"**

A clean, honest logbook that happens to fit in a thumb. The page is warm off-white paper (#fdfcfc) or deep near-black (#090f15) in dark; ink is near-black or warm off-white; one blue says "this is done, this is active". Everything else is soft grey fill. Weights and reps are the largest, most legible thing on every screen, set in tabular numerals, because the number is the product.

The mood is calm, warm and utilitarian. It must stay clean, simple, clear and modern, work one-handed on a phone, and be as good in dark as in light: dark is not an afterthought, and both themes follow the OS with no flash. The interface recedes during a set and speaks only to confirm (a fill, a check, a haptic), to time (rest), or to report (the finish sheet).

**Key Characteristics:**
- Numbers first: 26px tabular numerals carry the app.
- One accent (blue) for done, active, focus and links; nothing else competes.
- Soft filled surfaces and generous radii instead of lines and shadows.
- 44px minimum targets, 68px set rows, a 56px primary pill docked in the thumb zone.
- Meaning is never carried by colour alone: done is a fill plus a check; outcomes are glyphs plus text.

## Colors

Warm neutrals with a single blue accent; plan-day colours appear only as dots beside the day name.

### Primary
- **Ink** (#090f15; #f5f3f1 in dark): text, the primary pill button, the selected segment. In dark the pill flips to warm off-white with near-black text.
- **Brand Blue** (#1a66e0; #4d93ff in dark): the done fill on a set row, check marks, links and active chips. Under white text it is at least 4.72:1.

### Neutral
- **Paper** (#fdfcfc; #090f15 in dark): the page.
- **Soft Surface** (#f5f3f1; #11181f in dark): cards, set rows, list groups. Fields and rows inside a surface swap to the page colour so they still stand out.
- **Fill** (#ebe8e4; #1b232c in dark): secondary buttons, segmented tracks, hairlines. **Strong Border** (#d7d2cc) is for inputs and dividers.
- **Warm Grey** (#6b655d; #a59f97 in dark): secondary text (at least 4.72:1 on Fill).

### Status
- **Success Green** (#1f7a4d; #4cc38a dark) for a progressed lift. **Destructive Red** (#c2362b; #ff7b6b dark) for delete and discard. **Focus Blue** (#2b7fff; #4d93ff dark) is the focus ring only.
- **Day colours** (eight: blue, red, green, amber, violet, teal, pink, slate) are small dots; lighter ramp in dark. They always sit next to the day name.

### Named Rules
**The One Blue Rule.** Blue means done, active or focused. If a screen has blue that is not one of those, remove it.
**The Never-Colour-Alone Rule.** Every state pairs colour with a shape or word: check with fill, arrow with outcome text, dot with day name.
**The Both-Themes Rule.** Every colour pair is AA-checked in light and dark; a new colour ships with both values.

## Typography

**Display, Body and Label Font:** Inter Variable (with system-ui, sans-serif). One family, hierarchy by size, weight and tight tracking.

**Character:** Neutral, modern and highly legible; tabular figures keep columns of weights steady and the numerals read like instrument readouts.

### Hierarchy
- **Title** (600, 28px, 1.25, -0.025em): screen title in the sticky header, "Plan · Day".
- **Headline** (600, 20px, 1.25, -0.015em): exercise names.
- **Numeral** (600, 26px, 1, -0.02em, tabular): set rows "5 × 135 lb" (22px under 375px wide) and the rest timer.
- **Body** (400, 16 to 17px): day names, notes and paragraphs; day names in the picker are 17px/500.
- **Label** (500, 14px): field labels, "Last time", group captions; 15px for header notes; 11px only for nav labels and the AMRAP chip.

### Named Rules
**The Number Is Loud Rule.** The set's reps × weight is always the largest type on its row; labels around it are small and muted.
**The Tabular Rule.** Any figure that changes or aligns uses tabular numerals.

## Layout

A single column with a 16px gutter. Sections are separated by 28px; rows inside a section by 8px. The sticky header holds the title and Settings; a five-item tab bar is docked at the bottom on phones (the ::after fills the gap to the screen edge, the safe area is respected). The primary action is docked above the tab bar, and on md and up sits at the page end. Targets are at least 44px, the set row 68px. Verify at 375px, light and dark.

## Elevation & Depth

Flat by default. Depth is tonal: a soft surface sits on the page, and rows inside a surface take the page colour. One shadow exists, for floating sheets and popovers (`0 10px 30px -8px rgb(9 15 21 / 0.18), 0 2px 6px rgb(9 15 21 / 0.06)`; stronger with a hairline ring in dark). Pressed state is a short 150ms opacity change to 0.8. There is no other motion apart from sheet transitions, and reduced motion is honoured.

### Named Rules
**The Flat-By-Default Rule.** Surfaces are flat at rest; the only shadow is on things that float above the page.

## Shapes

Soft and rounded, with a clear family: buttons, chips and tabs are full pills; fields 14px; list and set rows 16px; cards 22px; sheets 24px. No borders on filled surfaces; hairlines divide list rows only.

## Components

### Buttons
- **Shape:** full pill (9999px).
- **Primary:** solid ink (off-white in dark), 56px high with 24px side padding, 16px/600 text; one per screen, docked low.
- **Secondary / outline:** soft Fill pill, 44px; hover darkens the fill 6%. **Ghost:** transparent with an accent fill on hover. **Destructive:** solid red, kept apart from the primary action.
- **Focus:** 2px blue ring offset 2px, always visible by keyboard.

### Set row (signature)
- A full-width 68px soft block (16px radius): set number in a 36px circle, the numerals, a check. Done inverts to a solid Brand Blue fill with a white check. A separate 44px pencil sits outside the row for editing. Tap toggles; hold opens the editor.
- The editor is a surface with Reps and Weight fields, − / + steppers and a note field.

### Cards / Containers
- 22px radius, Soft Surface fill, no border, no shadow; a list group is one surface with hairline dividers and 16px outer radius clipping.

### Inputs / Fields
- 14px radius, Soft Surface fill (page colour inside a surface), 48px high; focus is the blue ring.

### Navigation
- Bottom tab bar with five items and icon plus 11px label; active uses the primary pill. Settings is a round icon button in the header on every screen.

### Rest timer
- A soft-surface bar with the elapsed rest in 22px tabular numerals and a 44px dismiss, docked above Finish.

## Do's and Don'ts

### Do:
- **Do** make the reps × weight the largest thing on a row, in tabular numerals.
- **Do** keep one primary action per screen, docked in the thumb zone with a 44px minimum for every target.
- **Do** pair every colour state with a shape or word, and check every pair in light and dark.
- **Do** use soft fills and generous radii for depth instead of borders and shadows.

### Don't:
- **Don't** use a second accent colour or put blue on anything that is not done, active or focused.
- **Don't** add swipe-only gestures, or put delete beside the chevron; delete is quiet and icon-only.
- **Don't** add decoration that does not help log a set, plan a day or understand progress.
- **Don't** introduce motion beyond the 150ms colour change and sheet transitions.
