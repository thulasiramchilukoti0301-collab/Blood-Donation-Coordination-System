# Implementation Readiness Review

This is a documentation-only review of the current design. It does not authorize implementation or amend approved business rules. API operations are planned contracts, including approved documentation additions, not implemented endpoints. Frontend routes/screens are proposed, and no behavior described here is claimed to be implemented or verified.

## 1. Current project status

| Area | Documented/designed | Implemented and verified |
|---|---|---|
| Scope, architecture, requirements, role permissions, domain rules, preliminary API, database model, ER design, relational schema, and normalization | Documented. Phase 0, Phase 1, and Phase 2 are marked complete as documentation/design in `development-plan.md`. | No application implementation or executable SQL is documented. The repository status contains documentation only; no runtime behavior has been exercised as part of this review. |
| UI | Thirty planned screens and shared UI requirements are described in `ui-screen-map.md`. | No screens are implemented or verified. |
| Database | Fourteen logical entities, constraints/invariants, sample-data targets, and selected DBMS features are designed in `database-design.md`. | No physical schema, DDL/DML, project database setup, or sample data is documented. The user reports a MySQL Workbench connection to a server; this environment observation does not establish that the project schema or application database connection is implemented. |
| API | Preliminary routes, roles, payload outlines, security behavior, and report operations appear in `api-design.md`. | No API routes or endpoint behavior are implemented or verified. |

Phase 3 database implementation and later application phases require explicit authorization under `AGENTS.md` and `development-plan.md`.

## 2. Screen-to-API coverage

Route names below are the planned contracts in `api-design.md`; they are not implemented endpoints. Detail reads, password change, and allocation-history retrieval requested by the screen baseline are now approved documentation contracts. The frontend routes remain proposed.

