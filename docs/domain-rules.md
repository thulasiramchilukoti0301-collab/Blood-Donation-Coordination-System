# Domain Rules and Lifecycle Definitions

Canonical API/database state and decision codes are uppercase. Human-readable labels are presentation only.

## 1. Donor lifecycle

### Registration and profile

1. Donor submits name, date of birth, contact details, address/area, ABO/Rh blood group (if known), and credentials. Server validates required fields and unique login identifiers.
2. New donor account is `PENDING` until staff approves it. The donor may complete/edit their own profile; staff may correct/approve it. A donor cannot approve their own account or edit another donor.
3. PENDING Donor/Hospital users may authenticate only to see approval status, access/update permitted own-profile fields, change their password, and log out. They cannot book or perform other operational actions. SUSPENDED accounts cannot establish sessions; suspension revokes existing sessions and every protected request checks current account state. Reactivation is an audited staff action and requires fresh login; revoked sessions remain invalid.
4. The shared registration and implemented password-change policy requires at least 8 Unicode code points and no more than 72 UTF-8 bytes, one Unicode number and one punctuation/symbol character, with control characters rejected. Spaces are preserved and do not satisfy the symbol requirement. No upper/lowercase combination is required. Passwords are never trimmed, normalized, truncated, logged, or echoed; bcrypt work factor is 12. Password changes require current-password verification and invalidate every session in the same transaction as the hash update and non-sensitive audit event.
5. Staff confirmation/testing is authoritative for the blood group used for inventory. A donor-provided or self-reported group is not sufficient to establish an allocatable unit's group.
6. The bounded Admin Donor Management operation separates ordinary staff profile corrections from explicit confirmed-group selection. `reported_blood_group_id` remains a Donor self-report and is never copied into `confirmed_blood_group_id`. Existing Donation/BloodUnit history and each unit's recorded group are immutable through profile correction. Before changing the confirmed group, the service compares the proposed group with all existing BloodUnit group history for that Donor; a mismatch is a conflict, not a history rewrite. Clearing an established confirmed group and inactive BloodGroup eligibility/allocation behavior are not defined by this operation.
7. Donation history is derived from donation records and visible to that donor and authorized staff. Donors cannot create or edit completed donation records.

### Eligibility

