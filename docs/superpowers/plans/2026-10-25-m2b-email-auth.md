# M2b Email Verification and Password Reset Implementation Plan

> **Status: Done (2026-10-26). Verification, reset, set-up links, Resend and the console mailer are built and documented. Where the code differs from this plan (single set-up link for unverified resend, all mailed links valid until one is used), the spec and CLAUDE.md describe the real behaviour.**

> **For agentic workers:** Use superpowers:subagent-driven-development (lean variant: one implementer per task, fail-before/pass-after tests, controller reads the diff; independent review only for Tasks 1 and 3) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sign-up requires a verified email, and a user who forgot their password can reset it by email, using Resend in production and a console mailer in development.

**Architecture:** A small `Mailer` interface in the API (`send({to, subject, text, html})`) with three implementations: Resend (production, plain `fetch`, no SDK), console (development: prints the link to the API log, so no account or domain is needed), and an in-memory capture (tests). Better Auth's `emailVerification` and `sendResetPassword` hooks call the mailer. The web app gains a "check your email" state, a resend action, a "Forgot password?" flow and two landing routes. Guest data upload moves to the first successful sign-in of a new account, which M2 already handles (`ProfileNotFoundError` leads to upload).

**Tech Stack:** Better Auth 1.7.12 (installed), Hono, zod, Vitest, React. No new runtime dependency.

**Spec:** `docs/spec.md` §7 (sign-up and sign-in rules), §13 (decisions: verify before first sign-in, Resend), §15 (email).

## Global Constraints

- Everything runs through `just`; exact dependency pins; no secrets, domains, mailbox names or local paths in the repo or commits.
- `RESEND_API_KEY` and `MAIL_FROM` are required when `NODE_ENV=production` (the process refuses to start without them); in development and test they are optional and the console or capture mailer is used. Never log the API key, a token, or a full link outside the development console mailer.
- Sign-in requires a verified email (`requireEmailVerification: true`). Verification links expire after 24 hours, reset links after 1 hour; both are single use. A password reset revokes every session of that user.
- Responses must not reveal whether an email has an account: sign-up with an existing email, "resend verification" and "forgot password" all return the same success shape and wording for known and unknown addresses.
- Email sending never blocks or changes the HTTP response (do not await the send inside the request path; failures are logged sanitized).
- Throttle per recipient: at most 3 emails per hour per (recipient, kind), in addition to the per-IP rate limits. Per-IP rules for `/request-password-reset` and `/send-verification-email`: 5 per hour.
- The token is read from the URL once and removed from the address bar (`history.replaceState`); the API already sends `Referrer-Policy: no-referrer` (verify in a test).
- Plain-language copy, sentence case, no tracking pixels, no remote images; text and minimal HTML versions of every email.

## Review Focus

- Sign-up twice with the same email (or with different letter case): same response as a new email, no second account, no error that says "taken".
- Reset link used twice, used after expiry, or used after a newer reset was requested: rejected with a generic message; the old password stops working only after a successful reset.
- Verification link opened on a different device or browser than the one that signed up: the account becomes verified, no session is created there, the original device can then sign in.
- A user who signed up as a guest with data, never verifies, and signs up again later: guest data is still on the device and uploads on the first successful sign-in.
- Someone submits another person's email to "forgot password" 50 times: at most 3 emails go out per hour and the page still answers the same way.
- Resend is down or returns 4xx/5xx: sign-up and reset still answer normally, an error is logged without the key or the link.

---

## File Structure

