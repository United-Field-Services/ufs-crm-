# Same-site synthetic test accounts

> **Historical (superseded Oct 15–17, 2026):** sign-in is password-only and the authenticator code and its exceptions were removed. See password-only-sign-in.md. Sections about MFA, AAL2 and password-only exceptions below no longer describe the code.

Status: local implementation only. No migration, runtime flag, identity, account,
credential, employee, invitation, or publication is authorized by this document.
The existing Site and existing Supabase project remain the only targets.

## Isolation contract

An immutable server-owned `data_scope` separates `live` from `qa-bots-v1` on
23 business tables. Existing rows retain their values with a `live` default.
Every route scopes reads, aggregates, relationships, mutation guards and audits.
Schema triggers reject scope changes and cross-scope references. Production and
test users cannot see or change the other's records. Scope is not a browser
option, a name convention, or a role override.

Employee keeps self-service permissions; HR Manager administers synthetic records
only. HR cannot grant roles, add login identities, or change Site access. New
profiles created by test HR inherit the test scope and do not become login
accounts. Only two specifically approved Supabase subjects may enter this scope.

Test documents use `test/qa-bots-v1/documents/<owner>/<id>`. Both scope and object
keys are checked before and after storage reads. Photos are likewise constrained
to the test namespace. Company files, notices, calendars, budgets, workflow tasks,
assets, time entries, acknowledgements, reports and audit are scoped too. Imported
source settings/history summaries and the real headcount snapshot are never
returned to test users. Test charts use synthetic scoped data.

Imports stay closed (HTTP 410). External connector access rejects test users.
There are no workflow email/SMS/Slack senders in this release. Future outbound
features must use the same live-scope guard and add denial tests. Testers must use
fictional text and files; the app cannot guarantee that arbitrary free text or
uploads contain no sensitive material supplied by the tester.

## Provisioning, only after separate approval

1. Agree the exact two login email addresses. Real inbox provisioning and bot email
   access can remain deferred. Password login through an auto-confirmed provider
   account does not require sending an invitation.
2. The account owner creates the two users privately in Supabase Authentication →
   Users → Add user → Create new user, enters fresh passwords themselves and chooses
   Auto confirm. Do not collect, generate, transmit or save passwords in chat.
3. Read back each account's exact UUID, email, confirmation, deletion/ban status and
   provider. Only project `ycswaipyuonxwyalkits` is permitted. No other project,
   service-role key, provider setting, public signup or Google sign-in is needed.
4. Obtain action-time approval for these exact two UUID/email/role bindings and
   the following runtime changes. Keep them absent until approval:
   - `UFS_QA_TEST_ACCESS=enabled`
   - `UFS_QA_EMPLOYEE_SUB=<verified lower-case UUID>`
   - `UFS_QA_HR_MANAGER_SUB=<verified different lower-case UUID>`
   - `UFS_QA_BOOTSTRAP=approved`
   - `UFS_QA_EMPLOYEE_EMAIL=<verified lower-case email>`
   - `UFS_QA_HR_MANAGER_EMAIL=<verified different lower-case email>`
5. A genuine verified password login by either approved subject can then atomically
   create only the synthetic `QA HR Manager` and `QA Employee` profiles and their
   immutable identity bindings. Employee reports to the test HR Manager. Profile
   IDs are `qa-bots-v1:hr-manager` and `qa-bots-v1:employee`.
   Conflicting, disabled, inactive, changed-role, changed-email, changed-manager,
   changed-scope or rebound existing rows are never repaired or reactivated by
   sign-in. A final CHECK assertion inside the D1 batch rolls back all provisioning
   if either approved tuple is incomplete or wrong.
6. Normal HR Manager TOTP remains mandatory. The real administrators' temporary
   password-only exception does not cover test accounts. The two real production
   subjects remain separately approved; QA subjects never inherit live access.
7. Verify real sign-in, HR authenticator, both roles' workflows, denied live IDs,
   logout/refresh and revocation. Synthetic route tests do not establish these
   hosted checks. Remove `UFS_QA_BOOTSTRAP` after successful provisioning readback.

The audience must remain unchanged without separate approval. Production Site
sharing/standalone-access approval is independent of this local code work.

