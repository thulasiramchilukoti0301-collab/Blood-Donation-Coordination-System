# Preliminary API Design

This document is the API contract baseline. The bounded authentication/Donor work implements only routes marked **Implemented subset** or **Implemented bounded subset**; all other listed endpoints remain planned, not implemented. Endpoints use JSON over HTTP. Request/response property names are camelCase; database column names remain snake_case. State, outcome, role, and priority codes use the exact uppercase values defined in `domain-rules.md` and `database-design.md`; screens may display title-case labels. Protected routes use the server-side authenticated principal; clients must not select their role or override ownership by submitting actor/hospital/donor identifiers. Every protected request checks current account status, role, and resource ownership. Routes marked **Approved addition** remain approved contracts for later work. Unless an operation is expressly allowed to PENDING accounts below, operational endpoints require an ACTIVE account; Admin operations require an ACTIVE Admin.

## Authentication and accounts

| Route | Method | Role | Purpose | Major request fields | Major response fields |
|---|---|---|---|---|---|
| `/api/auth/csrf` | GET | Public or authenticated | **Implemented subset.** Create or return a session-bound CSRF token for the trusted web client; response is `no-store`. | none | csrfToken (CSRF token only; no session identifier) |
| `/api/auth/register/donors` | POST | Public | **Implemented subset.** Atomically create a pending donor Account and Donor profile. No automatic login. | fullName, email, password, dateOfBirth, phone, address, optional area, optional reportedBloodGroupId | accountId, donorId (same shared ID), accountStatus=`PENDING`; no credentials or profile secret |
| `/api/auth/register/hospitals` | POST | Public | Create pending hospital account/profile (planned) | organizationName, registration/contact details, address, password (shared policy defined below) | hospitalId, accountStatus, safe profile |
| `/api/auth/login` | POST | Public | **Implemented subset.** Authenticate with bcrypt and establish a rotated persistent server-side session. Invalid credentials use one generic response. | email, password | accountId, role, accountStatus; HttpOnly session cookie set; no session/CSRF token in JSON |
| `/api/auth/logout` | POST | Authenticated | **Implemented subset.** Destroy the current server-side session. | none; valid CSRF header required | success message; cookie cleared |
| `/api/auth/me` | GET | Donor, Hospital, Admin | **Implemented subset.** Reload current role/status from Account; limited PENDING accounts may read status. Does not require a Hospital profile table. | none | accountId, role, accountStatus |
| `/api/auth/password` | POST | Authenticated Donor, Hospital, Admin; PENDING Donor/Hospital allowed | **Approved addition.** Verify current password and change password | currentPassword, newPassword | success; revoke all sessions, including current session; user must log in again |
| `/api/admin/accounts` | GET | Admin | Search/approve queue and accounts | role, accountStatus, search, page | accounts, pagination |
| `/api/admin/accounts/{accountId}` | PATCH | Active Admin | Approve, suspend, or reactivate account | accountStatus (`ACTIVE` or `SUSPENDED`), reason | accountId, accountStatus; reactivation requires fresh login and never restores previously revoked sessions |

The registration API accepts an optional reported blood group, but the current Donor registration UI has no blood-group selector and omits `reportedBloodGroupId`. The confirmed group remains staff-controlled. Neither group is editable through the bounded Donor self-profile PATCH.

## Donors, eligibility, and bookings

