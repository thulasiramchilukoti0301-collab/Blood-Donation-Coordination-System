# Preliminary API Design

This is the preliminary API contract, not an implementation. Endpoints use JSON over HTTP. Request/response property names are camelCase; database column names remain snake_case. State, outcome, role, and priority codes use the exact uppercase values defined in `domain-rules.md` and `database-design.md`; screens may display title-case labels. Protected routes use the server-side authenticated principal; clients must not select their role or override ownership by submitting actor/hospital/donor identifiers. IDs, pagination, timestamps, and error envelope details can be finalized alongside implementation.

## Authentication and accounts

| Route | Method | Role | Purpose | Major request fields | Major response fields |
|---|---|---|---|---|---|
| `/api/auth/register/donors` | POST | Public | Create pending donor account/profile | name, email/contact, password, DOB, address/area, reported blood group | donorId, accountStatus, safe profile |
| `/api/auth/register/hospitals` | POST | Public | Create pending hospital account/profile | organizationName, registration/contact details, address, password | hospitalId, accountStatus, safe profile |
| `/api/auth/login` | POST | Public | Authenticate and establish secure session | email, password | userId, role, displayName; session cookie set |
| `/api/auth/logout` | POST | Authenticated | End current session | none | success |
| `/api/auth/me` | GET | Authenticated | Current identity and role | none | userId, role, accountStatus, profile summary |
| `/api/admin/accounts` | GET | Admin | Search/approve queue and accounts | role, accountStatus, search, page | accounts, pagination |
| `/api/admin/accounts/{accountId}` | PATCH | Admin | Approve/suspend or correct account status | accountStatus (`ACTIVE` or `SUSPENDED`), reason | accountId, accountStatus |

## Donors, eligibility, and bookings

| Route | Method | Role | Purpose | Major request fields | Major response fields |
|---|---|---|---|---|---|
| `/api/donors/me` | GET | Donor | Read own profile | none | profile, confirmedBloodGroup, accountStatus |
| `/api/donors/me` | PATCH | Donor | Update own editable profile fields | name/contact/address/area | updated profile |
| `/api/admin/donors` | GET | Admin | Search donor records | search, bloodGroupId, accountStatus, eligibility, area, page | donor summaries, pagination |
| `/api/admin/donors/{donorId}` | PATCH | Admin | Correct/confirm operational profile | editable fields, confirmedBloodGroup, reason | updated donor summary |
| `/api/donors/me/eligibility` | GET | Donor | View advisory interval result | none; server controls evaluation date | result (`ELIGIBLE`, `INELIGIBLE_UNTIL_DATE`, `STAFF_REVIEW_REQUIRED`), nextEligibleDate, checkedAt, safe reason |
| `/api/admin/donors/{donorId}/eligibility-decisions` | POST | Admin | Record day-of decision/deferral | decision, bookingId (optional), deferredUntil, reasonCode, safeNote | eligibilityDecisionId, decision, nextEligibleDate |
| `/api/donation-slots` | GET | Donor, Admin | Donor lists open slots; Admin may filter all slots | from, to, slotStatus (Admin), page | slots with capacity/remaining count |
| `/api/admin/donation-slots` | POST | Admin | Create slot | startsAt, endsAt, capacity | slotId, slotStatus, startsAt, endsAt, capacity |
| `/api/admin/donation-slots/{slotId}` | PATCH | Admin | Change/cancel future slot | startsAt, endsAt, capacity, slotStatus, reason | slotId, slotStatus, startsAt, endsAt, capacity |
| `/api/donors/me/bookings` | GET | Donor | List own bookings | bookingStatus, from, to, page | bookings |
| `/api/donors/me/bookings` | POST | Donor | Book an open slot | slotId | bookingId, bookingStatus, slot summary |
| `/api/donors/me/bookings/{bookingId}/cancellation` | POST | Donor | Cancel own booking before start | reasonCode optional | bookingId, bookingStatus, cancelledAt |
| `/api/admin/bookings` | GET | Admin | Search bookings/check-in queue | donor, bookingStatus, from, to, page | bookings |
| `/api/admin/bookings/{bookingId}/status` | PATCH | Admin | Check in, mark no-show, staff-cancel | bookingStatus, reason | booking |

## Donation and inventory

