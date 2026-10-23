# Moving UFS People to Supabase (database, sign-in and files)

Branch: `supabase-migration`. The live site keeps running on Cloudflare D1 + Convex until you switch it over; nothing below changes it by itself.
Project: `ycswaipyuonxwyalkits` (https://ycswaipyuonxwyalkits.supabase.co). The app still runs on Cloudflare Workers; only where the data lives changes.

## What moves where
| Part | Now | After the move |
|---|---|---|
| Database | Cloudflare D1 (SQLite) | Supabase Postgres, private schema `ufs` |
| Sign-in | Convex Auth | Supabase Auth (the reviewed flow already in the app) |
| Files | Database chunks (no R2) | Supabase Storage, private bucket `ufs-files` |
| Email | Convex relay | Supabase Edge Function `send-mail` (your SMTP mailbox) |

## How the database move works (and why no database password is needed)
The app's queries were written for SQLite. `lib/pg-dialect.ts` rewrites each one for Postgres on the way out, and `supabase/executor.sql`
installs one function, `ufs_batch`, that runs a list of statements as a single transaction over Supabase's normal HTTPS API.
Tests prove that all 410 distinct statements the app issues run on Postgres, that failed batches roll back completely, that `changes()`
behaves, and that the main pages' server code works end to end on Postgres.

## Security design (read this)
- Tables live in the private `ufs` schema, which Supabase does not expose, with **row-level security on and no policies**, and all access revoked from `anon`/`authenticated`.
- The executor can be called **only by the service role**. The publishable key alone gets nothing (`node scripts/supabase-setup.mjs check` proves it against the real project).
- The **service key is a master key** to the whole project. Keep it only as the Worker secret `UFS_SUPABASE_SERVICE_KEY` (and in your own terminal when running the setup helper). Never paste it into a chat, a file in Git, or a screenshot. If it has been shared anywhere, rotate it in Project Settings, API.
- Files have no public link; every download goes through the app's permission checks.
- The email function only sends to addresses of active employees and only for requests carrying the service key.

## Steps (in order)
1. **Rotate the service key if it was shared in a chat** (Supabase dashboard, Project Settings, API).
2. **Create the database objects.** In the Supabase dashboard open SQL Editor and run, in this order: `supabase/schema.sql`, `supabase/executor.sql`, `supabase/storage.sql`.
   (If you have the Supabase connector authorised in Claude Code, ask Claude to apply them and review the result first.)
3. **Check the project's sign-in settings** (the boss's reviewed setup, `docs/password-reset-setup-and-testing.md`):
   - Authentication, URL Configuration: add the exact redirect `https://ufs-people.unitedffs.workers.dev/reset-password` (no wildcards).
   - Authentication, Email Templates, Reset password: link must be `{{ .RedirectTo }}?token_hash={{ .TokenHash }}`.
   - Custom SMTP (the default sender is limited to a few emails an hour).
   - The session-check function from `docs/supabase-session-check.sql` must exist (it likely does).
4. **Deploy the email function** (needs the Supabase CLI, `npm i -g supabase`, `supabase login`):
   `supabase functions deploy send-mail --no-verify-jwt --project-ref ycswaipyuonxwyalkits`
   `supabase secrets set SMTP_USER=noreply@unitedffs.com SMTP_PASS="app password" --project-ref ycswaipyuonxwyalkits`
5. **Copy the existing data** (this reads the live D1; it deletes nothing): `node scripts/cloudflare.mjs config`, then `node scripts/migrate-d1-data.mjs`.
   Run the resulting `supabase/data.sql` in the SQL editor, then delete the file (it holds real HR data).
6. **Check everything and create the first administrator's sign-in** (PowerShell, in your own terminal):
   ```
   $env:UFS_SUPABASE_SERVICE_KEY = Read-Host "Service key"
   $env:UFS_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_..."
   node scripts/supabase-setup.mjs check
   node scripts/supabase-setup.mjs first-admin --email venakat@unitedffs.com
   ```
7. **Switch the site over.** Copy `cloudflare-deploy.supabase.example.json` to `cloudflare-deploy.json` and fill it in. Store the secret yourself (it prompts, nothing is echoed):
   `npx wrangler secret put UFS_SUPABASE_SERVICE_KEY --name ufs-people`
   Then `npm run build`, `node scripts/cloudflare.mjs config`, `npx wrangler deploy --config dist/server/wrangler.deploy.json`.
8. Open the site, choose **Forgot your password?** with the administrator's email, and set a password.
   Check: sign in, People, request time off, upload a file, bell notifications, invite a test person.

## Rollback
Put the previous `cloudflare-deploy.json` (D1 + Convex) back and redeploy. D1 and Convex are untouched by all of the above, so the old site comes straight back.
Anything created on Supabase after the switch would have to be copied back by hand, so decide quickly after the switch.

## Speed
Every page makes several database calls. Pick a Cloudflare placement near the Supabase project's region (`"placement": {"region": "aws:us-east-1"}` for a US-East project)
and, if you can, a project in the region most staff use. Moving the Supabase project region later means copying the data again.
