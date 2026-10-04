# Database Design Inputs (Candidates, Not Schema)

This document identifies likely entity concepts and relationships for Phase 2. It deliberately does not define tables, columns, keys, indexes, or SQL. Normalization and exact boundaries remain to be designed.

## Candidate entities

| Candidate entity | Why it exists | Candidate relationships / considerations |
|---|---|---|
| Account / User | Authentication identity, account state, and role authorization for all three roles | One account has one primary role/profile in the mini-project. Role assignment must not be self-selected for Admin. Credentials should be separated from profile data conceptually. |
| Donor profile | Donor-specific personal/contact data, reported/confirmed group distinction, eligibility display | Belongs to an Account; has many bookings and donation records. Avoid storing detailed medical screening answers. |
| Hospital profile | Organization/contact identity | Belongs to an Account; has many blood requests. |
| Blood group | Authoritative supported ABO/Rh categories | Referenced by confirmed donor data, donation/unit group, request recipient group, and compatibility pairs. Eight supported codes. |
| Blood compatibility rule | Relational representation of donor-group to recipient-group red-cell compatibility | Each rule references one donor BloodGroup and one recipient BloodGroup; unique pair. Readable by API/report query; changes are controlled. |
| Donation slot | Scheduled appointment window and capacity | Has many bookings; should prevent overbooking under concurrent booking. No external calendar required. |
| Booking | Donor reservation and attendance/cancellation lifecycle | Belongs to one donor and one slot; may link to zero/one donation record. Retained after cancellation/no-show. |
| Eligibility decision / deferral | Staff day-of acceptance or deferral and interval-related result traceability | Belongs to donor and optionally booking/donation; links to actor account. Eligibility preview can be computed instead of persisted each time. |
| Donation | Actual attempt and collection outcome, separate from appointment | Belongs to donor and usually booking; records responsible staff; may have testing/release outcome. Successful approved donation is source of one unit under simplified model. |
| Testing / release decision | Records whether collected donation is approved for unit creation or rejected | Belongs to donation; decided by staff. Could be attributes/events of Donation rather than a separate entity; decide based on need for repeated test history. |
| Blood unit | Traceable inventory item with group, collection/expiry dates and lifecycle status | Belongs to one donation and one blood group; may have zero/one active allocation; retained when expired/discarded/issued. |
| Hospital request | Request quantity, recipient group, priority, need-by, status and lifecycle | Belongs to one hospital; has one or many allocation records; status changes should be traceable. |
| Allocation | Links a request with one or more selected units (or one row per unit) and tracks reservation, cancellation, issue | Belongs to request and unit and actor; design row granularity to prevent a unit being allocated twice and support partial fulfillment. |
| Audit event | Traceable record of significant state-changing actions | References actor and entity by type/id or modeled specific references; avoid secret/medical payloads. Polymorphic entity reference is simple but has weaker FK guarantees; choose deliberately. |
| Expiry run/event | Evidence that scheduled expiry handling ran and how many units changed | Could be represented by audit events rather than a dedicated entity. Decide whether run-level reporting is needed. |

## Candidate relationship summary

```text
Account 1--0/1 DonorProfile
Account 1--0/1 HospitalProfile
DonorProfile 1--many Booking many--1 DonationSlot
Booking 0/1--1 Donation
DonorProfile 1--many Donation
Donation 1--0/1 BloodUnit
BloodGroup 1--many BloodUnit / Donation / DonorProfile / HospitalRequest
BloodGroup many--many BloodGroup via BloodCompatibility (directed donor -> recipient)
HospitalProfile 1--many HospitalRequest
HospitalRequest 1--many Allocation many--1 BloodUnit (one unit per allocation candidate row)
Account 1--many AuditEvent; AuditEvent refers to affected entity/action
```

The notation is conceptual; it is not an ERD or finalized cardinality/schema. A booking may end without a donation. A donation may fail/reject and therefore have no unit. A request can have zero or multiple allocations and can be partially fulfilled.

## Normalization questions for Phase 2

- Keep login/account identity separate from donor and hospital profile attributes while avoiding unnecessary generic-profile complexity.
- Store blood-group labels/codes once and reference them; represent compatibility as pairs rather than repeating a matrix in application code.
- Avoid storing request outstanding quantity if it is safely derivable from requested quantity and active allocations; if stored for performance/demo, define transactionally maintained invariant.
- Determine whether request status history, eligibility decisions, testing decisions, and allocation transitions require separate event entities or a current status plus audit history.
- Define audit referential strategy that retains history even if a profile is deactivated.
- Document which candidate entities count as “major tables” for the required minimum ten sample records per major table.

## Query/report design inputs

Queries should join unit -> blood group and donation -> donor; request -> hospital and allocation -> unit; booking -> donor and slot. Aggregates should filter by half-open date ranges (`from <= timestamp < to`) in the agreed timezone. Use `COUNT` for records/units, `SUM` for requested/allocated/issued quantities, and `AVG` for explicitly defined durations over completed records only.

## DBMS feature candidates

- View: available, unexpired, approved inventory grouped by blood group/status, or request fulfillment summary.
- Stored procedure: transactional allocation of compatible units; or stored function for a narrowly defined eligibility/compatibility check. Favor a procedure if locking/multi-row updates are demonstrated.
- Trigger: maintain an audit/status event or enforce a narrow invariant, while preventing duplicate logging with application audit. Pick one behavior with a clear test case.
- Scheduled expiry: MySQL Event Scheduler if available in the development environment, or an application scheduler; both must be idempotent, auditable, and safe with concurrent allocation. Choose based on environment support in Phase 2.
- SQL examples: CRUD, parameterized search, joins, grouped counts/sums/averages, view query, routine call, trigger evidence, expiry run evidence.

## Decisions still open

- Local/institution-approved donor criteria and whether the proposed 56-day educational interval is accepted.
- Whether the proposed 42-day inventory shelf-life rule is accepted for the simplified model.
- Account approval specifics and whether hospitals/donors share a common account entity in the physical schema.
- Whether allocation status becomes fulfilled at issue only or at committed allocation; the domain proposal defines fulfilled as all units issued, with `Allocated` before issue.
- Slot duration, time zone, capacity, and whether staff-created slots may be edited after bookings exist.
- Exact definition of “major table” for sample data.
- MySQL version/configuration and event-scheduler availability.
- Session-store deployment choice and cross-origin/CSRF details for local frontend/API origins.
- Whether to keep testing/release decisions, eligibility decision history, request status history, and expiry runs as separate normalized entities or event records.
- Final report metrics, date grouping granularity, and privacy-safe donor report fields.
