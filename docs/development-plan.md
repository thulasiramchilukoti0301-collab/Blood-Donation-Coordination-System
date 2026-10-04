# Development Plan

This plan divides the project into reviewable phases. Phases 0, 1, and 2 are complete as documentation/design work. Do not begin a later phase without explicit user instruction.

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

## Phase 3 — Database implementation and local verification

- Create DDL and DML for the approved logical design; add at least ten sample records to every major table.
- Implement and demonstrate the view, stored procedure, trigger, and scheduled expiry mechanism.
- Verify keys, constraints, allocation concurrency invariants, and sample reports in the selected MySQL version.
- **Deliverables:** reviewed SQL artifacts and local database verification evidence. Do not apply to a shared/live database without authorization.

## Phase 4 — Project foundation and connectivity

- Establish the React and Express project structure and development configuration.
- Configure environment-based settings and MySQL connection pooling with `mysql2`.
- Add a minimal connectivity path and consistent error handling.
- **Deliverables:** runnable client/server foundation and documented local setup.

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
