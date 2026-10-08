# Domain Rules and Lifecycle Definitions

Canonical API/database state and decision codes are uppercase. Human-readable labels are presentation only.

## 1. Donor lifecycle

### Registration and profile

1. Donor submits name, date of birth, contact details, address/area, ABO/Rh blood group (if known), and credentials. Server validates required fields and unique login identifiers.
2. New donor account is `PENDING` until staff approves it. The donor may complete/edit their own profile; staff may correct/approve it. A donor cannot approve their own account or edit another donor.
3. PENDING Donor/Hospital users may authenticate only to see approval status, access/update permitted own-profile fields, change their password, and log out. They cannot book or perform other operational actions. SUSPENDED accounts cannot establish sessions; suspension revokes existing sessions and every protected request checks current account state. Reactivation is an audited staff action and requires fresh login; revoked sessions remain invalid.
4. Staff confirmation/testing is authoritative for the blood group used for inventory. A donor-provided or self-reported group is not sufficient to establish an allocatable unit's group.
5. Donation history is derived from donation records and visible to that donor and authorized staff. Donors cannot create or edit completed donation records.

### Eligibility

- Eligibility check returns `ELIGIBLE`, `INELIGIBLE_UNTIL_DATE`, or `STAFF_REVIEW_REQUIRED`, plus `checkedAt` and a safe reason code/message. It is advisory; the final pre-donation acceptance is recorded by trained/authorized staff.
- For the educational whole-blood workflow, an otherwise accepted donor must have at least 56 calendar days since their last successful collection (`COLLECTED` donation outcome), regardless of the later release result. `nextEligibleDate = lastSuccessfulCollectionDate + 56 days`; if there is no prior successful collection, the interval test passes. Failed/incomplete attempts do not advance this interval date. The 56-day interval is a configurable educational project rule, not a universal clinical rule.
- Other suitability criteria are not auto-evaluated. Staff records the day-of decision and a non-sensitive outcome/reason category; do not store detailed private medical questionnaire answers in this mini-project.
- A deferral may be temporary with `deferredUntil` or indefinite until staff review; the system does not infer durations from medical data.
- For display/booking checks, the latest staff decision applies: a latest temporary deferral blocks eligibility through `deferred_until`; a later accepted/review decision supersedes earlier outcomes for the current visit. The 56-day interval remains independently enforced.
- The 56-day interval is an educational project rule, not a universal or clinical eligibility determination. Actual blood services must follow applicable national criteria and qualified staff assessment. [WHO donor-selection guidance](https://www.who.int/publications/i/item/blood-donor-selection-guidelines-on-assessing-donor-suitability-for-blood-donation), [WHO donor eligibility overview](https://www.who.int/campaigns/world-blood-donor-day/who-can-give-blood).

### Booking and cancellation

- Staff defines each slot's start/end and positive capacity in Asia/Kolkata local time; slot duration is not fixed by the system. Capacity occupancy counts `BOOKED` reservations and `CHECKED_IN` bookings. `CANCELLED_BY_DONOR`, `CANCELLED_BY_STAFF`, `NO_SHOW`, and `COMPLETED` do not occupy capacity. Capacity may be raised freely, but a reduction below the current occupied count is rejected.
- Reject edits to a slot's schedule once any booking row exists for it. The approved DonationSlot schema and slot API do not define a location field, so location persistence/editing is not currently part of the design. Cancelling a future slot follows the existing cancellation rule: cancel its still-`BOOKED` bookings with staff reason/audit; a checked-in donor must be resolved as a donation outcome rather than silently cancelled.
- A donor can book an open future slot only if account status is `ACTIVE`, eligibility interval passes, and they have no other active booking for the same appointment window. For this capacity/overlap rule, active bookings are `BOOKED` and `CHECKED_IN`.
- Booking statuses: `BOOKED`, `CANCELLED_BY_DONOR`, `CANCELLED_BY_STAFF`, `CHECKED_IN`, `NO_SHOW`, `COMPLETED`.
- Donor cancellation is permitted until the slot start time; after that, only staff can resolve the booking as `NO_SHOW` or correct it with an audited action. Staff can cancel before attendance.
- `BOOKED -> CANCELLED_BY_DONOR` or `CANCELLED_BY_STAFF`; `BOOKED -> CHECKED_IN -> COMPLETED`; `BOOKED -> NO_SHOW`. `CHECKED_IN` can only become `COMPLETED` after a donation record is opened, or be resolved by staff as a no-donation attendance outcome. Cancellation/no-show does not create a donation or unit.
- Keep cancelled/no-show bookings as history; do not delete them.

The schema booking statuses and capacity treatment are: `BOOKED` (occupies capacity), `CHECKED_IN` (occupies capacity), `CANCELLED_BY_DONOR` (does not), `CANCELLED_BY_STAFF` (does not), `NO_SHOW` (does not), and `COMPLETED` (does not). These names match `database-design.md` and `relational-schema.md`.

## 2. Donation lifecycle

1. Staff checks in the donor with a `CHECKED_IN` booking.
2. Staff performs the day-of assessment and records an `ACCEPTED`, `TEMPORARILY_DEFERRED`, or `REVIEW_REQUIRED` EligibilityDecision. A booking being `BOOKED` or donor eligibility previewing `ELIGIBLE` is not proof of acceptance.
3. Staff records a Donation outcome of `COLLECTED`, `INCOMPLETE`, or `DEFERRED`, with booking, time, and collection reference where applicable. Recording any outcome does not create a BloodUnit. A cancelled/no-show booking has no Donation row.
4. Collected donations proceed to release review: `PENDING`, `APPROVED`, or `REJECTED` (`NOT_REQUIRED` for non-collected outcomes). Staff records decision timestamp and safe category/reason. Rejected or incomplete donations never create an allocatable unit.
5. Exactly one unit is created atomically only when a collected donation receives `APPROVED` release with a confirmed blood group. Repeating the same approval request is idempotent and cannot create a duplicate unit. Creation records source donation, group, collection date through the donation record, and expiry date; its persisted status starts as `AVAILABLE` if the expiry date is in the future, otherwise `EXPIRED`.
6. One collected donation creates one unit for this project. This is a simplified mini-project assumption, not a model of component processing.

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

Reservation is transaction-local selection/row locking, not a persisted BloodUnit status. Allocation records use `ALLOCATED`, `ISSUED`, or `CANCELLED`. `EXPIRED`, `ISSUED`, and `DISCARDED` units are terminal. Do not reactivate expired/discarded units or reassign issued units.

### Dates and expiry

- `collectionDate` is the local date of collection; timestamps use `Asia/Kolkata`.
- The simplified teaching model uses a configurable shelf life of 42 calendar days: `expiryDate = collectionDate + 42 days`; a unit is eligible only while the current date is strictly before its expiry date. This is an approved educational project rule, not a clinical or regulatory claim.
- Expiry runs daily. It changes due `AVAILABLE` units to `EXPIRED`, records `expiredAt`, and audits the run and affected units. An `ALLOCATED` but unissued unit that reaches expiry has its allocation changed to `CANCELLED` and the unit changed to `EXPIRED` atomically; recompute the request status. The allocation procedure must not select a unit expiring on/before its intended issue date.
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
- `SUBMITTED`, `UNDER_REVIEW`, `AWAITING_INVENTORY`, or `PARTIALLY_FULFILLED -> CANCELLED` (hospital may cancel before any unit is issued; staff may cancel with reason). In the same transaction, cancel unissued active allocations and return their units to `AVAILABLE` if still usable/unexpired, otherwise `EXPIRED`.
- `PARTIALLY_FULFILLED -> AWAITING_INVENTORY` only when no units remain either allocated or issued (for example, all reservations are cancelled/expired before any issue)
- `UNDER_REVIEW -> REJECTED` by staff with reason; rejected is terminal
- `FULFILLED`, `CANCELLED`, `REJECTED` are terminal

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
| `PARTIALLY_FULFILLED` | `FULFILLED`, `CANCELLED`; `AWAITING_INVENTORY` only when both current allocated and issued counts are zero |
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
- Allocation, issue, request/allocation cancellation, discard, and expiry must use one consistent locking strategy to prevent double assignment, issuing cancelled/expired units, over-allocation, and terminal-state regression. The exact strategy is to be implemented and verified with concurrent MySQL connections in Phase 3; it is not yet verified.
- Cancelling an individual allocation before issue changes its allocation record to `CANCELLED` and returns the unit to `AVAILABLE` if it remains usable/unexpired, otherwise `EXPIRED`; audit the action.

## 7. Audit events

Audit at least: account approval/suspension and role changes; donor profile corrections by staff; eligibility/deferral decisions; booking create/cancel/no-show correction; donation recording and testing/release decisions; unit creation, discard, expiry, allocation, deallocation, and issue; blood-group/compatibility reference changes; hospital request create, priority/status/quantity changes, rejection/cancellation; authentication failures only as counts/actor/time if desired (never credentials).

Each event should capture actor, action, entity type/id, timestamp, and concise before/after state or safe change summary; include reason where a staff override is permitted. Never store passwords, password hashes in audit payload, JWT/session tokens, secrets, detailed medical answers, or unnecessary sensitive information.