| # / screen | Existing planned endpoint coverage | Coverage note |
|---|---|---|
| 1. Login | `POST /api/auth/login`; `POST /api/auth/logout` | Login is covered. Logout is a separate authenticated operation; no logout control is assigned to a dedicated screen. |
| 2. Unauthorized / Access Denied | No dedicated endpoint; protected endpoints return safe authorization errors. | Presentation-only screen; backend authorization remains required. |
| 3. Not Found / 404 | None | Presentation/router fallback; no API endpoint needed. |
| 4. Donor Dashboard | `GET /api/donors/me/eligibility`; `GET /api/donors/me/bookings`; `GET /api/donors/me/donations`; `GET /api/donors/me/reports/activity` | Summary data is available across existing planned operations. |
| 5. Donor Profile | `GET/PATCH /api/donors/me`; `GET /api/blood-groups` | Own profile read/update and group lookup are covered. |
| 6. Eligibility Status | `GET /api/donors/me/eligibility`; `GET /api/donors/me/donations` | Advisory status and high-level history are covered. Staff decisions are recorded by `POST /api/admin/donors/{donorId}/eligibility-decisions`. |
| 7. Available Donation Slots | `GET /api/donation-slots`; `POST /api/donors/me/bookings` | Open slot listing and booking are covered. |
| 8. My Bookings | `GET /api/donors/me/bookings`; `POST /api/donors/me/bookings/{bookingId}/cancellation` | Own booking list and cancellation are covered. |
| 9. Donation History | `GET /api/donors/me/donations` | High-level own history is covered. |
| 10. Hospital Dashboard | `GET /api/hospitals/me/reports/requests`; `GET /api/hospitals/me/requests` | Own request summary/list are covered. |
| 11. Hospital Profile | `GET/PATCH /api/hospitals/me` | Own profile read/update are covered. |
| 12. Create Blood Request | `POST /api/hospitals/me/requests`; `GET /api/blood-groups` | Request creation and group lookup are covered. |
| 13. My Blood Requests | `GET /api/hospitals/me/requests` | Own request list/filter is covered. |
| 14. Blood Request Details | `GET /api/hospitals/me/requests/{requestId}`; `POST /api/hospitals/me/requests/{requestId}/cancellation` | Own request details and cancellation are covered. |
| 15. Admin Dashboard | `GET /api/admin/reports/inventory`; `GET /api/admin/reports/donations`; `GET /api/admin/reports/requests` | Compose the dashboard from existing planned report endpoints; no dedicated dashboard endpoint is needed. |
| 16. Donor Management | `GET /api/admin/donors`; `GET /api/admin/accounts` | Search and account-state filters are covered. |
| 17. Donor Details / Edit Donor | `GET/PATCH /api/admin/donors/{donorId}`; `POST /api/admin/donors/{donorId}/eligibility-decisions`; `PATCH /api/admin/accounts/{accountId}` | Detail read, edit, eligibility, and account actions are covered by planned contracts. |
| 18. Donation Slot Management | `GET /api/donation-slots`; `POST /api/admin/donation-slots`; `PATCH /api/admin/donation-slots/{slotId}` | List/create/update/cancel future slots are covered. |
| 19. Bookings Management | `GET /api/admin/bookings`; `PATCH /api/admin/bookings/{bookingId}/status` | Search and status/check-in operations are covered. |
| 20. Donation Processing | `POST /api/admin/donations`; `GET /api/admin/bookings`; `POST /api/admin/donors/{donorId}/eligibility-decisions` | Staff can find bookings, record a day-of decision, and record the donation outcome. Ensure decision and donation are tied to the same donor/booking. |
| 21. Donation Testing / Approval | `GET /api/admin/donations`; `POST /api/admin/donations/{donationId}/testing-decision` | Find and decide release status are covered. |
| 22. Blood Inventory | `GET /api/inventory`; `POST /api/admin/inventory/expiry/run` | Search and explicit expiry reconciliation are covered; scheduled expiry is a database design feature, not a screen endpoint. |
| 23. Blood Unit Details | `GET /api/admin/inventory/{bloodUnitId}`; `POST /api/admin/inventory/{bloodUnitId}/discard`; allocation/issue routes below | Approved detail GET returns screen-required unit/source/allocation summary fields. |
| 24. Hospital Management | `GET /api/admin/hospitals`; `GET /api/admin/hospitals/{hospitalId}`; `GET /api/admin/accounts`; `PATCH /api/admin/accounts/{accountId}` | Approved Admin list/detail contracts cover screen reads; account status changes reuse the existing account endpoint. |
| 25. Blood Request Management | `GET /api/admin/requests`; `GET /api/admin/requests/{requestId}`; `POST /api/admin/requests/{requestId}/review`; `PATCH /api/admin/requests/{requestId}/priority` | Queue, details, review/status, rejection, and priority operations are covered by planned contracts. |
| 26. Request Allocation | `GET /api/admin/requests/{requestId}` (includes allocation history); `POST /api/admin/requests/{requestId}/allocations`; `POST /api/admin/allocations/{allocationId}/cancellation`; `POST /api/admin/allocations/{allocationId}/issue`; `GET /api/inventory` | The Admin request-detail response includes only allocations belonging to that request; no second allocation-history GET is defined. |
| 27. Compatibility Management | `GET /api/blood-groups`; `PATCH /api/admin/blood-compatibility/{donorGroupId}/{recipientGroupId}`; `PATCH /api/admin/blood-groups/{groupId}` | Matrix read and reviewed compatibility/group updates are covered. |
| 28. Audit Log | `GET /api/admin/audit-events` | Search is covered. |
| 29. Reports & Analytics | `GET /api/admin/reports/inventory`; `GET /api/admin/reports/donations`; `GET /api/admin/reports/requests` | The listed aggregate reports are covered. |
| 30. Account / Password Settings | `GET /api/auth/me`; `POST /api/auth/password`; `POST /api/auth/logout` | Password change is an approved planned contract; the shared registration/password policy remains to be specified. |

### Coverage summary

The planned contracts cover all 30 screens in `ui-screen-map.md`; the approved additions are specified in `api-design.md`, not implemented endpoints. Allocation history is available within the Admin request-detail response; no separate allocation-history GET is defined. Donor and Hospital report endpoints feed their dashboards; the Admin dashboard composes existing report endpoints. Theme assignments remain OPEN.

## 3. Business-rule consistency

