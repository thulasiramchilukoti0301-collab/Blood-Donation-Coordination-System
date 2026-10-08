# Project Scope

## Project

**Blood Donation Coordination System** is a college DBMS Laboratory group mini-project. The intended deliverable is a working web application backed by MySQL.

## Technology

- Frontend: React
- Backend: Node.js and Express
- Database: MySQL
- Node.js database driver: `mysql2`
- Authentication: bcrypt password hashing and server-side sessions (selected in Phase 1)
- Charts: Chart.js
- Development environment: VS Code
- Version control: Git and GitHub

## Users and responsibilities

1. **Admin / Blood Bank Staff** — manages donor and blood group records, donation operations, blood inventory, incoming hospital requests, allocations, and operational reports.
2. **Hospital** — registers and signs in, submits blood requests with a priority, and follows request status.
3. **Donor** — registers and manages a donor profile, checks eligibility, and books a donation slot.

Authorization must ensure each role can access only the operations and records needed for its responsibilities. The approved role permissions are documented in `docs/role-permissions.md`.

## Functional scope

- Donor registration and profile management
- Donor eligibility checking
- Donation slot booking
- Donation recording by authorized blood bank staff
- Blood unit creation and traceable inventory tracking
- Blood group management
- Blood unit expiry tracking and scheduled expiry handling
- Hospital registration and login
- Hospital blood requests with **Emergency**, **Urgent**, or **Normal** priority
- Blood compatibility checking
- Blood unit allocation to requests
- Request status tracking
- Inventory management
- Audit logging of significant operational changes
- Dashboard and reports, including charts where useful

No additional user roles or product capabilities are included in this scope.

## Database and academic requirements

The database deliverables must demonstrate:

- Primary keys and foreign keys
- `NOT NULL`, `UNIQUE`, `CHECK`, and `DEFAULT` constraints
- CRUD operations, search/filter, JOIN queries, aggregate functions, and `GROUP BY`
- At least one database view
- At least one stored procedure or function
- At least one trigger
- Scheduled expiry handling
- At least ten sample records in each major table
- SQL DDL and DML artifacts
- ER diagram, relational schema, and normalization through 3NF

The major-table list and scheduled expiry design are documented in `docs/database-design.md`; implementation details remain subject to Phase 3 environment checks.

## Application and submission requirements

- MySQL connectivity through the Node.js backend
- Server-side input validation
- Login and role-appropriate authorization
- Report screens
- Testing evidence
- Complete project documentation, including setup and use instructions

## Out of scope unless separately approved

- Payment processing, donor rewards, external messaging, mobile applications, external health-record integrations, and production deployment infrastructure
- Any additional business workflow not listed in this document

## Acceptance outline

Source-separated academic handoff requirements and user-requested PPT/GitHub deliverables are tracked in [`docs/project-report-checklist.md`](project-report-checklist.md), including the recovered college section order.

The project is complete when the authorized implementation phases produce a usable React/Express/MySQL application that supports the functional scope, enforces role and data integrity rules, demonstrates the listed DBMS concepts, includes the academic and user documentation, and has documented test results.
