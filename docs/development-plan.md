# Development Plan

This plan divides the project into reviewable phases. Phases 0, 1, and 2 are complete as documentation/design work. No implementation phase is complete without repository evidence. Phases define authorized deliverables; feature ownership defines who implements those deliverables. Do not begin a later phase without explicit user instruction.

The approved architecture remains React, Node.js/Express, MySQL, `mysql2`, bcrypt, server-side sessions, and Chart.js. See `team-workflow.md` for full-feature ownership. Shared foundations are integrated sequentially; domain feature work can proceed in parallel after dependencies are available on `main`.

The one-time repository scaffold commit (`88fd043`, `chore: initialize project structure`) is present in `main` ancestry through merge commit `3335268`. Lathikaa's integrated application foundation (`39e6a3c`) adds the React/Vite client, Express API, mysql2 pool/configuration, and health/connectivity checks. It maps to the foundation and connectivity components of official Phase 4; it does not complete authentication, sessions, feature workflows, or database schema. Official Phase 3 is partially implemented only when its explicitly authorized database deliverables are present; the current bounded Account/BloodGroup milestone alone does not complete it.

## Phase 0 — Scope and project conventions (complete)

- Inspect repository state.
- Record scope, proposed architecture, implementation phases, and repository conventions.
- Review the documents for consistency.
- **Deliverables:** `AGENTS.md`, `docs/project-scope.md`, `docs/architecture.md`, `docs/development-plan.md`.

## Phase 1 — Requirements and detailed design (complete)

- Define role permissions, donor/donation/unit/request lifecycles, compatibility and allocation behavior, audit requirements, searches, and initial reports.
- Choose secure server-side sessions with bcrypt for authentication.
- Produce preliminary API contract and candidate database entities/relationships without finalizing a schema.
- Record the role, lifecycle, compatibility, allocation, audit, search, report, and preliminary API decisions documented for review in Phase 2.
- **Deliverables:** `docs/requirements.md`, `docs/domain-rules.md`, `docs/role-permissions.md`, `docs/api-design.md`, and `docs/database-design-inputs.md`; no application implementation or SQL artifacts.

## Phase 2 — Database design (complete)

- Select final logical entities and relationships; document attributes, keys, constraints, and indexes.
- Review normalization through 3NF and document the ER diagram and relational schema.
- Select the view, transactional allocation procedure, status-history trigger, and scheduled expiry mechanism conceptually.
- Define major-table list and sample-data minimum.
- **Deliverables:** `docs/database-design.md`, `docs/relational-schema.md`, `docs/normalization.md`, `docs/er-design.md`, and resolved `docs/database-design-inputs.md`. No executable SQL or schema deployment in this phase.

## Phase 3 — Database implementation and local verification (in progress; foundation, Donor, eligibility/booking, Donation, and BloodUnit storage verified)

