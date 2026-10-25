# Hospital Profile and Admin Hospital reads

GET and PATCH `/api/hospitals/me` are mounted through `createHospitalRouter` in `app.js`, reusing the Hospital service/repository and shared session/current-account/HOSPITAL guards. PATCH also requires shared CSRF protection; the only Profile CORS change was adding PATCH. Atomic POST `/api/auth/register/hospitals` lives in shared auth while preserving Donor behavior and these Profile APIs. GET `/api/admin/hospitals` and GET `/api/admin/hospitals/:hospitalId` mount Admin service reads with shared current-account/ACTIVE ADMIN guards. Existing validation, response and authorization contracts are retained. Lathikaa has demonstrated real local Hospital registration/login in her environment with correct saved organization, registration/contact fields and PENDING Profile; this is user-reported evidence, not live Admin/failure/concurrency verification performed by this task. No private environment file was read and no MySQL connection, DDL or DML was executed during these integrations. See [Profile contracts and read-only checks](../../../../docs/hospital-profile-api.md), [atomic registration](../../../../docs/hospital-registration-api.md) and [Admin Hospital Management](../../../../docs/admin-hospital-management.md).

Later [USER-RUN evidence dated 2026-10-25 from Thulasi's environment](../../../../docs/implementation-readiness.md#user-run-hospital-evidence-in-thulasis-environment-2026-10-25) separately covers Hospital installation/structure, application-account SELECT access, PENDING registration, explicit login, contact-edit persistence/cancellation, and preserved Donor flows. It does not establish live Admin access, API tampering, transaction failure/rollback, concurrency, suspension/reactivation, AuditEvent integration, or a dedicated Hospital constraint-verifier run. Shared account approval remains pending.

Separate [USER-RUN evidence with browser confirmation reported 2026-10-26](../../../../docs/first-admin-bootstrap.md#user-run-evidence-browser-confirmation-reported-2026-10-26) records manual first-Admin creation and the basic Mint Gauge Admin Hospital list/search/details, refresh and logout flow. The earlier dated environment and automated results remain unchanged. Real MySQL concurrency/failure/rollback/cancellation, live refusal and API tampering tests, audited account-status actions/revocation, production action/reason mappings, audit search/UI and other operational workflows remain pending.

## Dependencies and methods

`createHospitalRepository(database)` receives the existing mysql2 pool; it never imports the environment loader or creates a pool. Reads use `execute(sql, values)`. For updates the pool must provide `getConnection()` and the normal mysql2 transaction methods. An injected connection is used inside each transaction. This Profile repository has no registration writer, Account update, schema operation or request/report dependency. Atomic Account/Hospital creation belongs to the shared auth repository, which reuses this repository's safe profile read on its transaction connection.

Repository methods:

- `findAccountById(id, { forUpdate })`: only identity, role and current account status, with optional row locking.
- `findProfileByAccountId(id, { forUpdate })`: Hospital fields and account status, with IDs cast to strings to preserve unsigned BIGINT precision. Does not select passwords, email or session data.
- `findAccountIdByRegistrationNumber(registrationNumber)`: internal lookup for future shared registration validation. Database collation supplies case/accent-insensitive comparison. This is not a public availability API and cannot replace the UNIQUE constraint under concurrency.
- `updateContactProfile(id, patch)`: the three allowed columns only, explicit `updated_at = CURRENT_TIMESTAMP`, followed by a profile read. Called within the service transaction after existence checks; affectedRows=0 is not mistaken for a missing profile.
- `listHospitals({ search, accountStatus, page })`: parameterized organization/registration/contact/phone search and account-status filtering, with count and stable organization/account-ID ordering. Literal LIKE wildcards are escaped. Internal page size is 20; no new pageSize or sorting request property is added. Count and list are separate reads and can reflect concurrent changes.
- `withTransaction(work)`: connection acquisition, begin/commit, rollback on failure and release. No application transaction should wrap the service update.

`createHospitalService({ repository })` provides `getOwnProfile`, `updateOwnProfile`, `listHospitals`, and `getHospitalProfileForAdmin`. The Admin detail method supplies the profile component only; it does not fabricate an absent request summary.

## Authorization boundary

Own-profile routes run `requireCurrentAccount` and `requireRole('HOSPITAL')` against the established shared session. The router uses the same mysql2 pool and existing auth repository/service for the Account reload; it creates no alternate login/session system. Only `{ accountId: req.authAccount.accountId }` is passed to the Hospital service. Body/query IDs, custom identity headers and unverified cookies cannot select the acting Hospital. The service also reloads current Account role/status. PENDING/ACTIVE Hospitals may read/update permitted own-profile fields. DONOR/ADMIN receive 403 on own-Hospital routes. Missing identity receives 401; suspended/missing/role-changed Accounts invalidate their existing session and receive 401 `ACCOUNT_UNAVAILABLE`. Absent Hospital profiles receive 404.

Admin list/detail reads run `requireCurrentAccount`, `requireRole('ADMIN')` and `requireActiveAccount`, then pass only the verified Admin Account ID to the existing service, which also rechecks ACTIVE ADMIN. DONOR/HOSPITAL sessions cannot list or select other Hospital profiles. PENDING/SUSPENDED Admin sessions are rejected. Target Hospitals can have PENDING, ACTIVE or SUSPENDED status; only their approved profile fields are selected. Both routes return HTTP 200 `no-store` JSON: `{ success: true, hospitals, pagination }` or `{ success: true, profile }`. A trailing slash on the list route remains a list request, not a detail identifier. Request summaries are omitted until HospitalRequest storage/services exist. These GET reads need no CSRF token and require no CORS changes.

PATCH runs shared authentication/role checks, then `requireTrustedOriginAndCsrf`, before the existing service. Updates check authorization before validating input, then lock and recheck Account followed by Hospital in the transaction. This serializes the mutation against Account status changes; suspension discovered by the transaction returns 403 `FORBIDDEN` without an update. No extra transaction wraps the service. The service does not create sessions, check passwords or replace Thulasi's middleware. Do not add an ACTIVE-only operational guard to these documented PENDING profile operations.

## Validation and safe errors

`validateContactPatch` accepts a nonempty plain object containing only `contactName`, `phone`, and/or `address`. Organization/registration changes are not in the approved PATCH contract, even though the permission matrix broadly mentions profile management. IDs, role/status, credentials and client timestamps are rejected. No Admin profile-edit endpoint is invented.

`validateHospitalDetails` is a reusable pure validator for the five Hospital fields, now also consumed by shared Hospital registration validation. It does not create profiles. Organization/contact/phone/address are required trimmed strings. Registration is nullable/optional, with blank text normalized to NULL. Maximum Unicode character counts follow DDL: 180/80/120/30/255. Existing control-character rules apply. Phone accepts digits with spaces, +, parentheses, dots and hyphens and needs at least one digit; no country or fixed length policy is imposed. No institution verification policy is invented. Registration adapts these domain errors to the shared 422 envelope; Profile PATCH remains unchanged.

The list validator accepts only the existing `search`, `accountStatus`, and `page` properties. Search is trimmed and limited to 180 characters; status uses the canonical uppercase values; page is a positive integer with a safe offset. IDs are positive unsigned BIGINT decimal strings or safe integer inputs; invalid IDs and unknown fields fail validation.

Domain errors use the existing `HttpError` and central envelope: 400 `VALIDATION_ERROR`, 401 `UNAUTHENTICATED`, 403 `FORBIDDEN`, 404 `HOSPITAL_NOT_FOUND`, 409 `HOSPITAL_REGISTRATION_CONFLICT`/`HOSPITAL_CONFLICT`, or 503 `DATABASE_UNAVAILABLE`. Mounted routes also use the unchanged shared authentication/CSRF/storage error codes; see the integration documents for exact HTTP contracts. The named registration UNIQUE violation is translated without forwarding driver messages; the shared registration writer now reuses this safe conflict handling. Registration numbers remain read-only through Profile PATCH. Admin reads use the existing fixed 20-row pagination and organization/Account-ID ordering; shared middleware is untouched.

## HTTP integration status

| Approved contract | Existing logic | Integration status |
|---|---|---|
| GET `/api/hospitals/me` | `getOwnProfile` | Mounted; shared session/current-account/HOSPITAL guards |
| PATCH `/api/hospitals/me` | `updateOwnProfile`; only contactName/phone/address | Mounted; same guards plus shared CSRF and configured-origin PATCH CORS |
| POST `/api/auth/register/hospitals` | Shared auth validation/hash/atomic writer | Mounted; CSRF and independent rate limit; HOSPITAL/PENDING; no automatic login |
| GET `/api/admin/hospitals` | `listHospitals`; search/accountStatus/page | Mounted; shared current-account/ACTIVE ADMIN guards; no-store; fixed 20-row pages |
| GET `/api/admin/hospitals/{hospitalId}` | `getHospitalProfileForAdmin`, profile component only | Mounted; same guards; validated unsigned BIGINT ID; request summary deferred |

Public Hospital registration is implemented in shared auth under the [atomic Account/Hospital contract](../../../../docs/hospital-registration-api.md). Thulasi's shared `GET /api/admin/accounts` and `PATCH /api/admin/accounts/{accountId}` remain planned/unmounted; no account-status mutation, request, audit infrastructure or report is implemented here. The session-store account-wide revocation primitive exists, but approval/suspension/reactivation still requires AuditEvent storage and a safe writer, shared CSRF, required reason, durable audit, safe transition handling and tested revocation/fresh-login integration. Screen 24 therefore displays real status read-only with no approve/suspend buttons or Hospital-only bypass.

## Database-free verification

Final rollback-cleanup checkpoint (2026-10-25): **115 backend tests and 34 frontend tests passed, 0 failed, 0 skipped**. The frontend browser run retained 20 scenarios and 161 assertions at each of four widths (644 total); the production compilation passed for 99 modules with private environment-file loading disabled and output in memory. The transaction tests now cover success, operation/commit/begin/acquisition failures, successful rollback/release, failed rollback/destroy, no duplicate cleanup, original safe-error/conflict preservation, and a destruction exception without release. The Profile helper destroys rather than pools a connection after failed rollback. These are isolated results; at that checkpoint, live Admin and MySQL failure/concurrency verification remained pending. The later basic Admin read evidence is separate; deeper failures/concurrency remain pending.

At the completed Admin-read checkpoint on 2026-10-25, the full backend suite passed **108 tests, 0 failed, 0 skipped**, adding 16 isolated Admin HTTP tests to the preceding 92-test registration checkpoint. Coverage includes ACTIVE Admin list/detail, other-role and pending/suspended denial, forged actor claims, search/status filters, literal LIKE wildcards, pagination, IDs, absent profiles, safe errors, response field allowlists and unmounted mutation/request/report boundaries. Existing auth, registration and own-profile suites remain included. The [92-test registration](../../../../docs/hospital-registration-api.md#verification-and-remaining-work), [70-test Profile](../../../../docs/hospital-profile-api.md#isolated-verification) and 31-test pre-integration results are earlier historical checkpoints. Counts here record those completed runs, not a new execution by the documentation update. All tests use in-memory doubles and ephemeral listeners; no development database is contacted. Those isolated tasks did not verify live Admin reads or MySQL failures/constraints/concurrency; Lathikaa-environment Hospital positive-flow evidence is separate.

From `backend/`, the following PowerShell command runs the reviewed tests without loading private environment files. Only the named OS variables are passed to the child; DB settings are excluded. The test-only loader replaces dotenv for the existing environment module, with no production-code changes. It does not mock authentication or create an identity route.

```powershell
@'
import { spawnSync } from 'node:child_process';
const env = { SystemRoot: process.env.SystemRoot, PATH: process.env.PATH,
  TEMP: process.env.TEMP, TMP: process.env.TMP, NODE_ENV: 'test' };
const result = spawnSync(process.execPath, [
  '--experimental-loader', './tests/helpers/no-private-env-loader.mjs', '--test',
  'tests/auth.test.js', 'tests/donor-profile.test.js', 'tests/health.test.js', 'tests/hospitals.test.js',
  'tests/hospitals-boundaries.test.js', 'tests/hospitals-http.test.js', 'tests/hospital-registration.test.js',
  'tests/admin-hospitals-http.test.js'
], { env, stdio: 'inherit', timeout: 60000 });
if (result.error) { console.error(result.error.code); process.exitCode = 1; }
else process.exitCode = result.status ?? 1;
'@ | node --input-type=module
if ($LASTEXITCODE -ne 0) { throw 'Backend tests failed.' }
```

Node 20 emits an experimental-loader warning for this test command. Plain `npm test` still uses the existing application's normal environment loading, so it was not used for the private-file-free check. No dependencies were installed.

## Frontend integration and remaining work

The bounded [Hospital frontend milestone](../../../../docs/hospital-frontend.md) integrates Hospital registration within `/login?register=hospital` and Hospital Profile at `/hospital/profile`, using the real registration API, explicit login, status navigation and only the three editable contact fields. [Admin Hospital Management](../../../../docs/admin-hospital-management.md) adds Screen 24 at `/admin/hospitals`, consuming the mounted list/detail APIs with search, status filters, pagination and profile details. The user selected **Mint Gauge with Sora headings and Nunito Sans body/UI** for all three Hospital surfaces, scoped without restyling unrelated pages. Shared audited approval/suspension/reactivation, request summaries and dashboards remain future work. The original implementation tasks provisioned no Admin and did not run live Admin checks; the later user-run manual bootstrap/basic Admin read evidence is linked above. Shared audited account approval remains pending.

At that completed Admin-read checkpoint, frontend verification passed **34 tests, 0 failed, 0 skipped**, including 20 browser scenarios at four desktop/tablet/phone widths and 644 assertions. The 13 existing registration/Profile/Donor scenarios remain included. Vite 8.3.4 production compilation passed for 99 modules with private environment-file loading disabled and output in memory. These are historical verified results. See the [Admin verification record](../../../../docs/admin-hospital-management.md#verification-evidence-and-manual-checks) for exact viewport measurements and evidence limits.