| Route | Method | Role | Purpose | Major request fields | Major response fields |
|---|---|---|---|---|---|
| `/api/donors/me` | GET | Donor | **Implemented subset.** Read the profile identified only by the current session. PENDING Donors may read their own profile. | none; supplied IDs are ignored | accountId, email, accountStatus, fullName, dateOfBirth, phone, address, area, reportedBloodGroup, confirmedBloodGroup |
| `/api/donors/me` | PATCH | PENDING or ACTIVE Donor | **Implemented bounded subset.** Update only supplied own-profile contact fields; ownership comes from the verified session, with Account role/status rechecked under lock before the Donor row is changed. | Nonempty plain JSON object containing only `fullName` (required nonblank, max 120 code points), `phone` (required nonblank, max 30), `address` (required nonblank, max 255), or `area` (optional, max 100; blank/null clears). Omitted fields stay unchanged. Trim text and reject controls/unexpected fields. CSRF header required. | Same safe profile fields as GET after transaction commit; no password/hash, session data, or staff-only fields |
| `/api/admin/donors` | GET | Admin | Search donor records | search, bloodGroupId, accountStatus, eligibility, area, page | donor summaries, pagination |
| `/api/admin/donors/{donorId}` | GET | Active Admin | **Approved addition.** Read one donor record for the donor-detail screen | none | donor ID, account status, permitted profile/contact fields, reported/confirmed blood group, high-level eligibility/booking/donation summary; no password/hash or detailed medical answers |
| `/api/admin/donors/{donorId}` | PATCH | Admin | Correct/confirm operational profile | editable fields, confirmedBloodGroup, reason | updated donor summary |
| `/api/donors/me/eligibility` | GET | Donor | View advisory interval result | none; server controls evaluation date | result (`ELIGIBLE`, `INELIGIBLE_UNTIL_DATE`, `STAFF_REVIEW_REQUIRED`), nextEligibleDate, checkedAt, safe reason |
| `/api/admin/donors/{donorId}/eligibility-decisions` | POST | Admin | Record day-of decision/deferral | decision, bookingId (optional), deferredUntil, reasonCode, safeNote | eligibilityDecisionId, decision, nextEligibleDate |
| `/api/donation-slots` | GET | Donor, Admin | Donor lists open slots; Admin may filter all slots | from, to, slotStatus (Admin), page | slots with capacity/remaining count |
| `/api/admin/donation-slots` | POST | Admin | Create slot | startsAt, endsAt, capacity | slotId, slotStatus, startsAt, endsAt, capacity |
| `/api/admin/donation-slots/{slotId}` | PATCH | Active Admin | Change future slot capacity or cancel; reject capacity below occupancy and reject schedule edits once any booking exists | capacity, slotStatus, reason; startsAt/endsAt only when no bookings exist | slotId, slotStatus, startsAt, endsAt, capacity |
| `/api/donors/me/bookings` | GET | Donor | List own bookings | bookingStatus, from, to, page | bookings |
| `/api/donors/me/bookings` | POST | ACTIVE Donor | Book an open slot after the eligibility predicate and evaluation date are resolved; duplicate booking for the same donor/slot, even after cancellation, conflicts with the schema unique key | slotId | bookingId, bookingStatus, slot summary |
| `/api/donors/me/bookings/{bookingId}/cancellation` | POST | Donor | Cancel own booking before start | reasonCode optional | bookingId, bookingStatus, cancelledAt |
| `/api/admin/bookings` | GET | Admin | Search bookings/check-in queue | donor, bookingStatus, from, to, page | bookings |
| `/api/admin/bookings/{bookingId}/status` | PATCH | Admin | Check in, mark no-show, staff-cancel | bookingStatus, reason | booking |

For the implemented Donor self-profile PATCH, every maximum counts Unicode code points after trimming. `email`, `dateOfBirth`, reported/confirmed blood groups, identifiers, role, account status, passwords/hashes, and timestamps are not accepted in the payload. The server returns safe validation field errors (422), authentication/state errors (401), wrong-role errors (403), and missing-profile/storage failures (503) without exposing SQL or credentials. The update reads the saved profile on the transaction connection and responds only after commit; a zero affected-row count for identical values is not treated as missing.

## Donation and inventory

| Route | Method | Role | Purpose | Major request fields | Major response fields |
|---|---|---|---|---|---|
| `/api/admin/donations` | POST | Active Admin | Record donation outcome after booking/day-of decision; recording the outcome never creates a BloodUnit | bookingId, outcome, collectedAt, collectionReference | donationId, outcome, releaseStatus; no unit-creation result |
| `/api/admin/donations` | GET | Admin | Search donation history | donorAccountId, outcome, releaseStatus, from, to, page | donation summaries |
| `/api/admin/donations/{donationId}/testing-decision` | POST | Active Admin | Record final release decision for a collected donation; approval plus confirmed group creates exactly one unit atomically and idempotently | decision (`APPROVED` or `REJECTED`), decidedAt, reasonCode, confirmedBloodGroupId when approving | releaseStatus; unit summary when created or already created for this approved donation; identical retries return the same unit and never create duplicates; conflicting replay returns a safe conflict |
| `/api/donors/me/donations` | GET | Donor | Read own high-level history | from, to, page | collectedAt, outcome, nextEligibleDate |
| `/api/blood-groups` | GET | Authenticated | List supported groups and compatibility for display | donorGroupId or recipientGroupId (optional) | bloodGroups, compatibilityPairs |
| `/api/admin/blood-groups/{groupId}` | PATCH | Admin | Activate/deactivate or correct group metadata | displayName, isActive, reason | updated bloodGroup |
| `/api/admin/blood-compatibility/{donorGroupId}/{recipientGroupId}` | PATCH | Admin | Correct one reviewed compatibility pair | isCompatible, reason | donorGroup, recipientGroup, isCompatible |
| `/api/inventory` | GET | Admin | Search unit-level inventory | bloodGroupId, unitStatus, availableOnly, collectedFrom/To, expiresFrom/To, expirySoon, page | units, counts, pagination |
| `/api/admin/inventory/{bloodUnitId}` | GET | Active Admin | **Approved addition.** Read one unit and its traceable source/allocation summary | none | unit ID/status/group/expiry, source donation outcome/release status and collection time, allocation statuses and request IDs; no unnecessary donor private data |
| `/api/admin/inventory/{bloodUnitId}/discard` | POST | Admin | Mark available or allocated-but-unissued unit unusable (cancel allocation if needed) | reasonCode, reason | bloodUnitId, unitStatus, discardedAt |
| `/api/admin/inventory/expiry/run` | POST | Admin | Explicitly run/reconcile expiry (scheduled job is also expected) | none | expiredUnitCount, runAt, operationId |

