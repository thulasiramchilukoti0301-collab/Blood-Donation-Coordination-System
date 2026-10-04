# Preliminary API Design

This is a planning contract, not an implementation. All endpoints use JSON over HTTP. Protected routes use the server-side authenticated principal; clients must not select their role or override ownership by submitting actor/hospital/donor identifiers. IDs, pagination, timestamps, and error envelope details can be finalized alongside implementation.

## Authentication and accounts

| Route | Method | Role | Purpose | Major request fields | Major response fields |
|---|---|---|---|---|---|
| `/api/auth/register/donors` | POST | Public | Create pending donor account/profile | name, email/contact, password, DOB, address/area, reported blood group | donorId, accountStatus, safe profile |
| `/api/auth/register/hospitals` | POST | Public | Create pending hospital account/profile | organizationName, registration/contact details, address, password | hospitalId, accountStatus, safe profile |
| `/api/auth/login` | POST | Public | Authenticate and establish secure session | email/username, password | userId, role, displayName; session cookie set |
| `/api/auth/logout` | POST | Authenticated | End current session | none | success |
| `/api/auth/me` | GET | Authenticated | Current identity and role | none | userId, role, accountStatus, profile summary |
| `/api/admin/accounts` | GET | Admin | Search/approve queue and accounts | role/status/search/page | accounts, pagination |
| `/api/admin/accounts/{accountId}` | PATCH | Admin | Approve/suspend or correct account status | accountStatus, reason | updated account status |

## Donors, eligibility, and bookings

| Route | Method | Role | Purpose | Major request fields | Major response fields |
|---|---|---|---|---|---|
| `/api/donors/me` | GET | Donor | Read own profile | none | profile, confirmedBloodGroup, accountStatus |
| `/api/donors/me` | PATCH | Donor | Update own editable profile fields | name/contact/address/area | updated profile |
| `/api/admin/donors` | GET | Admin | Search donor records | search, bloodGroup, accountStatus, eligibility, area, page | donor summaries, pagination |
| `/api/admin/donors/{donorId}` | PATCH | Admin | Correct/confirm operational profile | editable fields, confirmedBloodGroup, reason | updated donor summary |
| `/api/donors/me/eligibility` | GET | Donor | View advisory interval result | optional asOfDate for display/testing only; server controls actual date | result, nextEligibleDate, checkedAt, safe reason |
| `/api/admin/donors/{donorId}/eligibility-decisions` | POST | Admin | Record day-of decision/deferral | donationDate, decision, deferredUntil, reasonCode, safeNote | decisionId, decision, nextEligibleDate |
| `/api/donation-slots` | GET | Donor, Admin | Donor lists open slots; Admin may filter all slots | from, to, status (Admin), page | slots with capacity/remaining count |
| `/api/admin/donation-slots` | POST | Admin | Create slot | startsAt, endsAt, capacity | slot |
| `/api/admin/donation-slots/{slotId}` | PATCH | Admin | Change/cancel future slot | startsAt, endsAt, capacity, status, reason | updated slot |
| `/api/donors/me/bookings` | GET | Donor | List own bookings | status, from, to, page | bookings |
| `/api/donors/me/bookings` | POST | Donor | Book an open slot | slotId | bookingId, status, slot summary |
| `/api/donors/me/bookings/{bookingId}/cancellation` | POST | Donor | Cancel own booking before start | reasonCode optional | bookingId, status, cancelledAt |
| `/api/admin/bookings` | GET | Admin | Search bookings/check-in queue | donor, status, from, to, page | bookings |
| `/api/admin/bookings/{bookingId}/status` | PATCH | Admin | Check in, mark no-show, staff-cancel | status, reason | booking |

## Donation and inventory

| Route | Method | Role | Purpose | Major request fields | Major response fields |
|---|---|---|---|---|---|
| `/api/admin/donations` | POST | Admin | Record donation after booking/day-of decision | bookingId, outcome, collectedAt, confirmedGroup, collectionReference | donationId, status, unitPendingApproval |
| `/api/admin/donations` | GET | Admin | Search donation history | donor, outcome, testingStatus, from, to, page | donation summaries |
| `/api/admin/donations/{donationId}/testing-decision` | POST | Admin | Approve/reject collected donation | decision, decidedAt, reasonCode | donation status; created unit summary if approved |
| `/api/donors/me/donations` | GET | Donor | Read own high-level history | from, to, page | donation date, safe outcome/status, nextEligibleDate |
| `/api/blood-groups` | GET | Authenticated | List supported groups and compatibility for display | direction (optional) | bloodGroups, compatibility pairs |
| `/api/admin/blood-groups` | POST | Admin | Add/update supported reference group (if design permits) | code, label, active | bloodGroup |
| `/api/admin/blood-groups/{groupId}` | PATCH | Admin | Activate/deactivate or correct group metadata; compatibility edits remain controlled reference-data changes | label, active, reason | updated bloodGroup |
| `/api/inventory` | GET | Admin | Search unit-level inventory | group, status, availableOnly, collectedFrom/To, expiresFrom/To, expirySoon, page | units, counts, pagination |
| `/api/admin/inventory/{unitId}/discard` | POST | Admin | Mark usable/unissued unit unusable | reasonCode, reason | unitId, status, discardedAt |
| `/api/admin/inventory/expiry/run` | POST | Admin | Explicitly run/reconcile expiry (scheduled job is also expected) | asOfDate omitted in normal use | updatedCount, runAt |

