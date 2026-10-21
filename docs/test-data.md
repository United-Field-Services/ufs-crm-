# Test accounts and sample data

Added to the live site on 2026-10-21 for hands-on testing. Everything is tagged: ids start with `test-` and emails end with `@ufs-test.example`.

| Role | Account |
|---|---|
| Administrator | test.admin@ufs-test.example |
| HR manager | test.hr@ufs-test.example |
| Manager | test.manager@ufs-test.example |
| Hiring manager | test.hiring@ufs-test.example |
| Employee | test.employee@ufs-test.example, test.employee2@ufs-test.example |

Passwords are only in the git-ignored files `test-accounts.local.json` and `TEST-ACCOUNTS.local.md`.

Data: 36 people in six teams with a manager hierarchy (four team leads and 26 staff without sign-ins, plus the six accounts), about 116 leave
requests (approved, pending and rejected, past and upcoming), 15 tasks, 8 events and holidays, 5 announcements, 12 equipment items and 140 timesheet days.

## Commands (project root)
- Create the six sign-ins in Convex (passwords set directly, no email); `CONVEX_DIR` is a backend folder where `npx convex` is logged in:
  `CONVEX_DIR=../UFS-People-auth-convex node scripts/seed-test-data.mjs accounts`
- Load the data (safe to repeat): `node scripts/seed-test-data.mjs sql`, then
  `npx wrangler d1 execute DB --remote --config dist/server/wrangler.deploy.json --file .wrangler/test-data.sql`
- Remove the data: `node scripts/seed-test-data.mjs cleanup`, then the same `d1 execute` with `--file .wrangler/test-data-cleanup.sql`
- Remove each Convex sign-in: `npx convex run invites:remove '{"email":"test.hr@ufs-test.example"}'` (run in the backend folder)

Remove all of it before real employees are added, and never use `invites:addWithPassword` for real people.
