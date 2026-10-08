# Database Design — Phase 2

## Status and scope

This is the logical/physical design proposal for MySQL, not executable DDL. No SQL scripts, database connection, or data seeding are part of this phase. Proposed types assume MySQL 8.0.16+ so `CHECK` constraints are enforced; generated columns and InnoDB transactions are used for allocation integrity. Dates and local appointment timestamps use `Asia/Kolkata`; persisted `DATETIME` values are interpreted in that project timezone, with server and MySQL session timezone configured consistently.

## Design decisions

- Fourteen domain entities are selected below. Eligibility decisions and request status history are separate history entities. Testing/release fields live on Donation because the simplified workflow records one final release decision per donation. Expiry runs are audit events, not a separate entity.
- Account is the single authentication identity, with exactly one role and one matching Donor or Hospital profile for those roles; Admin has neither profile. PENDING Donor/Hospital accounts may use limited account/profile operations; operational actions require ACTIVE status. SUSPENDED accounts cannot establish sessions and existing sessions are revoked on suspension.
- Account stores bcrypt hash, not credentials in a profile. Server-side session data is outside this domain schema (a future session store may be infrastructure storage).
- Blood group and directed donor-to-recipient compatibility are normalized reference data; store all 64 donor/recipient pairs and a true/false compatibility value for each.
- Donation always references a booking (walk-ins are out of scope). One approved collected donation creates at most one BloodUnit.
- Request status history is distinct from general audit because it is a typed, FK-backed sequence of request status changes. The request-creation transaction inserts the initial status event; one `AFTER UPDATE` trigger records later status changes only. The application must not also insert those update events.
- Allocation is one row per unit. A persisted allocation is `ALLOCATED`, `ISSUED`, or `CANCELLED`; reservation is only a transaction-local lock/selection state. A unique nullable generated active-unit key prevents more than one active allocation per unit.
- Donor interval (56 days) and shelf life (42 days) are configurable project rules in backend configuration for the initial mini-project, with one authoritative configuration source. The database stores resulting decision dates and expiry date; it does not duplicate those constants in multiple rows.
- Foreign-key deletion behavior is restrictive for operational history. Retire/deactivate accounts and reference data rather than deleting them.

## Entities and sample-data classification

Major means a core operational relation that should be populated with at least ten coherent sample rows for the DBMS submission. Lookup tables and purely derived/read-only history helper rows are not classed as major for the minimum, though sample values should still be provided where useful.

| Entity | Purpose and relationships | Major? |
|---|---|---|
| Account | Login identity, role, account state; parent of optional one-to-one Donor/Hospital profile; actor for decisions and audit | Yes |
| Donor | Donor-specific personal/contact data and reported/confirmed group; 1:many Booking and EligibilityDecision | Yes |
| Hospital | Hospital identity/contact details; 1:many HospitalRequest | Yes |
| BloodGroup | Eight supported ABO/Rh values; referenced by compatibility, donor, unit, and request | No (lookup) |
| BloodCompatibility | Directed donor-group/recipient-group pair and whether compatible; two FKs to BloodGroup | No (lookup; 64 rows for matrix) |
| DonationSlot | Appointment start/end/capacity; parent of bookings; created by Account | Yes |
| Booking | Donor reservation/attendance outcome for one slot; optional one Donation | Yes |
| EligibilityDecision | Timestamped staff decision/deferral; belongs to Donor, optionally Booking, decided by Account | Yes (history) |
| Donation | Outcome and one final testing/release decision; belongs to Booking and recording staff; source of optional one BloodUnit | Yes |
| BloodUnit | Inventory record, blood group, expiry, status; source donation; may have allocation history | Yes |
| HospitalRequest | Requested group/quantity/priority/status; belongs to Hospital; has status history and allocations | Yes |
| RequestStatusHistory | FK-backed request status transition with actor/time/reason; child of HospitalRequest and Account | Yes (history) |
| Allocation | One request-to-unit assignment with state and issue/cancellation details; one row per unit | Yes |
| AuditEvent | General operational audit event, actor FK, typed subject reference; expiry task events also recorded here | Yes (audit) |

