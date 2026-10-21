# UFS People — private review

A purpose-built HR workspace for United Field Services. Hosted by Sites with individual ChatGPT-backed identity, server-side role checks, D1 records, and private R2 documents. This is a review build, not a production HR system or a complete TalentHR replacement.

## Quick start (local)

Needs Node 22.13 or newer.

```sh
npm run setup   # installs dependencies, creates .env, creates the local database
npm run dev     # http://localhost:5173, signed in as the fake owner with fictional demo data
```

`npm run setup -- --reset` wipes local data and starts over. Password reset is off by default and is described in [docs/password-reset-setup-and-testing.md](docs/password-reset-setup-and-testing.md); an optional Convex Auth sign-in provider is described in [docs/convex-auth-provider.md](docs/convex-auth-provider.md); real sign-in and email need hosted services and are not part of local setup.

## Repository layout

- The app (this folder): Next.js on Cloudflare Workers with D1 and R2.
- [auth-convex/](auth-convex/README.md): optional Convex Auth sign-in backend (its own dependencies and checks; run `npm install` inside it).

## Included

- Overview dashboard with pending approvals, employee counts, personal leave balance, tasks and upcoming events.
- Searchable employee directory with departments, divisions/locations, hire dates, and employment type.
- Administrator, HR Manager, and employee permissions; manager-assigned review access; admin-only role, manager and activate/deactivate controls. Admin-created employee profiles. A verified sign-in can bind to its pre-registered email exactly once; records thereafter use the Site-scoped stable user ID.
- Vacation, Sick Leave, WFH and Bereavement; configured defaults 15, 5, 30 and 3 days. Per-employee/per-calendar-year overrides with audit trail.
- Full-day, half-day and single-date hourly leave; weekday calculation, configured-location holiday exclusion, pending cancellation, required-manager approval/rejection, atomic balance enforcement and overlap prevention. No self-approval. Reassigning a manager reroutes pending requests atomically.
- Shared month/list calendar. Colleagues see approved absence dates, never private notes or medical reasons.
- Persistent private uploads and authorized downloads. PDF, DOCX, JPG, PNG, TXT; 10 MB per file, 100 active uploads per owner in review. Admins and HR Managers may publish company files. Employees can link their own private document to a leave request; only its assigned approver, employee and HR can download it. Downloads are attachments and never public object URLs.
- Assigned tasks, due dates, completion, and recent change history.
- Responsive layout and keyboard-accessible forms and controls.

## Access and review data

New publication is owner-only. No employee invitations or wider sharing were performed. Each future employee needs an individual ChatGPT account, an admin-created employee profile, and separately authorized Site access. Available sharing options must be verified in Sites before any change.

The server runtime setting `UFS_OWNER_EMAIL` identifies the verified Site owner's account for initial admin binding. It is set in Sites and is not committed in source. The owner's authenticated identity is used for their account. All example employees, requests, tasks and events are explicitly fictional and use example.invalid addresses. No real TalentHR employee records, balances, medical information or documents were migrated.

## Important gaps before production

- Approval requires the single assigned manager. Multiple required approvers are not implemented. The owner must assign another active employee as their manager before their own requests can be reviewed. HR Managers can view all employee records, while only the owner/admin can change roles or activation.
- No invitation delivery, custom-password auth, email/SMS notifications, or automated external access revocation. Site-sharing invitations remain a separate explicit step.
- Upload a private file in Documents first, then select it when requesting leave. Inline upload in the leave form and attachment replacement after submission are not implemented.
- Actual company holiday dates and employee-specific balances have not been imported. An 8-hour workday is a stated assumption requiring confirmation.
- No accrual, carryover, payslips/payroll, time clock, recruitment, performance, benefits, external integrations, org-chart editing or full onboarding/offboarding template automation.
- Upload extension/content signatures are checked, but there is no malware scanner. DOCX verification checks the ZIP signature, not every archive member. Use trusted test files only.
- Security/privacy, data retention, backups/restoration, operational monitoring, legal requirements and accessibility need a production review. Do not upload real HR or medical records before that review and explicit migration approval. A deactivated account loses all app/API access even if its Site visitor grant remains.

