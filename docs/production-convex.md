# Production Convex sign-in

The production deployment is `basic-ostrich-538` (project ufs-crm):
- Convex address: https://basic-ostrich-538.convex.cloud
- Site address (public signing keys): https://basic-ostrich-538.convex.site
- Already done: backend code deployed, signing keys created, `SITE_URL` set, administrator invited.
- The development deployment (`resolute-wildebeest-477`) stays for testing only.

## Still needed from you (secrets, never in chat or Git)
Create a new App Password for the sending mailbox (Google Account, Security, 2-Step Verification, App passwords), then run in the backend folder:
```
npx convex env set SMTP_USER noreply@unitedffs.com --prod
npx convex env set SMTP_PASS "xxxx xxxx xxxx xxxx" --prod
```
A service mailbox such as Amazon SES is better than Gmail for production. Without these two settings no reset email can be sent.

## Switching the live site (one change, then redeploy)
1. In `cloudflare-deploy.json` set `UFS_CONVEX_URL` and `UFS_CONVEX_SITE_URL` to the production addresses above.
2. `npm run build`, `node scripts/cloudflare.mjs config`, `npx wrangler deploy --config dist/server/wrangler.deploy.json`.
3. Bind the administrator to the production sign-in (the person's Convex user id comes from `npx convex run invites:whoIs ... --prod`):
   insert an `employee_identities` row with issuer = the production site address and that subject for the existing administrator.
4. The administrator opens the site, chooses "Forgot your password?", and sets a password from the emailed code.
5. Remove the test accounts and sample data (`docs/test-data.md`) before adding real employees. Test passwords are not created on production.

Rollback: put the development addresses back and redeploy. Existing sessions end at the switch, so everyone signs in again.

## Status
Switched on 2026-10-22. The live site signs in through production Convex and the administrator set a password with the emailed code.
The six test accounts and the sample data belong to the old development sign-in, so those logins no longer work. Remove the sample data
(`docs/test-data.md`) before real employees are added.
The sending mailbox settings were copied from development: change the App Password (and delete the old one in the Google account) as soon as possible.

## Fake data removed (2026-10-22)
All sample and test records were deleted from the live database; only the real administrator remains. A backup of the database from just before
the wipe is on the Desktop in `ufs-db-backups`. The built-in demo people are now opt-in: they are only created when `UFS_DEMO_DATA=enabled`
(set by `npm run setup` for local development) and never in production.
