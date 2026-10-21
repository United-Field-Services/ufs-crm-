# Deploying to Cloudflare Workers

Prerequisites: a Cloudflare account, `npx wrangler login`, and a production Convex deployment (`auth-convex/README.md`).

1. Create storage (once):
   `npx wrangler d1 create ufs-people-db` and `npx wrangler r2 bucket create ufs-people-files`
2. Copy `cloudflare-deploy.example.json` to `cloudflare-deploy.json` (git-ignored) and fill in the D1 id and the Convex addresses.
3. `npm run build`, then `node scripts/cloudflare.mjs config`.
4. Create the tables: `npx wrangler d1 migrations apply DB --remote --config dist/server/wrangler.deploy.json`
5. Invite the first administrator in Convex (`invites:add`, then `invites:whoIs` for the user id), then
   `node scripts/cloudflare.mjs admin-sql --email <e> --name "<n>" --issuer <UFS_CONVEX_SITE_URL> --subject <user id>` and run the
   `wrangler d1 execute DB --remote --config dist/server/wrangler.deploy.json --file .wrangler/first-admin.sql` command it prints in the file header.
6. `npx wrangler deploy --config dist/server/wrangler.deploy.json`
7. The administrator opens the site, chooses "Forgot your password?", and sets a password with the emailed code.

Security: `UFS_SELF_HOSTED=true` is set by step 3. It makes the worker discard `oai-authenticated-user-*` headers, which only OpenAI Sites may set.
Never deploy publicly without it. SMTP and token-signing secrets live on the Convex deployment, not in Cloudflare.