## Verification

Run `node --test tests/*.test.mjs` for backend integration/security tests. These execute the application route code against SQLite-backed D1 and R2 mocks. Coverage includes unauthorized requests, role and owner isolation, no self-escalation, identity binding, private file reads, invalid MIME/signature and size rejection, streaming request limits, concurrent upload quotas, atomic approval/overlap constraints, and per-year budgets.

Run `npx tsc --noEmit` and the Sites build helper for static and production-build checks. Hosted platform authentication and two distinct real employee accounts require an end-to-end acceptance test after authorized sharing; local mocks do not prove that platform boundary.

## Storage and source

Schema migrations are under drizzle/. Keep applied migrations immutable. Use the Sites workflow helper to publish exact source commits. Local preview uses the starter's synthetic sign-in only; its identity and database are not deployed. No runtime secrets, local databases, cookies or credentials belong in source or deployment archives.

## Dashboard redesign (October 11, 2026)

The workspace now uses a labelled blue sidebar, a dashboard-first layout, interactive workforce charts, an aggregate Reports page with CSV download, and an organization view grouped by department or configured approval route. Task starting points prefill an ordinary task for review, assignment, and saving; they do not run automated onboarding or offboarding.

The administrator dashboard's 26-employee number is explicitly the TalentHR snapshot verified on October 11, 2026, not a live integration or imported employee count. All charts, reports, directory counts, and organization groups use current UFS People records. Charts disclose the inclusion of fictional demo profiles and offer a non-demo filter. No historical workforce, turnover, birthday, or reporting hierarchy data was fabricated. The organization view's approval routes describe leave approvers, not verified management reporting lines.

Aggregate CSV downloads include the scope, date, and data-source caveat, and protect spreadsheet-formula text. They do not export personal request notes, private documents, account IDs, or raw state. No server authorization rules, migrations, invitations, or Site audience changed in this redesign.

## Comprehensive TalentHR review expansion (October 11, 2026)

The mobile Home layout now follows the supplied TalentHR reference: compact white header/navigation, search, Reports first, blue tab underline/chart, and Today/Tomorrow time-off cards. The initial administrator headcount chart is a read-only aggregate snapshot verified directly from TalentHR's report on October 11, 2026: Oct 2025–Oct 2026 = 19,19,19,19,19,21,25,24,24,25,25,26,26. Its caption and CSV explicitly identify the source/date and lack of synchronization. Switching to a breakdown/filter uses current UFS People records; no employee records or private values were imported. Full report keeps the current source, chart dimension and filters.

### Employee profiles and privacy

Each profile now has Overview, Personal, Contact, Emergency, Job, Education, Compensation, Benefits, Identifiers and History sections. Private tables store DOB, legal/preferred names, personal contact details, main/secondary addresses, multiple emergency contacts, education, job metadata, dated salary and bonus records, benefit enrollment, and limited identifier metadata. Employee and HR may read private profile records; employees edit their personal/contact/emergency/education metadata, while HR edits employment, pay and benefits. Manager status does not confer access to another person's private profile. Only the administrator may change an approver. Directory responses select public columns explicitly and exclude DOB, personal email/phone/address, emergency contacts, identifiers and pay. Optional directory work phone requires an explicit public flag.

Full Social Security, passport, license, tax and bank account numbers are not supported by the profile API. Dedicated identifier forms accept type/country/status/expiry and optional four-character suffix only. This is not an encrypted identifier vault, a compliance certification, or permission to use real HR records. The review remains synthetic until security/privacy and migration approval. Free-text fields and uploads cannot guarantee prevention of users entering sensitive content, so no such blanket claim is made.

