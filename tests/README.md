# Backend security regression tests

Run from the project root with Node 24:

```sh
node --test tests/*.test.mjs
```

The tests execute the real policy functions, authentication helpers, action/state routes, and file routes. A Node synchronous import hook transpiles the repository's TypeScript and substitutes only `cloudflare:workers`, `next/headers`, and `next/navigation`. No additional package is needed.

Each test gets a fresh in-memory SQLite database, a D1-shaped query adapter, a mocked R2 bucket, and synthetic identities. The harness uses the project's generated SQL migrations when present. Until those exist, it uses a fallback schema matching `db/schema.ts`.

Coverage includes verified-membership binding, owner bootstrap, inactive/demo access, privilege escalation, request and document isolation, private downloads, company publishing restrictions, CSRF checks, leave validation, no self-approval, concurrent allowance/overlap protection, task permissions, upload formats, body-size enforcement, and the concurrent upload quota. Manager/HR tests cover assigned-only approvals, manager transfers during submissions and reviews, linked-attachment access, HR permissions, role promotion/demotion, and immediate denial of deactivated accounts on every API.

These tests do not establish hosted edge behavior, identity-header anti-spoofing at dispatch, platform access policy, real D1/R2 provisioning, deployment, or browser behavior. Those still need platform/preview verification. All test data is synthetic. `latest-results.tap`, when present, is a disposable local test report.

## Expanded all-profile regression pass (October 11, 2026)

- `all-roster-sessions.test.mjs` creates 26 synthetic imported profile shapes, preserving only blank-field coverage, category distributions and reporting-link structure. It runs all five application roles for every shape (130 isolated sessions), checks every cross-profile read, and tests each disabled account against all modules. The test activation exists only in an in-memory fixture.
- `actions-deep`, `operations-deep`, `profiles-files-deep`, `state-read-races` exercise deterministic authorization revocation, concurrent writes, stale ownership/manager assignments, audit-failure rollback, duplicate identifiers, boundary validation and object-storage failures. Expected failures must be controlled and leave consistent records.
- `workspace-render` renders all 14 real workspace screens for all five roles, plus forms, former/current filtering, sparse imported records and safe text escaping. Profile rendering tests cover every tab, source-history labels and protected photo URLs.
- Photo and migration suites use synthetic manifests. No real employee name, account email, photo bytes, history or credential belongs in these fixtures or source.

The SQLite D1 adapter serializes batches to reflect D1 transactional semantics. Cross-request race gates pause before a batch starts; they do not permit another committed transaction to interleave inside an atomic batch. R2 and platform identity remain mocked. Static server rendering and responsive CSS checks are not pixel-level mobile verification, browser interaction tests, or actual employee ChatGPT sign-ins.

D1's documented batch transaction and serialization behavior: https://developers.cloudflare.com/d1/worker-api/d1-database/#batch . Query and batch limits: https://developers.cloudflare.com/d1/platform/limits/ . The adapter models those guarantees; it does not certify the hosted deployment's runtime.
