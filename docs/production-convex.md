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
