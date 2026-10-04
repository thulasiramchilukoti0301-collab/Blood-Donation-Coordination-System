# Development Plan

This plan divides the project into reviewable phases. Only the planning phase is complete at this point. Do not begin a later phase without explicit user instruction.

## Phase 0 — Scope and project conventions (current)

- Inspect repository state.
- Record scope, proposed architecture, implementation phases, and repository conventions.
- Review the documents for consistency.
- **Deliverables:** `AGENTS.md`, `docs/project-scope.md`, `docs/architecture.md`, `docs/development-plan.md`.

## Phase 1 — Requirements and detailed design

- Confirm role permissions and workflow rules within the approved scope.
- Define donor eligibility and blood compatibility rules, request status transitions, and allocation behavior.
- Decide authentication approach (JWT or secure sessions), major-table boundaries, and scheduled expiry mechanism.
- Produce screen outline and API contract at a level sufficient for implementation.
- **Deliverables:** reviewed design notes; no application implementation unless separately authorized.

## Phase 2 — Database design

- Design entities and relationships; check normalization through 3NF.
- Produce and review ER diagram and relational schema.
- Prepare MySQL DDL with keys, required constraints, defaults, indexes as justified, and any agreed checks.
- Design view, stored procedure or function, trigger, and scheduled expiry handling.
- Prepare DML and at least ten sample records in each agreed major table.
- **Deliverables:** reviewed SQL and database documentation. Do not apply schema to a live database without authorization.

## Phase 3 — Project foundation and connectivity

- Establish the React and Express project structure and development configuration.
- Configure environment-based settings and MySQL connection pooling with `mysql2`.
- Add a minimal connectivity path and consistent error handling.
- **Deliverables:** runnable client/server foundation and documented local setup.

## Phase 4 — Authentication and role access

- Implement registration/login for the agreed roles and selected authentication approach.
- Hash passwords with bcrypt and enforce role-based access on API operations.
- Add server-side input validation for authentication flows.
- **Deliverables:** working login and role-protected routes.

## Phase 5 — Donor and donation workflows

- Implement donor profile management, eligibility checks, slot booking, and staff donation recording.
- Connect donation records to blood unit creation and traceability.
- **Deliverables:** integrated donor and donation workflows.

## Phase 6 — Inventory and hospital requests

- Implement blood group and inventory management, expiry status handling, hospital request submission, priority, compatibility checks, allocation, and status tracking.
- Add audit logging for significant changes and transaction handling for related allocation updates.
- **Deliverables:** end-to-end request and inventory workflows.

## Phase 7 — Dashboards and reports

- Build role-appropriate dashboard and report screens from agreed metrics.
- Add Chart.js visualizations where useful and SQL queries demonstrating joins and aggregates.
- **Deliverables:** report screens and documented report queries.

## Phase 8 — Verification and documentation

- Verify validation, authentication, permissions, database constraints, workflows, expiry handling, and report queries.
- Document test cases and results, setup, database connectivity, user workflows, ERD/schema, normalization, SQL artifacts, and known limitations.
- Review the complete project against scope and academic requirements.
- **Deliverables:** testing evidence and complete handoff documentation.

## Phase gates

- The user explicitly authorizes the next phase before work begins in it.
- Review each phase's artifacts against the scope and architecture before advancing.
- If a design choice would materially change scope, resolve it with the user before implementation.