## Attribute dictionary

Notation: `NN` = NOT NULL; `UQ` = UNIQUE; `DF` = proposed DEFAULT; `CK` = proposed CHECK; `FK` lists references. Every primary key is `BIGINT UNSIGNED` auto-generated unless stated. Times are `DATETIME` in Asia/Kolkata. Enumerated values may be implemented as checked `VARCHAR` rather than MySQL `ENUM` to make constraints visible and portable within MySQL.

### Account

| Attribute | Type; nullability | Key / rules |
|---|---|---|
| account_id | BIGINT UNSIGNED NN | PK |
| email | VARCHAR(254) NN | UQ; normalized lowercase at application boundary |
| password_hash | VARCHAR(255) NN | bcrypt hash only; never exposed |
| role | VARCHAR(16) NN | CK `ADMIN`, `HOSPITAL`, `DONOR` |
| account_status | VARCHAR(16) NN | CK `PENDING`, `ACTIVE`, `SUSPENDED`; DF `PENDING` for self-registration |
| created_at | DATETIME NN | DF current timestamp |
| updated_at | DATETIME NN | DF current timestamp; maintained by application |

Candidate key: `account_id`; alternate key: `email`.

### Donor

| Attribute | Type; nullability | Key / rules |
|---|---|---|
| account_id | BIGINT UNSIGNED NN | PK and FK -> Account.account_id |
| full_name | VARCHAR(120) NN | |
| date_of_birth | DATE NN | Application rejects future dates; minimum age policy is not included |
| phone | VARCHAR(30) NN | Not unique; shared household contact numbers are possible |
| address | VARCHAR(255) NN | |
| area | VARCHAR(100) NULL | Searchable locality, not a separate entity |
| reported_blood_group_id | BIGINT UNSIGNED NULL | FK -> BloodGroup; self-reported, not operationally authoritative |
| confirmed_blood_group_id | BIGINT UNSIGNED NULL | FK -> BloodGroup; staff-confirmed, nullable until verified |
| created_at | DATETIME NN | DF current timestamp |
| updated_at | DATETIME NN | DF current timestamp |

Candidate key/PK: `account_id`. `phone` uniqueness is a policy choice, not an identity key; final DDL should not impose it if shared family contact numbers are allowed.

### Hospital

| Attribute | Type; nullability | Key / rules |
|---|---|---|
| account_id | BIGINT UNSIGNED NN | PK and FK -> Account.account_id |
| organization_name | VARCHAR(180) NN | |
| registration_number | VARCHAR(80) NULL | UQ when present; local institution policy may not provide one |
| contact_name | VARCHAR(120) NN | |
| phone | VARCHAR(30) NN | |
| address | VARCHAR(255) NN | |
| created_at | DATETIME NN | DF current timestamp |
| updated_at | DATETIME NN | DF current timestamp |

Candidate key/PK: `account_id`; alternate key: nullable `registration_number`.

### BloodGroup

| Attribute | Type; nullability | Key / rules |
|---|---|---|
| blood_group_id | BIGINT UNSIGNED NN | PK |
| code | CHAR(3) NN | UQ; CK in `O-`, `O+`, `A-`, `A+`, `B-`, `B+`, `AB-`, `AB+` |
| display_name | VARCHAR(12) NN | UQ; e.g. `O negative` |
| is_active | BOOLEAN NN | DF TRUE; only deactivate if no longer offered; existing history remains |

Candidate key: `blood_group_id`; alternate key: `code`.

### BloodCompatibility

| Attribute | Type; nullability | Key / rules |
|---|---|---|
| donor_group_id | BIGINT UNSIGNED NN | PK part; FK -> BloodGroup.blood_group_id |
| recipient_group_id | BIGINT UNSIGNED NN | PK part; FK -> BloodGroup.blood_group_id |
| is_compatible | BOOLEAN NN | NN; DF absent because all 64 ordered pairs are seeded explicitly |

