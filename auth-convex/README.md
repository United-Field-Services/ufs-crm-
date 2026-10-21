# UFS People sign-in backend (Convex Auth)

An alternative sign-in provider for UFS People. It stores sign-in accounts (email + password) and sends
password-reset codes by email through an SMTP mailbox (Gmail with an App Password works). It holds **no HR data**: employees, roles, leave and files stay in
UFS People's own database. The app trusts a person only if this backend signed their token **and** the app has an
approved binding from that person's Convex user id to an eligible employee.

Status: development deployment only (`dev:resolute-wildebeest-477`, project `ufs-crm`). Convex Auth is a beta library;
get your boss's review before it serves real employees.

## What is here
| File | Purpose |
|---|---|
| `convex/auth.ts` | Password sign-in, 12 to 72 character passwords, 15-minute tokens, 12-hour sessions, 30-minute idle limit, emailed reset code, invite-only account creation |
| `convex/EmailOTPPasswordReset.ts` | Creates the 8-digit reset code (valid 20 minutes, one use) |
| `convex/mailSmtp.ts` | Sends the message through your SMTP account (Node runtime, internal only) |
| `convex/invites.ts` | Admin-only commands: add, look up and remove an invited person |
| `convex/sessions.ts` | `endAllMine` and `whoami` (callable only with a valid token) |
| `convex/http.ts` | Publishes the public signing keys at `/.well-known/jwks.json` |
| `scripts/setup-keys.mjs` | One-time: creates the token signing keys and stores them on the deployment (never printed) |

## Settings stored on the Convex deployment (never in source)
`JWT_PRIVATE_KEY`, `JWKS` (created by `scripts/setup-keys.mjs`), `SITE_URL`, and the SMTP settings you add yourself, on your own computer, never in chat or source:
```
cd auth-convex
npx convex env set SMTP_USER you@gmail.com
npx convex env set SMTP_PASS "xxxx xxxx xxxx xxxx"     # a Gmail App Password (spaces are ignored)
```
Optional: `SMTP_HOST` (default `smtp.gmail.com`), `SMTP_PORT` (default `465`; `587` uses STARTTLS), `SMTP_FROM` (default `UFS People <SMTP_USER>`).

Gmail needs 2-Step Verification on, then an App Password from your Google account's Security page. Gmail sends from your own address and has a daily sending limit, which is fine for testing. For production use a service mailbox such as Amazon SES SMTP credentials.

## Everyday commands (run in this folder; you are logged in with `npx convex login`)
```
npx convex run invites:add    '{"email":"name@example.com"}'   # invite + create the account (no usable password yet)
npx convex run invites:whoIs  '{"email":"name@example.com"}'   # the Convex user id (the app's "subject")
npx convex run invites:list
npx convex run invites:remove '{"email":"name@example.com"}'   # delete invite, account and sessions
npx convex dev --once                                          # push code changes
```
Nobody sets a password for someone else. After `invites:add`, the person opens UFS People, chooses "Forgot your
password?", receives a code by email and picks their own password.

## Safety notes
- Sign-up is closed: an address that is not invited cannot create an account, even by calling Convex directly.
- Wrong password, unknown address and locked account give the app the same answer; Convex's own messages never reach visitors.
- Convex limits failed sign-in and code attempts per account (10 per hour); the app adds its own limits.
- Rotate the keys by deleting `JWT_PRIVATE_KEY` and `JWKS` (`npx convex env remove ...`), running `node scripts/setup-keys.mjs`
  again. Everyone is signed out.
