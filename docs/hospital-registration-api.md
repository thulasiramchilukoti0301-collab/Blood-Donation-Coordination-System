# Atomic Hospital registration API

Implemented on `lathikaa` on 2026-10-25, preserving the Hospital Profile integration and Donor workflows. Lathikaa reports Account, Hospital and app_session installed in her environment's `blood_donation_coordination` on 127.0.0.1:3306 and has demonstrated successful real Hospital registration/login with the correct saved organization, registration/contact fields and PENDING Profile. This user-reported live flow is separate from isolated automated tests and does not establish live failure/concurrency or Admin access. Implementation/testing did not inspect or modify that database, open private environment files, run migrations or create demonstration records.

Separate [USER-RUN evidence dated 2026-10-25 from Thulasi's environment](implementation-readiness.md#user-run-hospital-evidence-in-thulasis-environment-2026-10-25) records 004 installation/structure, application-account Hospital SELECT access, PENDING Hospital registration without automatic login, and explicit login to the Mint Gauge Profile. This is distinct from Lathikaa's evidence and the earlier automated tests; those dated registration/Profile observations did not verify Admin reads. Separate [USER-RUN first-Admin/basic browser evidence with browser confirmation reported 2026-10-26](first-admin-bootstrap.md#user-run-evidence-browser-confirmation-reported-2026-10-26) now covers the basic Admin Hospital read/session/logout flow. Further live failure/rollback/cancellation/concurrency, refusal/security/API-tampering and all-session/multi-device revocation checks remain pending; the later [USER-RUN Console approval/audit/fresh-login evidence dated 2026-10-26](account-approval-backend.md#user-run-account-approval-evidence-2026-10-26) is separate from registration evidence.

## Exact HTTP contract

POST `/api/auth/register/hospitals` is public registration protected by the existing session-bound CSRF middleware and rate-limiter factory. It creates a new Account and matching Hospital row in one MySQL transaction. The server always assigns HOSPITAL/PENDING. Registration does not sign in, switch the current authenticated identity, or return a session identifier/token. A new registrant must explicitly use the existing login endpoint before accessing protected Profile APIs.

Request fields are exactly the following JSON properties. Angle-bracket values are placeholders for the applicant's actual details, not seeded records:

```json
{
  "email": "<hospital email>",
  "password": "<password satisfying the shared policy>",
  "organizationName": "<organization name>",
  "registrationNumber": null,
  "contactName": "<contact name>",
  "phone": "<phone text in the permitted format>",
  "address": "<hospital address>"
}
```

Only registrationNumber is optional. A successful response is HTTP **201**, `Cache-Control: no-store`:

```json
{
  "success": true,
  "accountId": "<new Account ID>",
  "hospitalId": "<same Account ID>",
  "accountStatus": "PENDING",
  "profile": {
    "hospitalId": "<same Account ID>",
    "organizationName": "<normalized organization name>",
    "registrationNumber": null,
    "contactName": "<normalized contact name>",
    "phone": "<normalized phone>",
    "address": "<normalized address>",
    "createdAt": "<database-generated ISO timestamp>",
    "updatedAt": "<database-generated ISO timestamp>",
    "accountStatus": "PENDING"
  }
}
```

IDs are strings to preserve unsigned BIGINT precision. Profile fields come from the existing safe Hospital repository projection on the transaction connection. The response contains no email, submitted password, bcrypt hash, session payload, CSRF token or unrelated record. A present registrationNumber is returned as normalized text rather than null.

Errors retain `{ success: false, error: { code, message, fields? } }`:

| Condition | HTTP / code |
|---|---|
| Invalid/missing fields or unknown properties | 422 VALIDATION_ERROR |
| Scalar/malformed JSON rejected by the shared strict parser | 400 INVALID_JSON |
| Missing/incorrect/other-session CSRF | 403 CSRF_TOKEN_INVALID |
| Untrusted supplied Origin | 403 ORIGIN_NOT_ALLOWED |
| Duplicate Account email, including an existing Donor/Admin email | 409 EMAIL_CONFLICT |
| Duplicate named Hospital registration UNIQUE constraint | 409 HOSPITAL_REGISTRATION_CONFLICT |
| Other Hospital uniqueness conflict | 409 HOSPITAL_CONFLICT |
| Rate limit exceeded | 429 RATE_LIMITED with Retry-After |
| Auth/session configuration unavailable | 503 AUTHENTICATION_NOT_CONFIGURED or SESSION_STORAGE_UNAVAILABLE |
| Hashing failure | 503 AUTHENTICATION_UNAVAILABLE |
| Database/transaction failure | Safe 503 DATABASE_UNAVAILABLE or DATABASE_NOT_CONFIGURED |

Raw MySQL messages, SQL, stack traces, hashes and submitted secrets are never sent to the client. Email and registration conflicts are distinguished at their respective insert boundaries; Hospital registration duplicates cannot fall through to the existing Donor email-conflict mapper.

## Validation and CSRF

| Field | Rules |
|---|---|
| email | Required string, trimmed/lowercased, maximum 254 Unicode characters; existing shared email validation |
| password | Existing shared policy: at least 8 Unicode code points, at most 72 UTF-8 bytes, a Unicode number and punctuation/symbol; reject control characters; preserve spaces and the exact string without trimming/normalizing |
| organizationName | Required trimmed text, maximum 180 Unicode characters |
| registrationNumber | Optional/nullable trimmed text, maximum 80 Unicode characters; omission, null and blank text normalize to SQL NULL |
| contactName | Required trimmed text, maximum 120 Unicode characters |
| phone | Required trimmed text, maximum 30 characters; existing Hospital digits/space/+/( )/dot/hyphen formatting and at least one digit |
| address | Required trimmed text, maximum 255 Unicode characters |

The existing Hospital validator enforces its text/control-character rules. Its domain 400 validation error is translated to the shared registration 422 envelope without changing Profile PATCH validation. Unknown properties reject the whole body: Account/Hospital IDs, role, account status, timestamps and passwordHash cannot be supplied. Password hashing uses the existing bcrypt work factor **12**; only the resulting hash reaches the writer.

First request GET `/api/auth/csrf` with credentials enabled, then POST registration with the same anonymous session, JSON Content-Type and `X-CSRF-Token`. No automatic login follows success. Explicit login rotates the session ID/token; fetch a fresh CSRF token before later Profile PATCH operations. Existing origin/CORS, signed-cookie security and session lifetime are unchanged.

Hospital registration has its own five-attempt/client-IP fixed 15-minute limiter, using the existing bounded in-process factory. Attempts rejected by CSRF or validation also count. Donor registration and login retain their existing independent limiter instances and behavior. Multi-process/distributed rate limiting remains deferred.

## Atomic writer and database dependencies

The shared auth repository owns registration; the Hospital Profile service/repository/validators/errors are preserved. The writer acquires one pool connection, begins one transaction, inserts the server-assigned HOSPITAL/PENDING Account, inserts Hospital with the new shared key, reads the safe saved profile on that same connection, commits, then releases the connection. Any failure before a successful commit attempts rollback. Failed rollback destroys the connection instead of returning an uncertain transaction to the pool. Account acquisition/begin/insert, Hospital insert/readback and commit failure paths return safe errors with appropriate cleanup. No outer transaction wraps this writer.

Both INSERT statements are parameterized, and Account role/status are server-owned SQL literals. The existing UNIQUE constraints are authoritative, including concurrent registration races; there is no public availability endpoint or precheck presented as a uniqueness guarantee. The database's existing case/accent-insensitive collation governs email/registration uniqueness. Multiple NULL registration numbers are supported. Local in-memory tests emulate representative duplicate failures; they do not prove live MySQL collation or concurrency.

Dependencies are the unchanged InnoDB Account table from `002_auth.sql`, Hospital from `004_hospitals.sql`, and persistent app_session infrastructure for CSRF/session handling. The application needs Account SELECT/INSERT, Hospital SELECT/INSERT for registration, its existing Hospital UPDATE permission for Profile PATCH, and app_session SELECT/INSERT/UPDATE. No new schema or BloodGroup dependency is introduced for Hospital registration. Do not rerun migrations, setup wrappers or seeds. Read-only metadata checks remain in [Hospital Profile API documentation](hospital-profile-api.md#read-only-workbench-structure-checks).

## Decisions and boundaries

The reviewed OPEN decisions about staff-created accounts, compatibility, booking rules, timestamps for operational events, requests and audit workflows do not block this public pending-registration contract. The optional registration number remains nullable under the approved institution-neutral schema; no licensing/identity-verification policy or mandatory registration format is invented. Duplicate registration uses existing database uniqueness and safe conflict handling. No public Admin registration is created. The response follows the Donor registration identity/status convention while including the already planned safe Hospital profile.

## Verification and remaining work

At the original registration checkpoint on 2026-10-25, the complete isolated backend suite passed **92 tests, 0 failed, 0 skipped**: the previous 70 tests plus **22 registration tests** (13 validation/service/transaction checks and 9 HTTP checks). Coverage includes valid and optional registration, bcrypt cost/verification, atomic creation and failure cleanup, unsafe numeric IDs, rollback failure disposal, duplicate email/registration, invalid fields, forged privileges, CSRF/origin, rate limiting, exact safe response, no automatic login, and explicit login followed by Hospital Profile access. Donor registration's response, role, login and independent rate limit are exercised without changing its implementation; its original 20 authentication tests remain preserved. The later completed Admin-read checkpoint passed **108 backend tests and 34 frontend tests**, with production compilation passing. These are historical checkpoint results, not a new test run performed by this documentation update.

Tests use only in-memory mysql2-shaped dependencies and ephemeral HTTP listeners. Production auth/session/CSRF/registration/Profile code is exercised; no test identity route is introduced. The child process excludes DB settings and uses the existing no-private-env-loader, preventing private dotenv reads. The repeatable full-suite command is in the [Hospital backend README](../backend/src/modules/hospitals/README.md#database-free-verification). Existing boundary assertions now expect the configured registration route to exist while keeping public Admin registration and unrelated routes unmounted; the unconfigured route returns safe 503.

Live MySQL rollback/constraint failures/concurrent uniqueness remain unverified; Lathikaa's successful real registration/login/PENDING Profile in her environment is separate positive-flow evidence. At the original backend checkpoint frontend files were unchanged; the later [Hospital frontend](hospital-frontend.md) and [Admin Hospital Management](admin-hospital-management.md) milestones now implement registration, own Profile/contact editing and ACTIVE ADMIN Hospital list/detail. All three use scoped **Mint Gauge with Sora/Nunito Sans**; unrelated page styling is preserved. The later USER-RUN first-Admin/basic Admin read evidence and separate bounded Console approval/audit/fresh-login evidence are linked above. Thulasi's shared Account queue and PENDING-to-ACTIVE approval backend are implemented; no frontend approval controls, suspension/reactivation or password change are implemented. Further live concurrency/failure/security and all-session/multi-device revocation checks remain pending. Status stays read-only in Hospital management. Requests, allocation, audit UI and reports remain outside these implementations. No commit, push or merge was performed by these implementation tasks.