- Divide database work into coordinated feature modules aligned to `team-workflow.md` ownership; coordinate shared relations and invariants.
- Create DDL and DML for the approved logical design; add at least ten sample records to every major table.
- Implement and demonstrate the view, stored procedure, trigger, and scheduled expiry mechanism.
- Assemble and run database setup modules in dependency order, then verify keys, constraints, allocation concurrency invariants, and sample reports in the selected MySQL version.
- Audit recording and RequestStatusHistory infrastructure must accompany the first operations that require those records; the audit-log screen may be implemented later.
- **Deliverables:** reviewed SQL artifacts and local database verification evidence. Do not apply to a shared/live database without authorization.
- Completing Phase 3 does not by itself authorize React or Express implementation; Phase 4 remains a separate authorization gate.
- The completed local foundation milestone contains `001_foundation.sql` (BloodGroup), `002_auth.sql` (Account), the eight-row BloodGroup reference seed, a foundation-only setup path, and disposable-schema verification. The bounded Donor milestone adds only `003_donors.sql` and its disposable verifier; it does not expand `apply-foundation.mjs` or `setup.sql`. User-run evidence dated 2026-10-20 records successful preflight, application of only 003 to `blood_donation_coordination`, and fresh disposable verification with 13 negative checks plus successful rollback of ten synthetic Account/Donor pairs and connection cleanup. This completes only the Donor schema verification milestone. At that historical milestone, ten major tables remained. Other logical entities including BloodCompatibility, domain data, other seeds, procedures, triggers, reports, expiry, concurrency checks, and future application enforcement remain pending and require their applicable authorization. Donor verifier fixtures are not permanent samples.
- The 005 milestone creates `DonationSlot`, `Booking`, and `EligibilityDecision` in dependency order. Fresh disposable setup is 001, 002, the BloodGroup reference seed, 003, then 005; 004 Hospital is not a dependency. User-run results reported 2026-10-24 verify only this storage milestone; they do not verify booking workflows, concurrency, authentication, or all of Phase 3.
- The bounded 006 milestone creates only Donation after Account and Booking. User-run results reported 2026-10-24 verify its storage: fresh disposable assembly followed 001, 002, reference data, 003, 005, 006; all 31 verifier negative checks passed; ten synthetic Donation fixtures and prerequisites rolled back and the connection closed; preflight found the required tables present and Donation absent; applying only 006 to `blood_donation_coordination` succeeded. At the 006 milestone, six major tables remained. See `database/README.md` for the full evidence. This does not expand `apply-foundation.mjs` or `setup.sql`. Donation outcome recording creates no BloodUnit; atomic/idempotent unit creation after approval remains later service work after inventory and audit schema exist. Authorization, eligibility workflows, lifecycle transitions, corrections, concurrency, other logical entities including BloodCompatibility, domain data/seeds, procedures, triggers, reports, expiry, and future application enforcement remain pending and require their applicable authorization. Verifier fixtures are not permanent samples.
- User-run results reported 2026-10-24 verify the bounded 007 BloodUnit storage milestone only. Disposable schema `bddc_phase3_test_inventory_20261024_first` followed order 001, 002, reference data, 003, 005, 006, 007; all 16 negative checks passed; ten fixtures and prerequisites rolled back and the connection closed. Development preflight found all seven prerequisites and BloodUnit absent, then only 007 was applied successfully; read-only `SHOW CREATE TABLE` confirmed its expected structure. An accidental second invocation failed authentication before executing SQL and is not a successful rerun-guard test. See `database/README.md` for details. Current remaining schema scope is six logical entities, including five major tables: Hospital, BloodCompatibility, HospitalRequest, RequestStatusHistory, Allocation, and AuditEvent. Authorization, approval/unit creation, expiry calculation/validation, lifecycle operations, audit writes, concurrency, permanent sample data, and the rest of Phase 3 remain pending. Do not expand the foundation runner; rolled-back verifier fixtures do not satisfy the sample-data requirement.
- User-run results reported 2026-10-24 verify only the grouped read-only inventory view milestone. Disposable schema `bddc_phase3_test_inventory_view_20261024_first` was assembled in order 001, 002, reference data, 003, 005, 006, 007, then the view; its verifier passed 14 fixture cases, metadata, exact-count, and date-boundary checks, rolled back fixtures, confirmed an empty view afterward, and closed the connection. Development preflight found eight base tables and no view; applying only the view to `blood_donation_coordination` succeeded. This does not verify application-account access, APIs, reports/screens, approval/unit creation, allocation, expiry transitions, audit writes, or concurrency. The view adds no entity/table. Approval/unit creation, allocation, expiry work, audit infrastructure, concurrency, permanent sample data, and the remaining six logical entities/five major tables remain pending. The separate bounded authentication evidence is recorded under Phase 5.
- User-run results reported 2026-10-24 verify the seven canonical parameterized SELECT demonstrations in `database/queries/donor_inventory.sql` and their disposable fixture assertions, assembled in schema `bddc_phase3_test_donor_inventory_queries_20261024_first` from 001, 002, reference data, 003, 005, 006, 007. Coverage included donor isolation, traceability, optional filters, ordering, date boundaries, grouped counts, fractional-hour averages, and empty results; fixtures were rolled back, empty-state checks passed, and the connection closed. These query templates are not a migration or setup batch. Verification is limited to these SQL demonstrations; it does not establish application authorization, APIs, reports/screens, authentication, workflow mutations, or concurrency.
- User-reported local evidence records successful foundation setup on `blood_donation_coordination` and successful verification on both named disposable schemas, including all 21 negative checks each; reruns against both populated disposable schemas returned exit code 1 and were followed by successful verification. This evidence completes only the bounded setup/verification milestone. The remaining Phase 3 deliverables are still in progress.