## Deployment and stopping

The two generated migrations are schema-only. The first adds scope columns,
scoped uniqueness and immutable/relation triggers; the second adds a value-only
transaction assertion singleton. Neither seeds profiles or grants access. Review
and approve migration/publication before applying them. Do not merge the original
checkout's unfinished custom-email migrations into this branch.

Disable `UFS_QA_TEST_ACCESS` to deny test sessions on their next authorization
check. Do not delete profile data, drop scope columns or weaken production guards
as a rollback shortcut. Auth cookies remain genuine Supabase sessions with the
existing server checks and limits.

## Verification

Run all tests, TypeScript, production build, asset audit and applicable lint.
Boundary tests exercise every scoped table, foreign ID/reference, upsert and
storage denial, both directions, race conditions and mixed concurrent requests.
The QA route-test harness injects an explicitly synthetic authenticated principal
only in the test loader. Production source has no such path. Separate provider
integration tests use the real pinned SDK and locally signed JWTs with a denied-by-
default synthetic transport. No provider account, token, email or credential is
created in a live service by those tests.

### Local verification completed 2026-10-12

- Full regression: 1,639/1,639 tests passed, no skipped tests.
- Independent suites: 69 boundary/migration checks and 61 provisioning checks.
- TypeScript, production Sites build, private-asset audit (21 assets/54 modules),
  changed backend/test lint and whitespace checks passed.
- Workspace UI ESLint still reports the same 19 errors and 14 warnings as the
  unchanged deployed baseline, verified by running both versions. No new rule
  violations were introduced. They are existing typing/hooks/style issues.
- Hosted migration, real browser sign-in/MFA and live role acceptance are not
  verified by these local results.

## Migration integration order

This isolated test-scope release owns its newly generated 0009 and 0010 migrations.
The original checkout has separate, unpublished custom-email work that currently
uses the same sequence numbers. Those files are different migration histories and
must never be copied together or applied interchangeably.

Preserve this test-scope release as-is. After it is actually published and its
migration readback is verified, rebase the email implementation onto the resulting
source/schema baseline, regenerate its pending migrations with Drizzle, and review
the resulting additive SQL and metadata. Do not rename or rewrite any migration
already applied to the deployed database. Do not publish email work or perform
production writes as part of this integration preparation.

### Approved temporary QA HR authenticator exception

A separate explicit approval on 2026-10-12 permits password-only access for the
exact QA HR account `hrtest@unitedffs.com`, subject
`1ce902e2-5c60-40fd-96b3-1ae14478f5e7`, until
`2026-10-13T01:35:00.000Z` (October 12 at 6:35 p.m. Pacific).
The runtime key is `UFS_QA_MFA_TEST_UNTIL`; the source pins the exact subject and
maximum approved deadline. A missing, malformed, expired, too-early or extended
value fails closed. This applies only to that approved HR Manager in `qa-bots-v1`
under standalone authentication. It does not transfer to another subject, scope
or role. Password proof, verified provider identity, live session/revocation,
immutable binding, current eligibility and all data-scope guards remain required.
Existing authenticator factors are preserved. At expiry, normal HR Manager
verification resumes on the next authorization check, including existing cookies.

### Ongoing QA HR password-only approval, October 13, 2026

The owner subsequently approved password-only sign-in for this same QA HR account
until they ask to re-enable the authenticator. The separate server-only setting
`UFS_QA_HR_MFA=disabled` implements that approval without changing either historic
exception deadline. It applies only to the exact verified subject above, immutable
profile `qa-bots-v1:hr-manager`, email `hrtest@unitedffs.com`, `hr_manager` role and
`qa-bots-v1` data scope. The existing QA access configuration, active non-demo
profile, null legacy identity and every password/session/binding check remain
mandatory. Missing or malformed settings fail closed. Removing this setting and
deploying restores the normal MFA requirement on the next authorization check.

No expiry is scheduled for this separate approval. It neither removes enrolled
factors nor changes a password, the Supabase provider, roles, scope, Site audience,
or any other account. In particular, Art and Lilit retain their existing MFA
requirements; their expired pilot exception is not renewed by this setting.
