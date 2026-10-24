# Hospital backend preparation

The Hospital repository, validators and service are prepared for shared authentication integration. No router/controller is exported, and `app.js` is unchanged. No Hospital endpoint is mounted. The user reports applying 004 to development; live schema verification remains pending. No database query or mutation was executed while preparing this module.

## Dependencies and methods

`createHospitalRepository(database)` receives the existing mysql2 pool; it never imports the environment loader or creates a pool. Reads use `execute(sql, values)`. For updates the pool must provide `getConnection()` and the normal mysql2 transaction methods. An injected connection is used inside each transaction. There is no registration/Account insert, Account update, schema operation or request/report dependency.

Repository methods:

- `findAccountById(id, { forUpdate })`: only identity, role and current account status, with optional row locking.
- `findProfileByAccountId(id, { forUpdate })`: Hospital fields and account status, with IDs cast to strings to preserve unsigned BIGINT precision. Does not select passwords, email or session data.
- `findAccountIdByRegistrationNumber(registrationNumber)`: internal lookup for future shared registration validation. Database collation supplies case/accent-insensitive comparison. This is not a public availability API and cannot replace the UNIQUE constraint under concurrency.
- `updateContactProfile(id, patch)`: the three allowed columns only, explicit `updated_at = CURRENT_TIMESTAMP`, followed by a profile read. Called within the service transaction after existence checks; affectedRows=0 is not mistaken for a missing profile.
- `listHospitals({ search, accountStatus, page })`: parameterized organization/registration/contact/phone search and account-status filtering, with count and stable organization/account-ID ordering. Literal LIKE wildcards are escaped. Internal page size is 20; no new pageSize or sorting request property is added. Count and list are separate reads and can reflect concurrent changes.
- `withTransaction(work)`: connection acquisition, begin/commit, rollback on failure and release. No application transaction should wrap the service update.

`createHospitalService({ repository })` provides `getOwnProfile`, `updateOwnProfile`, `listHospitals`, and `getHospitalProfileForAdmin`. The Admin detail method supplies the profile component only; it does not fabricate an absent request summary.

## Authorization boundary

Each service operation receives a **trusted server-side principal** with `accountId` from future verified shared sessions. The service cannot authenticate that object. Never construct it from body/query IDs, custom identity headers or an unverified cookie. Current Account role/status is reloaded; claimed role/status values on the principal are ignored. PENDING/ACTIVE Hospital accounts may read/update their own permitted profile fields; Admin list/detail requires ACTIVE Admin. Missing identity returns 401; disallowed role/status returns 403; absent Hospital returns 404.

Updates check authorization before validating input, then lock and recheck Account followed by Hospital in the transaction. This serializes the mutation against Account status changes. Existing shared session/CSRF guards must still authorize every future HTTP request, including suspended/revoked-session behavior. The service does not create sessions, check passwords or replace Thulasi's middleware.

## Validation and safe errors

`validateContactPatch` accepts a nonempty plain object containing only `contactName`, `phone`, and/or `address`. Organization/registration changes are not in the approved PATCH contract, even though the permission matrix broadly mentions profile management. IDs, role/status, credentials and client timestamps are rejected. No Admin profile-edit endpoint is invented.

`validateHospitalDetails` is a reusable pure validator for the five Hospital fields; it neither creates a profile nor establishes a new registration payload. Organization/contact/phone/address are required trimmed strings. Registration is nullable/optional, with blank text normalized to NULL. Maximum Unicode character counts follow DDL: 180/80/120/30/255. Control characters are rejected. Phone accepts digits with spaces, +, parentheses, dots and hyphens and needs at least one digit; no country or fixed length policy is imposed. Detailed institution registration policy remains for future shared registration work.

The list validator accepts only the existing `search`, `accountStatus`, and `page` properties. Search is trimmed and limited to 180 characters; status uses the canonical uppercase values; page is a positive integer with a safe offset. IDs are positive unsigned BIGINT decimal strings or safe integer inputs; invalid IDs and unknown fields fail validation.

