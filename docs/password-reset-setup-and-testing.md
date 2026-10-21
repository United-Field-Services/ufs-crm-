# UFS People password recovery: setup and testing

Status: new local source candidate, 2026-10-16. Not deployed. Live routes, email delivery, provider configuration and human password-reset acceptance have not been verified. This guide does not authorize deployment, credentials, account changes or email sends.

## What is included

- A Forgot your password link on sign-in, `/forgot-password` request page, and `/reset-password` new-password page.
- Recovery is **off by default**. The exact server flag `UFS_PASSWORD_RECOVERY=enabled` and all existing standalone-auth prerequisites are required. With it disabled, pages explain that reset is not enabled; APIs return 503 without email/provider actions. Normal password sign-in remains in place.
- Existing password authentication, employee eligibility, identity bindings, role/QA boundaries and public-pilot restrictions remain required. Recovery does not activate, bind, invite, register or promote anybody.
- The work email stored on the bound employee profile must match the current Supabase sign-in email for requests to reach the intended inbox. Normal login binds by immutable provider subject and can still work after a provider-email change; recovery does not automatically reconcile that change. Administrators must verify profile/provider email alignment through approved support procedures before testing. Never relink subjects based on email alone. A stale profile email could send an unusable link to a different provider account; completion still requires that account’s own eligible subject binding.
- Only an eligible existing bound employee email triggers a provider request. Unknown/ineligible emails and provider/SMTP errors receive the same generic success notice. This means a success notice never establishes account existence or email delivery.
- Shared D1 limits are 10 per identity/token and 40 per network per 15-minute window, separately for request/completion. They supplement Supabase limits. Production must preserve Cloudflare's trusted client-IP header; self-hosted proxies must sanitize it. Unknown IPs share a conservative bucket. The response floor reduces trivial timing differences, but is not a constant-time network guarantee.

## Release order (required)

1. Keep recovery disabled. Back up the existing application/configuration and verify the target is UFS People / Supabase project `ycswaipyuonxwyalkits`.
2. Apply the additive **D1** migration `drizzle/0011_shiny_killmonger.sql` through the approved release workflow before deploying this code. It adds `auth_password_resets` with provider subject, issuer, cutoff timestamp and a lock bit. It is not a Supabase migration. Normal auth now reads this table, so deploying code without it fails closed. No existing rows or permissions are changed by the migration. Preserve earlier migrations and migration history.
3. Deploy the exact reviewed candidate through the normal authorized workflow, still with recovery disabled. Verify all new pages and APIs and normal login at the intended address. This ZIP has not performed those steps.
4. Snapshot the existing Supabase Auth redirect allowlist and recovery template before edits. Preserve all existing entries. Add only exact destinations actually used:
   - `http://localhost:5173/reset-password`
   - `https://ufs-people.artman79.chatgpt.site/reset-password` only once this candidate is deployed and verified there.
   Do not add wildcards. A different tester host needs explicit code allowlist review and a separately approved exact provider entry. Requests cannot supply their own redirect/next destination.
5. Set the recovery email action link to `{{ .RedirectTo }}?token_hash={{ .TokenHash }}`. It requires the exact query-free redirect above. The dedicated endpoint hardcodes `type: 'recovery'`; signup, invitation, OTP login and arbitrary `type` inputs are not accepted as recovery. This is token-hash verification, not the default PKCE code-exchange callback. Do not reuse a template that sends `code` or an access-token fragment to this handler.
6. Verify SMTP/delivery and provider password policy. New Free projects with default SMTP may not permit template customization; custom SMTP and/or plan prerequisites must be checked in the dashboard. No SMTP secrets belong in source or this ZIP. A fake login email is not an inbox. Use an explicitly approved, accessible isolated test mailbox/account. Never relink a real employee simply to test this feature.
7. Confirm request/query/body logging redaction at every hosting, proxy, monitoring and error-reporting layer. The application never logs tokens, passwords or reset addresses, sets no-referrer/no-store, and removes the link query on hydration. However the initial URL necessarily reaches the server, mail provider and browser before JavaScript can scrub it. Disable link click-tracking and avoid analytics on recovery pages; redact `token_hash`, `password`, `confirmPassword`, cookies and authorization headers. Do not attach recovery URLs to tickets/screenshots.
8. Only after those checks, enable the exact server flag in the approved test/deployment environment. Enabling source alone does not verify delivery.

## Recovery and session guarantees