Composite PK/candidate key: `(donor_group_id, recipient_group_id)`. Store one row for every ordered pair; `is_compatible` is its fact, and the composite key prevents duplicate pair rules. The 8-group RBC matrix has 27 compatible and 37 incompatible pairs. Blood groups are reference data; admins view them, compatibility changes require reviewed controlled maintenance.

### DonationSlot

| Attribute | Type; nullability | Key / rules |
|---|---|---|
| slot_id | BIGINT UNSIGNED NN | PK |
| starts_at | DATETIME NN | CK |
| ends_at | DATETIME NN | CK `ends_at > starts_at` |
| capacity | SMALLINT UNSIGNED NN | CK `capacity > 0` |
| slot_status | VARCHAR(12) NN | CK `OPEN`, `CLOSED`, `CANCELLED`; DF `OPEN` |
| created_by_account_id | BIGINT UNSIGNED NN | FK -> Account.account_id; actor must be Admin at API boundary |
| created_at | DATETIME NN | DF current timestamp |

Candidate key/PK: `slot_id`. The approved entity has no location attribute. Add UQ `(starts_at, ends_at)` only if overlapping windows are prohibited; current design allows overlapping slots and does not impose that constraint. Once any Booking row exists for the slot, schedule edits are rejected. Capacity reductions below occupied capacity are rejected; occupied rows are `BOOKED` or `CHECKED_IN`.

### Booking

| Attribute | Type; nullability | Key / rules |
|---|---|---|
| booking_id | BIGINT UNSIGNED NN | PK |
| donor_account_id | BIGINT UNSIGNED NN | FK -> Donor.account_id |
| slot_id | BIGINT UNSIGNED NN | FK -> DonationSlot.slot_id |
| booking_status | VARCHAR(20) NN | CK `BOOKED`, `CANCELLED_BY_DONOR`, `CANCELLED_BY_STAFF`, `CHECKED_IN`, `NO_SHOW`, `COMPLETED`; DF `BOOKED` |
| booked_at | DATETIME NN | DF current timestamp |
| status_changed_at | DATETIME NN | DF current timestamp |
| cancellation_reason | VARCHAR(160) NULL | safe category/note, no medical details |

Candidate key/PK: `booking_id`; UQ `(donor_account_id, slot_id)` prevents repeat booking of same slot even after cancellation. Also declare UQ `(booking_id, donor_account_id)` as a referenced candidate key so an optional booking-linked eligibility decision can be constrained to the same donor. Capacity occupancy counts `BOOKED` and `CHECKED_IN`; `CANCELLED_BY_DONOR`, `CANCELLED_BY_STAFF`, `NO_SHOW`, and `COMPLETED` do not occupy capacity. Capacity and active-booking-per-donor-window require transaction/service validation because overlap spans rows.

### EligibilityDecision

| Attribute | Type; nullability | Key / rules |
|---|---|---|
| eligibility_decision_id | BIGINT UNSIGNED NN | PK |
| donor_account_id | BIGINT UNSIGNED NN | FK -> Donor.account_id |
| booking_id | BIGINT UNSIGNED NULL | Composite FK `(booking_id, donor_account_id)` -> Booking; multiple decision history entries may refer to a booking |
| decided_by_account_id | BIGINT UNSIGNED NN | FK -> Account.account_id |
| decision | VARCHAR(24) NN | CK `ACCEPTED`, `TEMPORARILY_DEFERRED`, `REVIEW_REQUIRED` |
| reason_code | VARCHAR(40) NULL | safe non-medical category |
| deferred_until | DATE NULL | CK required for temporary deferral; date semantics reviewed in API validation |
| decided_at | DATETIME NN | DF current timestamp |

Candidate key/PK: `eligibility_decision_id`. Donor and booking correspondence is enforced by the composite FK when `booking_id` is non-NULL; donor-only deferrals may leave booking NULL.

### Donation

