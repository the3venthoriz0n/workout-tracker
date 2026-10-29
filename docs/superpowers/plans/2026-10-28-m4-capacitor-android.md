# Mobile (M4) Plan: Capacitor Android, tested in an emulator

> **Status: Planned (2026-10-28). Nothing built yet. Android first; iOS waits for a Mac and an Apple Developer account.**

**Goal:** The same web app runs as an Android app (bundled `dist/`, offline-first like the web version), signs in against the self-hosted API, and can be run and screenshotted in an emulator on the dev machine.

**Not in scope:** iOS, Play Store listing, push notifications, Google sign-in, any change to what the web app looks like (apart from safe areas).

## What the code looks like today (checked, not assumed)

- The bearer plugin is **not installed**. Only the spec mentions it. Auth is cookie-only (`SameSite=Lax`, `httpOnly`).
- The API has **no CORS** (the web app is same-origin). `isTrustedOrigin` and `TRUSTED_ORIGINS` already decide which `Origin` may make state-changing requests; they do not send CORS headers.
- Every request in `auth/client.ts` and `packages/shared/src/api-repo.ts` uses `credentials: 'include'`, and the public fetch uses `same-origin`. The base URL comes from `API_BASE_URL` (`VITE_API_BASE_URL`), which is empty on the web.
- The router is `createBrowserRouter`, which works under Capacitor's `https://localhost`.
- Mailed links are built from `BETTER_AUTH_URL` only (a security invariant) and open the **website**, not the app.

So a bundled app at `https://localhost` calling the API on another domain is cross-site: Lax cookies are not sent, and the browser needs CORS. Bearer tokens plus a narrow CORS rule are required, not optional.

## Decisions (defaults; change any before we start)

| Decision | Choice | Why |
|---|---|---|
| App id | `app.workouttracker` (permanent once published) | Short, no personal info. |
| Bundled app vs. loading the live site in the WebView | **Bundled** | Keeps guest mode and offline use; the live-site approach is same-origin and needs no bearer work but is dead without network and risks store rejection as "just a website". |
| Android WebView origin | `https://localhost` (`androidScheme: 'https'`) | Secure context, so Web Crypto, wake lock and Dexie behave like the web. To be verified on the emulator, then pinned in `TRUSTED_ORIGINS` as an exact string. |
| Auth transport on native | Bearer token in `Authorization`, stored in Capacitor Secure storage (Keystore-backed), **no cookies** | Cookies would be third-party in the WebView. |
| API base URL | `VITE_API_BASE_URL` at build time; staging build points at the staging domain, taken from the private env file, never committed | Public repo rule. |

## Global constraints

- Public repo: no domain, IP, key or local path in committed files; the staging URL is a build-time variable.
- API changes are additive only (old builds keep working). Web behaviour must not change: cookie auth stays the default when not native.
- The CSRF/origin guard stays strict: `https://localhost` is added through `TRUSTED_ORIGINS` (env), never hard-coded, never a wildcard.
- CORS answers only origins `isTrustedOrigin` accepts, allows only the headers and methods the app uses, never `*`, and never sends `Access-Control-Allow-Credentials` (bearer needs none).
- Android release signing keys never enter the repo. Debug builds only in this milestone.
- Tests first with fail-before evidence for API and shared-code changes; `just check` and `just public-check` stay green.

## Review focus (independent reviewer, security-critical)

- Bearer plugin: tokens are the existing session tokens (same expiry, revocation on password reset and on account deletion); a bearer request is still subject to the origin guard.
- CORS rules cannot be made to reflect an untrusted origin; preflight handled for `/api/auth/*`, `/api/v1/*`, `/api/public/*` only.
- Where the token lives on the device and that it is cleared on sign-out, expiry, and account deletion.
- Password-reset and set-up links: nothing new trusts a client-supplied URL.

## Tasks

### Task 0: Emulator spike (no repo changes)

Prove the toolchain before writing code. In `~/android` (outside the repo): JDK 21, Android command-line tools, `platform-tools`, one platform and build-tools, an x86_64 Google APIs system image, an AVD (Pixel-class, 1080x2400). Start it with KVM (the host has `/dev/kvm`; AMD, so `svm`), first with the window on WSLg, falling back to `-no-window` with `adb exec-out screencap` for screenshots.
Done when: `adb devices` shows the emulator, Chrome loads a page from the dev server through the emulator's built-in host alias (the Android emulator documents one for reaching the host machine), and I can take a screenshot from the terminal. Report boot time and whether it is usable. If WSL cannot run it acceptably, stop and switch to Android Studio on Windows (needs the owner's go-ahead).
Also: pin the SDK/JDK versions in a short `docs/mobile.md` and a `just android-*` recipe set only after this works.

