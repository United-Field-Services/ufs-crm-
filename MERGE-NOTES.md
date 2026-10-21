# Merged copy: boss's password reset + our improvements

Built 2026-10-19. **Not deployed. The current project folder (`UFS-People`) was not changed**; a backup of it is in `UFS-People-backup-2026-10-19`.

## Where it comes from
- **Boss candidate** `UFS-People-Password-Reset-Candidate-2026-10-16.zip` (all 267 files matched its own `SOURCE-MANIFEST.json`). It is the official password reset in this copy, taken byte for byte: `lib/password-recovery.ts`, the `forgot-password` / `reset-password` routes and pages, migration `0011`, `db/auth-schema.ts`, his docs and his three new test files (222 tests).
- **Our project** (as of 2026-10-17) supplies everything that is not password reset.

## What is on top of the boss candidate (32 files changed, 4 left out)
1. **Authenticator code removed.** Left out: `lib/mfa-qr.ts` and the two `/api/auth/mfa*` routes (his version keeps them as HTTP 410 stubs with contract tests). Removed `requiresMfa`, the temporary password-only / QA exception helpers, `allowMfaPending`, the `mfaRequired / factors / allowEnrollment` status fields and the three retired settings. The check that rejects an `aal2` session without TOTP proof stays.
2. **His session-cutoff guards are kept** in `lib/standalone-auth.ts` (the `credentialAt` lines and the two guarded session statements), merged into our cleaned file.
3. **Typed API rows** (`lib/api-types.ts`, `workspace.tsx`, `dashboard.tsx`, `operations.tsx`): no `any` left.
4. **Usability fixes:** balance-year window, required department pick, super-admin approver choice for new hires, one search box on People, denser tables, workflow starter buttons, larger tap targets.
5. **First-load error screen** with Try again.
6. **Lint:** 0 errors, 0 warnings (his package had 21 errors / 25 warnings).
7. **Setup:** `npm run setup`, `.env.example` (now also lists `UFS_PASSWORD_RECOVERY`), README quick start.
8. Tests: our rewritten `standalone-auth` and `standalone-login-ui` tests replace his versions of those two files (his retired-MFA contract tests went away with the routes); our other test updates follow our code changes.

## Not carried over from our version
- Our own forgot/reset routes, pages and docs (replaced by his).
- The HR/admin **"Send password reset link"** button and its action. It would need to be rebuilt on his flow (off switch, eligibility rule, email alignment). The profile error banner is back to "Changes weren't saved".
- `SOURCE-MANIFEST.json` (its hashes describe his package, not this copy). Regenerate it before packaging this copy.

## Results (this copy)
- Tests: **2,235 / 2,235 pass** (his 222 recovery tests included); `tsc` clean; ESLint 0/0; production build and public-asset audit pass.
- Browser (dev server, recovery off): `/login` shows his "Forgot your password?" link; `/forgot-password` and `/reset-password` show "Password reset is not enabled yet" with controls disabled; the token is removed from the address bar; the workspace loads on a database that has migration `0011`; our UI fixes work.
- **Not verified:** deployment, real email, Supabase settings, the live reset (still waiting on the Supabase owner).

## Things to settle with the boss
- His release order applies unchanged: apply D1 migration `0011` before deploying, keep `UFS_PASSWORD_RECOVERY` off until the redirect URLs, email template and SMTP are verified.
- His password limit is 12 to 128 characters; Supabase may cap passwords lower (believed 72). Check before the live test.
- Whether he accepts the authenticator code being removed instead of kept as 410 stubs.

## Housekeeping
`node_modules` here is a Windows junction to the project's `node_modules` (same lockfile, nothing reinstalled). Do not run `npm install` here, and remove the junction with `rmdir` (not a recursive delete) before deleting this folder.