| Attribute | Type; nullability | Key / rules |
|---|---|---|
| donation_id | BIGINT UNSIGNED NN | PK |
| booking_id | BIGINT UNSIGNED NN | UQ and FK -> Booking.booking_id; each booking has zero or one donation record |
| recorded_by_account_id | BIGINT UNSIGNED NN | FK -> Account.account_id |
| outcome | VARCHAR(16) NN | CK `COLLECTED`, `INCOMPLETE`, `DEFERRED` |
| collected_at | DATETIME NULL | required iff outcome `COLLECTED`; CHECK when supported, plus application validation |
| collection_reference | VARCHAR(80) NULL | UQ when present |
| release_status | VARCHAR(16) NN | CK `NOT_REQUIRED`, `PENDING`, `APPROVED`, `REJECTED`; DF `PENDING` for collected, application sets `NOT_REQUIRED` otherwise |
| release_decided_by_account_id | BIGINT UNSIGNED NULL | FK -> Account.account_id |
| release_decided_at | DATETIME NULL | required with `APPROVED`/`REJECTED` |
| release_reason_code | VARCHAR(40) NULL | safe category; required for rejection |
| created_at | DATETIME NN | DF current timestamp |

Candidate key/PK: `donation_id`; alternate key: `booking_id`. One final release decision is kept on Donation; no repeat testing history is required by the agreed workflow. Donor is derived through Booking to avoid duplicated donor FK. Blood group is assigned to the resulting unit at approval/creation and is not duplicated here.

### BloodUnit

| Attribute | Type; nullability | Key / rules |
|---|---|---|
| blood_unit_id | BIGINT UNSIGNED NN | PK |
| donation_id | BIGINT UNSIGNED NN | UQ and FK -> Donation.donation_id |
| blood_group_id | BIGINT UNSIGNED NN | FK -> BloodGroup.blood_group_id |
| expiry_date | DATE NN | calculated once on creation from donation's collection date and configured shelf life; transaction validates it is after source collection date |
| unit_status | VARCHAR(12) NN | CK `AVAILABLE`, `ALLOCATED`, `ISSUED`, `EXPIRED`, `DISCARDED`; DF `AVAILABLE` |
| discarded_at | DATETIME NULL | required iff status `DISCARDED` |
| discard_reason_code | VARCHAR(40) NULL | required iff discarded |
| expired_at | DATETIME NULL | set by expiry process |
| created_at | DATETIME NN | DF current timestamp |

Candidate key/PK: `blood_unit_id`; alternate key: `donation_id`. Collection date is obtained through `BloodUnit -> Donation.collected_at`, rather than stored twice. The unit is assigned a staff-confirmed blood group at creation after donation approval. Only `AVAILABLE` units with future expiry and approved source donation may be allocated.

### HospitalRequest

| Attribute | Type; nullability | Key / rules |
|---|---|---|
| request_id | BIGINT UNSIGNED NN | PK |
| hospital_account_id | BIGINT UNSIGNED NN | FK -> Hospital.account_id |
| recipient_group_id | BIGINT UNSIGNED NN | FK -> BloodGroup.blood_group_id |
| quantity_requested | SMALLINT UNSIGNED NN | CK `> 0`; immutable after submission in initial design |
| priority | VARCHAR(10) NN | CK `EMERGENCY`, `URGENT`, `NORMAL`; DF `NORMAL` |
| needed_by | DATETIME NN | |
| request_note | VARCHAR(500) NULL | no patient-identifying or sensitive clinical details |
| request_status | VARCHAR(20) NN | CK `SUBMITTED`, `UNDER_REVIEW`, `AWAITING_INVENTORY`, `PARTIALLY_FULFILLED`, `FULFILLED`, `REJECTED`, `CANCELLED`; DF `SUBMITTED` |
| rejection_reason_code | VARCHAR(40) NULL | required when rejected |
| created_at | DATETIME NN | DF current timestamp |
| updated_at | DATETIME NN | DF current timestamp |

Candidate key/PK: `request_id`. Current `ALLOCATED`, `ISSUED`, and outstanding counts are derived from Allocation rows, not duplicated. Request state is recomputed from current `ALLOCATED` and `ISSUED` quantities; terminal `FULFILLED`, `CANCELLED`, and `REJECTED` states never regress during allocation or expiry. Hospital ownership is server-derived from the session.

### RequestStatusHistory