## Hospital requests and allocation

| Route | Method | Role | Purpose | Major request fields | Major response fields |
|---|---|---|---|---|---|
| `/api/hospitals/me` | GET | Hospital | Read own profile | none | hospital profile/status |
| `/api/hospitals/me` | PATCH | Hospital | Update own contact/profile details | contactName, phone, address | updated profile |
| `/api/admin/hospitals` | GET | Active Admin | **Approved addition.** Search/list hospital accounts and profiles | search, accountStatus, page | hospital ID/account status, organization/contact fields needed for management, pagination |
| `/api/admin/hospitals/{hospitalId}` | GET | Active Admin | **Approved addition.** Read one hospital profile and operational summary; `{hospitalId}` identifies the Hospital shared account key | none | hospital/account status, organization/contact fields, request summary; no other hospital's data or staff-only notes |
| `/api/hospitals/me/requests` | POST | Hospital | Submit blood request | recipientGroupId, quantityRequested, priority, neededBy, note | requestId, requestStatus, outstandingQuantity |
| `/api/hospitals/me/requests` | GET | Hospital | List own requests | requestStatus, priority, recipientGroupId, submittedFrom/To, neededByFrom/To, page | requests and fulfillment totals |
| `/api/hospitals/me/requests/{requestId}` | GET | Hospital | View only own request status/detail | none | request fields safe for that Hospital, allocated/issued/outstanding counts, requestStatusHistory; no donor identity, unit provenance, or staff-only notes |
| `/api/hospitals/me/requests/{requestId}/cancellation` | POST | ACTIVE Hospital | Cancel own request only before any unit has been issued; release/cancel unissued allocations transactionally | reasonCode, note | requestStatus, cancelledAt, issued/remaining totals |
| `/api/admin/requests` | GET | Admin | Work queue/search all requests | requestStatus, priority, recipientGroupId, hospitalId, submittedFrom/To, neededByFrom/To, page | requests sorted priority/neededBy/createdAt |
| `/api/admin/requests/{requestId}` | GET | Active Admin | **Approved addition.** Read request details and its allocation history | none | request/status history, requested/allocated/issued/outstanding counts, allocations with unit ID/status/group/expiry, hospital summary and safe request note; no donor identity or staff-only notes |
| `/api/admin/requests/{requestId}/review` | POST | Active Admin | Begin review / set awaiting inventory / reject when the documented transition and allocation-derived state permit it | decision (`UNDER_REVIEW`, `AWAITING_INVENTORY`, `REJECTED`), reasonCode, safeNote | requestStatus, requestStatusHistory |
| `/api/admin/requests/{requestId}/priority` | PATCH | Admin | Change priority with reason | priority (`EMERGENCY`, `URGENT`, `NORMAL`), reason | requestId, priority |
| `/api/admin/requests/{requestId}/allocations` | POST | Active Admin | Allocate compatible available units only when request is `UNDER_REVIEW`, `AWAITING_INVENTORY`, or `PARTIALLY_FULFILLED`; `SUBMITTED` must first enter review, and terminal requests cannot be allocated | quantity (optional; defaults to outstanding derived as requested minus current ALLOCATED and ISSUED), intendedIssueDate | allocations array (one allocationId and bloodUnitId per unit), separately labeled allocated/issued/outstanding totals, requestStatus; never over-allocate or reopen a terminal state |
| `/api/admin/allocations/{allocationId}/cancellation` | POST | Admin | Release allocation before issue | reason | allocationStatus, unitStatus |
| `/api/admin/allocations/{allocationId}/issue` | POST | Admin | Record handoff/issue | issuedAt, handoffReference | allocationStatus, unitStatus, requestStatus |