| Topic | Documented rule and consistency review | Readiness note / reference |
|---|---|---|
| Role authorization | Default deny; explicit role and ownership checks; Admin / Blood Bank Staff performs operational actions. UI visibility is not authorization. | Consistent in `role-permissions.md`, `architecture.md`, `api-design.md`, and `ui-screen-map.md`. Backend authorization must be implemented and verified on every protected resource/action. |
| Resource ownership | Donor and Hospital “me” resources derive identity from session; hospital can only see own requests; donor can only see own profile/bookings/history. Client-supplied actor or owner IDs are not trusted. | Consistent. Admin entity IDs remain subject to role authorization. See `role-permissions.md` and API contract preamble. |
| Account states | `PENDING`, `ACTIVE`, `SUSPENDED`; registration, limited pending access, session revocation, audited reactivation, and fresh login are specified in `api-design.md`/`role-permissions.md`. | Resolved at documentation level; runtime enforcement remains unimplemented and unverified. |
| Eligibility | Advisory preview; latest staff decision; configured 56-day interval from successful `COLLECTED` outcome; temporary deferral independently blocks through its date. | Consistent in `domain-rules.md` and `database-design.md`; no eligibility-policy ambiguity identified in this review. |
| Booking capacity | `BOOKED` and `CHECKED_IN` occupy capacity; the other four schema statuses do not. Reject capacity reduction below occupancy and schedule edits once any booking row exists; preserve cancellation rules. | Resolved in `domain-rules.md`, `database-design.md`, and `api-design.md`; slot location is not an existing schema/API field. |
| Donation processing/testing | Outcome recording creates no unit. Approval of a collected donation with a confirmed group creates exactly one unit atomically and idempotently. | Response semantics are aligned in `api-design.md`; behavior is planned and not implemented/verified. |
| Unit expiry | Shelf life is a configurable 42 calendar days; unit is allocatable only before expiry. Daily Asia/Kolkata scheduler expires due available units and cancels/expires due unissued allocations atomically. Issue/allocation recheck validity. | Consistent at design level. Confirm MySQL version, Event Scheduler support/privileges; otherwise use only the documented application-scheduler fallback. `database-design.md`, `architecture.md`, `AGENTS.md`. |
| Compatibility direction | Matrix is directed from donor-unit group to recipient group, for educational red-cell model. | Use the complete matrix in `domain-rules.md`; verify any Phase 3 seed rows against that documented matrix. It is not a clinical decision rule. |
| FEFO allocation | Admin allocation locks/rechecks eligible units and sorts expiry, collection time, then unit ID. Only approved, available, compatible, unexpired units may be allocated; partial fulfillment is allowed. | Consistent in `database-design.md` and `domain-rules.md`. `intendedIssueDate` must be checked against expiry, and issue rechecks actual current validity. |
| Cancellation | Donor may cancel own booking before slot start. Hospital may cancel its request before any unit is issued; cancellation releases unissued allocations and restores units only if still usable/unexpired. Individual allocation cancellation is pre-issue; expired/discarded units are not restored as available. | Rules and audit/history requirements are documented across `domain-rules.md`, `database-design.md`, and `api-design.md`; Phase 3 verification must exercise simultaneous cancellation/issue serialization under the shared locking strategy. |
| Issuing | Issue is a separate transaction from allocation; it locks allocation/unit, validates allocated and valid state, marks both issued, records handoff, and recomputes request status. | Consistent in `database-design.md`, `domain-rules.md`, and API endpoint. Handoff reference format and whether `issuedAt` can be supplied or server-generated are implementation details to settle in API finalization. |
| Request fulfillment | Derive status from current `ALLOCATED` and `ISSUED` quantities; fulfilled requires issued quantity exactly equal to request quantity; terminal states never regress; allocate at most requested minus current allocated and issued. | Resolved in `domain-rules.md` and specified for implementation/verification in `database-design.md`. |

## 4. Account workflow

### Resolved access rules

- Public Donor/Hospital registration creates `PENDING`; Admin accounts remain manually/out-of-band provisioned.
- PENDING Donor/Hospital accounts may authenticate only to view approval status, read/update permitted own profile fields, change their password, and log out. Operational actions require `ACTIVE` status.
- SUSPENDED accounts cannot establish sessions. Suspension revokes existing sessions, and every protected request checks current account status, role, and ownership.
- Reactivation is an audited staff action and requires a fresh login. A session revoked by suspension remains invalid.
- Own-profile routes and `/api/auth/me` remain the status/profile surfaces; no screen is added beyond the 30-screen baseline.
- Password change is an approved planned `POST /api/auth/password` contract. It verifies the current password, validates the new password server-side against the registration policy, stores only a bcrypt hash, audits without password values or hashes, revokes every account session including the current one, and requires login again. CSRF protection and login rate limiting remain in force. Public recovery is out of scope.

### Remaining narrow decision

The registration contract currently has no concrete password policy. Specify one shared policy for registration and password change before implementing authentication. No policy has been invented in this review.

## 5. Proposed implementation order and ownership

The sequence below is dependency-based and does not authorize implementation. Shared foundations are integrated first; then complete domain features may proceed in parallel once dependencies are on `main`. Each feature owner handles its database, backend/API, frontend/UI, validation, testing, and feature documentation. See `team-workflow.md`.