| Attribute | Type; nullability | Key / rules |
|---|---|---|
| request_status_history_id | BIGINT UNSIGNED NN | PK |
| request_id | BIGINT UNSIGNED NN | FK -> HospitalRequest.request_id |
| old_status | VARCHAR(20) NULL | NULL for initial Submitted event |
| new_status | VARCHAR(20) NN | same allowed status set as request |
| changed_by_account_id | BIGINT UNSIGNED NULL | FK -> Account.account_id; NULL for system-originated expiry/maintenance only if applicable |
| reason_code | VARCHAR(40) NULL | |
| changed_at | DATETIME NN | DF current timestamp |

Candidate key/PK: `request_status_history_id`; index `(request_id, changed_at)`. Trigger maintains history atomically. Avoid cascade deletion.

### Allocation

| Attribute | Type; nullability | Key / rules |
|---|---|---|
| allocation_id | BIGINT UNSIGNED NN | PK |
| request_id | BIGINT UNSIGNED NN | FK -> HospitalRequest.request_id |
| blood_unit_id | BIGINT UNSIGNED NN | FK -> BloodUnit.blood_unit_id |
| allocation_status | VARCHAR(12) NN | CK `ALLOCATED`, `ISSUED`, `CANCELLED`; DF `ALLOCATED` |
| allocated_by_account_id | BIGINT UNSIGNED NN | FK -> Account.account_id |
| allocated_at | DATETIME NN | DF current timestamp |
| issued_at | DATETIME NULL | required iff `ISSUED` |
| handoff_reference | VARCHAR(80) NULL | |
| cancelled_at | DATETIME NULL | required iff `CANCELLED` |
| cancellation_reason_code | VARCHAR(40) NULL | required iff `CANCELLED` |
| active_blood_unit_id | BIGINT UNSIGNED GENERATED NULL | UQ; expression returns blood_unit_id while status is ALLOCATED or ISSUED, otherwise NULL |

Candidate key/PK: `allocation_id`. UQ `active_blood_unit_id` allows no more than one active (allocated or issued) allocation for a unit while permitting a cancelled historical allocation followed by a new row. UQ `(request_id, blood_unit_id)` is intentionally not used because reallocation after cancellation must be possible. Unit status and allocation state change in one transaction.

### AuditEvent

| Attribute | Type; nullability | Key / rules |
|---|---|---|
| audit_event_id | BIGINT UNSIGNED NN | PK |
| actor_account_id | BIGINT UNSIGNED NULL | FK -> Account.account_id; NULL for system scheduler only |
| action_code | VARCHAR(48) NN | controlled action vocabulary |
| subject_type | VARCHAR(32) NN | CK whitelist of entity names plus `SYSTEM_TASK` |
| subject_id | BIGINT UNSIGNED NULL | identifier in subject relation; typed reference, no polymorphic FK; NULL only for a run-level system task event |
| occurred_at | DATETIME NN | DF current timestamp |
| reason_code | VARCHAR(40) NULL | |
| change_summary | VARCHAR(1000) NULL | concise scalar summary only; no secrets/medical answers |
| operation_id | CHAR(36) NULL | groups per-unit events from one expiry run or allocation operation |

Candidate key/PK: `audit_event_id`. Index `(subject_type, subject_id, occurred_at)` and `(actor_account_id, occurred_at)`. CHECK requires subject_id to be NULL exactly when subject_type is `SYSTEM_TASK`; other subject types require an ID. Subject FK compromise and integrity rationale are documented below.

## Core constraints and invariant ownership