- Eligibility check returns `ELIGIBLE`, `INELIGIBLE_UNTIL_DATE`, or `STAFF_REVIEW_REQUIRED`, plus `checkedAt` and a safe reason code/message. It is advisory; the final pre-donation acceptance is recorded by trained/authorized staff.
- For the educational whole-blood workflow, an otherwise accepted donor must have at least 56 calendar days since their last successful collection (`COLLECTED` donation outcome), regardless of the later release result. `nextEligibleDate = lastSuccessfulCollectionDate + 56 days`; if there is no prior successful collection, the interval test passes. Failed/incomplete attempts do not advance this interval date. The 56-day interval is a configurable educational project rule, not a universal clinical rule.
- Other suitability criteria are not auto-evaluated. Staff records the day-of decision and a non-sensitive outcome/reason category; do not store detailed private medical questionnaire answers in this mini-project.
- A temporary deferral has `deferred_until`. For the bounded Admin day-of API, it is a valid IST calendar date on or after today; other decisions carry no deferral date. Indefinite review is represented by `REVIEW_REQUIRED` with no `deferred_until`; the system does not infer durations from medical data.
- For display/booking checks, order staff decisions by `decided_at DESC, eligibility_decision_id DESC`. A latest temporary deferral blocks through `deferred_until` inclusively; a latest `REVIEW_REQUIRED` blocks until a later decision, and a later `ACCEPTED` clears it. The 56-day interval remains independently enforced.
- The 56-day interval is an educational project rule, not a universal or clinical eligibility determination. Actual blood services must follow applicable national criteria and qualified staff assessment. [WHO donor-selection guidance](https://www.who.int/publications/i/item/blood-donor-selection-guidelines-on-assessing-donor-suitability-for-blood-donation), [WHO donor eligibility overview](https://www.who.int/campaigns/world-blood-donor-day/who-can-give-blood).

### Booking and cancellation

- Staff defines each slot's start/end and positive capacity in Asia/Kolkata local time; slot duration is not fixed by the system. Capacity occupancy counts `BOOKED` reservations and `CHECKED_IN` bookings. `CANCELLED_BY_DONOR`, `CANCELLED_BY_STAFF`, `NO_SHOW`, and `COMPLETED` do not occupy capacity. Capacity may be raised freely, but a reduction below the current occupied count is rejected.
- Reject edits to a slot's schedule once any booking row exists for it. The approved DonationSlot schema and slot API do not define a location field, so location persistence/editing is not currently part of the design. Cancelling a future slot follows the existing cancellation rule: cancel its still-`BOOKED` bookings with staff reason/audit; a checked-in donor must be resolved as a donation outcome rather than silently cancelled.
- A donor can book an open future slot only if account status is `ACTIVE`, the eligibility check passes on the selected appointment's Asia/Kolkata date, and they have no other active booking whose actual time window overlaps it. For this capacity/overlap rule, active bookings are `BOOKED` and `CHECKED_IN`. The 56-day calendar interval uses the latest `COLLECTED` Donation regardless of release status; no collected history passes that interval check. The latest staff decision is ordered by `decided_at DESC, eligibility_decision_id DESC`: `REVIEW_REQUIRED` blocks until a later decision, `TEMPORARILY_DEFERRED` blocks through `deferred_until` inclusively, and later `ACCEPTED` clears those blocks without waiving the 56-day interval. The own-status preview uses today's server Asia/Kolkata date and is advisory; see `eligibility-booking.md`.
- Schema key `(donor_account_id, slot_id)` prevents booking the same slot again even after a previous booking is cancelled. The API/UI should present that explicit schema consequence and report a safe conflict on a duplicate attempt.
- Booking statuses: `BOOKED`, `CANCELLED_BY_DONOR`, `CANCELLED_BY_STAFF`, `CHECKED_IN`, `NO_SHOW`, `COMPLETED`.
- Donor cancellation is permitted until the slot start time; after that, staff-only resolution is required. The bounded staff check-in action permits only `BOOKED -> CHECKED_IN` for an ACTIVE Donor during `starts_at <= server_now < ends_at`, with a non-cancelled slot (CLOSED appointments remain valid). It records `BOOKING_CHECKED_IN` / `STAFF_CHECKED_IN`, preserves occupied capacity, and creates no Donation.
- Individual staff booking actions use a deliberately narrow policy: only an ACTIVE Admin may change a `BOOKED` row for an ACTIVE Donor on a non-cancelled slot, and only when no Donation exists. `BOOKED -> CANCELLED_BY_STAFF` is allowed strictly before slot start, with fixed reason `STAFF_CANCELLED`; `BOOKED -> NO_SHOW` is allowed at or after slot end, with fixed reason `STAFF_NO_SHOW`. Neither action changes `CHECKED_IN`, `COMPLETED`, already-cancelled, or other states. A CLOSED slot may retain and resolve its existing bookings. The Admin chooses no free-text reason. These bounds keep staff cancellation before the appointment and no-show after it; no intermediate attendance override is introduced.
- `BOOKED -> CANCELLED_BY_DONOR` or `CANCELLED_BY_STAFF`; `BOOKED -> CHECKED_IN -> COMPLETED`; `BOOKED -> NO_SHOW`. Recording one permitted Donation outcome resolves a `CHECKED_IN` visit and changes that Booking to `COMPLETED` in the same transaction. `COMPLETED` means the visit was resolved, not that collection succeeded. `COLLECTED` is a successful collection, `INCOMPLETE` is an accepted attempt that did not complete, and `DEFERRED` ends the visit without collection after a latest same-visit `TEMPORARILY_DEFERRED` decision. `REVIEW_REQUIRED` remains unresolved until a later supported final decision. Do not infer `DEFERRED` from elapsed time or absence of a collection. Cancellation/no-show does not create a Donation or unit.
- Keep cancelled/no-show bookings as history; do not delete them.

The schema booking statuses and capacity treatment are: `BOOKED` (occupies capacity), `CHECKED_IN` (occupies capacity), `CANCELLED_BY_DONOR` (does not), `CANCELLED_BY_STAFF` (does not), `NO_SHOW` (does not), and `COMPLETED` (does not). These names match `database-design.md` and `relational-schema.md`.

## 2. Donation lifecycle

1. Staff checks in the donor during the appointment interval, then performs the day-of assessment and records an `ACCEPTED`, `TEMPORARILY_DEFERRED`, or `REVIEW_REQUIRED` EligibilityDecision. The bounded API requires the appointment's current IST date, same-owner checked-in booking, ACTIVE Donor and no existing Donation; ACCEPTED independently checks the 56-day interval. Each decision is appended with deterministic latest ordering and a fixed audit reason. A booking being `BOOKED` or donor eligibility previewing `ELIGIBLE` is not proof of acceptance. This subset accepts no free-text medical answers.
2. Staff records one Donation outcome of `COLLECTED`, `INCOMPLETE`, or `DEFERRED` for the checked-in visit and completes the Booking atomically. `COLLECTED` and `INCOMPLETE` require the latest same-visit decision to be `ACCEPTED` plus current donor-wide eligibility and the independent 56-calendar-day collection interval. `DEFERRED` requires the latest same-visit decision to be `TEMPORARILY_DEFERRED` and does not require collection eligibility. The decision must belong to the booking and donor and have been recorded on that appointment's current IST date. Recording preserves decision history and creates no BloodUnit. A cancelled/no-show booking has no Donation row.
4. Collected donations proceed to release review: `PENDING`, `APPROVED`, or `REJECTED` (`NOT_REQUIRED` for non-collected outcomes). Staff records decision timestamp and safe category/reason. Rejected or incomplete donations never create an allocatable unit.
5. Exactly one unit is created atomically only when a collected donation receives `APPROVED` release with a confirmed blood group. Repeating the same approval request is idempotent and cannot create a duplicate unit. Creation records source donation, group, collection date through the donation record, and expiry date; its persisted status starts as `AVAILABLE` if the expiry date is in the future, otherwise `EXPIRED`.
6. One collected donation creates one unit for this project. This is a simplified mini-project assumption, not a model of component processing.

The bounded release implementation accepts only a `PENDING` `COLLECTED` Donation. An ACTIVE Admin chooses an active BloodGroup explicitly for `APPROVED`, independent of any self-reported group. This confirms the unit's group without editing the Donor profile; an existing different staff-confirmed Donor group causes a conflict. The server computes expiry from the IST collection date plus 42 calendar days and starts the unit `AVAILABLE` only while today's IST date is strictly before expiry; otherwise it starts `EXPIRED`. `REJECTED` requires one approved non-sensitive reason code and creates no unit. Identical approval or rejection replay is read-only; a changed decision, reason or group conflicts. The Donation release update, unit insert when approved, and mandatory audit events are one transaction. See [release and inventory guide](release-inventory.md). No laboratory measurements are captured.

## 3. Blood-unit lifecycle

### Exact statuses

- `AVAILABLE`: approved, unexpired, and eligible for allocation.
- `ALLOCATED`: committed to a hospital request and no longer available to another request.
- `ISSUED`: handed over to the hospital; terminal for inventory availability.
- `EXPIRED`: expiry date has passed before issue; unavailable for allocation.
- `DISCARDED`: staff has marked the unit unusable for a documented non-expiry reason; unavailable for allocation.

### Allowed transitions

```text
AVAILABLE -> ALLOCATED -> ISSUED
    |             |
    |             +-> AVAILABLE if its allocation is cancelled before issue and it remains usable
    |             +-> EXPIRED if it passes expiry before issue; cancel its unissued allocation atomically
    |             +-> DISCARDED by staff if found unusable before issue; cancel its allocation atomically
    +-> EXPIRED (scheduled expiry)
    +-> DISCARDED (staff only)
```

Reservation is transaction-local selection/row locking, not a persisted BloodUnit status. Allocation records use `ALLOCATED`, `ISSUED`, or `CANCELLED`. `EXPIRED`, `ISSUED`, and `DISCARDED` units are terminal. Do not reactivate expired/discarded units or reassign issued units. The broader lifecycle transitions shown below describe the integrated target workflow; the current Admin API deliberately refuses allocated-unit expiry/discard until Allocation cancellation and request-state recomputation are available.

### Dates and expiry

- `collectionDate` is the local date of collection; timestamps use `Asia/Kolkata`.
- The simplified teaching model uses a configurable shelf life of 42 calendar days: `expiryDate = collectionDate + 42 days`; a unit is eligible only while the current date is strictly before its expiry date. This is an approved educational project rule, not a clinical or regulatory claim.
- The current bounded Admin expiry reconciliation explicitly changes due `AVAILABLE` units to `EXPIRED`, records `expired_at`, and writes one `BLOOD_UNIT_EXPIRED` event per unit in the same transaction. Repeating it is safe and reports zero additional expirations. No scheduler is implemented. If any due `ALLOCATED` unit is found, the entire run conflicts and rolls back. An `ALLOCATED` but unissued unit's allocation cancellation and request-state recomputation belong to Lathikaa's Allocation workflow and must be integrated before that transition is enabled. The allocation procedure must not select a unit expiring on/before its intended issue date.
- Admin discard is limited to an unallocated, unexpired persisted `AVAILABLE` unit. It sets `DISCARDED`, `discarded_at`, and a bounded non-sensitive reason code, and writes `BLOOD_UNIT_DISCARDED` atomically. Due AVAILABLE units must be reconciled first. ALLOCATED conflicts pending coordinated cancellation; ISSUED, EXPIRED, and DISCARDED are not changed. Donation, group, expiry date, and traceability history are retained.
- Expiry does not delete a unit or erase allocation/donation history. `EXPIRED` and `DISCARDED` units are excluded from available inventory reports.

## 4. Hospital request lifecycle

### Request fields

Hospital, requested ABO/Rh group, positive integer `quantityRequested`, priority code (`EMERGENCY`, `URGENT`, `NORMAL`), `neededBy`, optional non-sensitive note, created timestamp, current status, and status history. Hospital identity comes from authenticated account, not a client-supplied hospital ID. Fulfillment totals are derived from allocation rows.

### Priority behavior

- Priority affects staff work queue ordering only; it does not change compatibility, safety, or eligibility rules.
- Sort requests by `EMERGENCY` > `URGENT` > `NORMAL`, then earliest needed-by time, then oldest submission. Within the same priority and need-by time, oldest request first.
- Staff may change priority only with an audit reason. Hospital may not self-upgrade an existing request after submission; it can cancel and submit a new request or contact staff through the existing workflow (no messaging feature implied).

### Exact statuses and transitions

- `SUBMITTED -> UNDER_REVIEW -> PARTIALLY_FULFILLED -> FULFILLED`
- `UNDER_REVIEW -> AWAITING_INVENTORY -> PARTIALLY_FULFILLED` when compatible stock becomes available
- `SUBMITTED`, `UNDER_REVIEW`, `AWAITING_INVENTORY`, or `PARTIALLY_FULFILLED -> CANCELLED` are status transitions in the domain model. The approved Hospital cancellation contract permits cancellation only before any unit is issued. Whether staff may cancel a request after partial issue is OPEN; no Admin cancellation API contract is approved.
- `PARTIALLY_FULFILLED -> AWAITING_INVENTORY` only when no units remain either allocated or issued (for example, all reservations are cancelled/expired before any issue)
- `UNDER_REVIEW -> REJECTED` by staff with reason; rejected is terminal
- `FULFILLED`, `CANCELLED`, `REJECTED` are terminal

The approved domain limit for Hospital cancellation is before any unit has been issued. The current bounded endpoint is narrower: it also refuses cancellation while any active ALLOCATED row exists because individual deallocation is not implemented; it does not release reservations. Staff cancellation after partial issue remains OPEN, including whether staff has that permission and its transition/audit contract. If that permission is approved, a proposed preservation rule is to retain issued Allocation rows/units and cancel/release only unissued allocations, returning units only when still usable and unexpired. Request quantity stays immutable after submission.

| Derived request state | Current Allocation quantities | Result |
|---|---|---|
| Outstanding, no units reserved or issued | `ALLOCATED = 0`, `ISSUED = 0` | `AWAITING_INVENTORY` after review/allocation finds no stock |
| Some units reserved and/or issued, but not all issued | `ALLOCATED + ISSUED > 0` and `ISSUED < quantityRequested` | `PARTIALLY_FULFILLED`; show allocated and issued quantities separately |
| All requested units issued | `ISSUED = quantityRequested` | `FULFILLED` |

| Current state | Allowed next states |
|---|---|
| `SUBMITTED` | `UNDER_REVIEW`, `CANCELLED` |
| `UNDER_REVIEW` | `AWAITING_INVENTORY`, `PARTIALLY_FULFILLED`, `REJECTED`, `CANCELLED` |
| `AWAITING_INVENTORY` | `PARTIALLY_FULFILLED`, `CANCELLED` |
| `PARTIALLY_FULFILLED` | `FULFILLED`; `CANCELLED` subject to cancellation permission/timing (staff cancellation after partial issue is OPEN); `AWAITING_INVENTORY` only when both current allocated and issued counts are zero |
| `FULFILLED`, `CANCELLED`, `REJECTED` | Terminal; no transitions |

`ALLOCATED` means reserved/committed, not issued. `FULFILLED` requires exactly the requested quantity to be `ISSUED`. On an allocation attempt with zero additional eligible units, derive status using all current allocation rows: choose `AWAITING_INVENTORY` only when current allocated and issued quantities are both zero; retain `PARTIALLY_FULFILLED` when allocated/issued units remain and issued quantity is below requested; retain `FULFILLED` when issued quantity equals the request. Never allocate more than `quantityRequested - current ALLOCATED - current ISSUED`. `FULFILLED`, `CANCELLED`, and `REJECTED` are terminal and must never be reopened or regressed by allocation or expiry processing.

Creation status is `SUBMITTED`. Staff review moves to `UNDER_REVIEW`; no suitable stock moves to `AWAITING_INVENTORY`. Any current committed allocation with issued quantity below the request derives `PARTIALLY_FULFILLED`, including when all outstanding units are allocated but await handoff. If active allocations are cancelled or expire, recompute from the current `ALLOCATED` and `ISSUED` rows without changing a terminal request state.

## 5. Compatibility

Support the eight red-cell ABO/Rh groups: `O-`, `O+`, `A-`, `A+`, `B-`, `B+`, `AB-`, `AB+`.

| Donor unit group | Compatible recipient groups (RBC model) |
|---|---|
| O- | O-, O+, A-, A+, B-, B+, AB-, AB+ |
| O+ | O+, A+, B+, AB+ |
| A- | A-, A+, AB-, AB+ |
| A+ | A+, AB+ |
| B- | B-, B+, AB-, AB+ |
| B+ | B+, AB+ |
| AB- | AB-, AB+ |
| AB+ | AB+ |

Compatibility is donor-unit-to-recipient, for red cells only. This table is a planning model and not a transfusion decision; clinical compatibility requires testing/crossmatch outside this project.

Represent compatibility relationally in `BloodGroup` and `BloodCompatibility`, with donor-group and recipient-group references, rather than duplicating conditional logic across endpoints/queries. Admin may make reviewed compatibility changes through the restricted, audited administration route; other roles have read-only access.

## 6. Allocation rules

- Allocation is Admin-only. A unit must have status `AVAILABLE`, be unexpired on intended issue date, have `APPROVED` release, and be compatible with requested recipient group.
- Select units using FEFO: earliest expiry date first, then earliest collection date, then stable unit identifier for deterministic ties.
- Request priority determines which request staff works first; it does not allow an incompatible unit or bypass unit eligibility.
- Partial fulfillment is allowed. Allocate qualifying units only up to `quantityRequested - current ALLOCATED - current ISSUED`, record unit-to-request allocations individually, and derive remaining quantity as outstanding. When no additional units are available, derive request status from the current `ALLOCATED` and `ISSUED` quantities using the request-state rules above; do not unconditionally change the request to `AWAITING_INVENTORY`.
- If compatible inventory is insufficient, do not create phantom units, substitute an incompatible group, or silently reduce requested quantity. The hospital sees allocated/issued and outstanding counts.
- Allocation is a single database transaction: lock/recheck candidate available units, use transaction-local reservation/row locks, set unit and allocation to `ALLOCATED`, update request status, write audit event, and commit. On any failure roll back all effects. Expire candidates at decision time before selecting.
- Allocation capacity is `quantityRequested - current ALLOCATED quantity - current ISSUED quantity`; requests with terminal status cannot be allocated. A zero-additional-unit result derives the request status from all current allocations as specified above.
- The integrated Feature 8 allocation and issue writers use Account/SID, request, BloodGroup (for allocation), BloodUnit in expiry-date/unit-ID order, then relevant Allocation row locks, followed by same-transaction unit/allocation/request/history/audit writes. The isolated MySQL integration passed concurrent duplicate allocation and issue attempts and audit-failure rollback. Cross-operation contention with release, expiry, discard and cancellation writers still requires coordinated concurrent MySQL verification; individual allocation cancellation is not implemented. Request cancellation after partial issue remains OPEN.
- Cancelling an individual allocation before issue changes its allocation record to `CANCELLED` and returns the unit to `AVAILABLE` if it remains usable/unexpired, otherwise `EXPIRED`; audit the action.

## 7. Audit events

The [bounded Account approval backend](account-approval-backend.md) preserves DONOR/HOSPITAL PENDING -> ACTIVE with ACCOUNT_APPROVED / REGISTRATION_REVIEWED. The [backend-only extension](account-status-backend.md) adds ACTIVE -> SUSPENDED with ACCOUNT_SUSPENDED / ACCESS_RESTRICTED and SUSPENDED -> ACTIVE with ACCOUNT_REACTIVATED / ACCESS_RESTORED. Each uses the fixed transition text, server UUID, one-transaction status/tombstones/audit and verified ACTIVE ADMIN actor. PENDING -> SUSPENDED is unsupported, stale approval cannot reactivate, and refused retries emit no event. All three transitions revoke target sessions. Protected guards and transaction-time profile writes check the authoritative SID alongside locked Account state, so matching ACTIVE status after a cycle cannot revive an old session. The status guide defines in-flight authorization; committed work is not undone. Other actions/mappings remain deferred; this is not donor eligibility or blood-group confirmation.

Audit at least: account approval/suspension/reactivation; donor profile corrections by staff; eligibility/deferral decisions; booking create/cancel/no-show correction; donation recording and testing/release decisions; unit creation, discard, expiry, allocation, deallocation, and issue; blood-group/compatibility reference changes; hospital request create, priority/status, rejection/cancellation; authentication failures only as counts/actor/time if desired (never credentials). Request quantity is immutable after submission. Role changes are not an approved application operation; if a role-changing workflow is later approved, specify and audit it separately.

Each event should capture actor, action, entity type/id, timestamp, and concise before/after state or safe change summary; include reason where a staff override is permitted. Never store passwords, password hashes in audit payload, JWT/session tokens, secrets, detailed medical answers, or unnecessary sensitive information.
