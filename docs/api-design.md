# Preliminary API Design

This is a planned API contract, not an implementation. Endpoints use JSON over HTTP. Request/response property names are camelCase; database column names remain snake_case. State, outcome, role, and priority codes use the exact uppercase values defined in `domain-rules.md` and `database-design.md`; screens may display title-case labels. Protected routes use the server-side authenticated principal; clients must not select their role or override ownership by submitting actor/hospital/donor identifiers. Every protected request checks current account status, role, and resource ownership. Routes marked **Approved addition** are approved documentation contracts for planned implementation; no endpoint is claimed to exist in code. Unless an operation is expressly allowed to PENDING accounts below, operational endpoints require an ACTIVE account; Admin operations require an ACTIVE Admin.

## Authentication and accounts

| Route | Method | Role | Purpose | Major request fields | Major response fields |
|---|---|---|---|---|---|
| `/api/auth/register/donors` | POST | Public | Create pending donor account/profile | name, email/contact, password (shared password policy to be decided), DOB, address/area, reported blood group | donorId, accountStatus, safe profile |
| `/api/auth/register/hospitals` | POST | Public | Create pending hospital account/profile | organizationName, registration/contact details, address, password (shared password policy to be decided) | hospitalId, accountStatus, safe profile |
| `/api/auth/login` | POST | Public | Authenticate and establish secure session | email, password | userId, role, displayName; session cookie set |
| `/api/auth/logout` | POST | Authenticated | End current session | none | success |
| `/api/auth/me` | GET | Donor, Hospital, Admin | Current identity and role; PENDING Donor/Hospital sessions may use this for approval status | none | userId, role, accountStatus, profile summary |
| `/api/auth/password` | POST | Authenticated Donor, Hospital, Admin; PENDING Donor/Hospital allowed | **Approved addition.** Verify current password and change password | currentPassword, newPassword | success; revoke all sessions, including current session; user must log in again |
| `/api/admin/accounts` | GET | Admin | Search/approve queue and accounts | role, accountStatus, search, page | accounts, pagination |
| `/api/admin/accounts/{accountId}` | PATCH | Active Admin | Approve, suspend, or reactivate account | accountStatus (`ACTIVE` or `SUSPENDED`), reason | accountId, accountStatus; reactivation requires fresh login and never restores previously revoked sessions |

## Donors, eligibility, and bookings

| Route | Method | Role | Purpose | Major request fields | Major response fields |
|---|---|---|---|---|---|
| `/api/donors/me` | GET | Donor | Read own profile | none | profile, confirmedBloodGroup, accountStatus |
| `/api/donors/me` | PATCH | Donor | Update own editable profile fields | name/contact/address/area | updated profile |
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

Use server-side sessions with an opaque, high-entropy session identifier in an `HttpOnly`, `Secure` (in HTTPS deployment), `SameSite` cookie. Rotate session on successful login and privilege/account changes; invalidate on logout, suspension, and password change. Every protected request checks current account status, role, and ownership. ACTIVE accounts can perform their authorized operations. PENDING Donor/Hospital accounts may authenticate only to inspect approval status, read/update permitted own-profile fields, change password, and log out; all operational actions require ACTIVE status. SUSPENDED accounts cannot establish sessions; suspension revokes existing sessions. Reactivation is an audited staff action and requires fresh login; previously revoked sessions remain invalid.

Password change at `POST /api/auth/password` requires the current password and server-side validation of `newPassword` against the same policy as registration, stores only a bcrypt hash, audits the event without password values/hashes, and revokes every session for that account including the current one. The response must not leave the caller authenticated. CSRF protection applies. Login remains rate-limited. Public password recovery is out of scope. **Password-policy decision:** the existing registration contract does not define concrete password requirements; agree one shared registration/change policy before implementation rather than inventing it here.

### Validation and error expectations for approved additions

- All path identifiers must parse as valid existing identifiers. Return the safe `not found` error for missing or out-of-scope records; do not reveal a Hospital's records to another Hospital.
- Admin donor, Hospital, unit, and request reads require an ACTIVE Admin. Return only the response fields listed in their route rows. Hospital-facing request list/detail responses must not include donor identity, unit-level donor provenance, or staff-only notes.
- `GET /api/admin/hospitals` validates/normalizes search, account-status filter, and pagination; it returns only management fields, not credentials or hashes. `GET /api/admin/hospitals/{hospitalId}` reads the identified Hospital profile and safe operational summary.
- `GET /api/admin/requests/{requestId}` includes allocation history belonging only to that request, with unit ID/group/expiry and allocation status/timestamps. The detail read is Admin-only and does not expose donor identity or staff-only notes.
- Request review, allocation, cancellation, discard, issue, and expiry operations must validate the canonical transition and current allocation-derived quantities under the shared concurrency strategy; terminal request states are not reopened.
- `POST /api/auth/password` requires an authenticated non-suspended session and a valid CSRF token, a non-empty current password that verifies against the stored bcrypt hash, and a server-valid new password under the unresolved shared registration policy. Expected safe errors include unauthenticated, forbidden/suspended, invalid current password, password validation failure, CSRF failure, and rate-limit response. Do not echo submitted passwords or return hashes.
- Common safe errors include validation failure, unauthenticated, forbidden, not found, invalid transition, conflict, and rate limited. Responses must not expose SQL, stack traces, credentials, hashes, donor identity to Hospitals, or staff-only notes.

The session-store choice is an implementation/configuration decision; a persistent store is preferable if deployment spans restarts, while a database-backed store should not be confused with the domain schema.

### Open API contract gaps (no new routes approved here)

Screen-to-endpoint mapping shows planned coverage only; it does not imply that every operation shown or implied by a screen has a complete approved contract.

- The permissions document permits staff-created non-admin profiles and audited corrections to completed Donation records, but this API table has no corresponding creation or correction operation. Resolve the policy/contract mismatch before implementing either action.
- The domain state table includes `PARTIALLY_FULFILLED -> CANCELLED`, but whether staff may cancel after partial issue is OPEN; no Admin request-cancellation operation is approved. If permission is approved, retaining issued allocations and releasing unissued allocations is a proposal only. Do not infer staff permission or a contract from the Hospital cancellation route.
- Booking treatment of `REVIEW_REQUIRED`, the exact date used for the 56-day check, role-scoped blood-group lookup fields, timestamp ownership, and equal-time eligibility-decision ordering remain design questions listed in `implementation-readiness.md`.
