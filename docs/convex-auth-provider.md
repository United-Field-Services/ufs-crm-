# Convex Auth sign-in provider (optional)

Status: implemented and covered by synthetic tests; live-tested only on a development deployment. **Supabase stays the default.**
The Convex provider is switched on with `UFS_AUTH_PROVIDER=convex`; with that setting unset, nothing here is used.
Convex Auth is a beta library: have the project owner review this before it serves real employees.

The backend lives outside this repository (`auth-convex`) and holds only sign-in accounts.

## Settings
| Name | Meaning |
|---|---|
| `UFS_AUTH_PROVIDER=convex` | Use Convex instead of Supabase |
| `UFS_AUTH_MODE=standalone` (or `pilot`) | Same switch as before: sign-in on |
| `UFS_CONVEX_URL` | `https://<deployment>.convex.cloud` |
| `UFS_CONVEX_SITE_URL` | `https://<deployment>.convex.site` (same deployment; no other host is accepted) |
| `UFS_CONVEX_OWNER_SUB`, `UFS_CONVEX_OWNER_EMPLOYEE_ID` | Optional one-time binding of the first administrator (Convex user id and existing admin employee id) |
| `UFS_PASSWORD_RECOVERY=enabled` | Turns password reset on (off by default, as for Supabase) |

## How it works
1. Sign-in: the browser posts email and password to `/api/auth/login` as before. The server signs in through Convex's HTTP API, verifies the
   returned RS256 token against the deployment's published keys (issuer, audience, expiry, algorithm pinned), and stores the tokens in the same
   Secure, HttpOnly, SameSite=Strict `__Host-` cookies. No token reaches JavaScript, localStorage or the database; only a one-way fingerprint is kept for logout.
2. Access: unchanged. A person needs an approved row in `employee_identities` (issuer = the Convex site URL, subject = the Convex user id) for a current, eligible
   employee. Unbound, disabled, inactive, demo, former and test-scope accounts are refused. Roles still come only from the database.
3. Sessions: the app's own session ledger (12-hour limit, 30-minute idle limit, instant revocation on logout and reset) works exactly as for Supabase.
4. Refresh and logout use Convex's refresh tokens. Logout revokes the app session first and works even when Convex is unreachable.
5. Password reset: the visitor asks for a code on `/forgot-password`, Convex emails an 8-digit code (through an SMTP mailbox), and the visitor enters the code and a new
   password (12 to 72 characters) on the same page or `/reset-password`. The answer never reveals whether an address has an account. A correct code sets
   the password, ends every Convex session, and the server then revokes every app session, advances the reset cutoff (the same `auth_password_resets`
   table the Supabase flow uses) and ends the one session the reset created, so the person must sign in again. A wrong code changes nothing and cannot lock anyone out.

## Differences from the Supabase flow
- The reset uses an emailed code instead of an emailed link, so no link needs to be allow-listed anywhere.
- The Supabase public-pilot limits and the isolated test-account scope do not apply to Convex sign-in.
- Accounts are invite-only and created without a usable password; people choose their own through the reset flow.

## Before real use
- A proper sending mailbox: a Gmail App Password is for testing only; production should use a service mailbox such as Amazon SES SMTP credentials on a verified domain.
- Review of the Convex deployment (project owner), the 15-minute token and 12-hour session settings, and rate limits.
- Profile email and Convex sign-in email must match for reset to find the employee.
- Provider failures: Convex outage returns "temporarily unavailable"; existing signed-in requests keep working until their 15-minute token expires.

## Rollback
Unset `UFS_AUTH_PROVIDER` (and the Convex settings). Nothing else changes. App sessions created through Convex stop working immediately.
