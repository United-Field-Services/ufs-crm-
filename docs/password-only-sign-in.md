# Password-only sign-in — October 15, 2026

At the owner’s request, all UFS People roles use their work email as username and their existing password. Authenticator enrollment and verification endpoints return 410; the login page no longer displays either flow. Existing provider factors are retained but are not required by this application. Password validation, identity bindings, account eligibility, role permissions, secure cookies, rate limits, CSRF checks, and online/local session revocation remain enforced.

The provided United Field Services logo replaces the placeholder on the login page, sidebar, and mobile header.

## Authenticator code removed — October 17, 2026

The disabled authenticator code is gone: the `/api/auth/mfa` and `/api/auth/mfa/enroll` routes (formerly HTTP 410), `lib/mfa-qr.ts`, the temporary password-only exception helpers and `requiresMfa` in `lib/standalone-auth.ts`, the `mfaRequired/factors/allowEnrollment` fields of the auth status response, and the `UFS_AUTH_MFA_TEST_UNTIL`, `UFS_QA_MFA_TEST_UNTIL` and `UFS_QA_HR_MFA` settings. Existing Supabase factors are untouched. The server still rejects a session labelled aal2 without TOTP proof. Re-adding an authenticator requirement means re-implementing it, not flipping a flag. `docs/standalone-auth-rollout.md` and `docs/test-account-isolation.md` describe the earlier MFA design and exceptions and are kept as history.

## Password reset — October 2026

Forgot-password and reset links are implemented (the Oct 16 candidate prepared by the project owner). They are **off by default**; see [password-reset-setup-and-testing.md](password-reset-setup-and-testing.md) for the release order, the one-time Supabase configuration and the acceptance checklist.