| Milestone | Dependency and deliverable | Full-feature ownership and integration |
|---|---|---|
| 0. Shared decision/integration agreement | Agree module boundaries, schema/API ownership, dependency order, shared status/error/session contracts, and what evidence gates parallel work. Documentation coordination only; no application foundation is implemented here. | Thulasi and Lathikaa coordinate and review. |
| 1. Phase 3 database modules | Build coordinated schema modules and sample data, assemble in dependency order, implement selected view/procedure/trigger/expiry design, and verify constraints/transactions/concurrency on target MySQL. Phase 3 does not authorize React/Express work by itself. | Thulasi owns authentication/donor/eligibility/booking/donation/inventory database modules; Lathikaa owns hospital/request/compatibility/allocation/audit/report database modules. Coordinate shared Account, Booking, Donation, BloodUnit, HospitalRequest, Allocation, RequestStatusHistory, and AuditEvent dependencies. |
| 2. Phase 4 shared application foundation | After verified database work and separate Phase 4 authorization, establish React/Express structure, mysql2 pool, environment configuration, shared API/error/auth/session/CSRF conventions, route/navigation shell, and local connectivity. | Shared, coordinated foundation is integrated into `main` before feature parallelism. |
| 3. Phase 5 authentication and role access | Implement registration/login/logout/current identity, pending/suspended rules, approval/reactivation, and agreed password change. This is the shared operational gate for protected domain features. | Thulasi owns the complete Authentication & Role Access feature; Lathikaa reviews and integrates against the shared contract. |
| 4. Parallel domain features after dependencies integrate | Implement donor/eligibility/booking/donation/inventory features and hospital/request features. Hospital profile and request work can proceed alongside Thulasi's donor workflows; compatibility/FEFO allocation and issuing begin once the inventory and request interfaces they depend on are integrated. | Thulasi owns complete donor, eligibility/booking, donation, and inventory features. Lathikaa owns complete hospital/request, compatibility/allocation, and related operational tracking features. Coordinate shared files/contracts and integrate dependencies through reviewed PRs. |
| 5. Dashboards, reports, and audit views | Build report/dashboard and audit UI after stable domain contracts; audit recording and request-history infrastructure must accompany the first operations that require them. | Lathikaa owns Audit & Operational Tracking and Dashboard & Reports end-to-end; feature owners include their audit writes with their operations. The audit screen may be delivered later. |
| 6. Cross-feature verification and handoff | Verify role/ownership/state rules, database constraints, lifecycle transitions, reports, setup, and documentation; record actual evidence. | Both developers review and understand each other's work; other teammates can support report preparation, test documentation, screenshots, and presentation. |

### Database dependencies and locking integration

Database setup eventually executes coordinated modules in dependency order. Shared dependencies include Account, BloodGroup/Compatibility, DonationSlot/Booking/EligibilityDecision, Donation/BloodUnit, Hospital/HospitalRequest, Allocation, RequestStatusHistory, and AuditEvent. A consistent lock strategy must cover allocation, issue, cancellation, discard, and expiry; implement and verify it with concurrent MySQL connections in Phase 3. Do not claim this is already verified.

## 6. Readiness conclusion

The project is design-ready for Phase 3 subject to its explicit authorization and target-environment checks. The API additions and account-state/lifecycle decisions in this review are resolved as planned documentation contracts. None of them represents implemented behavior.

### Remaining database-phase blockers/checks

1. MySQL Workbench results were provided by the user: connected server version `8.0.46`, Event Scheduler `ON`, global and session time zones `SYSTEM`, and system time zone `India Standard Time`. These are user-provided observations, not results queried by this review. An earlier non-interactive CLI connection attempt was denied, so this review did not independently query the server. Named `Asia/Kolkata` time-zone support and privileges to create scheduled events remain unverified and must be confirmed for the target environment before relying on the database scheduler. The Phase 3 expiry verification should also confirm the scheduler uses the intended India time zone.
2. During Phase 3, implement and verify one consistent locking strategy across allocation, issue, cancellation, discard, and expiry using concurrent MySQL connections. This concurrency behavior remains unverified.
3. Phase 3 remains an explicit authorization gate. Its logical entities and major-table sample minimum are already documented; execute the coordinated modules in dependency order when authorized. The location field is absent from the approved DonationSlot schema; schedule edits are prohibited after bookings exist, and location is not modeled by current contracts.

These are database environment/implementation checks, not a claim that every later application configuration decision blocks schema work.

### Later application decisions

- Agree the concrete password policy once for both registration and password change; current documentation does not specify one.
- Select the server-side session store and deployment-specific cookie, CSRF, and CORS settings during the application foundation phase.
- Finalize remaining pagination, validation/error details, and dashboard metric definitions without adding unapproved thresholds or metrics.