| Route | Method | Role | Purpose | Major request fields | Major response fields |
|---|---|---|---|---|---|
| `/api/admin/donations` | POST | Admin | Record donation after booking/day-of decision | bookingId, outcome, collectedAt, collectionReference | donationId, outcome, releaseStatus, bloodUnitCreated |
| `/api/admin/donations` | GET | Admin | Search donation history | donorAccountId, outcome, releaseStatus, from, to, page | donation summaries |
| `/api/admin/donations/{donationId}/testing-decision` | POST | Admin | Record release decision for a collected donation | decision (`APPROVED` or `REJECTED`), decidedAt, reasonCode, confirmedBloodGroupId when approving | releaseStatus; created bloodUnit summary if approved |
| `/api/donors/me/donations` | GET | Donor | Read own high-level history | from, to, page | collectedAt, outcome, nextEligibleDate |
| `/api/blood-groups` | GET | Authenticated | List supported groups and compatibility for display | donorGroupId or recipientGroupId (optional) | bloodGroups, compatibilityPairs |
| `/api/admin/blood-groups/{groupId}` | PATCH | Admin | Activate/deactivate or correct group metadata | displayName, isActive, reason | updated bloodGroup |
| `/api/admin/blood-compatibility/{donorGroupId}/{recipientGroupId}` | PATCH | Admin | Correct one reviewed compatibility pair | isCompatible, reason | donorGroup, recipientGroup, isCompatible |
| `/api/inventory` | GET | Admin | Search unit-level inventory | bloodGroupId, unitStatus, availableOnly, collectedFrom/To, expiresFrom/To, expirySoon, page | units, counts, pagination |
| `/api/admin/inventory/{bloodUnitId}/discard` | POST | Admin | Mark available or allocated-but-unissued unit unusable (cancel allocation if needed) | reasonCode, reason | bloodUnitId, unitStatus, discardedAt |
| `/api/admin/inventory/expiry/run` | POST | Admin | Explicitly run/reconcile expiry (scheduled job is also expected) | none | expiredUnitCount, runAt, operationId |

## Hospital requests and allocation

| Route | Method | Role | Purpose | Major request fields | Major response fields |
|---|---|---|---|---|---|
| `/api/hospitals/me` | GET | Hospital | Read own profile | none | hospital profile/status |
| `/api/hospitals/me` | PATCH | Hospital | Update own contact/profile details | contactName, phone, address | updated profile |
| `/api/hospitals/me/requests` | POST | Hospital | Submit blood request | recipientGroupId, quantityRequested, priority, neededBy, note | requestId, requestStatus, outstandingQuantity |
| `/api/hospitals/me/requests` | GET | Hospital | List own requests | requestStatus, priority, recipientGroupId, submittedFrom/To, neededByFrom/To, page | requests and fulfillment totals |
| `/api/hospitals/me/requests/{requestId}` | GET | Hospital | View own request status/detail | none | request, allocated/issued/outstanding counts, requestStatusHistory |
| `/api/hospitals/me/requests/{requestId}/cancellation` | POST | Hospital | Cancel own request before issue | reasonCode, note | requestStatus, cancelledAt |
| `/api/admin/requests` | GET | Admin | Work queue/search all requests | requestStatus, priority, recipientGroupId, hospitalId, submittedFrom/To, neededByFrom/To, page | requests sorted priority/neededBy/createdAt |
| `/api/admin/requests/{requestId}/review` | POST | Admin | Begin review / set awaiting inventory / reject | decision (`UNDER_REVIEW`, `AWAITING_INVENTORY`, `REJECTED`), reasonCode, safeNote | requestStatus, requestStatusHistory |
| `/api/admin/requests/{requestId}/priority` | PATCH | Admin | Change priority with reason | priority (`EMERGENCY`, `URGENT`, `NORMAL`), reason | requestId, priority |
| `/api/admin/requests/{requestId}/allocations` | POST | Admin | Allocate compatible available units | quantity (optional; defaults to outstanding), intendedIssueDate | allocations array (one allocationId and bloodUnitId per unit), allocated/outstanding totals, requestStatus |
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

All errors should return a consistent safe error code/message and optional field validation errors. Do not expose SQL, stack traces, password state, session identifiers, secrets, or another user's records. Expected domain errors include validation failure, unauthenticated, forbidden, not found, invalid transition, slot full, ineligible pending staff review, insufficient stock, and conflict/stale allocation.

## Session behavior

Use server-side sessions with an opaque, high-entropy session identifier in an `HttpOnly`, `Secure` (in HTTPS deployment), `SameSite` cookie. Rotate session on successful login and privilege/account changes; invalidate on logout and suspension. Apply CSRF protection for state-changing cookie-authenticated requests and rate-limit login attempts. Passwords are bcrypt hashes; never return/store raw passwords. The session store choice is an implementation detail; a persistent store is preferable if deployment spans restarts, while a database-backed store should not be confused with the domain schema.
