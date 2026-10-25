# Blood Donation Coordination System

College DBMS Laboratory group project. The approved stack is React, Node.js with Express, MySQL, and `mysql2`.

## Current status

- **Phases 0–2:** scope, requirements, domain/API design, relational schema, ER design, and normalization are documented and complete.
- **Approved design baseline:** 14 logical entities, 12 major tables, the approved account and workflow status names, the educational 56-day donor interval and 42-day unit shelf life, Asia/Kolkata date/time interpretation, bcrypt with server-side sessions, and a 30-screen baseline. Themes remain OPEN for unimplemented screens. These remain design rules; the current feature does not implement the associated operational workflows.
- **Official Phase 4/5 application work:** Lathikaa's integrated foundation (`39e6a3c`) provides React/Vite, Express, mysql2 pool/configuration, health checks, and foundation tests. The bounded Auth/Donor work adds Donor registration, login/logout, persistent server-side sessions, current-account status, self-profile read/edit, and optional self-reported group selection from the canonical seed. The integrated Hospital checkpoint adds public Hospital registration, PENDING/ACTIVE Hospital own-profile read/contact edit, ACTIVE Admin Hospital list/detail reads, and their Mint Gauge screens. User-run Donor evidence belongs to Thulasi's local environment. Separate Hospital evidence is recorded for Lathikaa's environment and, on 2026-10-25, Thulasi's integrated installation/structure, application-account SELECT access, registration/login and profile contact-edit flow. Password change, approval/suspension, operational workflows, live Admin access, deeper transaction/concurrency checks, and downstream group use remain unimplemented or unverified. See the [implementation readiness review](docs/implementation-readiness.md).
- **Official Phase 3 database work:** partially implemented. Foundation, Donor, 005 eligibility/booking storage, Donation storage, 007 BloodUnit storage, the grouped read-only `v_available_inventory_by_group` view, and seven donor/inventory SQL demonstrations have user-run setup/verification evidence. Hospital DDL is authored, with separately attributed installation evidence from both environments. Thulasi's USER-RUN 2026-10-25 evidence confirms 004 installation, approved structure and application-account Hospital SELECT access; the dedicated Hospital constraint verifier remains pending. The query/view results do not provide application access control or implement workflow mutations or concurrency. Donation approval/unit creation, authorization, eligibility workflows, expiry calculation/validation, lifecycle operations, corrections, audit writes, and concurrency remain pending. The integrated AuditEvent-only 010 foundation and internal writer have historical incoming-revision MySQL evidence; the corrected visibility preflight has not been live-reverified, and development installation/Account approval remain pending. Four logical entities, including three major tables, remain unauthored: BloodCompatibility, HospitalRequest, RequestStatusHistory, and Allocation. RequestStatusHistory and its trigger require a separate future migration with number/filename UNASSIGNED. Other domain seeds, procedures, triggers, reporting, expiry implementation, permanent sample data, and concurrency verification are incomplete. See the [implementation readiness review](docs/implementation-readiness.md) and [database setup and verification record](database/README.md).
- Hospital registration/profile and Admin Hospital reads are implemented within their documented boundaries. Booking workflow/API, donation processing or inventory workflows, request/allocation, audit, password change, account approval/suspension, and other operational application routes remain unimplemented. The current storage DDL does not implement those workflows. Verifier fixtures are transactional and rolled back; no Account fixtures are permanent seeds. See the [implementation readiness review](docs/implementation-readiness.md) and [development plan](docs/development-plan.md).

## Project documents

- [Project scope](docs/project-scope.md)
- [Architecture](docs/architecture.md)
- [Requirements](docs/requirements.md)
- [Domain rules](docs/domain-rules.md)
- [Role permissions](docs/role-permissions.md)
- [API design](docs/api-design.md)
- [Database design](docs/database-design.md)
- [Relational schema](docs/relational-schema.md)
- [Normalization](docs/normalization.md)
- [ER design](docs/er-design.md)
- [Development plan](docs/development-plan.md)
- [Implementation readiness](docs/implementation-readiness.md)
- [Team workflow and ownership](docs/team-workflow.md)
- [UI screen map](docs/ui-screen-map.md)
- [UI design themes](docs/ui-design.md)
- [Project report checklist](docs/project-report-checklist.md)
- [Database setup and collaboration guide](database/README.md)
- [Phase 4 foundation verification record](docs/phase-1-verification.md)
- [Hospital storage](docs/hospital-storage.md)
- [Hospital registration API](docs/hospital-registration-api.md)
- [Hospital profile API](docs/hospital-profile-api.md)
- [Hospital frontend](docs/hospital-frontend.md)
- [Admin Hospital management](docs/admin-hospital-management.md)

