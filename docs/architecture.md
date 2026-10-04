# Proposed Architecture

## Overview

The application has three parts: a React browser client, a Node.js/Express HTTP API, and a MySQL relational database. The API is the trusted boundary for authentication, authorization, input validation, domain rules, and database access. The browser never connects directly to MySQL.

```text
React client  -- HTTP/JSON -->  Express API  -- mysql2 -->  MySQL
    |                              |                         |
    +-- role-aware screens         +-- rules and data access +-- relational records,
        and reports                    with transactions          constraints, routines
```

## Frontend

- React provides role-appropriate screens for donors, hospitals, and Admin / Blood Bank Staff.
- Screens cover registration/profile workflows, eligibility and slot booking, donation and inventory operations, hospital requests and statuses, and dashboards/reports.
- Client-side validation gives immediate feedback; the server remains authoritative.
- Chart.js presents the agreed report metrics. Screen layouts and chart choices are implementation details.

## Backend

- Node.js with Express exposes the preliminary HTTP/JSON contract in `docs/api-design.md`.
- Backend modules separate routing, authentication/authorization, validation, domain operations, and data access.
- `mysql2` provides pooled connectivity and parameterized queries; related multi-row operations use database transactions.

## Database

- MySQL is the system of record. The approved 14-entity logical design, relationships, constraints, index candidates, and 3NF rationale are documented in `docs/database-design.md`, `docs/relational-schema.md`, and `docs/normalization.md`.
- The ER representation is in `docs/er-design.md`. Physical DDL/DML are not part of the completed design phase.
- The selected database features are `v_available_inventory_by_group`, `sp_allocate_request_units`, `trg_request_status_history_update`, and a daily MySQL Event Scheduler expiry task.
- Persisted application date/time values and the scheduled expiry boundary use `Asia/Kolkata`.

## Request and data flow

1. A user submits a form from React.
2. Express authenticates the session, validates input and role/ownership, and applies domain rules.
3. The data-access layer executes parameterized queries with `mysql2`; MySQL constraints provide an additional integrity boundary.
4. The API returns a safe structured response, and the client updates the screen or report.
5. Allocation, issue, booking capacity, and other multi-row changes run transactionally to preserve inventory and status consistency.

## Security and integrity

- Authentication uses bcrypt password hashes and server-side sessions with an opaque secure cookie, as selected in Phase 1. Never return or log passwords, password hashes, session identifiers, or secrets.
- Use server-side role and ownership checks, CSRF protection for cookie-authenticated state changes, and secure cookie settings appropriate to the deployment.
- Validate and normalize input on the server and use parameterized SQL.
- Keep credentials outside source control; retain audit history without sensitive medical details.
- Use relational constraints and transactions to protect identity, references, allocation exclusivity, and inventory transitions.

## Deferred implementation checks

- Confirm the target MySQL version, Event Scheduler availability/privileges, generated-column behavior, and transaction/trigger behavior.
- Author physical DDL/DML, exact index plans, and sample-data distribution in Phase 3.
- Finalize session-store selection and local frontend/API CSRF/CORS settings during application foundation.
- Finalize pagination, validation/error envelopes, and chart layouts during implementation; the documented route set and initial report metrics remain the baseline.