## Phase 4 — Project foundation and connectivity (foundation/connectivity components complete)

- The runnable React/Express structure and development configuration were integrated in Lathikaa's personal Phase 1 foundation commit; this maps to these official Phase 4 components. Personal phase labels do not renumber official project phases.
- Configure environment-based settings and MySQL connection pooling with `mysql2`.
- Add a minimal connectivity path and consistent error handling.
- **Deliverables:** runnable client/server foundation and documented local setup.
- User-reported `check:db` success using the configured application account, including the 2026-10-25 corrected `SELECT 1` result, provides live connectivity evidence. The API health test's injected database success is separate. The bounded authentication/session feature is recorded under Phase 5; this Phase 4 foundation commit did not include it. Remaining shared configuration and domain features are incomplete.

## Phase 5 — Authentication and role access (first bounded local flow user-verified; phase incomplete)

- Implemented in this bounded milestone: Donor registration, login/logout, current account identity/status, session-derived Donor self-profile read, bcrypt hashing, MySQL-backed express sessions, CSRF, trusted-origin credentialed CORS, rate limiting, and a Rose Quartz Login/profile/status UI. A separate infrastructure table is authored; it is not automatically created.
- Backend tests use injected services/session storage and database-free repository probes. These automated checks do not establish live MySQL transaction-failure/rollback or concurrent session behavior. User-run evidence dated 2026-10-25 records local `app_session` creation, private configuration, successful startup/connectivity, Donor registration, login to a saved read-only PENDING profile, authentication through profile refresh and backend restart, logout, signed-out route/API denial, incorrect-password rejection, and correct-password login. This verifies only that bounded local flow; it does not verify CSRF tampering, rate limits, suspension/reactivation, or other roles.
- Not implemented: Hospital registration/profile, account approval/suspension operations, password change/recovery, Donor profile editing, business feature APIs, or audit writes. No operation that requires audit infrastructure is stubbed.
- **Deliverables:** bounded working route/UI code with database-free tests and the user-reported local flow above; remaining Authentication & Role Access behavior and deeper live failure/concurrency checks remain pending.

## Phase 6 — Donor and donation workflows

- Implement donor profile management, eligibility checks, slot booking, and staff donation recording.
- Connect donation records to blood unit creation and traceability.
- **Deliverables:** integrated donor and donation workflows.

## Phase 7 — Inventory and hospital requests

- Implement blood group and inventory management, expiry status handling, hospital request submission, priority, compatibility checks, allocation, and status tracking.
- Add audit logging for significant changes and transaction handling for related allocation updates.
- **Deliverables:** end-to-end request and inventory workflows.

## Phase 8 — Dashboards and reports

- Build role-appropriate dashboard and report screens from agreed metrics.
- Add Chart.js visualizations where useful and SQL queries demonstrating joins and aggregates.
- **Deliverables:** report screens and documented report queries.

## Phase 9 — Verification and documentation

- Verify validation, authentication, permissions, database constraints, workflows, expiry handling, and report queries.
- Document test cases and results, setup, database connectivity, user workflows, ERD/schema, normalization, SQL artifacts, and known limitations.
- Review the complete project against scope and academic requirements.
- **Deliverables:** testing evidence and complete handoff documentation.

## Phase gates

- The user explicitly authorizes the next phase before work begins in it.
- Review each phase's artifacts against the scope and architecture before advancing.
- If a design choice would materially change scope, resolve it with the user before implementation.
- Phase completion requires repository evidence for its deliverables; planned work is not evidence of implementation or verification.
- Complete shared foundations sequentially and integrate them into `main`. Once the database, application foundation, and authentication dependencies are integrated, feature owners may develop independent domain modules in parallel, subject to each phase's authorization and cross-feature dependencies. Compatibility/allocation depends on the integrated inventory and request interfaces.
