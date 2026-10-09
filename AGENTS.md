# Project Rules and Development Conventions

## Project intent

This repository is for the **Blood Donation Coordination System**, a college DBMS Laboratory group mini-project. The target is a complete web application using React, Node.js with Express, MySQL, and `mysql2`.

## Workflow boundaries

- Work only on the phase the user explicitly authorizes. Planning documents do not authorize implementation.
- Phase 2 database design is complete. Phase 3 database implementation is the next phase and may begin only after the user explicitly approves it.
- The initial backend/frontend/database folder scaffold has been integrated into `main`, but its tracked SQL/runtime files are empty placeholders. This repository setup is not Phase 3 or Phase 4 implementation evidence.
- Do not create application code, database tables, migrations, or sample data until implementation is explicitly requested.
- Do not create executable SQL, install dependencies, alter Git configuration, or commit/push unless explicitly requested.
- Keep the application within the agreed scope in `docs/project-scope.md`; ask before adding features that change it materially.
- Preserve existing user work. Review repository state before editing files.

## Development conventions for future implementation

- Use React for the frontend and Node.js/Express for the API backend.
- Use MySQL as the system of record and `mysql2` for Node.js database access. Keep credentials outside source control in environment-specific configuration.
- Hash passwords with bcrypt and use server-side sessions as selected in Phase 1; apply the documented cookie, CSRF, and role-authorization behavior consistently.
- Validate and normalize input on the server even when the frontend also validates it. Use parameterized SQL queries.
- Enforce data integrity in MySQL with appropriate primary/foreign keys, `NOT NULL`, `UNIQUE`, `CHECK`, and `DEFAULT` constraints.
- Keep database access, request handling, and presentation responsibilities separated.
- Use Chart.js only for the dashboard/report visualizations in the agreed scope.
- Avoid storing derived values that can be computed reliably from normalized data. Document intentional exceptions.
- Record significant data-changing administrative actions in the audit log; do not log passwords, tokens, or other secrets.
- Use clear names, small modules, consistent formatting, and comments for non-obvious business rules.
- Keep documentation aligned with actual implementation as each authorized phase is completed.

## Database and domain conventions

- Represent donation, inventory, hospital request, allocation, and expiry as traceable records with explicit statuses and timestamps where appropriate.
- Apply donor eligibility and blood compatibility rules consistently in the backend and database operations where practical; document the authoritative rule set before implementation.
- Use the approved daily MySQL Event Scheduler expiry design, subject to confirming target-server support during Phase 3.
- In Phase 3, prepare reproducible SQL DDL/DML and at least ten sample rows for every major table listed in `docs/database-design.md`, after explicit authorization.
- Demonstrate the required relational concepts and operations listed in the scope, including a view and a stored procedure or function, at least one trigger, and expiry handling.

## Verification and documentation

- Add and run checks appropriate to the authorized phase. Do not claim a behavior is verified unless it was exercised.
- Document setup, database connectivity, validation, authentication, reports, and test steps before project handoff.
- Keep the ER diagram, relational schema, normalization notes through 3NF, and SQL artifacts consistent with the implemented database design.
