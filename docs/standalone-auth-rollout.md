# Standalone authentication rollout

> **Historical (superseded Oct 15–17, 2026):** sign-in is password-only and the authenticator code and its exceptions were removed. See password-only-sign-in.md. Sections about MFA, AAL2 and password-only exceptions below no longer describe the code.

Status: source implementation only until the separately approved runtime configuration, session-check SQL and owner binding are verified. The Site audience must remain owner-private during this phase.

## Boundaries

- Only Supabase project `ycswaipyuonxwyalkits` (`HR platform`) is permitted.
- HR records, photos and history stay in the existing Sites D1/R2 resources. No migration to Supabase is required.
- No Google/social sign-in, self-signup, anonymous signup, employee provisioning, invitations, reset emails or employee notifications are implemented.
- A publishable key is used server-side. A service-role key, secret key, database password and new API credentials are unnecessary.
- Password entry and authenticator enrollment are performed by the person using their own browser. Never enter a password previously shared in chat.

## Authentication design

The browser submits email/password only to the same-origin HTTPS endpoint. A fresh server-only Supabase SDK client performs password authentication and verifies signature, exact issuer/audience/subject/session, password AMR, confirmed current user and a bounded current-session RPC. Application identity binds the immutable issuer and UUID to a current eligible D1 employee. Roles never come from email or user metadata.

Access and refresh tokens are in Secure, HttpOnly, SameSite=Strict, Path=/ `__Host-` cookies. They are not returned in JSON or persisted in localStorage, source, logs or D1. D1 stores session identifiers, eligibility mappings, activity timestamps and one-way access-token fingerprints used only for logout revocation. No bearer-token-only request is accepted; the application uses its cookies and session ledger.

Admin and HR manager require a live AAL2 session with TOTP AMR. Other roles retain their existing application permissions. All write routes enforce same-origin requests. HTML/API responses are private/no-store and vary by Cookie. The client retries an unauthorized API request once after a single-flight same-origin refresh; it never refreshes on an unconditional timer. A 12-hour absolute and 30-minute idle limit apply in D1. The RPC separately checks provider session lifetime, refreshed activity and current MFA state. Revocation is checked at authorization time; an operation already authorized/in flight can finish if revocation races it across the two databases.

Logout revokes the app session first using the one-way fingerprint of a previously accepted token, even if that token expired or the provider is unavailable. All recorded token generations can revoke the same app session. It then attempts provider-local logout and clears cookies. `providerSignOutComplete` distinguishes provider completion from app completion. A D1 outage returns an error rather than falsely claiming logout.

## Required setup and approvals

1. Verify public signup is off, email/password is enabled, and Google/social/anonymous providers are off. Keep email confirmation enabled.
2. The owner creates their own account at Authentication → Users → Add user → Create new user, entering a fresh password privately and selecting Auto confirm user. This Create user flow sends no email; do not select Send invitation.
3. Verify only that supplied UUID's email, confirmation, deletion and ban status through a narrow read-only query.
4. Obtain explicit action-time approval to install `supabase-session-check.sql`, configure the private pilot, and bind that UUID to the separately verified existing owner employee ID. Apply SQL only to the allowed project. Verify function ownership, grants, search paths, anonymous denial and security advisors.
5. Configure approved runtime values through Sites native environment tools, preserving existing values:
   - `UFS_AUTH_MODE=pilot`
   - `UFS_SUPABASE_URL=https://ycswaipyuonxwyalkits.supabase.co`
   - `UFS_SUPABASE_PUBLISHABLE_KEY=<existing publishable key>`
   - `UFS_SUPABASE_SESSION_CHECK=enabled`
   - `UFS_SUPABASE_OWNER_SUB=<verified, approved owner UUID>`
   - `UFS_SUPABASE_OWNER_EMPLOYEE_ID=<verified, approved existing admin employee ID>`