- `apps/api/src/mail.ts`: `Mailer` type, `createResendMailer`, `createConsoleMailer`, `createCaptureMailer`, `throttled(mailer)` wrapper, message builders (`verificationEmail`, `resetEmail`).
- `apps/api/src/env.ts`: `RESEND_API_KEY`, `MAIL_FROM` (required in production).
- `apps/api/src/auth.ts`: `createAuth(db, env, { mailer })` wires the hooks and rate-limit rules.
- `apps/api/src/index.ts`: picks the mailer from env.
- `apps/web/src/auth/client.ts`, `import-flow.ts`, `auth-provider.tsx`: new error kinds and the verify-pending outcome.
- `apps/web/src/components/{account-card,credentials-form,forgot-password-form}.tsx`, `apps/web/src/screens/{verified,reset-password}.tsx`, router entries.
- Tests mirror these under `apps/api/test` and `apps/web/test`.

---

### Task 1: Mailer and Better Auth wiring (server)

**Files:**
- Create: `apps/api/src/mail.ts`, `apps/api/test/mail.test.ts`, `apps/api/test/email-auth.test.ts`
- Modify: `apps/api/src/env.ts`, `apps/api/src/auth.ts`, `apps/api/src/index.ts`, `apps/api/test/auth.test.ts` and the shared test fixture (sign-up helpers must now verify the user)

**Interfaces:**
- Produces: `type Mail = { to: string; subject: string; text: string; html: string }`; `interface Mailer { send(mail: Mail): Promise<void> }`; `createResendMailer(opts: { apiKey: string; from: string; fetch?: typeof fetch }): Mailer`; `createConsoleMailer(log?: (line: string) => void): Mailer`; `createCaptureMailer(): Mailer & { sent: Mail[] }`; `throttled(inner: Mailer, opts?: { max?: number; windowMs?: number; now?: () => number }): Mailer`; `createAuth(db, env, opts: { mailer: Mailer; clientIpHeader?: string })`.
- Consumes: existing `createAuth`, `sanitizedLog`, `AuthEnv`.

- [ ] **Step 1: Write failing tests.** `mail.test.ts`: Resend mailer posts to `https://api.resend.com/emails` with `Authorization: Bearer <key>`, JSON `{from,to,subject,text,html}`, never includes the key in a thrown error message; non-2xx rejects with a message that has the status only; `throttled` allows 3 sends per (recipient, subject kind) per hour and silently drops the 4th (returns resolved, does not call inner), resets after the window (injected `now`); env test: production without `RESEND_API_KEY` or `MAIL_FROM` exits, development without them uses the console mailer. `email-auth.test.ts` (real Postgres harness + capture mailer): sign-up sends exactly one verification mail and returns no session cookie; sign-in before verifying is rejected with 403 `EMAIL_NOT_VERIFIED`; following the emailed link verifies and sign-in then works; sign-up for an existing email (any letter case) returns the same status and body shape as a new one, creates no second user and sends no second mail to a stranger's address beyond the throttle; `send-verification-email` for unknown and known addresses answers identically; reset: request for unknown and known emails answer identically, the emailed token resets the password once, the old password fails, the new one works, a second use fails, an expired token (advance time) fails, and existing sessions are revoked; the per-IP 5/hour rules return 429 on the 6th call; a mailer that throws does not change any response and logs nothing containing the link.
- [ ] **Step 2: Run them; expected FAIL** (`mail.ts` missing, behaviours absent).
- [ ] **Step 3: Implement.** Better Auth options: `emailAndPassword.requireEmailVerification: true`, `autoSignIn: false`, `sendResetPassword`, `resetPasswordTokenExpiresIn: 3600`, `revokeSessionsOnPasswordReset: true`; `emailVerification: { sendOnSignUp: true, autoSignInAfterVerification: false, expiresIn: 86400, sendVerificationEmail }`. Hooks call `void mailer.send(...).catch(sanitizedLog)` (never awaited). Confirm the exact endpoint and option names against the installed 1.7.12 types and pin any difference in the tests. Enumeration safety: if 1.7.12 does not already return a uniform response for an existing email on sign-up, add a `hooks.before` that does. `rateLimit.customRules` for the two endpoints. Messages built in `mail.ts` with the link only in the body. `index.ts`: Resend mailer wrapped in `throttled` when the key exists, else console mailer.
- [ ] **Step 4: Run tests; expected PASS.** Then `just check`.
- [ ] **Step 5: Commit** `feat(api): email verification and password reset via Resend`.
- [ ] **Step 6: Independent opus security review** of this task: token handling, enumeration, throttle bypass (letter case, plus-addressing is allowed), link/host construction (links must be built from `BETTER_AUTH_URL`, never from the request `Host`), log leakage, session revocation.

