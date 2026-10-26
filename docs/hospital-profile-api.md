# Hospital Profile API integration

The original Profile integration was implemented on `lathikaa` on 2026-10-25 after merged checkpoint `66e726b`, mounting GET/PATCH `/api/hospitals/me` through the existing Hospital service/repository and shared authentication. Subsequent milestones also implement atomic Hospital registration, ACTIVE ADMIN Hospital list/detail and their React surfaces; this document specifies the own-Profile contract. Donor workflows/private configuration are preserved. No MySQL connection or database operation was performed by the implementation/testing tasks. Lathikaa has separately demonstrated real Hospital registration/login in her environment with correct saved PENDING Profile information; those earlier Profile observations did not verify Admin reads or failure/concurrency behavior. Later basic Admin read evidence is separate, as linked below.

Separate [USER-RUN evidence dated 2026-10-25 from Thulasi's environment](implementation-readiness.md#user-run-hospital-evidence-in-thulasis-environment-2026-10-25) records successful Hospital login and contact editing/persistence/cancellation with protected UI fields remaining read-only. At that 2026-10-25 checkpoint, API tampering, failure/rollback, concurrency, suspension/reactivation and AuditEvent integration were unverified live and shared approval remained pending. The later [USER-RUN Console approval/audit/fresh-login evidence dated 2026-10-26](account-approval-backend.md#user-run-account-approval-evidence-2026-10-26) is separate; the deeper live checks remain pending.

## Mounted contracts and guards

| Route | Request | Success |
|---|---|---|
| GET `/api/hospitals/me` | Established authenticated Hospital session; no owner selector | HTTP 200 `{ success: true, profile }` |
| PATCH `/api/hospitals/me` | Same session; JSON object with any nonempty subset of contactName/phone/address; valid session-bound X-CSRF-Token | HTTP 200 `{ success: true, profile }` |

Both successful responses use `Cache-Control: no-store`. `hospitalId` is the shared Account ID as a string, preserving unsigned BIGINT precision. The profile contains only hospitalId, organizationName, nullable registrationNumber, contactName, phone, address, createdAt, updatedAt and current accountStatus. MySQL date values serialize as ISO timestamps through the existing timezone-aware pool configuration.

The existing `requireCurrentAccount` reloads Account role/status from the shared server session; `requireRole('HOSPITAL')` excludes DONOR and ADMIN. Only `{ accountId: req.authAccount.accountId }` reaches the Hospital service. No body/query ID, custom role/identity header or unverified cookie establishes identity. The router uses the existing auth repository/service and same pool to apply these guards; it introduces no alternate login/session mechanism. PENDING and ACTIVE Hospitals are allowed. SUSPENDED/missing/role-changed Accounts invalidate the existing session; missing/invalid/revoked sessions are denied. Hospital service authorization and its Account/Hospital transaction locks remain intact. A suspension detected inside the transaction denies the update even after the initial HTTP guard passed.

PATCH trims and validates only the existing allowed contact fields. Unknown properties reject the whole request. Organization name, registration number, Account/Hospital IDs, role/status, credentials and timestamps cannot be overwritten. Query identity claims are ignored. No hashes, email, session payload, other Hospital records, requests or staff data appear in the profile response.

Illustrative PATCH body; this example creates no identity or database fixture:

```json
{
  "contactName": "Updated contact name",
  "phone": "+91 44 1234 5678",
  "address": "Updated hospital address"
}
```

GET and PATCH success shape; angle-bracket values describe the actual saved values:

```json
{
  "success": true,
  "profile": {
    "hospitalId": "<authenticated-account-id>",
    "organizationName": "<saved organization name>",
    "registrationNumber": null,
    "contactName": "<saved contact name>",
    "phone": "<saved phone>",
    "address": "<saved address>",
    "createdAt": "<ISO timestamp>",
    "updatedAt": "<ISO timestamp>",
    "accountStatus": "PENDING"
  }
}
```

Errors use the unchanged central envelope. Missing-profile example, HTTP 404:

```json
{
  "success": false,
  "error": {
    "code": "HOSPITAL_NOT_FOUND",
    "message": "Hospital profile was not found."
  }
}
```

| Condition | Status / code |
|---|---|
| No authenticated session | 401 AUTHENTICATION_REQUIRED |
| Suspended/missing/role-changed Account encountered by shared guard | 401 ACCOUNT_UNAVAILABLE; session destroyed |
| DONOR/ADMIN on Hospital self-profile | 403 FORBIDDEN |
| Missing/incorrect/stale/other-session CSRF | 403 CSRF_TOKEN_INVALID |
| Disallowed supplied Origin | 403 ORIGIN_NOT_ALLOWED |
| Invalid/unknown PATCH fields | 400 VALIDATION_ERROR |
| Scalar/malformed JSON rejected by existing strict parser | 400 INVALID_JSON |
| Missing own Hospital profile | 404 HOSPITAL_NOT_FOUND |
| Status/role fails domain transaction recheck | 403 FORBIDDEN; no update |
| Missing DB dependency, database failure or session storage failure | Safe 503 error; no driver details |

The shared JSON parser still precedes route guards, so malformed JSON is handled by that existing parser. No parsing/authentication behavior was changed to accommodate these routes.

## CSRF and CORS

Use the established `/api/auth/login` flow with an existing legitimate Hospital account. After login, obtain a fresh token from GET `/api/auth/csrf` using the same cookie/session. PATCH `/api/hospitals/me` requires `Content-Type: application/json` and `X-CSRF-Token: <returned token>`. Login rotates both the session ID and CSRF token; pre-login tokens are invalid. Browser clients include credentials (`withCredentials: true` in the existing Axios client); the browser manages the HttpOnly cookie. GET needs no CSRF header.

PATCH runs shared current-account and HOSPITAL-role guards, then the existing `requireTrustedOriginAndCsrf` middleware. A CSRF-bearing anonymous session still receives 401. The only CORS change is adding PATCH to GET/HEAD/POST/OPTIONS. The configured exact frontend origin, credential behavior, allowed headers, supplied-Origin checks, signed sessions, cookie flags and session expiry are unchanged. PUT/DELETE and unrelated endpoints are not exposed by this method allowance.

## Read-only Workbench structure checks

Use the connection configured for **127.0.0.1:3306** and select **blood_donation_coordination** in Workbench. These statements are metadata reads only and were not executed by this task. They do not retrieve Account records, hashes or session payloads. Visibility is privilege-filtered; missing metadata requires inspection rather than recreation.

```sql
SELECT DATABASE() AS selected_schema, @@hostname AS server_hostname,
       @@port AS server_port, VERSION() AS server_version,
       @@SESSION.sql_mode AS sql_mode, @@SESSION.time_zone AS session_time_zone;

SELECT TABLE_NAME, TABLE_TYPE, ENGINE, TABLE_COLLATION
FROM information_schema.TABLES
WHERE TABLE_SCHEMA = 'blood_donation_coordination'
  AND LOWER(TABLE_NAME) IN ('account', 'hospital', 'app_session')
ORDER BY TABLE_NAME;

SELECT TABLE_NAME, ORDINAL_POSITION, COLUMN_NAME, COLUMN_TYPE,
       IS_NULLABLE, COLUMN_DEFAULT, COLUMN_KEY, EXTRA,
       CHARACTER_SET_NAME, COLLATION_NAME
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = 'blood_donation_coordination'
  AND LOWER(TABLE_NAME) IN ('account', 'hospital', 'app_session')
ORDER BY TABLE_NAME, ORDINAL_POSITION;
```

Expect port 3306, selected schema `blood_donation_coordination`, and three InnoDB base tables. The server hostname may be the machine name. If all three tables exist, inspect their complete constraints and indexes:

```sql
SHOW CREATE TABLE blood_donation_coordination.Account;
SHOW CREATE TABLE blood_donation_coordination.Hospital;
SHOW CREATE TABLE blood_donation_coordination.app_session;
SHOW INDEX FROM blood_donation_coordination.Account;
SHOW INDEX FROM blood_donation_coordination.Hospital;
SHOW INDEX FROM blood_donation_coordination.app_session;
```

Compare against the existing canonical files without rerunning them:

- `002_auth.sql`: seven Account columns; generated unsigned BIGINT primary key; unique email; case-sensitive role/status CHECK values; bcrypt hash storage. HOSPITAL is a valid role; statuses are PENDING/ACTIVE/SUSPENDED.
- `004_hospitals.sql`: eight columns; non-generated unsigned BIGINT shared primary key and restrictive Account FK; nullable unique registration; text lengths 180/80/120/30/255. `updated_at` is application-maintained, without an automatic-update clause/trigger.
- `infrastructure/auth_sessions.sql`: four columns; case-sensitive ASCII VARCHAR(128) session_id primary key; unsigned BIGINT expires_at; nullable MEDIUMTEXT session_data; nullable unsigned BIGINT revoked_at; expiry index. Runtime table creation and automatic cleanup remain disabled.

For these profile operations the existing application identity needs Account SELECT, Hospital SELECT/UPDATE, and app_session SELECT/INSERT/UPDATE, in addition to its existing Donor/auth privileges. The application pool uses `+05:30`; existing private DB/session configuration and a session secret of at least 32 UTF-8 bytes are prerequisites. They were not opened or changed. A successful health `SELECT 1` cannot verify these tables. No new domain schema is required if these canonical objects are installed correctly. Do not run setup wrappers, migration batches, seeds, the disposable verifier or automatic infrastructure installation on development.

## Isolated verification

Final rollback-cleanup rerun on 2026-10-25 passed **115 backend tests and 34 frontend tests, 0 failed, 0 skipped**; production frontend compilation also passed. The Profile transaction helper releases after a successful rollback, destroys after a failed rollback, and never performs both cleanups. Original safe domain errors and driver-conflict mappings survive rollback failure; a destruction exception cannot replace that safe failure or trigger release. These fault cases use isolated doubles, with no MySQL mutations. Existing authenticated contact-only Profile behavior remains covered; live database failure/concurrency and Admin access remain pending.

Original Profile checkpoint on 2026-10-25: **70 passed, 0 failed, 0 skipped**. This consisted of 20 existing auth tests, 12 health tests, 18 Hospital unit tests, the non-exposure boundary test and 19 HTTP integration tests. The first run was 69/70 because a new test expected domain validation for scalar JSON; its expectation was corrected to the existing parser's INVALID_JSON without modifying parsing behavior. The complete rerun passed. Later registration/Admin-read integrations retained those flows, and the completed Admin-read checkpoint passed **108 backend tests and 34 frontend tests**, with production compilation passing. These are historical checkpoint results, not a new test run performed by this documentation update.

The HTTP tests exercise production auth runtime, bcrypt comparison, signed cookies, MySQL session-store code, shared guards, Hospital router/service/repository and actual Express listeners. The mysql2 dependency alone is an in-memory test double in `backend/tests/helpers/hospital-database.mjs`; application code never imports it. They cover required authentication, both permitted statuses, DONOR/ADMIN denial on own-Hospital routes, suspension and replay, missing/changed Accounts, forged IDs/roles, read-only fields, missing profiles, CSRF, errors/rollback, transactional status recheck, configured-origin PATCH CORS, logout, exact success fields and BIGINT string IDs. The original milestone left registration/Admin routes unmounted; those specific reads/registration are now implemented with their own tests. Public Admin registration, Account-status mutations, request/report routes and Donor mutations remain unavailable.

Tests ran with only whitelisted OS variables plus NODE_ENV=test; DB settings were excluded and the existing no-private-env-loader disabled dotenv file reads. The exact repeatable PowerShell command is in the [Hospital backend README](../backend/src/modules/hospitals/README.md#database-free-verification). Boundary tests retain unmounted unrelated-route checks while requiring authentication on mounted profile/Admin routes. No production identity shortcuts or permanent fixtures were introduced. Frontend files/checks were unchanged at the original backend-only checkpoint; later React/browser verification is recorded in [Hospital frontend](hospital-frontend.md) and [Admin Hospital Management](admin-hospital-management.md).

These are isolated application checks. Lathikaa separately reports successful real local Hospital registration and login in her environment, and correct saved organization/registration/contact/PENDING Profile. That positive-flow evidence supersedes the earlier unverified-browser-flow status; it does not establish every metadata/privilege check, live MySQL constraint failures/rollback/locking/concurrency, status transitions, audit or live Admin management. No development records were read or changed by these implementation/testing tasks.

## Remaining dependencies

An actual Profile flow requires a legitimate HOSPITAL Account and matching Hospital shared-key row. Metadata checks alone cannot prove that pair exists; login reads Account alone and cannot establish profile completeness. The implemented shared atomic POST `/api/auth/register/hospitals` creates both rows; see [registration contract and evidence](hospital-registration-api.md). A real applicant registers, then explicitly logs in before Profile access. The user has demonstrated this positive flow locally; the implementation tasks did not provision development accounts or substitute a mock identity.

The [Hospital frontend](hospital-frontend.md) implements registration and own Profile UI, and [Admin Hospital Management](admin-hospital-management.md) implements Screen 24 with real list/profile-detail APIs for ACTIVE ADMIN. Hospital Registration, Profile and Screen 24 use selected **Mint Gauge**, Sora headings and Nunito Sans body/UI while unrelated themes are preserved. Separate [USER-RUN evidence with browser confirmation reported 2026-10-26](first-admin-bootstrap.md#user-run-evidence-browser-confirmation-reported-2026-10-26) confirms manual first-Admin creation and the basic Mint Gauge Admin Hospital read/session/logout flow. Further live API tampering, failure/rollback/cancellation/concurrency and all-session/multi-device revocation checks remain pending; the separate basic approval evidence linked above does not prove them. Thulasi now implements the [shared queue/bounded approval backend](account-approval-backend.md), with same-transaction AuditEvent/status/session tombstones and coordinated login. Basic USER-RUN Console approval/audit/fresh-login evidence is linked above; further live checks remain pending. The later [Mint Account approval page](account-approval-frontend.md) implements shared controls separately, with separate USER-RUN Donor UI evidence in that guide, while live Hospital approval and remaining frontend checks stay pending; suspension/reactivation are not implemented. Hospital management therefore keeps real status read-only. Blood Requests, FEFO, audit UI and reports remain outside these implementations.
