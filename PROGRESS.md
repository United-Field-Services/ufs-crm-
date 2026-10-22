# PROGRESS

## 2026-10-19 - Convex sign-in and emailed-code reset: live test passed
**Status**: Passed on the dev deployment. Invite, emailed code (SMTP, `noreply@unitedffs.com`), three-step reset (email, code, new password), sign-in with the new password and sign-out all worked for the test address. Database check afterwards: reset cutoff recorded, one active app session created after it (sign-in after the reset), one matching Convex session; pre-reset sessions were gone.
**Changes since the entry below**: Resend replaced by SMTP only (`convex/mailSmtp.ts`, `convex/EmailOTPPasswordReset.ts`; `SMTP_USER`/`SMTP_PASS` are Convex deployment settings set by the owner, never in chat). Reset page is now three screens. 2,384/2,384 tests, `tsc`, ESLint, build and asset audit pass.
**Local test data changed (copy only)**: the local admin's email is the test address, and a local sign-in binding for its Convex user id was inserted by hand (a reset needs an approved binding first; there is no admin screen for that yet).
**Open items**: see the list in the chat reply of 2026-10-19: rotate the pasted Convex token and Gmail App Password; boss OK for the noreply mailbox; hosting decision (Cloudflare vs AWS) before choosing the final provider; binding/invite admin flow; production Convex deployment and proper sending mailbox; boss review (Convex Auth is beta); whether to swap this copy into the project.