| Constraint family | Proposed examples | Enforcement |
|---|---|---|
| PRIMARY KEY | PK on every entity; composite PK on BloodCompatibility | MySQL |
| FOREIGN KEY | Profile -> Account; Booking -> Donor/Slot; Donation -> Booking; Unit -> Donation/Group; Request -> Hospital/Group; Allocation -> Request/Unit/Account; history -> parent/actor | MySQL, restrictive delete behavior |
| NOT NULL | identity, role, statuses, event timestamps, required relationship IDs, requested quantity/priority | MySQL |
| UNIQUE | Account.email; profile shared PK; BloodGroup.code; compatibility pair; Booking(donor,slot) and Booking(id,donor) referenced candidate key; Donation.booking; BloodUnit.donation; Allocation.active_blood_unit_id; optional registration/reference values | MySQL; nullable unique values permit multiple NULLs |
| CHECK | enum-like status/role/priority values; boolean values; positive quantities/capacity; slot ends after starts; conditional state/date fields where MySQL CHECK can express row-local logic | MySQL 8.0.16+, plus server validation; cross-table expiry validation is transactional |
| DEFAULT | PENDING account, OPEN slot, BOOKED booking, NORMAL priority, SUBMITTED request, AVAILABLE unit, ALLOCATED allocation, created/updated timestamps | MySQL where deterministic; state-dependent values set explicitly by application |

Cross-row rules (slot capacity, donor-slot overlap, donor/booking match, request/unit compatibility, donation release before unit creation, unit expiry after source collection, request status derived from issued allocation count) require transactional application logic or the allocation procedure. Do not pretend a row-level CHECK can enforce them.

## Candidate indexes

Beyond PK/unique/FK indexes, add only indexes justified by planned searches and joins:

| Index columns | Justification |
|---|---|
| Donor `(confirmed_blood_group_id)` and `full_name`; optionally `area` | staff donor group/name filters; add area index only if measured list size justifies it |
| DonationSlot `(slot_status, starts_at)` | open future slot listing |
| Booking `(donor_account_id, booking_status)` and `(slot_id, booking_status)` | donor history and slot capacity/queue checks |
| EligibilityDecision `(donor_account_id, decided_at)` | donor decision history/latest decision |
| Donation `(collected_at, outcome, release_status)` | staff date/status filters and reports; use selective leading columns based on actual query patterns |
| BloodUnit `(blood_group_id, unit_status, expiry_date, blood_unit_id)` and possibly `(unit_status, expiry_date, blood_unit_id)` | compatible-group FEFO selection and broad expiry scan; retain only indexes validated by EXPLAIN |
| HospitalRequest `(request_status, priority, needed_by, created_at)` | Admin priority queue; separately `(hospital_account_id, created_at)` for hospital's own requests |
| RequestStatusHistory `(request_id, changed_at)` | request timeline |
| Allocation unique active-unit key plus `(request_id, allocation_status)` | duplicate prevention and request fulfillment totals |
| AuditEvent `(subject_type, subject_id, occurred_at)` and `(actor_account_id, occurred_at)` | audit filters |

No full-text index or speculative index is proposed. Confirm indexes with representative queries and EXPLAIN after DDL exists.

## DBMS feature design (selected)