## Hospital requests and allocation

| Route | Method | Role | Purpose | Major request fields | Major response fields |
|---|---|---|---|---|---|
| `/api/hospitals/me` | GET | Hospital | Read own profile | none | hospital profile/status |
| `/api/hospitals/me` | PATCH | Hospital | Update own contact/profile details | contactName, phone, address | updated profile |
| `/api/hospitals/me/requests` | POST | Hospital | Submit blood request | recipientGroup, quantityRequested, priority, neededBy, note | requestId, status, quantityOutstanding |
| `/api/hospitals/me/requests` | GET | Hospital | List own requests | status, priority, group, submittedFrom/To, neededByFrom/To, page | requests and fulfillment totals |
| `/api/hospitals/me/requests/{requestId}` | GET | Hospital | View own request status/detail | none | request, allocated/issued/outstanding counts, status history |
| `/api/hospitals/me/requests/{requestId}/cancellation` | POST | Hospital | Cancel own request before issue | reasonCode, note | request status, cancellation timestamp |
| `/api/admin/requests` | GET | Admin | Work queue/search all requests | status, priority, group, hospital, submittedFrom/To, neededByFrom/To, page | requests sorted priority/neededBy/createdAt |
| `/api/admin/requests/{requestId}/review` | POST | Admin | Begin review / set awaiting inventory / reject | decision, reasonCode, safeNote | status, status history |
| `/api/admin/requests/{requestId}/priority` | PATCH | Admin | Change priority with reason | priority, reason | updated priority |
| `/api/admin/requests/{requestId}/allocations` | POST | Admin | Allocate compatible available units | quantity (optional; default outstanding), intendedIssueDate | allocationId, selected unit summaries, allocated/outstanding totals, request status |
| `/api/admin/allocations/{allocationId}/cancellation` | POST | Admin | Release allocation before issue | reason | allocation/unit statuses |
| `/api/admin/allocations/{allocationId}/issue` | POST | Admin | Record handoff/issue | issuedAt, handoffReference | allocation, issued units, updated request status |

## Audit, reports, and errors

| Route | Method | Role | Purpose | Major request fields | Major response fields |
|---|---|---|---|---|---|
| `/api/admin/audit-events` | GET | Admin | Search audit history | actor, action, entityType, entityId, from, to, page | events, pagination |
| `/api/admin/reports/inventory` | GET | Admin | Inventory counts/quantities by group and status | asOf/from/to, group | grouped counts |
| `/api/admin/reports/donations` | GET | Admin | Donations by date/status/group and average processing duration | from, to, group, status, interval | totals, grouped series, average duration |
| `/api/admin/reports/requests` | GET | Admin | Request/fulfillment aggregates | from, to, priority, group, status | request count, requested/allocated/issued sums, grouped results, avg fulfillment duration |
| `/api/hospitals/me/reports/requests` | GET | Hospital | Own request summary | from, to | own counts and requested/issued totals by status/priority |
| `/api/donors/me/reports/activity` | GET | Donor | Own booking/donation summary | from, to | own booking and donation counts by status/period |

All errors should return a consistent safe error code/message and optional field validation errors. Do not expose SQL, stack traces, password state, session identifiers, secrets, or another user's records. Expected domain errors include validation failure, unauthenticated, forbidden, not found, invalid transition, slot full, ineligible pending staff review, insufficient stock, and conflict/stale allocation.

## Session behavior

Use server-side sessions with an opaque, high-entropy session identifier in an `HttpOnly`, `Secure` (in HTTPS deployment), `SameSite` cookie. Rotate session on successful login and privilege/account changes; invalidate on logout and suspension. Apply CSRF protection for state-changing cookie-authenticated requests and rate-limit login attempts. Passwords are bcrypt hashes; never return/store raw passwords. The session store choice is an implementation detail; a persistent store is preferable if deployment spans restarts, while a database-backed store should not be confused with the domain schema.