## 2026-10-19 - Convex Auth sign-in provider (in this copy; not yet swapped into the project)
**Status**: Built and verified with synthetic tests and against the real Convex deployment; live reset test waits on a Resend key and a test email.
**What was done**: Optional provider switch `UFS_AUTH_PROVIDER=convex` (Supabase stays the default). New `lib/auth-provider.ts`, `lib/convex-auth.ts` (HTTP sign-in, RS256 token check against the deployment's published keys, app session ledger, owner binding, refresh, logout) and `lib/convex-recovery.ts` (emailed 8-digit code reset, same cutoff table and flag as the Supabase reset). Login, refresh, logout, session and both reset routes dispatch by provider; `app/reset-password/convex-recovery-form.tsx` is the two-step reset form. The backend is a separate project, `auth-convex` (Convex Auth + SMTP email, invite-only, deployed to dev deployment `resolute-wildebeest-477`).
**Found by running it for real (not by the tests)**: the edge runtime rejects `fetch(..., {redirect:'error'})`; now `manual` with 3xx treated as failure, and tests assert it. Also fixed: Convex calls now require full configuration (mode on) before contacting Convex.
**Results**: 2,381 tests pass (2,255 before plus 126 new for Convex sign-in/reset and the form); `tsc` clean, ESLint clean, build and asset audit pass. Real deployment checks: public keys served, wrong sign-in answers one generic 401, unknown reset address answers the generic notice, RS256 verification and Convex's key import work in the edge runtime.
**Needs from the owner of the Convex account**: SMTP settings (`SMTP_USER`, `SMTP_PASS` = Gmail App Password) set on the deployment by the owner, never in chat. The test email is already invited and bound locally; then run the live sign-in and reset.
**Next steps**: live test; boss review (Convex Auth is beta); a proper sending mailbox (not a personal Gmail) before real employees receive codes; then decide whether to swap this copy into the project. Rotate the Convex token that was pasted into a file earlier, and run `npx convex logout` when finished.

## 2026-10-19 - Merged copy swapped into the project
**Status**: Completed
**What was done**: The project now equals the merged copy (boss's password-reset candidate unchanged + our non-reset improvements; see `MERGE-NOTES.md`). Old copies of our own reset (routes, pages, docs, auth shell) and the authenticator files are gone. Backup of the previous project: `../UFS-People-backup-2026-10-19` (kept). The local database got migration `0011` via `npm run setup` (data kept).
**Results**: 2,235/2,235 tests, `tsc` clean, ESLint 0/0, build and asset audit pass. Browser check on the project: workspace loads with the existing local data, People/Workflows fixes work, login shows his "Forgot your password?" link. Password reset is **off** (`UFS_PASSWORD_RECOVERY` unset).
**Next steps**: Live reset test after the Supabase owner's setup and his release order (migration `0011` before deploy, flag off until redirect URLs, template and SMTP are verified). Rebuild the admin "Send reset link" on his flow. Confirm with the boss that the retired authenticator stubs may stay removed and check the 128-character password limit against Supabase. Regenerate `SOURCE-MANIFEST.json` before packaging (it was left out).

## 2026-10-19 - Merged copy (boss's password reset + our improvements)
**Status**: Built and verified locally; awaiting approval. See `MERGE-NOTES.md` for what came from where, what was left out and what to confirm with the boss.
**Results**: 2,235/2,235 tests, `tsc` clean, ESLint 0/0, build and audit pass; pages checked in the browser. The original project was not changed; backup in `../UFS-People-backup-2026-10-19`.
**Next steps**: Approval to swap; rebuild the admin "Send reset link" on his flow; live test after the Supabase owner's setup (apply migration 0011 first, keep `UFS_PASSWORD_RECOVERY` off until then).

## 2026-10-17 - Typed API rows and tap targets
**Status**: Completed
**What was done**: Replaced the loose `Item=Record<string,any>` in `workspace.tsx`, `operations.tsx` and `dashboard.tsx` with real row types in the new `lib/api-types.ts` (people, leave requests, documents, events, balances, tasks, checklist templates and runs, assets, announcements, time entries, settings snapshot, and the full `StateData` / `OperationsData` responses). The three `any` suppressions are gone; there is no `any` left in `app/` or `lib/`. Keep `lib/api-types.ts` in step with the SELECT lists in `app/api/state/route.ts` and `app/api/operations/route.ts`. Touch targets: inline links get extra tap padding, small text inputs a minimum height, plus the earlier button changes. On a phone-sized view, 459 interactive elements across all 14 pages were checked: none is under 24px (the WCAG 2.2 minimum) except one search field that is now fixed, and there is no horizontal overflow.
**Tests**: 2,072/2,072 pass. Two render tests that patch component source by exact text were updated for the new type names. `tsc` clean, ESLint 0/0, build and asset audit pass.
**Files changed**: `lib/api-types.ts` (new), `app/workspace.tsx`, `app/operations.tsx`, `app/dashboard.tsx`, `app/talenthr-layout.css`, `tests/workspace-render.test.mjs`.
**Next steps**: Live password-reset test once the Supabase owner finishes setup; custom SMTP and the Supabase session-check SQL before real employees sign in; clean up the expired October 13 pilot date in `lib/standalone-auth.ts`.

## 2026-10-17 - Load error screen and lint warnings
**Status**: Completed
**What was done**: A failed first load (offline, server error, dev server still compiling) used to show the raw browser message "Failed to fetch" with a "Sign in with ChatGPT" button. It now says "We couldn't reach UFS People. Check your connection and try again." (or the server's own message) with a **Try again** button that recovers without a reload. Only a real 401/403 still shows the sign-in prompt. Cleared all 24 ESLint warnings: removed unused imports, variables and state (`workspace.tsx`, `employee-profile.tsx`, two tests), rewrote the photo-import digest line without an unused variable (same JSON output), and added reasoned `eslint-disable` comments for the 4 logo/photo `<img>` tags (private same-origin photo route; no image optimizer on this host) and the 2 deliberate full-page `location.assign` calls after sign-in/reset.
**Tests**: 2,072/2,072 pass (3 new load-error tests). `tsc` clean, ESLint 0 errors and 0 warnings, build and asset audit pass. Simulated a network failure in the browser: message and Try again appear, and Try again recovers.
**Files changed**: `app/workspace.tsx`, `app/employee-profile.tsx`, `app/employee-avatar.tsx`, `app/login/{auth-shell,login-form}.tsx`, `app/reset-password/reset-form.tsx`, `lib/photo-import.ts`, `tests/{workspace-interactions,actions-deep,directory-import}.test.mjs`.
**Next steps**: Live password-reset test once the Supabase owner finishes setup; type the API rows (`Item=Record<string,any>`); remaining 10 or so small tap targets are inline text links.

## 2026-10-17 - Usability fixes from the first review
**Status**: Completed
**What was done**: (1) Balance year dropdown now shows current year ±5 (11 options) instead of 2020-2100. (2) Add employee: department is a required pick from existing departments with "New department…" to add one; a super admin can choose the time-off approver (default: themselves); HR sees who the approver will be. Server: only a super admin's `managerId` is honored, and the approver is validated in the same SQL statement as the insert. Non-admin `managerId` is still ignored. (3) Profile error banner reads "That didn't go through" (it also covers reset-link failures). (4) People page hides the duplicate header search; it returns on other pages. (5) Tables use tighter cell padding below 1200px so the People table no longer clips "Work contact". (6) Workflows empty state offers "Start from the onboarding/offboarding checklist" (opens the create form prefilled; nothing is saved until HR saves). (7) Touch targets: icon buttons, segmented tabs, sign-out and checkboxes get larger hit areas on touch screens and phones (flagged small targets per page went from 28 to about 10, mostly inline text links).
**Decision**: I did not default new hires to "no approver" as first suggested: only a super admin can assign approvers later, so HR-created employees would be stuck with unapprovable leave.
**Tests**: 2,069/2,069 pass (13 new: approver rules in `manager-access.test.mjs`, page behavior in `workspace-interactions.test.mjs`). `tsc` clean, ESLint 0 errors / 24 warnings, build and asset audit pass. Checked in the browser (People table fits, header search hidden, year list 2021-2031, starter buttons, Add employee form).
**Files changed**: `app/workspace.tsx`, `app/api/action/route.ts`, `app/employee-profile.tsx`, `app/operations.tsx`, `app/talenthr-layout.css`, `app/operations.css`, `tests/manager-access.test.mjs`, `tests/workspace-interactions.test.mjs`.
**Next steps**: Raw "Failed to fetch" with a ChatGPT sign-in button on first dev load; 24 lint warnings; type the API rows; live password-reset test once the Supabase owner finishes setup.

## 2026-10-17 - Password reset and one-command local setup
**Status**: Completed in code; **live test pending** (needs Supabase setup by the owner, see `docs/password-reset.md`).
**What was done**: Self-service reset (`/forgot-password`, `/reset-password`, `POST /api/auth/forgot`, `POST /api/auth/reset`) and admin-triggered reset (`sendPasswordReset` action plus a "Send password reset link" button on employee profiles for HR/admin; HR cannot reset admins). Token-hash email link, one-time use, same answer for unknown addresses, rate limits, all sessions revoked after a reset, refused for the test scope. Login page has a "Forgot your password?" link; shared `AuthShell` extracted from the login page. `npm run setup` (`scripts/setup-local.mjs`) installs deps, creates `.env` from the new `.env.example`, and applies migrations to the local D1 (`--reset` wipes local data); verified from a clean `.wrangler/state`.
**Tests**: 2,056/2,056 pass (60 new: provider transport additions in `standalone-auth.test.mjs`, page tests in `standalone-login-ui.test.mjs`). `tsc` clean, ESLint 0 errors / 24 warnings, build and asset audit pass. Checked in the browser: new pages render, token is stripped from the URL, profile button works (locally it correctly answers "no active sign-in account").
**Files changed**: `lib/standalone-auth.ts`, `app/api/auth/{forgot,reset}/route.ts`, `app/api/action/route.ts`, `app/{forgot-password,reset-password}/*`, `app/login/{auth-shell,page,login-form}.tsx`, `app/login/login.css`, `app/employee-profile.tsx`, `scripts/setup-local.mjs`, `.env.example`, `.gitignore`, `package.json`, `README.md`, `docs/password-reset.md`, tests.
**Live test needs**: Redirect URL `http://localhost:5173/reset-password` allowed in Supabase, the Reset-password email template set to `{{ .RedirectTo }}?token_hash={{ .TokenHash }}`, the publishable key and `UFS_AUTH_MODE=pilot`, `UFS_SUPABASE_URL`, `UFS_SUPABASE_SESSION_CHECK=enabled` in `.env`, and a test account whose inbox the owner controls. Signing in after the reset also needs the `ufs_session_is_active` SQL installed and an identity binding.
**Next steps**: Run the live test; configure custom SMTP before real use; clear the remaining lint warnings; type the API rows.

## 2026-10-17 - Dead MFA code removed
**Status**: Completed
**What was done**: Deleted `lib/mfa-qr.ts` and the `/api/auth/mfa` and `/api/auth/mfa/enroll` routes (they returned 410, now 404). Removed `requiresMfa`, `temporaryPasswordOnly`, `temporaryQaPasswordOnly`, `approvedQaHrPasswordOnly`, `privileged` and the `allowMfaPending` option from `lib/standalone-auth.ts`. The auth status response is now `{ok,enabled,authenticated,testMode?}` (no `mfaRequired/factors/allowEnrollment`). Dropped the `mfa_required` login reason and the `UFS_AUTH_MFA_TEST_UNTIL`, `UFS_QA_MFA_TEST_UNTIL`, `UFS_QA_HR_MFA` settings. Kept the check that rejects an aal2 session without TOTP proof.
**Tests**: removed ones that only covered the deleted code (QR, password-only windows, QA exceptions); kept and adapted the identity, binding, revocation and QA-scope tests; added one test that the routes and helpers no longer exist. 1,997/1,997 pass. `tsc` clean, ESLint 0 errors / 23 warnings, build and asset audit pass.
**Files changed**: `lib/standalone-auth.ts`, `app/api/auth/{login,refresh}/route.ts`, `app/login/{page,login-form}.tsx`, `scripts/audit-public-assets.mjs`, `cloudflare-env.d.ts`, `tests/standalone-auth.test.mjs`, `tests/auth-client.test.mjs`, `docs/password-only-sign-in.md` (+ historical banners on two older docs). Deleted `lib/mfa-qr.ts`, `app/api/auth/mfa/`.
**Next steps**: Deploy-time check that no hosted setting still sets the three removed variables (harmless if so). Then password reset, API row types, 23 lint warnings.

## 2026-10-17 - Stale MFA tests and lint errors fixed
**Status**: Completed
**What was done**: The 76 failing tests asserted the retired authenticator flow (`requiresMfa()` is hard-wired to `false`; MFA routes return 410 since the 2026-10-15 password-only change). Rewrote them to the current behavior: privileged roles sign in with a password only, expiry windows and QA/MFA flags no longer change access, the login page never shows authenticator controls. Deleted tests that only covered the removed enrollment/challenge flow. Fixed all 21 ESLint errors.
**Results**: 2101/2101 tests pass, `tsc` clean, ESLint 0 errors (25 warnings left), build and asset audit pass.
**Files changed**: `tests/standalone-auth.test.mjs`, `tests/standalone-login-ui.test.mjs`, `tests/public-readiness.test.mjs`, `app/workspace.tsx`, `app/dashboard.tsx`, `app/operations.tsx`, `app/login/login-form.tsx`.
**Notes**: `Item=Record<string,any>` in `workspace.tsx` and `operations.tsx` keeps one targeted `eslint-disable` until API rows are typed. `RequestTable`, `TaskList` and `HeaderAction` in `workspace.tsx` are now called as plain functions (they use no hooks). Not re-checked in a browser; DOM render tests cover all 14 screens.
**Next steps**: Remove dead MFA code (`lib/mfa-qr.ts`, MFA routes, exception helpers in `lib/standalone-auth.ts`); type the API rows; clear the 25 lint warnings; add password reset and a one-command local setup.

## 2026-10-16 - Local run, QA pass and review
**Status**: Completed (review only, no source changes)
**What was done**: Installed deps, ran tests, tsc, lint, build, asset audit; ran the dev server and clicked through all 14 screens, mobile view, time-off request, add employee, /login.
**Results**: tsc clean. Build clean. Asset audit passed. Tests: 2135 run, 2059 pass, 76 fail (all stale MFA/authenticator tests in `standalone-auth` 61 and `standalone-login-ui` 15; code now returns HTTP 410 for MFA since the 2026-10-15 password-only change). ESLint: 21 errors, 25 warnings (mostly `any` in `app/workspace.tsx`).
**Local setup added (not source)**: `.claude/launch.json` (dev server), `.env` with `UFS_OWNER_EMAIL=seedy@sites.test`. Local D1 needs migrations applied once: `wrangler d1 migrations apply DB --local --persist-to .wrangler/state` with a config pointing `migrations_dir` at `drizzle/`.
**Files changed**: none in source.
**Next steps**: see the prioritized list in the chat summary (fix stale tests, fix lint errors, password reset, notifications, dev-setup docs).


## 2026-10-21 - Cloudflare Workers deployment
**Status**: Completed (first deploy live, no file uploads yet)
**What was done**: Pushed to United-Field-Services/ufs-crm-; added `UFS_SELF_HOSTED` header stripping, `scripts/cloudflare.mjs`, `docs/deploy-cloudflare.md`; created D1 `ufs-people-db` (ENAM), applied migrations 0000-0011, deployed worker `ufs-people` to https://ufs-people.unitedffs.workers.dev (no R2 binding), created first administrator venakat@unitedffs.com bound to the Convex dev deployment.
**Files changed**: build/sites-worker.ts, lib/self-hosted.ts, scripts/cloudflare.mjs, tests/self-hosted.test.mjs, docs/deploy-cloudflare.md, cloudflare-env.d.ts, cloudflare-deploy.example.json
**Next steps**: production Convex deployment + real SMTP mailbox; rotate exposed Convex token and Gmail app password; R2 (or Convex file storage) for uploads; admin invite/bind UI; custom domain; boss review of Convex Auth (beta).

## 2026-10-22 - QA report fixes (UFS-01 to UFS-15)
**Status**: Completed and deployed
**What was done**: Worker pinned near D1 (placement aws:us-east-1): pages 5 s -> ~1 s (UFS-04, likely UFS-15). Inline dialog errors, success toast before refresh, request timeouts and plain network messages (UFS-01/02/05). Section addresses /people, /time-off, ... with login `next` (UFS-03). Login form usable during session check (UFS-06). Fonts self-hosted via @fontsource-variable (UFS-07). Add employee: 100-char limits, hire date max +1 year, division defaults to department, "Login: Not set up yet" until bound (UFS-08). LinkedIn pattern (server already enforced, UFS-09). Profile dialog unlocks right after save (UFS-05/10). Labelled Approve/Decline (UFS-11). Task assignee defaults to current user (UFS-12). Headcount labels clarified (UFS-14). QA test rows removed from live DB.
**Left as decision**: UFS-13 past dates stay allowed (retroactive sick leave); Finance employee has no extra access.
**Files changed**: app/workspace.tsx, app/login/*, app/*/page.tsx, app/workspace-route.tsx, app/globals.css, app/employee-profile.tsx, app/dashboard.tsx, app/workforce.tsx, app/api/action/route.ts, lib/auth-fetch.ts, lib/profiles.ts, lib/sections.ts, scripts/cloudflare.mjs, tests/qa-fixes.test.mjs
**Next steps**: re-run QA on the live site; production Convex + real SMTP; R2 or other file storage.

## 2026-10-22 - QA round 2 (UFS-16 to UFS-25)
**Status**: Completed and deployed
**What was done**: File storage in D1 when no R2 bucket (migration 0012 file_chunks, lib/d1-storage.ts); 10 MB check in form and 413 on server; busy labels for approve/submit/return; asset and workflow validation; report range and source notes; parallel state queries; API permission tests; QA data removed from live DB.
**Files changed**: lib/d1-storage.ts, lib/server.ts, drizzle/0012_file_chunks.sql, app/workspace.tsx, app/operations.tsx, app/dashboard.tsx, app/api/state|operations|files routes, tests/permissions-api.test.mjs, tests/qa-fixes.test.mjs
**Next steps**: add R2 later if wanted (set r2Bucket); consider a database region near the users; production Convex + SMTP.

## 2026-10-22 - Production Convex
**Status**: Completed
**What was done**: Production deployment basic-ostrich-538 created (code, signing keys, SITE_URL, SMTP settings); live site switched to it; administrator bound and password set by email code. Test logins (dev issuer) no longer work.
**Next steps**: rotate the SMTP App Password and the earlier Convex token; remove sample data before real staff; invite real employees (invites:add --prod + identity binding); boss review of Convex Auth; consider a service mailbox (SES).

## 2026-10-23 - Notifications and reminders
**Status**: Completed and deployed (migration 0013, Worker cron every minute and every 30 minutes, Convex /notify route, secret on Worker and both Convex deployments)
**What was done**: In-app inbox, bell, preferences (in-app, instant or daily-summary email, mandatory security notices), 18 notification kinds, reminders with escalation (waiting approvals, tasks, equipment, file expiry, probation/contract end, anniversaries, upcoming leave, optional Friday timesheet), email queue with retries, branded emails, tests (27 new). Pipeline verified live: a queued email was sent by the scheduled run.
**Files changed**: lib/notifications.ts, lib/notify-events.ts, lib/reminders.ts, lib/notification-kinds.ts, lib/notification-inbox.ts, app/api/notifications/route.ts, app/notifications.tsx, app/workspace.tsx, build/sites-worker.ts, scripts/cloudflare.mjs, auth-convex/convex/http.ts, drizzle/0013_notifications.sql, docs/notifications.md, tests/notifications.test.mjs
**Next steps**: push notifications / SMS / Slack, quiet hours, birthday notices (privacy review), a service mailbox (SES) for volume.