## Audit, reports, and errors

| Route | Method | Role | Purpose | Major request fields | Major response fields |
|---|---|---|---|---|---|
| `/api/admin/audit-events` | GET | Admin | Search audit history | actorAccountId, actionCode, subjectType, subjectId, from, to, page | events, pagination |
| `/api/admin/reports/inventory` | GET | Admin | Inventory counts/quantities by group and status | asOf/from/to, bloodGroupId, unitStatus | grouped counts |
| `/api/admin/reports/donations` | GET | Admin | Donations by date/outcome and average processing duration | from, to, outcome, interval | totals, grouped series, average duration |
| `/api/admin/reports/requests` | GET | Admin | Request/fulfillment aggregates | from, to, priority, recipientGroupId, requestStatus | request count, requested/allocated/issued sums, grouped results, avg fulfillment duration |
| `/api/hospitals/me/reports/requests` | GET | Hospital | Own request summary | from, to | own counts and requested/issued totals by requestStatus/priority |
| `/api/donors/me/reports/activity` | GET | Donor | Own booking/donation summary | from, to | own booking and donation counts by bookingStatus/outcome and period |

The `GET /api/blood-groups` response is authenticated, but the exact role/account-state scope and whether each role receives the full directed matrix or only necessary choices remain open. See `implementation-readiness.md`; do not use this generic contract to expose operational lookup data to PENDING accounts or broader groups than the permissions allow.

All errors should return a consistent safe error code/message and optional field validation errors. Do not expose SQL, stack traces, password state, session identifiers, secrets, donor identity to hospitals, staff-only notes, or another user's records. Expected domain errors include validation failure, invalid current password, unauthenticated, forbidden, suspended account/session, not found, invalid transition, slot full/capacity conflict, ineligible pending staff review, insufficient stock, and conflict/stale allocation.

## Session behavior

Use server-side sessions with the custom MySQL-backed `app_session` store in `database/infrastructure/auth_sessions.sql`; runtime table creation is disabled and the store is not a domain entity or sample-data table. The implemented cookie is named `bdcs.sid`, `HttpOnly`, `SameSite=Lax`, path `/`, finite (default 120-minute) expiry, and `Secure` in production. Login rotates the session identifier; logout clears the cookie and tombstones the old session ID (`revoked_at` set, payload cleared). Saves and touches cannot restore revoked or expired rows. The store exposes account-wide tombstone revocation for future suspension/password operations; those operations are not implemented in this milestone. Tombstones are retained because removing one while an old request is in flight could permit a stale insert; safe cleanup remains a later deployment decision. Every protected request reloads current Account role/status and revokes a session when the account is missing, suspended, or its role no longer matches the authenticated role. PENDING Donor/Hospital accounts may authenticate only to inspect approval status, read/update permitted own-profile fields, change password, and log out; all operational actions require ACTIVE status. Only Donor self-profile editing is implemented; Hospital editing remains planned. SUSPENDED accounts cannot establish sessions; suspension revokes existing sessions. Reactivation is an audited staff action and requires fresh login; previously revoked sessions remain invalid.

Password change at `POST /api/auth/password` remains unimplemented. When authorized, it must require the current password and validate `newPassword` server-side using the registration policy below, store only a bcrypt hash, audit without password values/hashes, and revoke every account session including the current one. Public password recovery is out of scope.

### Implemented authentication security details