GET/page load does not consume the token, so ordinary email link scanners cannot reset a password. The browser keeps the token only in component memory, never rendered or placed in browser storage. Refreshing after URL cleanup requires reopening the email link. At submission the user enters and submits their own new password (12–128 characters, repeated identically). The server validates the one-time recovery token with Supabase, checks eligibility, and changes the password through an ephemeral server-side session. No recovery access/refresh token or normal session cookie is issued.

Before updating the password, a D1 transaction locks that subject and revokes app sessions. After successful update, another transaction advances the cutoff, revokes sessions again and unlocks. Normal session registration and validation use atomic cutoff/lock predicates and require both JWT issuance and the password-authentication event to be newer than the cutoff. A refreshed token cannot erase old authentication history. A same-second immediate sign-in can fail closed; wait a second and retry.

The endpoint explicitly asks Supabase to sign out globally using the recovered user's JWT (no service-role/admin credential). Provider 401/403/404 errors are not hidden. If global cleanup fails, the UI warns that cleanup was not confirmed; app cutoff/revocation still applies. Supabase access JWTs are not cryptographically revoked before expiry. Do not claim they are invalid everywhere; the app's session and cutoff checks enforce its own boundary.

A provider update failure or final D1 failure after initial lock leaves app sign-in locked for that subject. Request and successfully complete a fresh recovery link to clear it; if unavailable, an administrator must investigate through the approved support process. Do not delete cutoff history to get an old session working. A network failure can make the outcome uncertain; the UI deliberately does not promise that the password is unchanged. No automatic retry of the password mutation or automatic sign-in occurs.

## Local verification

Prerequisites: Node 22.13+ (validation used Node 24.19.0), the committed lockfile, and the existing project install/build workflow. `npm run install:ci` is the repository-supported clean install command. Do not copy an existing `.env`, runtime state or database from production into test fixtures.

Run from the extracted UFS-People directory:

```
node --test tests/*.test.mjs
node node_modules/typescript/bin/tsc --noEmit --incremental false
npm run build
node scripts/audit-public-assets.mjs
```

Focused synthetic suites: `tests/password-recovery.test.mjs` and `tests/password-recovery-ui.test.mjs`. They use local SQLite, real pinned Supabase SDK with a synthetic transport, and React/JSDOM. They never send an email or change a real password. These checks do not establish hosted behavior or pixel-level browser layout.

## Human acceptance checklist after authorized setup

- Pin the ZIP checksum and deployed version. Verify both new routes and the explicit disabled/setup state before enabling.
- Use the approved isolated test identity and real accessible mailbox. Have the human submit their own password; testers/bots must never receive a reusable recovery link, password or session token.
- Existing/unknown/inactive/disabled/former/demo/unbound accounts: same generic request result, no eligibility leakage or activation. Only eligible accounts receive a message.
- Open the email link, confirm exact destination and query cleanup; no request is sent merely by loading. Confirm password-manager/new-password autocomplete, mobile width, keyboard focus, duplicate clicks, Back/Forward and reload behavior.
- A valid link changes the password once. Expired/used/invalid links fail with a fresh-link path. Wrong type, duplicate token, fragment token, foreign host/origin and open-redirect inputs fail safely.
- After completion: fresh new-password sign-in works after the cutoff second; old password fails; pre-reset sessions, refresh tokens and in-flight old-password login cannot access app data. Check a second device. No automatic sign-in, role, binding, employee activation, scope or record change.
- Check request/completion throttling, cross-site POST rejection, provider/global-logout failure warning and locked partial-failure recovery.
- Record build/hash, account role/scope, steps, expected/actual, timestamp and redacted evidence. Do not mark hosted/email acceptance passed from a synthetic suite.

## Rollback

Disable the recovery flag first. Restore the previous application release if needed; preserve the additive cutoff table and records so old sessions are not re-enabled. If rolling back auth code that lacks cutoff checks, explicitly revoke affected provider sessions and assess exposure before releasing it. Restore the exact saved recovery template and remove only newly added redirect entries. Preserve existing allowlist entries, normal login settings, data, scopes and permissions. No automatic rollback/deployment is performed by this package.

## Official references checked

- https://supabase.com/docs/reference/javascript/auth-resetpasswordforemail
- https://supabase.com/docs/reference/javascript/auth-verifyotp
- https://supabase.com/docs/reference/javascript/auth-updateuser
- https://supabase.com/docs/reference/javascript/auth-signout
- https://supabase.com/docs/guides/auth/auth-email-templates
- https://supabase.com/docs/guides/auth/redirect-urls
- https://supabase.com/changelog/46599-changes-to-email-template-customisation-on-free-tier
