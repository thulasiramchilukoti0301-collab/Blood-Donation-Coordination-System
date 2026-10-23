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

## Phase 3 — Database implementation and local verification (in progress; bounded foundation, Donor, and eligibility/booking milestones)

- Divide database work into coordinated feature modules aligned to `team-workflow.md` ownership; coordinate shared relations and invariants.
- Create DDL and DML for the approved logical design; add at least ten sample records to every major table.
- Implement and demonstrate the view, stored procedure, trigger, and scheduled expiry mechanism.
- Assemble and run database setup modules in dependency order, then verify keys, constraints, allocation concurrency invariants, and sample reports in the selected MySQL version.
- Audit recording and RequestStatusHistory infrastructure must accompany the first operations that require those records; the audit-log screen may be implemented later.
- **Deliverables:** reviewed SQL artifacts and local database verification evidence. Do not apply to a shared/live database without authorization.
- Completing Phase 3 does not by itself authorize React or Express implementation; Phase 4 remains a separate authorization gate.
- The completed local foundation milestone contains `001_foundation.sql` (BloodGroup), `002_auth.sql` (Account), the eight-row BloodGroup reference seed, a foundation-only setup path, and disposable-schema verification. The bounded Donor milestone adds only `003_donors.sql` and its disposable verifier; it does not expand `apply-foundation.mjs` or `setup.sql`. User-run evidence dated 2026-10-20 records successful preflight, application of only 003 to `blood_donation_coordination`, and fresh disposable verification with 13 negative checks plus successful rollback of ten synthetic Account/Donor pairs and connection cleanup. This completes only the Donor schema verification milestone. The remaining ten major tables, other logical entities including BloodCompatibility, domain data, other seeds, procedures, triggers, reports, expiry, concurrency checks, and future application enforcement remain pending and require their applicable authorization. Donor verifier fixtures are not permanent samples.
- The bounded milestone adds only `005_eligibility_booking.sql` and `verify-eligibility-booking.mjs`, creating `DonationSlot`, `Booking`, and `EligibilityDecision` in that dependency order. Fresh disposable setup is 001, 002, the BloodGroup reference seed, 003, then 005; 004 Hospital is not a dependency. Existing development databases apply only 005 after inspection. This does not expand `apply-foundation.mjs` or `setup.sql`. User-run results reported 2026-10-24 record successful assembly of `bddc_phase3_test_booking_20261023_first`, all 36 negative checks passing, successful rollback of ten fixtures per new table and connection cleanup, successful development preflight with only the three target tables absent, and successful application of only 005 to `blood_donation_coordination`. This verifies only the storage milestone, not booking workflows, concurrency, authentication, or all of Phase 3. The remaining seven major tables, other logical entities including BloodCompatibility, domain data/seeds, procedures, triggers, reports, expiry, concurrency verification, and future application enforcement remain pending and require their applicable authorization. The verifier's fixtures do not count as permanent samples.
- User-reported local evidence records successful foundation setup on `blood_donation_coordination` and successful verification on both named disposable schemas, including all 21 negative checks each; reruns against both populated disposable schemas returned exit code 1 and were followed by successful verification. This evidence completes only the bounded setup/verification milestone. The remaining Phase 3 deliverables are still in progress.

## Phase 4 — Project foundation and connectivity (foundation/connectivity components complete)

- The runnable React/Express structure and development configuration were integrated in Lathikaa's personal Phase 1 foundation commit; this maps to these official Phase 4 components. Personal phase labels do not renumber official project phases.
- Configure environment-based settings and MySQL connection pooling with `mysql2`.
- Add a minimal connectivity path and consistent error handling.
- **Deliverables:** runnable client/server foundation and documented local setup.
- User-reported `check:db` success using the configured application account provides live connectivity evidence. The API health test's injected database success is separate. Authentication, sessions, business routes, and the remaining Phase 4 work are not implemented.

## Phase 5 — Authentication and role access

- Implement registration/login for the agreed roles using bcrypt and server-side sessions.
- Hash passwords with bcrypt and enforce role-based access on API operations.
- Add server-side input validation for authentication flows.
- **Deliverables:** working login and role-protected routes.

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