6. Publish privately and have the owner open `/login`, enter their fresh password and explicitly enroll/verify their authenticator. The exact configured owner may bootstrap one immutable D1 identity binding. An existing disabled or conflicting binding is never replaced or reactivated. Existing owner ChatGPT access remains during pilot.
7. Verify real login, TOTP, logout, refresh, revoked session denial and no-cache behavior. Synthetic tests do not replace this. Additional controlled test identities and access bindings require bounded approval; never create real employee accounts for testing.
8. Before public rollout, obtain exact separate approval for audience change and `UFS_AUTH_MODE=standalone`, after all readiness checks pass. Standalone mode disables all legacy identity fallback. Staff access and all employee email sends remain a separate approval.

Recommended settings include 15-minute access tokens, password minimum 12, secure email change and password reauthentication, with leaked-password protection when available. The app does not depend on paid session-timeout features. Redirect configuration should use exact Site HTTPS URLs, no wildcards; the current password-only/TOTP flow has no callback and never uses the reserved Sites `/callback` route. PKCE is configured in the SDK; password/TOTP themselves do not use a redirect code exchange. Signup, recovery and OAuth callback routes remain intentionally absent.

The explicitly approved additional super-admin uses `UFS_SUPABASE_ADDITIONAL_ADMIN_SUB` and `UFS_SUPABASE_ADDITIONAL_ADMIN_EMPLOYEE_ID`. Only that exact current, pending employee (employee role, inactive account, no legacy identity, no demo/former status) can be activated and promoted, atomically with its first immutable identity binding and audit event. Existing mappings cannot be replaced/reactivated, and later demotion/deactivation cannot be undone by this configuration. No additional employee is affected.

## Validation

Run `node --test tests/*.test.mjs`, `npm exec tsc -- --noEmit --incremental false`, the Sites build helper, then `node scripts/audit-public-assets.mjs`. Tests use synthetic identities and a deny-by-default HTTP adapter with locally signed ES256 tokens. They do not create provider accounts, transmit employee data or send mail.

Inspect the generated D1 schema-only migrations before private publication. They add only auth identity/session/rate-limit tables. Existing employee, photo, history and other HR rows must remain unchanged.

Live readiness cannot be reported while runtime setup, session-check SQL, real owner sign-in/MFA or public-audience checks are unverified.

## Approved temporary password-only private test

`UFS_AUTH_MFA_TEST_UNTIL` is an explicit UTC ISO expiry, not a permanent MFA-disable flag. The exception is valid only in `pilot` mode, for at most the next 24 hours, and only for the two exactly configured approved administrator UUIDs. The Site must stay owner-private during this test. Switching to `standalone`, removing/expiring the value, or presenting any other privileged identity immediately restores normal MFA requirements on the next authorization check.

This relaxes only the application's AAL2 requirement. Password AMR, signature, issuer, immutable D1 identity binding, current account eligibility, live provider session validity, local session revocation and role permissions remain mandatory. Existing enrolled factors and Supabase settings remain untouched. Do not delete factors, configure paid SMS, or change audience as part of this exception.

## Separately approved two-account public pilot

This isolated release adds the separately approved public pilot without the unfinished email-code feature or its migrations. Set `UFS_AUTH_MODE=standalone` and `UFS_AUTH_PUBLIC_PILOT_UNTIL=2026-10-13T01:35:00.000Z`, removing the private-pilot exception. The public pilot admits only the two explicitly configured approved immutable subjects, even if another subject already has an otherwise eligible mapping and valid MFA. All existing password, identity, eligibility, session and revocation checks still apply.

Standalone requires a valid public-pilot deadline in this release. Missing/malformed/later deadlines and a public flag paired with any non-standalone mode fail closed. The server suppresses legacy identity fallback whenever public-pilot intent is present. The code caps the password-only exception at the exact approved deadline above. After expiry, the two-account scope remains and normal MFA is required again. No Auth factors or email settings are modified.

Deploy and negatively test while owner-private before applying the separately approved public audience change. Then repeat anonymous API/file/photo and forged legacy-header checks without the Sites service token. Public access exposes the login page and data-free bundle, not the protected HR APIs. Authenticated owner-browser QA remains a separate verification step; synthetic tests cannot establish that result. Before intentionally reverting both public configuration fields, restore owner-private audience first.
