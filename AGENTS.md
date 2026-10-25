# Project Rules and Development Conventions

## Project intent

This repository is for the **Blood Donation Coordination System**, a college DBMS Laboratory group mini-project. The target is a complete web application using React, Node.js with Express, MySQL, and `mysql2`.

## Workflow boundaries

- Work only on the phase the user explicitly authorizes. Planning documents do not authorize implementation.
- Phase 2 database design is complete. Phase 3 database implementation requires explicit user authorization; authorization for a bounded Phase 3 milestone does not authorize unrelated schema or feature work.
- A one-time empty repository scaffold is in `main` ancestry. Lathikaa's integrated Phase 1 personal foundation is also present: React/Vite client, Express API, mysql2 configuration, and health/connectivity checks. The bounded Authentication/Donor work implements registration, login/logout, persistent-session identity/status, and Donor self-profile read/edit. The optional reported-group selector extends registration and self-profile editing using the existing BloodGroup seed and Donor column; confirmed group remains staff-controlled. The integrated Hospital checkpoint implements public Hospital registration, PENDING/ACTIVE own-profile read/contact edit, and ACTIVE Admin Hospital list/detail reads with scoped Mint Gauge screens. User-run local evidence dated 2026-10-25 confirms Thulasi's session-table setup and Donor flows; separate evidence from Lathikaa's environment confirms Hospital registration/login and a saved PENDING Hospital Profile. Later USER-RUN evidence dated 2026-10-25 confirms 004 installation/structure, application-account Hospital SELECT access, and bounded Hospital registration/profile contact editing in Thulasi's environment; the dedicated Hospital constraint verifier remains pending. Malformed-ID/API tampering, live transaction failure/rollback, concurrency, ACTIVE/SUSPENDED Donor editing, live Admin access, staff confirmation, downstream eligibility/inventory behavior, session expiry during editing, CSRF tampering, rate limits, account administration, password change, and operational domain features remain unverified or unimplemented as detailed in `docs/implementation-readiness.md`.
- The bounded Phase 3 database milestones include the shared foundation/BloodGroup and Account DDL, Donor DDL, Hospital DDL, DonationSlot/Booking/EligibilityDecision DDL, Donation DDL, BloodUnit storage, the approved inventory availability view, read-only donor/inventory SQL demonstrations, and the integrated AuditEvent-only 010 foundation/internal writer. Lathikaa retains Audit ownership. Historical Audit MySQL evidence applies to the incoming tested revision; the corrected visibility preflight has not been live-reverified. Development AuditEvent installation and shared Account approval remain pending. RequestStatusHistory/its trigger remain a separate future migration with number/filename UNASSIGNED. User-run evidence reported 2026-10-24 verifies the 005, 006, and 007 storage milestones, the grouped read-only inventory view, and the seven donor/inventory SQL demonstrations only. These read-only query demonstrations do not verify application-account access, APIs, reports/screens, authentication, workflow mutations, allocation, expiry transitions, audit writes, or concurrency, and do not authorize those features or other schema modules. Row-level storage and read-only SQL do not implement capacity/concurrency, overlap, actor/account-state, eligibility evaluation, schedule-edit, donation/inventory workflows, corrections, expiry calculation/validation, audit writes, or lifecycle enforcement. Approval-triggered BloodUnit creation remains future service work. Do not create other tables or application features without their explicit authorization.
- Do not create application code, database tables, migrations, or sample data outside the explicitly authorized bounded milestone.
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
- In Phase 3, prepare reproducible SQL DDL/DML and at least ten sample rows for every major table listed in `docs/database-design.md`, after explicit authorization for the relevant work. The foundation milestone's eight BloodGroup lookup rows are not Account fixtures and do not satisfy the later ten-row requirement for each of the 12 major tables.
- Demonstrate the required relational concepts and operations listed in the scope, including a view and a stored procedure or function, at least one trigger, and expiry handling.

## Verification and documentation

- Add and run checks appropriate to the authorized phase. Do not claim a behavior is verified unless it was exercised.
- Document setup, database connectivity, validation, authentication, reports, and test steps before project handoff.
- Keep the ER diagram, relational schema, normalization notes through 3NF, and SQL artifacts consistent with the implemented database design.