## Stack and prerequisites

Use Node.js `^20.19.0 || >=22.12.0`, npm, Git, Windows PowerShell, and MySQL 8.0.16 or newer for enforced CHECK constraints. The project uses React/Vite and React Router, Express, `mysql2`, `express-session`, and bcrypt. The current bounded feature uses persistent MySQL sessions and the security contract documented in [architecture](docs/architecture.md) and [API design](docs/api-design.md). Session SQL/configuration setup is manual and is not run automatically.

## Install and run the current application foundation

From the repository root, open separate PowerShell terminals:

```powershell
Set-Location .\backend
npm.cmd ci
npm.cmd test
npm.cmd run check:db
npm.cmd run dev
```

`npm.cmd run check:db` runs `SELECT 1`; it requires a private `backend/.env` with a working local database connection. Without it the command fails safely with `DATABASE_NOT_CONFIGURED`. The user reports that this check and backend startup succeeded on 2026-10-25 after the checker accepted either numeric `1` or string `"1"` from mysql2 while retaining BIGINT precision settings. Private session configuration was completed locally; its values are not documented here. The server can run without database configuration for API liveness.

```powershell
Set-Location .\frontend
npm.cmd ci
npm.cmd run dev
```

Open `http://localhost:5173`. The home page retains backend/database health checks. `/login` provides Donor registration and sign-in, with an optional reported-group selector; `/login?register=hospital` provides Hospital registration without automatic login. Successful Donor login opens `/donor/profile` with an Edit profile form for full name, phone, address, area, and optional reported group. The unknown choice clears the self-report; confirmed group and account details remain read-only. Both selectors use the eight stable groups in [`database/seeds/reference_data.sql`](database/seeds/reference_data.sql); a self-report awaits staff confirmation. PENDING/ACTIVE Hospital accounts open `/hospital/profile`; ACTIVE Admin accounts can open the read-only `/admin/hospitals` management screen. Other roles use the safe account-status surface where applicable. These surfaces require the manual session-table setup and private backend configuration described in [`database/README.md`](database/README.md). Run `npm.cmd run build` in `frontend/` to build the client. The earlier Phase 4 foundation checks are recorded in [`docs/phase-1-verification.md`](docs/phase-1-verification.md); separate user-reported database evidence is summarized in [`docs/implementation-readiness.md`](docs/implementation-readiness.md).

User-run PENDING Donor editing checks dated 2026-10-25 are recorded separately from automated tests in [`docs/implementation-readiness.md`](docs/implementation-readiness.md): opening Edit, unchanged Save disabled, Area save and persistence, draft cancellation, blank Full name rejection, clearing/restoring Area, and read-only protected details. Later manual verification remains for ACTIVE/SUSPENDED roles, protected-field API tampering, concurrent updates, transaction failure/rollback, session expiry during editing, and other untested security/error cases. Do not use private profile values in shared test records.

Separate user-run selector checks dated 2026-10-25 confirm reported-group selection, persistence, cancellation, clearing, unchanged Save behavior, and registration with either the unknown choice or a selected group. The resulting PENDING profiles showed the expected reported group or “Not provided,” while confirmed group stayed unset. These observations and their unverified boundaries are recorded in the [implementation readiness review](docs/implementation-readiness.md).

## Local database setup

Each developer uses a separate local MySQL database. Do not point routine work at shared/live data. Inspect and preserve any existing database. The foundation setup path, stable BloodGroup identifiers, required privileges, exact PowerShell/MySQL client steps, and rerun/failure behavior are documented in [`database/README.md`](database/README.md). Do not apply future placeholder migration/seed files. Keep connection secrets only in the ignored `backend/.env`; never place them in tracked files or command arguments.

## Integration workflow

Thulasi works on continuing branch `thulasiram`; Lathikaa works on `lathikaa`. Reviewed work enters `main` through PRs. Coordinate shared SQL objects and migration numbering; after syncing integrated SQL from `origin/main`, apply it to each person's own local database using the reviewed setup instructions. See [team workflow](docs/team-workflow.md).
