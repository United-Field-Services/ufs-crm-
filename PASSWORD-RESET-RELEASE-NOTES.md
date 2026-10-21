# UFS People password-reset source candidate

Prepared October 16, 2026. **Not deployed; live reset/email acceptance is unverified. Recovery is off by default.**

## Provenance

Base: `UFS-People-Latest-2026-10-15.zip`, SHA-256 `9b35eb1925f6a186a26857153f3e3a2692c8e12eb478deb4ef75dca9712c01cb`.
The base export was consistent with Sites v25 / commit `7c3f258d29a5374d32e21df31e1eab2de79efe92`, but had no embedded commit manifest, so exact commit identity is not asserted. This package is a new local candidate, not a new published version/commit.

## Changes

- Added Forgot password link, request page/API, new-password page/API, bounded exact redirects and one-shot token-hash recovery.
- Added default-off `UFS_PASSWORD_RECOVERY` gate, generic anti-enumeration responses, existing shared D1 throttling and CSRF checks.
- Recovery tokens are memory-only in the browser, never stored as app-session credentials. GET does not consume a link. New password is entered/submitted by the human; fresh normal sign-in is required.
- Added additive D1 reset-cutoff/lock migration and atomic auth-session guards against in-flight pre-reset login and old-auth refresh. Existing password-AMR, eligibility and role/scope requirements remain.
- Explicit global provider sign-out reports failures. Partial password/DB failures fail closed and can require a fresh recovery link.
- Retained all prior test-maintenance changes: refreshed password-only/retired-MFA auth and login UI contracts plus synthetic T053 2027 approval coverage. Updated the login test’s former no-reset-link expectation to allow only the intended local recovery link.
- Added 138 route/security/integration and 82 React/JSDOM recovery tests. No dependency or lockfile change.

## Verification

Final local checks against this candidate:

- Full synthetic suite: **2,432/2,432 pass**, zero failures/skips/cancellations.
- TypeScript: pass, `tsc --noEmit --incremental false`.
- Production build: pass.
- Public-asset audit: pass, 24 assets / 67 source modules.
- New recovery source and tests targeted ESLint: pass.
- Full project lint: **existing baseline remains 21 errors / 25 warnings**, identical counts before and after. This is not a full lint-clean claim.
- Independent review reran the 732 relevant auth/login/recovery tests, all passed, and found no remaining security blocker within the reviewed source scope.

Tests use actual local SQLite SQL/migrations, real pinned Supabase SDK with synthetic HTTP responses, and JSDOM interactions. They do not establish deployed Supabase settings, real inbox delivery, actual old-password invalidation, provider revocation, human acceptance, or pixel/browser layout. No actual password, reset email, live database, provider configuration, role, account or deployment was changed while preparing this package.

## Before testing or deployment

Read `docs/password-reset-setup-and-testing.md` in full. Apply `drizzle/0011_shiny_killmonger.sql` to D1 before deploying this code; normal auth now reads its table even while recovery is off. Configure and verify the exact recovery redirect/template/SMTP through an approved workflow before enabling the flag. Preserve existing redirect entries and all unrelated settings.

Requests require the bound employee-profile email and provider sign-in email to align; provider email changes alone are not reconciled here. Use approved support to resolve a mismatch, never email-based subject relinking.

A real accessible test inbox is required for delivery acceptance. Synthetic login emails are not proof of an inbox. Do not send reusable recovery links, tokens or passwords to bots/test tickets. Do not mark hosted acceptance passed from these automated checks.

## Package hygiene

Includes source, existing static product assets, lockfile, maintained build tooling, tests, migrations, documentation and a source-integrity manifest. Excludes `.env*`, credentials, runtime databases/employee records, dependencies, generated builds, caches and local tool state. `SOURCE-MANIFEST.json` records every included source file hash (excluding itself).
