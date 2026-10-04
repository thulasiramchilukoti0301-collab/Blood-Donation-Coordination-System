# Domain Rules and Lifecycle Definitions

## 1. Donor lifecycle

### Registration and profile

1. Donor submits name, date of birth, contact details, address/area, ABO/Rh blood group (if known), and credentials. Server validates required fields and unique login/contact identifiers as selected in schema design.
2. New donor account is `Pending` until staff approves it. The donor may complete/edit their own profile; staff may correct/approve it. A donor cannot approve their own account or edit another donor.
3. Staff confirmation/testing is authoritative for the blood group used for inventory. A donor-provided or self-reported group is not sufficient to establish an allocatable unit's group.
4. Donation history is derived from donation records and visible to that donor and authorized staff. Donors cannot create or edit completed donation records.

### Eligibility

- Eligibility check returns `Eligible`, `IneligibleUntilDate`, or `StaffReviewRequired`, plus `checked_at` and a safe reason code/message. It is advisory; the final pre-donation acceptance is recorded by trained/authorized staff.
- For the educational whole-blood workflow, proposed interval rule: an otherwise accepted donor must have at least 56 calendar days since their last **successful whole-blood donation**. `next_eligible_date = last_successful_donation_date + 56 days`; if there is no prior successful donation, the interval test passes. Failed/incomplete attempts do not advance this interval date.
- Other suitability criteria are not auto-evaluated. Staff records the day-of decision and a non-sensitive outcome/reason category; do not store detailed private medical questionnaire answers in this mini-project.
- A deferral may be temporary with `deferred_until` or indefinite until staff review; the system does not infer these durations from medical data.
- WHO says donor selection must follow national eligibility guidelines and appropriate assessment, and those criteria vary by country. The 56-day value is an educational rule proposal (also used by the American Red Cross for whole blood), not a universal rule. Obtain course/institution/local-service sign-off before implementation. [WHO donor-selection guidance](https://www.who.int/publications/i/item/blood-donor-selection-guidelines-on-assessing-donor-suitability-for-blood-donation), [WHO donor eligibility overview](https://www.who.int/campaigns/world-blood-donor-day/who-can-give-blood), [American Red Cross whole-blood interval](https://www.redcrossblood.org/donate-blood/how-to-donate/types-of-blood-donations/whole-blood-donation.html).

### Booking and cancellation

- A donor can book an open future slot only if account is approved, eligibility interval passes, and they have no other active booking for the same appointment window.
- Booking states: `Booked`, `CancelledByDonor`, `CancelledByStaff`, `CheckedIn`, `NoShow`, `Completed`.
- Donor cancellation is permitted until the slot start time; after that, only staff can resolve the booking as `NoShow` or correct it with an audited action. Staff can cancel before attendance.
- `Booked -> CancelledByDonor` or `CancelledByStaff`; `Booked -> CheckedIn -> Completed`; `Booked -> NoShow`. `CheckedIn` can only become `Completed` after a donation record is opened, or be resolved by staff as a no-donation attendance outcome. Cancellation/no-show does not create a donation or unit.
- Keep cancelled/no-show bookings as history; do not delete them.

## 2. Donation lifecycle

1. Booking is checked in, or staff records an authorized walk-in only if the project later chooses to support it (walk-in support is not currently included).
2. Staff performs the day-of assessment and records `Accepted` or `Deferred`. A booking being `Booked` or donor eligibility previewing eligible is not proof of acceptance.
3. If accepted, staff records a donation event with donor, date/time, outcome, and collection reference. Donation status: `Started`, `Collected`, `Incomplete`, `Cancelled`, `Deferred`.
4. Collected donations proceed to testing/release review: `PendingTesting`, `Approved`, `Rejected`. Staff records decision timestamp and safe category/reason. Rejected or incomplete donations never create an allocatable unit.
5. A unit is created only after a collected donation has required approval and a confirmed blood group. Creation records source donation, group, collection date, expiry date, and starts the unit at `Available` if the expiry date is still future; otherwise it cannot be released and is `Expired`.
6. One collected donation creates one unit for this project. This is a simplified mini-project assumption, not a model of component processing.

## 3. Blood-unit lifecycle

### Exact statuses

- `Available`: approved, unexpired, and eligible for allocation.
- `Reserved`: selected within an allocation transaction for a request but not yet issued/fulfilled. Reservation is short-lived and should be committed with allocation or rolled back.
- `Allocated`: committed to a hospital request and no longer available to another request.
- `Issued`: handed over/issued to the hospital; terminal for inventory availability.
- `Expired`: expiry date has passed before issue; unavailable for allocation.
- `Discarded`: staff has marked the unit unusable for a documented non-expiry reason; unavailable for allocation.

### Allowed transitions

```text
Available -> Reserved -> Allocated -> Issued
    |           |
    |           +-- transaction rollback -> Available
    +-> Expired (scheduled expiry)
    +-> Discarded (staff only)
Allocated -> Available only if allocation is formally cancelled before issue (audited)
```

`Expired`, `Issued`, and `Discarded` are terminal. Do not reactivate expired/discarded units or reassign issued units.

### Dates and expiry

- `collection_date` is the local date of collection, stored consistently as a date; timestamps use one documented timezone convention.
- Proposed simplified shelf life is 42 calendar days for this whole-blood/red-cell teaching model: `expiry_date = collection_date + 42 days`; a unit is eligible only while current date is strictly before expiry date. This is configurable as a project rule, and must be confirmed before Phase 2. It is not a substitute for product-specific regulatory storage limits.
- Scheduled expiry runs at least daily. It changes only `Available` units whose expiry date is on or before the run date to `Expired`, records `expired_at`, and creates an audit event. Reserved units should be prevented from reservation if expiry is on/before planned issue date; if a reservation crosses its expiry date, release it and mark expired in one controlled operation.
- Expiry does not delete a unit or erase allocation/donation history. An expired or discarded unit is excluded from available inventory reports.

## 4. Hospital request lifecycle

### Request fields

Hospital, requested ABO/Rh group, positive integer `quantity_requested`, priority (`Emergency`, `Urgent`, `Normal`), needed-by date/time, optional non-sensitive note, created timestamp, current status, status timestamps, and fulfillment totals. Hospital identity comes from authenticated account, not a client-supplied hospital ID.

### Priority behavior

- Priority affects staff work queue ordering only; it does not change compatibility, safety, or eligibility rules.
- Sort requests by priority Emergency > Urgent > Normal, then earliest needed-by time, then oldest submission. Within the same priority and need-by time, oldest request first.
- Staff may change priority only with an audit reason. Hospital may not self-upgrade an existing request after submission; it can cancel and submit a new request or contact staff through the existing workflow (no messaging feature implied).

### Exact statuses and transitions

- `Submitted -> UnderReview -> PartiallyFulfilled -> Fulfilled`
- `UnderReview -> AwaitingInventory -> PartiallyFulfilled` when eligible stock becomes available
- `Submitted`, `UnderReview`, `AwaitingInventory`, or `PartiallyFulfilled -> Cancelled` (hospital may cancel before any unit is issued; staff may cancel with reason)
- `PartiallyFulfilled -> AwaitingInventory` if an unissued allocation is cancelled and no units remain committed
- `UnderReview -> Rejected` by staff with reason; rejected is terminal
- `Fulfilled`, `Cancelled`, `Rejected` are terminal

Creation status is `Submitted`. Staff review moves to `UnderReview`; no suitable stock moves to `AwaitingInventory`; committed allocation for some but not all requested units moves to `PartiallyFulfilled`; all requested units committed/issued per final fulfillment convention moves to `Fulfilled`. To keep counts unambiguous, `Fulfilled` means all requested units are issued, not merely reserved. If units are committed but awaiting pickup, represent the unit as `Allocated` and request as partially fulfilled until issue; choose the exact handoff convention before implementation.

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

Represent compatibility relationally as maintained reference data (candidate `BloodGroup` and `BloodCompatibility` entities with donor-group and recipient-group references), not duplicated conditional logic across endpoints/queries. Admin may view but should not edit compatibility rules in the initial system; changing them needs a reviewed data update and audit.

## 6. Allocation rules

- Allocation is Admin-only. A unit must have status `Available`, be unexpired on intended issue date, have testing approval, and be compatible with requested recipient group.
- Select units using FEFO: earliest expiry date first, then earliest collection date, then stable unit identifier for deterministic ties.
- Request priority determines which request staff works first; it does not allow an incompatible unit or bypass unit eligibility.
- Partial fulfillment is allowed. Allocate as many qualifying units as possible, record unit-to-request allocations individually, and retain remaining quantity as outstanding. If none are available, set request to `AwaitingInventory`; if some but not all are allocated, set it `PartiallyFulfilled`.
- If compatible inventory is insufficient, do not create phantom units, substitute an incompatible group, or silently reduce requested quantity. The hospital sees allocated/issued and outstanding counts.
- Allocation is a single database transaction: lock/recheck candidate available units, reserve/update unit state, create allocation records, update request counts/status, write audit event, and commit. On any failure roll back all effects. Expire candidates at decision time before selecting.
- Cancellation before issue releases a unit only with a corresponding allocation cancellation record and audit event, after rechecking it remains unexpired and usable.

## 7. Audit events

Audit at least: account approval/suspension and role changes; donor profile corrections by staff; eligibility/deferral decisions; booking create/cancel/no-show correction; donation recording and testing/release decisions; unit creation, discard, expiry, allocation, deallocation, and issue; blood-group/compatibility reference changes; hospital request create, priority/status/quantity changes, rejection/cancellation; authentication failures only as counts/actor/time if desired (never credentials).

Each event should capture actor, action, entity type/id, timestamp, and concise before/after state or safe change summary; include reason where a staff override is permitted. Never store passwords, password hashes in audit payload, JWT/session tokens, secrets, detailed medical answers, or unnecessary sensitive information.
