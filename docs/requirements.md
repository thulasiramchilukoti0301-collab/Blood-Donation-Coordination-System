# Phase 1 — Requirements and Detailed Design

## Purpose and boundary

This document turns the approved project scope into requirements for the college mini-project. The system is an educational workflow simulator, not a clinical decision system or a production blood service. Donor eligibility and blood release must ultimately follow locally applicable rules and qualified staff decisions.

## Current bounded Account implementation

The [shared Account backend](account-approval-backend.md) now implements ACTIVE ADMIN queue and controlled DONOR/HOSPITAL PENDING -> ACTIVE approval, with atomic status/audit/session tombstones and revalidated login persistence. The later [backend-only status extension](account-status-backend.md) resolves ACCOUNT_SUSPENDED / ACCESS_RESTRICTED and ACCOUNT_REACTIVATED / ACCESS_RESTORED in addition to approval. It revalidates authoritative SIDs under Account/session locks at protected guards and again inside profile-write transactions, preventing revival across a complete cycle. Its latest 260-test backend run, including the Donor cleanup correction, is database-free. Separate [USER-RUN evidence reported 2026-10-27](account-status-backend.md#user-run-donor-status-cycle-evidence-reported-2026-10-27) records one Donor Console-driven status cycle and its observed sign-in/audit outcomes, without proving Hospital cycles, concurrency, rollback, multi-device revocation or all security cases. Separate USER-RUN Console approval/audit/fresh-login evidence dated 2026-10-26 is recorded in that guide; further live concurrency/failure/security and all-session/multi-device checks remain pending. The bounded [Mint approval frontend](account-approval-frontend.md) is now implemented through the existing contracts. Separate USER-RUN Donor UI evidence is recorded in that guide; live Hospital approval, multi-page/mobile/tablet and edge-case frontend checks remain pending; the later shared Mint Account management UI implements the exact status controls with fixture-based checks and a separate [USER-RUN Donor page cycle](account-approval-frontend.md#user-run-account-management-ui-evidence-reported-2026-10-27); Hospital UI status and further verification remain pending, and password change and other deferred features remain unimplemented. The broader requirements below do not imply those features are implemented.

## Product requirements

| ID | Requirement |
|---|---|
| R-01 | Support Admin / Blood Bank Staff, Hospital, and Donor accounts with role-restricted operations. |
| R-02 | Let a donor register, maintain contact/profile information, inspect their eligibility result and donation history, and book/cancel a slot under the defined rules. |
| R-03 | Let authorized staff record attendance, eligibility decision, donation outcome, testing/approval decision, and resulting unit creation. |
| R-04 | Track blood groups and individual blood units through availability, allocation, expiry, and unusable states. |
| R-05 | Let a hospital register, submit prioritized requests, view its own requests, and track fulfillment/status. |
| R-06 | Let authorized staff review requests, assess compatible inventory, allocate units, and update request status. |
| R-07 | Prevent allocation of units that are expired, unavailable, incompatible, or not approved for release. |
| R-08 | Record audit events for significant operational state changes without recording credentials/secrets. |
| R-09 | Provide searchable/filterable role-appropriate lists and an initial reports dashboard. |
| R-10 | Persist application data in MySQL through the Express API using `mysql2`; validate inputs server-side. |
| R-11 | Produce SQL and academic artifacts that demonstrate all database requirements in `project-scope.md`. |
| R-12 | Provide test evidence and complete setup, use, and database documentation before handoff. |

The source-separated academic handoff checklist, including user-requested PPT and GitHub URL deliverables, is in [`project-report-checklist.md`](project-report-checklist.md), which records the recovered exact order of the thirteen college report sections.

## Operational assumptions

- The first version models whole-blood donations and red-cell compatibility for allocation. It does not model components, crossmatching, transfusion decisions, or clinical workflows.
- A donation outcome record never creates a BloodUnit. Approval of a collected donation with a confirmed group creates exactly one unit atomically and idempotently; a failed/incomplete or unapproved donation does not create an allocatable unit.
- One unit represents one inventory item for this project. The actual collection volume is not used to compute clinical dosing.
- Hospitals request a blood group and integer number of units. Allocation is recorded per unit so partial fulfillment can be represented.
- Registration creates a pending account until approved by staff. Public self-registration cannot grant Admin privileges.
- PENDING Donor/Hospital accounts may log in only to view approval status, read/update permitted own-profile fields, change their password, and log out; operational actions require ACTIVE. SUSPENDED accounts cannot establish sessions, existing sessions are revoked, and protected requests check current account state, role, and ownership. Reactivation is audited and requires a fresh login; revoked sessions remain invalid.
- Shared registration/password-change policy: at least 8 Unicode code points, maximum 72 UTF-8 bytes, at least one Unicode number and one punctuation/symbol character; spaces are allowed but do not meet the symbol requirement; no mandatory upper/lowercase combination; reject control characters. Preserve the exact password string without trimming, normalization, truncation, logging, or echoing. Hash with bcrypt work factor 12. Password change remains deferred; when authorized it must verify the current password, audit without password material, revoke all account sessions, and require login again. CSRF protection remains required; public recovery is excluded.
- No physical slot-capacity calendar, messaging, or external integrations are implied; a slot is a scheduled date/time record whose capacity rules can be kept simple for the mini-project.

## Functional requirement coverage

| Scope item | Design location |
|---|---|
| Donor registration/profile | `role-permissions.md`, `api-design.md` |
| Eligibility and next eligible date | `domain-rules.md` |
| Slot booking/cancellation | `domain-rules.md`, `api-design.md` |
| Donation recording | `domain-rules.md`, `role-permissions.md`, `api-design.md` |
| Blood-unit creation/tracking and blood groups | `domain-rules.md`, `database-design.md` |
| Expiry and scheduled handling | `domain-rules.md`, `database-design.md` |
| Hospital registration/login/requests | `role-permissions.md`, `domain-rules.md`, `api-design.md` |
| Priorities, compatibility, allocation, request status | `domain-rules.md`, `api-design.md` |
| Inventory, audit, dashboard/reports | `role-permissions.md`, `api-design.md`, `database-design.md` |
| Authentication/input validation/connectivity | `api-design.md` |
| ERD/schema/3NF/SQL/DBMS demonstrations | `database-design.md`, `relational-schema.md`, `normalization.md`, `er-design.md` |

## DBMS demonstration mapping

| Required concept | Planned demonstration |
|---|---|
| PK/FK and NOT NULL/UNIQUE/CHECK/DEFAULT | Relational design and final DDL; select meaningful constraints for each entity. |
| CRUD | API-backed create/read/update flows and controlled status changes; avoid hard-delete of traceable donation/allocation history. |
| Search/filter | Role-specific list APIs and parameterized query examples. |
| JOIN | Request with hospital and allocations; unit with blood group and donation/donor; donation history with donor. |
| COUNT | Unit counts by blood group/status; requests by status/priority. |
| SUM | Requested/allocated unit quantities over a date range. |
| AVG | Average donation-to-approval duration or request fulfillment duration, only for completed records and with clearly stated units. |
| GROUP BY | Group inventory/request/donation aggregates by blood group, status, priority, and period. |
| View | `v_available_inventory_by_group`, specified in `database-design.md`. |
| Stored procedure/function | Transactional FEFO allocation procedure `sp_allocate_request_units`. |
| Trigger | `trg_request_status_history_update` records request status changes. |
| Scheduled expiry | Daily MySQL Event Scheduler design with run and per-unit audit events, subject to environment support. |
| 10+ sample records per major table | Twelve major tables are listed in `database-design.md`; Phase 3 supplies ten or more rows for each. |
| DDL/DML, ERD, relational schema, 3NF | ERD, relational design, and 3NF notes are complete; executable DDL/DML belong to Phase 3. |

## Phase status

Phase 1 requirements and Phase 2 logical database design are complete. The bounded Phase 3 foundation milestone authors Account/BloodGroup DDL and reference data; applying and verifying it requires an authorized local connection. The remaining physical schema, domain data, and DBMS operations are still later Phase 3 deliverables and require their own authorization.
