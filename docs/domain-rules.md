# Domain Rules and Lifecycle Definitions

Canonical API/database state and decision codes are uppercase. Human-readable labels are presentation only.

## 1. Donor lifecycle

### Registration and profile

1. Donor submits name, date of birth, contact details, address/area, ABO/Rh blood group (if known), and credentials. Server validates required fields and unique login identifiers.
2. New donor account is `PENDING` until staff approves it. The donor may complete/edit their own profile; staff may correct/approve it. A donor cannot approve their own account or edit another donor.
3. Staff confirmation/testing is authoritative for the blood group used for inventory. A donor-provided or self-reported group is not sufficient to establish an allocatable unit's group.
4. Donation history is derived from donation records and visible to that donor and authorized staff. Donors cannot create or edit completed donation records.

### Eligibility

- Eligibility check returns `ELIGIBLE`, `INELIGIBLE_UNTIL_DATE`, or `STAFF_REVIEW_REQUIRED`, plus `checkedAt` and a safe reason code/message. It is advisory; the final pre-donation acceptance is recorded by trained/authorized staff.
- For the educational whole-blood workflow, an otherwise accepted donor must have at least 56 calendar days since their last successful collection (`COLLECTED` donation outcome), regardless of the later release result. `nextEligibleDate = lastSuccessfulCollectionDate + 56 days`; if there is no prior successful collection, the interval test passes. Failed/incomplete attempts do not advance this interval date. The 56-day interval is a configurable educational project rule, not a universal clinical rule.
- Other suitability criteria are not auto-evaluated. Staff records the day-of decision and a non-sensitive outcome/reason category; do not store detailed private medical questionnaire answers in this mini-project.
- A deferral may be temporary with `deferredUntil` or indefinite until staff review; the system does not infer durations from medical data.
- For display/booking checks, the latest staff decision applies: a latest temporary deferral blocks eligibility through `deferred_until`; a later accepted/review decision supersedes earlier outcomes for the current visit. The 56-day interval remains independently enforced.
- The 56-day interval is an educational project rule, not a universal or clinical eligibility determination. Actual blood services must follow applicable national criteria and qualified staff assessment. [WHO donor-selection guidance](https://www.who.int/publications/i/item/blood-donor-selection-guidelines-on-assessing-donor-suitability-for-blood-donation), [WHO donor eligibility overview](https://www.who.int/campaigns/world-blood-donor-day/who-can-give-blood).

### Booking and cancellation

- Staff defines each slot's start/end and positive capacity in Asia/Kolkata local time; slot duration is not fixed by the system. Capacity may be raised freely, but cannot be lowered below its current active booking count. Cancelling a future slot cancels its still-`BOOKED` bookings with staff reason/audit; a checked-in donor must be resolved as a donation outcome rather than silently cancelled.
- A donor can book an open future slot only if account is approved, eligibility interval passes, and they have no other active booking for the same appointment window.
- Booking statuses: `BOOKED`, `CANCELLED_BY_DONOR`, `CANCELLED_BY_STAFF`, `CHECKED_IN`, `NO_SHOW`, `COMPLETED`.
- Donor cancellation is permitted until the slot start time; after that, only staff can resolve the booking as `NO_SHOW` or correct it with an audited action. Staff can cancel before attendance.
- `BOOKED -> CANCELLED_BY_DONOR` or `CANCELLED_BY_STAFF`; `BOOKED -> CHECKED_IN -> COMPLETED`; `BOOKED -> NO_SHOW`. `CHECKED_IN` can only become `COMPLETED` after a donation record is opened, or be resolved by staff as a no-donation attendance outcome. Cancellation/no-show does not create a donation or unit.
- Keep cancelled/no-show bookings as history; do not delete them.

## 2. Donation lifecycle

1. Staff checks in the donor with a `CHECKED_IN` booking.
2. Staff performs the day-of assessment and records an `ACCEPTED`, `TEMPORARILY_DEFERRED`, or `REVIEW_REQUIRED` EligibilityDecision. A booking being `BOOKED` or donor eligibility previewing `ELIGIBLE` is not proof of acceptance.
3. Staff records a Donation outcome of `COLLECTED`, `INCOMPLETE`, or `DEFERRED`, with booking, time, and collection reference where applicable. A cancelled/no-show booking has no Donation row.
4. Collected donations proceed to release review: `PENDING`, `APPROVED`, or `REJECTED` (`NOT_REQUIRED` for non-collected outcomes). Staff records decision timestamp and safe category/reason. Rejected or incomplete donations never create an allocatable unit.
5. A unit is created only after a collected donation has `APPROVED` release and a confirmed blood group. Creation records source donation, group, collection date through the donation record, and expiry date; its persisted status starts as `AVAILABLE` if the expiry date is in the future, otherwise `EXPIRED`.
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
- `PARTIALLY_FULFILLED -> AWAITING_INVENTORY` if unissued allocations are cancelled and no units remain committed
- `UNDER_REVIEW -> REJECTED` by staff with reason; rejected is terminal
- `FULFILLED`, `CANCELLED`, `REJECTED` are terminal

Creation status is `SUBMITTED`. Staff review moves to `UNDER_REVIEW`; no suitable stock moves to `AWAITING_INVENTORY`. Any committed allocation moves the request to `PARTIALLY_FULFILLED` until all requested units are issued; this remains true even if all requested units are allocated but await handoff. `FULFILLED` means exactly that all requested units are `ISSUED`.

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
- Partial fulfillment is allowed. Allocate as many qualifying units as possible, record unit-to-request allocations individually, and derive remaining quantity as outstanding. If none are available, set request to `AWAITING_INVENTORY`; any committed allocations set it to `PARTIALLY_FULFILLED` until every requested unit is issued.
- If compatible inventory is insufficient, do not create phantom units, substitute an incompatible group, or silently reduce requested quantity. The hospital sees allocated/issued and outstanding counts.
- Allocation is a single database transaction: lock/recheck candidate available units, use transaction-local reservation/row locks, set unit and allocation to `ALLOCATED`, update request status, write audit event, and commit. On any failure roll back all effects. Expire candidates at decision time before selecting.
- Cancelling an individual allocation before issue changes its allocation record to `CANCELLED` and returns the unit to `AVAILABLE` if it remains usable/unexpired, otherwise `EXPIRED`; audit the action.

## 7. Audit events

Audit at least: account approval/suspension and role changes; donor profile corrections by staff; eligibility/deferral decisions; booking create/cancel/no-show correction; donation recording and testing/release decisions; unit creation, discard, expiry, allocation, deallocation, and issue; blood-group/compatibility reference changes; hospital request create, priority/status/quantity changes, rejection/cancellation; authentication failures only as counts/actor/time if desired (never credentials).

Each event should capture actor, action, entity type/id, timestamp, and concise before/after state or safe change summary; include reason where a staff override is permitted. Never store passwords, password hashes in audit payload, JWT/session tokens, secrets, detailed medical answers, or unnecessary sensitive information.