- One shared password policy is used for donor registration and reserved for future password changes: at least 8 Unicode code points; at most 72 UTF-8 bytes; at least one Unicode number and one punctuation/symbol; spaces are allowed but do not count as symbols; no uppercase/lowercase combination is required; reject Unicode control characters. Never trim, normalize, truncate, log, or echo password values. bcrypt work factor is 12.
- Login rejects passwords over 72 UTF-8 bytes before bcrypt comparison and preserves accepted input exactly. It does not apply registration composition rules to existing credentials; invalid login responses remain generic.
- Cookie-authenticated unsafe requests (registration, login, logout, Donor self-profile PATCH) require a session-bound 256-bit random CSRF token in `X-CSRF-Token`. Obtain it from `GET /api/auth/csrf`; the frontend requests it before each profile save and keeps it in memory. Requests from a supplied Origin must match the configured frontend origin. Credentialed CORS permits only that exact origin, including PATCH preflight.
- Registration and login each allow five attempts per client IP in a fixed 15-minute window. The bounded in-process limiter is per Node process; it is not shared across multiple workers/instances. Behind a reverse proxy, `req.ip` reflects the direct connection unless a narrowly trusted proxy is configured; do not trust arbitrary forwarded headers.
- Database errors map to safe codes/messages. API responses never contain password hashes, submitted passwords, session IDs, or raw driver details. Registration returns a pending account identity but does not authenticate it.
- `GET /api/auth/me` returns only Account identity/role/status and does not query the Hospital table. `GET/PATCH /api/donors/me` require the Donor profile schema; missing database/profile dependencies fail closed with a safe service error. PATCH uses a fixed SQL column allowlist, updates `Donor.updated_at` explicitly, and treats identical submitted values as success; validation, missing profile, authorization, and database failures use safe errors. Both profile responses are `no-store`.
- The client clears cached identity and Donor profile state and returns protected views to sign-in on a `401` with `AUTHENTICATION_REQUIRED` or `ACCOUNT_UNAVAILABLE`. Invalid-login `401` (`INVALID_CREDENTIALS`) and transient `503` responses do not revoke cached identity. Response handling does not retry protected requests automatically.

### Validation and error expectations for approved additions

- All path identifiers must parse as valid existing identifiers. Return the safe `not found` error for missing or out-of-scope records; do not reveal a Hospital's records to another Hospital.
- Admin donor, Hospital, unit, and request reads require an ACTIVE Admin. Return only the response fields listed in their route rows. Hospital-facing request list/detail responses must not include donor identity, unit-level donor provenance, or staff-only notes.
- `GET /api/admin/hospitals` validates/normalizes search, account-status filter, and pagination; it returns only management fields, not credentials or hashes. `GET /api/admin/hospitals/{hospitalId}` reads the identified Hospital profile and safe operational summary.
- `GET /api/admin/requests/{requestId}` includes allocation history belonging only to that request, with unit ID/group/expiry and allocation status/timestamps. The detail read is Admin-only and does not expose donor identity or staff-only notes.
- Request review, allocation, cancellation, discard, issue, and expiry operations must validate the canonical transition and current allocation-derived quantities under the shared concurrency strategy; terminal request states are not reopened.
- `POST /api/auth/password` requires an authenticated non-suspended session and a valid CSRF token, a non-empty current password that verifies against the stored bcrypt hash, and a server-valid new password under the shared registration policy above. Expected safe errors include unauthenticated, forbidden/suspended, invalid current password, password validation failure, CSRF failure, and rate-limit response. Do not echo submitted passwords or return hashes.
- Common safe errors include validation failure, unauthenticated, forbidden, not found, invalid transition, conflict, and rate limited. Responses must not expose SQL, stack traces, credentials, hashes, donor identity to Hospitals, or staff-only notes.

`SESSION_SECRET` must be privately configured with at least 32 random UTF-8 bytes; `SESSION_TTL_MINUTES` is optional and defaults to 120 (allowed range 5–1440). Authentication fails closed if session configuration, database connection, or manually created session table is unavailable. The in-process limiter is suitable only for single-process development; shared rate-limit storage is a later deployment decision.

### Open API contract gaps (no new routes approved here)

Screen-to-endpoint mapping shows planned coverage only; it does not imply that every operation shown or implied by a screen has a complete approved contract.

- The permissions document permits staff-created non-admin profiles and audited corrections to completed Donation records, but this API table has no corresponding creation or correction operation. Resolve the policy/contract mismatch before implementing either action.
- The domain state table includes `PARTIALLY_FULFILLED -> CANCELLED`, but whether staff may cancel after partial issue is OPEN; no Admin request-cancellation operation is approved. If permission is approved, retaining issued allocations and releasing unissued allocations is a proposal only. Do not infer staff permission or a contract from the Hospital cancellation route.
- Booking treatment of `REVIEW_REQUIRED`, the exact date used for the 56-day check, role-scoped blood-group lookup fields, timestamp ownership, and equal-time eligibility-decision ordering remain design questions listed in `implementation-readiness.md`.