Job changes append a dated snapshot and take effect immediately; future-dated job changes are rejected. Salary/bonus history is append-only. Job hours/schedule are informational in this version: leave calculations retain the explicitly stated Monday–Friday/eight-hour-day assumption. Account roles and Site grants remain separate from employment status. As of the pre-public security hardening, setting employment status to Inactive or Terminated atomically disables app login; rehire does not reactivate it. Site grants are not changed automatically.

### Workflow modules

- Onboarding/offboarding templates with editable steps, employee/manager/HR assignees and relative due dates. Manually starting a checklist atomically creates assigned Tasks and a progress-tracked run. Starter subjects reflect the source workflow without uploading identifiers, opening accounts or sending messages. No automatic triggers, reminder delivery, blocking stages, membership provisioning or external effects.
- Asset inventory with unique tags, serial/category, employee assignment, expected return, return workflow, maintenance/retired status and assignment audit. Employees only see their assigned assets.
- Manual timesheets with personal draft/edit/cancel, daily 24-hour bounds, assigned-manager submit/approve/return and privacy. Managers only see entries actually submitted to them, including historical approval/return; private revised drafts do not leak. No payroll, overtime calculation, live timer, screenshots or location tracking.
- Internal company announcements with HR drafts/publishing, pinning and read acknowledgements. No external delivery.
- Employee file ownership selection for HR uploads, organizational folders, rename/expiry/pinning metadata, archive, company read acknowledgements and existing protected downloads. Folder names do not widen access. Read acknowledgements are not electronic signatures. No automated expiry emails, signing or malware scanner.
- People List/Directory/Org views with search and location/division/department filters, My profile navigation and corresponding calendar filters.

The user-facing Settings coverage matrix distinguishes implemented, limited and deferred areas. Hiring is accessible but empty in the source; performance/surveys and source time tracking are upgrade-gated. Recruiting, memberships, custom field/permission designers, advanced leave accrual/carryover, multiple approval stages, integrations and production operations remain deferred. Existing fixed leave budgets are conservatively enforced; the source's configurable allow-exceed behavior is not reproduced.

### Expanded verification

Run `node --test tests/*.test.mjs`. Added suites execute profile, operations and file endpoints with synthetic identities and SQLite-backed Worker adapters, covering private-field isolation, self/HR/manager permissions, forged IDs, metadata-only identifier validation, value-free private audit, manager rerouting, templates/assets/timesheets and document metadata. These are real route/source tests with simulated D1/R2/auth, not proof of hosted edge authentication or real-account behavior. TypeScript and the production build must also pass. Browser QA may be limited by the execution environment and requires a separately verified reachable authenticated browser session; do not infer visual verification from source checks.

### Explicit five-role access model

Roles are Super admin (`admin`), HR (`hr_manager`), Manager (`manager`), Hiring manager (`hiring_manager`) and Employee (`employee`). Only the super admin assigns roles/activation/approvers. HR administers personnel records and HR workflow modules without security administration. Managers need both an eligible role and exact record assignment to review team leave/time and linked leave files; no colleague DOB, home contacts, emergency contacts, identifiers, salary or benefits. An employee or hiring manager cannot gain that scope from a stale manager assignment. Hiring managers remain self-service/company-only until a separately implemented recruiting module exists; they never inherit HR permissions. The app cannot grant another super admin or change Site sharing.

HR-confidential documents add a distinct server-enforced `hr` visibility scope. Subject ownership and manager assignment do not grant access to these files. Personal and company visibility remain separate. Folder names remain organizational; they do not silently change access.

## October 11 rollout verification and migration boundaries

Earlier sections describe staged milestones and their then-current data scope. The latest application supports separate current and former directory views, source-labelled ordinary employment history, and private stored profile photos. Transfer totals shown in Settings come from completed one-time migration ledgers, not assumptions or live synchronization. Current staff awaiting login activation remain in current headcount; former staff do not inflate it. Login activation and employment lifecycle remain separate.