Errors use the existing `HttpError` and central envelope: 400 `VALIDATION_ERROR`, 401 `UNAUTHENTICATED`, 403 `FORBIDDEN`, 404 `HOSPITAL_NOT_FOUND`, 409 `HOSPITAL_REGISTRATION_CONFLICT`/`HOSPITAL_CONFLICT`, or 503 `DATABASE_UNAVAILABLE`. The named registration UNIQUE violation is translated without forwarding driver messages; other driver failures are sanitized. Conflict handling is prepared for the future shared registration writer; this milestone does not allow registration-number updates. Field-level response details and final pagination envelope conventions can be coordinated when adapters are authorized; shared middleware is untouched.

## Approved HTTP integration targets (all remain unmounted)

| Approved contract | Prepared logic | Required before exposing |
|---|---|---|
| GET `/api/hospitals/me` | `getOwnProfile` | Verified shared session and own-profile guards, including limited PENDING access |
| PATCH `/api/hospitals/me` | `updateOwnProfile`; only contactName/phone/address | Same session/ownership guards plus shared CSRF and coordinated mutation CORS support |
| GET `/api/admin/hospitals` | `listHospitals`; search/accountStatus/page | Verified ACTIVE Admin session/role guards |
| GET `/api/admin/hospitals/{hospitalId}` | `getHospitalProfileForAdmin`, profile component only | ACTIVE Admin guards and later approved request summary integration before claiming the full response |

Public Hospital registration remains Thulasi's shared atomic Account/Hospital transaction contract. Account approval/suspension stays at the existing planned `PATCH /api/admin/accounts/{accountId}`, not in this module. No account-status writes, requests, audit infrastructure or reports are implemented here. Coordinate any required audit behavior before exposing later administrative mutations.

## Database-free verification

31 tests passed on 2026-10-24: 18 Hospital unit tests, one HTTP non-exposure test and the existing 12 health tests. SQL constraints/concurrency and the development schema were not live-tested. The HTTP test uses a real ephemeral Express listener but no database; forged headers, IDs and cookies still return 404 for unmounted Hospital/registration endpoints. Unit tests inject database/repository mocks, including duplicate conflicts, safe central errors, unchanged updates, explicit timestamp SQL, transaction cleanup and status-change rechecks.

From `backend/`, the following PowerShell command runs the reviewed tests without loading private environment files. Only the named OS variables are passed to the child; DB settings are excluded. The test-only loader replaces dotenv for the existing environment module, with no production-code changes. It does not mock authentication or create an identity route.

```powershell
@'
import { spawnSync } from 'node:child_process';
const env = { SystemRoot: process.env.SystemRoot, PATH: process.env.PATH,
  TEMP: process.env.TEMP, TMP: process.env.TMP, NODE_ENV: 'test' };
const result = spawnSync(process.execPath, [
  '--experimental-loader', './tests/helpers/no-private-env-loader.mjs', '--test',
  'tests/hospitals.test.js', 'tests/hospitals-boundaries.test.js', 'tests/health.test.js'
], { env, stdio: 'inherit', timeout: 60000 });
if (result.error) { console.error(result.error.code); process.exitCode = 1; }
else process.exitCode = result.status ?? 1;
'@ | node --input-type=module
if ($LASTEXITCODE -ne 0) { throw 'Backend tests failed.' }
```

Node 20 emits an experimental-loader warning for this test command. Plain `npm test` still uses the existing application's normal environment loading, so it was not used for the private-file-free check. No dependencies were installed.

## Remaining frontend work

Hospital Profile (`/hospital/profile`) and Admin Hospital Management (`/admin/hospitals`) remain planned. After shared authentication and API integration: implement role navigation, profile/status display, the three allowed editable fields, safe validation/errors, loading/empty states and Admin search/status pagination. Account approval controls must use Thulasi's shared account endpoint. Per-screen themes remain OPEN. Request summaries/dashboard work belongs to later features and is not implemented here.