### Task 1: API: bearer plugin and CORS (tests first)

- Add Better Auth's `bearer` plugin. Sign-in/up responses already return the token in the `set-auth-token` header; expose it.
- CORS middleware on the three route groups above, driven by `isTrustedOrigin`. Preflight returns 204 with `Access-Control-Allow-Origin` echoing the one trusted origin, `Allow-Headers: Content-Type, Authorization`, `Expose-Headers: set-auth-token`, `Vary: Origin`. Untrusted origin: no CORS headers.
- Tests: trusted origin gets headers, untrusted/`null`/lookalike gets none; bearer request authenticates; revoked session (password reset, sign-out, account deletion) stops working; the existing cookie flows and the isolation matrix are unchanged; a cross-origin POST from an untrusted origin is still refused.

### Task 2: Shared and web: native-aware transport (tests first)

- `isNative()` (Capacitor platform check) in one place. A small token store (`getToken/setToken/clear`) backed by Capacitor Preferences-with-encryption or a Keystore plugin (pick in this task, verify it is not plain `SharedPreferences`), with an in-memory fallback on the web that is never used.
- Auth client and `api-repo`: when native, send `Authorization: Bearer <token>` and `credentials: 'omit'`; read `set-auth-token` after sign-in and reset; clear the token on sign-out, on 401 and after account deletion/restore flows that end the session. Web path untouched.
- Offline outbox and the "session ended" handling keep working (same 401 path).
- Tests: web requests are byte-identical to today; native requests carry the header and no cookie; token cleared on each ending path.

### Task 3: Capacitor project

- Add `@capacitor/core`, `@capacitor/cli`, `@capacitor/android`, `@capacitor/status-bar`, `@capacitor/app` (and the chosen secure-storage plugin) to `apps/web`; `capacitor.config.ts` (appId, appName, `webDir: 'dist'`, `androidScheme: 'https'`).
- `just android-sync` builds the web with `VITE_API_BASE_URL` from the environment and runs `cap sync`; `android/` is committed except build outputs and local config (`.gitignore` reviewed), `local.properties` and keystores never.
- Safe areas and status bar: transparent status bar with the app's background, bottom tab bar already pads for `env(safe-area-inset-bottom)`; verify the viewport meta and the Android back button (`App` plugin: back navigates, exits only from Today).
- The PWA manifest and the Capacitor app icons/splash share the existing icon.

### Task 4: Run it in the emulator against staging

- Install the debug APK, then walk the release checklist for mobile: guest use offline, sign-up (email only) and the set-up link, sign-in, sync across web and app, community plans, export/restore (file picker on Android), delete account, sign-out clears the token. Screenshots light and dark. Record anything that differs from the browser.
- Verify the exact WebView origin string in the emulator, then set it in `TRUSTED_ORIGINS` on the staging server (owner action, written into the staging instructions file, not the repo).

### Task 5: Links from email into the app (separate, after Task 4 works)

The set-up/reset mail opens the website. Options: leave it (works, costs one tap in the browser), or Android App Links (serve `/.well-known/assetlinks.json` from the app with the signing-cert fingerprint, handle the `appUrlOpen` event and route `/reset-password?token=...`). Decide after seeing the experience; App Links need a stable signing key, so they pair with the first real release build.

### Task 6: Docs

Spec §3/§5/§9/§13/§14 (mobile status, bearer, CORS, origins now verified), CLAUDE.md (new invariants: native uses bearer, CORS only for trusted origins), README, `docs/mobile.md` (toolchain, recipes, emulator tips), release checklist (`TRUSTED_ORIGINS`, signing key backup, Play account), roadmap.

## Order and checkpoints

0 (owner approval on SDK install) -> 1 -> 2 -> 3 -> 4 (owner tries it on the emulator; staging config) -> 6; 5 is optional. One implementer per task, independent review for tasks 1 and 2.

## Open questions for the owner

1. App id `app.workouttracker`, or something else?
2. OK to install about 5-8 GB of Android tooling into `~/android` in WSL (nothing on Windows)?
3. Is Task 5 (email links open the app) wanted for the first version, or is "opens in the browser" fine to start?
4. Real device later: a USB cable or Wi-Fi debugging from the phone, or emulator only for now?