The 26-profile QA fixture uses synthetic names, contacts, job values and identities. It preserves only blank-field coverage, categorical grouping and source reporting shape. Every fixture is exercised under all five roles, including cross-profile denials, self-service workflows and inactive-account rejection. No real employee account was activated or impersonated by these tests.

Write authorization is rechecked when mutations commit. Mutations and their audit/history records use atomic D1 batches. Deep regression tests include revocation races, stale manager/asset states, duplicate records, storage failure rollback, private-field/document/photo access, blank imported job fields and safe structured validation. Full workspace rendering and actual React DOM-event tests complement backend tests. Hosted sign-in, real employee acceptance, browser/device pixel QA and production operational readiness remain distinct checks; automated passes do not establish that every possible error is absent.

Photos are JPEG/PNG objects in private R2 storage, served only by an authenticated authorization-checking route. Current directory photos are available to signed-in active staff; former employee photos are HR-only. Placeholders remain when the source has no photo. Source photo bytes and private migration payloads never belong in this repository or deployment assets.

Temporary migration routes must be pinned to approved snapshots, executed only through the documented owner-private service boundary, reconciled with native database/storage readback, then replaced by closed HTTP 410 routes. No source system edits, invitations, employee activation, access sharing, notifications or external account actions are part of these transfers. Private personal/medical details, identifiers, compensation/payroll, documents and individual leave records remain outside the approved ordinary-history/photo transfer.

### Completed ordinary-history and photo transfer

Native database reconciliation confirms 45 source profiles: 26 current and 19 former, with 188 ordinary employment-history entries (100 current and 88 former). All former accounts remain disabled and unbound. The 32 previously existing employee rows and the 26 previously imported profile/link rows were preserved field-for-field.

The photo importer validated and stored 22 source photos (12 current and 10 former); the other 23 profiles retain placeholders. Native database readback confirms all 22 photo hashes, sizes, MIME types and source mappings plus the completed ledger. Independent post-storage R2 byte readback remains unverified because the read-only verification command was canceled before reaching the Worker. This does not establish successful browser rendering of each stored image.

The full application regression run passed 944 tests before the temporary routes were closed; closure regressions, TypeScript and the production build are checked again for the closeout publication. Tests simulate application identities and do not sign into employees' personal ChatGPT accounts.

## Pre-public security hardening (October 11, 2026)

Publication remains owner-private, with the existing Sites sign-in. No standalone provider, public audience, employee activation, credential configuration or external access grants are part of this change.

- Historical aggregate data and its source URL now live in a server-only module and are returned only in an authenticated HR/super-admin state response. Client components receive authorized data rather than embedding counts. The private source repository retains this ordinary aggregate; D1 persistence is an optional architectural refinement.
- Every live application API rejects anonymous, unknown, inactive, demo and former accounts. Eligibility is rechecked at protected read/write boundaries, including after private file/photo storage awaits. Prior one-time imports return HTTP 410 without connected database or storage handlers.
- HR may offboard ordinary employees. Inactive/Terminated employment edits and account deactivation commit together with history/audit, or all roll back. Self/super-admin lockout is blocked. Rehire edits do not re-enable login; a super admin must explicitly activate an eligible account. An imported former source flag remains a conservative block until a separately reviewed source-rehire reconciliation exists.
- Initial owner bootstrap only runs while no administrator record exists. It cannot create a second administrator or restore a disabled one merely because a runtime owner address matches.
- Files remain private R2 objects accessed through checked routes with no-store, attachment/sandbox, nosniff and same-origin resource headers. Photos remain checked same-origin JPEG/PNG routes. No public bucket URLs or photo bytes are placed in static assets.
- The upload form expressly excludes protected health information (PHI), payment-card data and full identity/account numbers. This is a scope warning, not a malware/content scanner or compliance certification. Ordinary sick-day dates/categories alone are not asserted to be PHI.

