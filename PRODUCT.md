# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Self-directed lifters who follow a plan and log sets on their own phone, one-handed, between sets in the gym. Most start in guest mode with no account. Signed-in users additionally sync across devices and can share or adopt community plans, which is secondary to logging.

## Product Purpose

A free, very simple lifting tracker: exercise library, gear, plans with per-plan overrides, set logging, and automatic progression. Success is a lifter who logs a whole workout with a few taps, sees the next session's targets without doing the maths, and never has to think about the app.

## Positioning

Free, very simple, and progression runs automatically from what the lifter actually lifted. Guest mode and offline logging work without an account.

## Operating Context

Used mid-workout: one thumb, a sweaty hand, a bright or dim gym, interrupted by rest between sets, sometimes with a poor connection. Sets are logged offline and synced later. The screen stays awake during a session.

## Capabilities and Constraints

- Guest mode (local, Dexie) and accounts (email set-up link, API, Postgres) behind one `repo` interface; offline set edits are queued and replayed.
- Progression is a pure function shared by guests and the server, so both compute identical results; history never changes when a plan does.
- Web now; iOS and Android via Capacitor are planned (M4) and not started.
- The product stays "very very simple": no new dependency, layer or service unless the spec calls for it.
- Terminology: the smallest weight jump is the "progression step", never "weight increment", in the UI.
- Staging is self-hosted; production on DigitalOcean is on hold.

## Brand Commitments

None beyond the name "Workout Tracker" and the rules already written in docs/design-guide.md (one primary action, 44 px targets, no swipe-only gestures, quiet icon-only delete, day colour always next to the day name).

## Evidence on Hand

docs/spec.md (data model, screens, decisions log), docs/design-guide.md, docs/architecture.md. No user research, analytics, testimonials or screenshots exist; do not invent any.

## Product Principles

1. Logging a set must take one tap; everything else gets out of the way.
2. The number is the product: weights and reps are the largest, clearest thing on the screen.
3. Progression is automatic and explained once, at the moment it happens.
4. Never lose a set: works offline, never blocks the toggle on the network.
5. Simple over clever: add a feature only when it helps log a set, plan a day or understand progress.

## Accessibility & Inclusion

WCAG AA contrast, checked per colour pair in the tokens; targets of at least 44 px; visible focus; reduced motion honoured; meaning is never carried by colour alone.
