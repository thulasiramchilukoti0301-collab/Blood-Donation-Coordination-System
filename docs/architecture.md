# Proposed Architecture

## Overview

The application will use a three-part architecture: a React browser client, a Node.js/Express HTTP API, and a MySQL relational database. The API is the trusted boundary for authentication, authorization, validation, business rules, and database access. The browser will not connect directly to MySQL.

```text
React client  -- HTTP/JSON -->  Express API  -- mysql2 -->  MySQL
    |                              |                         |
    +-- role-aware screens         +-- validation/rules      +-- constraints,
        and reports                    and authorization          records, routines
```

## Frontend

- React provides role-appropriate screens for donors, hospitals, and Admin / Blood Bank Staff.
- Screens cover registration/profile workflows, eligibility and slot booking, donation and inventory operations, hospital requests and their statuses, and dashboard/report views.
- Client-side validation can give immediate feedback, but does not replace server-side validation.
- Chart.js is used for agreed dashboard/report charts. Exact metrics and layouts are selected during UI design.

## Backend

- Node.js with Express exposes HTTP/JSON endpoints consumed by the React client.
- Backend modules separate route handling, validation, authentication/authorization, domain operations, and data access.
- `mysql2` provides pooled MySQL connectivity and parameterized queries.
- The server validates inputs and applies role checks and domain rules, including eligibility, compatibility, request status transitions, allocation, and inventory changes.
- Passwords are stored as bcrypt hashes. Select JWT or secure session-based authentication before implementation and apply it consistently.
- Secrets and database connection settings are supplied via environment-specific configuration and excluded from version control.
- Significant operations write audit records without including credentials or tokens.

## Database

- MySQL is the authoritative store for users and role profiles, donors, hospitals, blood groups, donation bookings and records, blood units, requests, allocations, and audit events. Exact table boundaries and names are deferred to database design.
- Relational constraints enforce identity, relationships, required values, uniqueness, valid ranges/values, and defaults.
- SQL deliverables will include DDL, representative DML/sample records, query examples, a view, a stored procedure or function, and a trigger.
- Expiry handling will be designed as a scheduled process that marks expired units and preserves traceability. The specific scheduling mechanism is chosen during implementation design.
- ERD, relational schema, and normalization notes through 3NF will document the final schema.

## Request and data flow

1. A user submits a form from the React client.
2. The API authenticates the user, validates the request, checks role permissions, and applies relevant business rules.
3. The data-access layer executes parameterized SQL through `mysql2`; MySQL constraints provide a further integrity boundary.
4. The API returns a structured success or error response; the client updates the screen and report data.
5. For multi-step changes such as allocating units, the backend uses a database transaction so related inventory and request updates remain consistent, subject to final schema design.

## Security and integrity principles

- No direct database access from the browser.
- Hash passwords with bcrypt and protect authenticated routes according to role.
- Validate inputs on the server and use parameterized queries.
- Keep secrets out of source control and avoid sensitive values in logs.
- Use database constraints and transactions to protect relationships and inventory consistency.

## Architecture decisions deferred

- JWT versus secure sessions
- Detailed API route and payload contracts
- Exact schema, major-table definition, and sample-data distribution
- Specific scheduled expiry mechanism
- Dashboard metrics and report layouts

Resolve these choices during the relevant design phase without expanding the agreed project scope.