`node scripts/audit-public-assets.mjs` is a release gate after building. It checks client dependency graphs and all emitted client/static assets for the known private server modules, source URLs, report literals, database/auth markers and accidental debug/storage files. It is a targeted regression check, not comprehensive DLP or a penetration test.

Before any broader publication: confirm supported standalone identity hosting; use verified-email enrollment tied to preregistered active employees and stable provider subjects; disable open registration and client-chosen roles; test session expiry/revocation, reset/invitation flows, CSRF and abuse limits; retain no-store and per-operation authorization. Verify real distinct employee/HR/admin accounts and anonymous direct API/file/photo requests at the hosted boundary. Review backups/restoration, retention, operational monitoring, upload scanning and jurisdiction-specific privacy requirements. Do not claim public readiness or regulatory compliance from mocked route tests alone.


### Isolated test accounts on the same Site (local preparation)

The disabled-by-default QA path separates synthetic test records from live records
at every server query, mutation, relationship and storage read. Scope is immutable
server metadata; clients cannot choose it. The two explicitly approved test
subjects retain Employee and HR Manager permissions only within the test group.
New profiles created there inherit the restriction and do not gain login accounts.
No test identity, profile, credential, runtime configuration or publication has
been created by this code preparation. See [the rollout and verification plan](docs/test-account-isolation.md).

## October 12 retest follow-up

The saved retest follow-up separates current/former employment from login activation in People and profiles. HR has independent employment-group and login-access filters. A rehire can remain a current employee with login disabled; this UI change never activates an account.

HR and super-admin Files views show aggregate read acknowledgement counts for company documents. Other roles receive no aggregate count, retain their own Mark read action, and cannot manage or archive company files through ownership. Reader, document and owner scope checks preserve the existing live/QA boundary. No reader-identity list or signing feature was added.

Current Locations, Divisions, Departments and Headcount chart selections open the exact filtered People set, including the manager report's assigned-team scope and the selected demo/non-demo group. Historical snapshot bars continue to show recorded details only; no historical employee roster is fabricated. The company-files card counts and opens company files. Time-off headings and personal balance tiles navigate to the existing time-off screen. UFS People is used for product coverage headings; accurate source provenance remains.

Balance selection preserves the requested year after load failures and offers Retry without displaying another year's cards. The existing one-refresh authentication flow is unchanged. A final state response of 401 or 403 clears protected workspace data and prompts reauthentication; only the selected year, never profile or permission data, can be carried through session storage to a subsequent sign-in. HTTP/network errors are not treated as proof of session expiry. Earlier responses cannot overwrite a newer state read.

Verification for the saved follow-up: 1,894 synthetic automated tests, TypeScript, production build, and diff integrity checks passed. Independent review added 24 DOM regressions. Targeted ESLint still reports the existing baseline's 18 errors and 15 warnings; no new lint diagnostic category/count was introduced. Synthetic DOM tests are not pixel/browser or live-account acceptance. The retest screenshot does not establish the underlying cause of its 2027 failure, and blocked employee acceptance steps still require a fresh authenticated hosted retest.

This release changes no database rows, migrations, auth exceptions, runtime environment settings, audiences, employee activation, roles or approver assignments. The existing 23 scoped tables and the fixed October 13, 2026 01:35 UTC authentication-exception ceiling are unchanged. Saving this release does not itself authorize production deployment.

## Password recovery source candidate — October 16, 2026

This ZIP adds password recovery and retains the existing QA test-maintenance fixes. It is a local source candidate, not a deployed or live-verified release. Recovery is disabled by default. Read [the setup, session-revocation and testing guide](docs/password-reset-setup-and-testing.md) before enabling or deploying: the additive D1 migration must precede the code, and Supabase redirect/template/SMTP setup plus a human-owned test inbox remain required. Never share real credentials or recovery links with testers.