1. **VIEW — `v_available_inventory_by_group`:** aggregate approved, unexpired `AVAILABLE` units by BloodGroup and expose unit count. Base relations: BloodUnit, Donation, BloodGroup. It centralizes the definition of countable inventory and gives report queries a consistent read surface.
2. **Stored procedure — `sp_allocate_request_units`:** input request ID, requested allocation count (or remaining quantity), actor ID, intended issue date. It validates that the actor is an active Admin and owns the transaction; callers invoke it without an already active transaction. It locks the request then eligible BloodUnit rows in FEFO order (`expiry_date`, donation collection time, `blood_unit_id`), rechecks that request status is `UNDER_REVIEW`, `AWAITING_INVENTORY`, or `PARTIALLY_FULFILLED`, expiry, source release approval, compatibility pair, and no active allocation; `SUBMITTED` must first enter review, and terminal states are ineligible. It inserts one Allocation per chosen unit, updates each unit to `ALLOCATED`, derives request status without marking fulfilled before issue, writes one audit operation, and commits. It may allocate fewer than requested and return selected count/outstanding count; zero additional units require status derivation from all current Allocation rows: use `AWAITING_INVENTORY` only when both current `ALLOCATED` and `ISSUED` quantities are zero, keep `PARTIALLY_FULFILLED` when either quantity remains and issued is below requested, and keep `FULFILLED` when issued equals requested. Never allocate more than `quantity_requested - current ALLOCATED - current ISSUED`, and never reopen `FULFILLED`, `CANCELLED`, or `REJECTED`. On any error it rolls back. `mysql2` caller must not wrap it in another transaction.
3. **Trigger — `trg_request_status_history_update`:** after a HospitalRequest update, conditionally insert old/new status, reason, actor context and timestamp only if status changed. Initial Submitted history is inserted by the request-creation transaction. MySQL triggers fire `AFTER UPDATE` for the row, so the body compares `OLD.request_status` and `NEW.request_status`. Application sets connection-scoped actor and reason values before changing status, and clears them before returning a pooled connection; trigger uses NULL actor only for trusted system operations. The application never inserts the update event, avoiding duplication. Trigger cannot replace authorization or transition validation.
4. **Scheduled expiry — MySQL Event Scheduler:** daily event uses `Asia/Kolkata` as its schedule time zone and calls a narrowly scoped expiry routine or performs idempotent updates: due `AVAILABLE` units become `EXPIRED`; due `ALLOCATED` but unissued units have their allocation cancelled and unit expired, with request status recomputed from current Allocation rows. Request states already `FULFILLED`, `CANCELLED`, or `REJECTED` remain terminal. It writes one `SYSTEM_TASK` AuditEvent for each run (including zero changes) and per-unit events sharing its operation ID. Allocation, issue, cancellation, discard, and expiry must use a consistent locking strategy so no operation can race a unit into an invalid state. The exact strategy must be verified using concurrent MySQL connections during Phase 3; this design has not verified it. This is preferred because expiry belongs close to the inventory data and MySQL can schedule it; deployment must verify `event_scheduler` is enabled and the event definer has required privileges. If the college server disables it, a documented application scheduler is fallback, not a second simultaneous scheduler.

Allocation and issue are separate transactions. Issue locks the Allocation and BloodUnit, rechecks the unit is allocated and still valid, marks both records `ISSUED`, records handoff details, and sets HospitalRequest to `FULFILLED` only when the number of issued units equals the requested quantity. The unique active-unit key remains occupied for issued inventory permanently. Allocation, issue, cancellation, discard, and expiry must follow the same consistent lock strategy and be tested with concurrent connections; the strategy is not yet verified.

## Approved lifecycle and occupancy clarifications

- Recording a Donation outcome never creates a BloodUnit. Only approval of a `COLLECTED` donation with a confirmed blood group creates its one unit, atomically. The unique `BloodUnit.donation_id` and retry-safe operation prevent duplicate creation.
- Capacity occupancy is the count of `BOOKED` plus `CHECKED_IN` Booking rows. `CANCELLED_BY_DONOR`, `CANCELLED_BY_STAFF`, `NO_SHOW`, and `COMPLETED` do not occupy capacity. Reject capacity reductions below this count and schedule edits once any Booking exists. DonationSlot has no location attribute; location changes are outside this schema.
- Request status derives from current `ALLOCATED` and `ISSUED` rows. Keep these quantities separately visible; `FULFILLED` requires issued quantity exactly equal to requested quantity. Never allocate beyond requested quantity less current allocated and issued quantities. Preserve terminal request states during allocation and expiry.
- The same concurrency/locking strategy must cover allocation, issue, request/allocation cancellation, discard, and expiry. Phase 3 must implement and verify it with concurrent MySQL connections.

## Audit reference decision

AuditEvent keeps a real FK from `actor_account_id` to Account and typed `subject_type` + `subject_id` for the target. A single polymorphic target cannot have a conventional FK to several different tables. Creating one nullable FK per target plus an exactly-one check would make every audit row wide and tightly coupled to every entity. The selected whitelist and no-hard-delete policy preserve useful target identity; application/service validates target existence at event creation, and subject references remain resolvable because operational records are retained. `SYSTEM_TASK` rows use a NULL subject ID and include an operation ID/summary. This is an explicit integrity tradeoff, not a claimed FK.

Request status changes use the dedicated FK-backed RequestStatusHistory, not generic AuditEvent, so their referential integrity and transition history remain strong. Other significant changes use AuditEvent.

## CRUD and query/report examples planned