### Task 2: Web flows and screens

**Files:**
- Create: `apps/web/src/components/forgot-password-form.tsx`, `apps/web/src/screens/verified.tsx`, `apps/web/src/screens/reset-password.tsx`, tests under `apps/web/test`
- Modify: `apps/web/src/auth/client.ts`, `import-flow.ts`, `auth-provider.tsx`, `apps/web/src/lib/auth-messages.ts`, `components/account-card.tsx`, router

**Interfaces:**
- Produces: `AuthErrorKind` adds `'email_not_verified'`; `AuthClient` adds `requestPasswordReset(email): Promise<void>`, `resetPassword(token, newPassword): Promise<void>`, `resendVerification(email): Promise<void>`; `FlowOutcome` adds `'verify-email'`; `signUpFlow` returns `'verify-email'` after a successful sign-up without uploading anything.
- Consumes: Task 1 endpoints.

- [ ] **Step 1: Write failing tests.** Client: new calls send JSON bodies with `Content-Type` and map statuses (`403` on sign-in becomes `email_not_verified`, 429 `rate_limited`, network `offline`); never echo response bodies. Flow: sign-up ends in `verify-email` with local data untouched and `importAll` not called; sign-in of a freshly verified new account hits `ProfileNotFoundError` then uploads (existing path, asserted). Account card: after sign-up shows "Check your email" with the address, a "Resend email" button (disabled for 30 s after use) and "Use a different email"; unverified sign-in error shows the same resend action; "Forgot password?" opens the request form, which always ends on "If that address has an account, we sent a link." `verified` route shows "Email confirmed. Sign in to continue." `reset-password` route: reads `token` from the URL then removes it from the address bar, form with new password (10 to 128 characters, shown/hidden toggle), success state with "Sign in", an invalid/expired token shows "This link has expired. Request a new one." and links to the request form; routes work signed out, in guest mode and signed in.
- [ ] **Step 2: Run; expected FAIL.**
- [ ] **Step 3: Implement** per the interfaces; copy in `auth-messages.ts`; keep 44 px targets and the existing form components.
- [ ] **Step 4: Run tests; expected PASS;** `just check`.
- [ ] **Step 5: Commit** `feat(web): verify-email, forgot-password and reset screens`.

### Task 3: Dev experience, docs and final review

**Files:** `docs/spec.md` (§7, §13, §14 already updated by this plan's commit; mark done), `README.md`, `CLAUDE.md`, `compose.yaml` (dev: no mail variables needed), `docs/release-checklist.md`.

- [ ] **Step 1:** `just dev` prints verification and reset links in the API log, prefixed so they are easy to find (`[mail]`), development only. Add a README section "Testing email flows locally".
- [ ] **Step 2:** Dev accounts created before this change are unverified: document wiping them (`truncate "user" cascade`) or verifying via the logged link.
- [ ] **Step 3:** Update CLAUDE.md invariants (verify before sign-in, never await mail, uniform responses, production requires `RESEND_API_KEY` and `MAIL_FROM`), spec status, release checklist (Resend domain verification is part of the production plan: `docs/superpowers/plans/2026-10-25-m3-production-cloudflare.md`).
- [ ] **Step 4:** `just check` once; one final independent review of Tasks 2 and 3 focusing on data loss around sign-up-then-verify (guest data must survive the whole path) and on token exposure in the browser.
- [ ] **Step 5: Commit** `docs: email auth, local mail testing`; mark M2b done in the spec.