No SQL is created in this phase. Later SQL evidence should include:

- **Create:** insert a booking/request; update lifecycle via controlled status operations.
- **Read/search:** donor by group/area/status; slots by open status/date; units by group/status/expiry; requests by status/priority/date and Hospital.
- **Update:** approve account; record donation release decision; cancel booking; mark unit discarded. Demonstrate valid transitions.
- **Delete:** demonstrate safe logical deactivation/cancellation rather than physical deletion for traceable records; optionally hard-delete only an unreferenced test fixture within a transaction.
- **JOIN:** BloodUnit + BloodGroup + Donation + Booking + Donor; HospitalRequest + Hospital + Allocation + BloodUnit.
- **COUNT/GROUP BY:** count available units per group; count requests per status and priority in date range.
- **SUM/GROUP BY:** sum requested, allocated, and issued unit counts per group/priority/month.
- **AVG:** average hours from collected_at to release_decided_at for approved donations; exclude missing/rejected decisions and name unit/filters.
- **VIEW:** select from `v_available_inventory_by_group`.
- **Procedure evidence:** allocate a request with more/less compatible stock than requested, then demonstrate no duplicate unit assignment and rollback on injected invalid request in a disposable test DB.
- **Trigger evidence:** create a request and verify the creation transaction inserts the initial history row; change status and verify the trigger records it, while an unchanged status creates no duplicate event.
- **Expiry evidence:** run scheduled event or controlled routine against available units with past, current, and future expiry dates; verify only due units expire and event is idempotent.

## Scope and API coverage review

| Requirement/resource | Relational concepts supporting it |
|---|---|
| Login, logout, current account, approvals | Account; server-side session remains infrastructure storage |
| Donor profile and eligibility | Donor, BloodGroup, EligibilityDecision, Donation joined through Booking |
| Slots and bookings | DonationSlot, Booking, EligibilityDecision |
| Donation record and testing/release | Donation, Booking, Account; approved creation of BloodUnit |
| Blood groups and compatibility | BloodGroup, BloodCompatibility; BloodUnit group assignment |
| Inventory and expiry | BloodUnit, Donation, BloodGroup, AuditEvent; daily scheduler |
| Hospital profile and requests | Hospital, HospitalRequest, BloodGroup, RequestStatusHistory |
| Allocation, cancellation, issue, partial fulfillment | Allocation, BloodUnit, HospitalRequest; per-unit rows and derived counts |
| Audit search | AuditEvent with actor FK and typed subject reference |
| Donor/hospital/admin reports | Existing entities joined and aggregated; no redundant report tables |
| API search/filter resources | Index candidates listed above match donor, booking, donation, inventory, request, audit, and report filters |

All resources in `api-design.md` map to one or more entities above or to derived report queries. Account registration and subtype-profile creation must be atomic. Read-only compatibility lookup is served from BloodGroup and BloodCompatibility. Report screens use the planned view and aggregate queries; no additional reporting entity is needed.

## Known implementation caveats

- MySQL CHECK enforcement depends on server version; use 8.0.16 or later.
- Generated-column uniqueness, row locking syntax, event privileges, and trigger/session-variable behavior must be checked against the selected MySQL version during implementation.
- Avoid using fake `asOfDate` values in production paths; expiry uses database local date in Asia/Kolkata.
- The compatibility matrix and 42-day shelf life are educational RBC assumptions, not transfusion or regulatory guidance.

MySQL implementation references: [Event Scheduler](https://dev.mysql.com/doc/refman/8.0/en/event-scheduler.html) and [event privileges](https://dev.mysql.com/doc/refman/8.0/en/events-privileges.html); [trigger OLD/NEW behavior](https://dev.mysql.com/doc/refman/8.0/en/trigger-syntax.html); [generated-column indexes](https://dev.mysql.com/doc/refman/8.0/en/generated-column-index-optimizations.html); CHECK constraints are enforced starting with MySQL 8.0.16 as documented in [TABLE_CONSTRAINTS](https://dev.mysql.com/doc/refman/8.0/en/information-schema-table-constraints-table.html).
