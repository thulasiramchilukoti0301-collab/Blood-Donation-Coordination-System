# Blood Donation Coordination System

College DBMS Laboratory group project. The approved stack is React, Node.js with Express, MySQL, and `mysql2`.

## Current status

- **Phases 0–2:** scope, requirements, domain/API design, relational schema, ER design, and normalization are documented and complete.
- **Approved design baseline:** 14 logical entities, 12 major tables, the approved account and workflow status names, the educational 56-day donor interval and 42-day unit shelf life, Asia/Kolkata date/time interpretation, bcrypt with server-side sessions, and 30 planned screens with OPEN theme assignments. These remain design rules; the current foundation does not implement the associated workflows.
- **Official Phase 4 foundation/connectivity components:** implemented in the integrated Lathikaa foundation commit (`39e6a3c`): React/Vite client, Express API, environment configuration, mysql2 pool, health checks, and automated foundation tests. This maps from Lathikaa's personal Phase 1 work to the corresponding official Phase 4 deliverables. It does not implement authentication, sessions, or domain workflows.
- **Official Phase 3 database work:** partially implemented. Foundation, Donor, 005 eligibility/booking storage, Donation storage, 007 BloodUnit storage, and the grouped read-only `v_available_inventory_by_group` view have user-run setup/verification evidence. The 2026-10-24 view evidence verifies the disposable view checks and applying the view to the local development schema only. It does not verify application-account access, APIs, reports/screens, approval/unit creation, allocation, expiry transitions, audit writes, or concurrency. Donation approval/unit creation, authorization, eligibility workflows, expiry calculation/validation, lifecycle operations, corrections, audit writes, and concurrency remain pending. Six logical entities, including five major tables, remain: Hospital, BloodCompatibility, HospitalRequest, RequestStatusHistory, Allocation, and AuditEvent. Other domain seeds, procedures, triggers, reporting, expiry implementation, permanent sample data, and concurrency verification are incomplete. See the [implementation readiness review](docs/implementation-readiness.md) and [database setup and verification record](database/README.md).
- No Hospital profile, booking workflow/API, donation processing or inventory workflows, request/allocation, audit, authentication, or application feature routes are implemented. The current Donor/slot/booking/eligibility and authored Donation/BloodUnit storage DDL do not implement those application workflows. Verifier fixtures are transactional and rolled back; no Account fixtures are permanent seeds. See the [implementation readiness review](docs/implementation-readiness.md) and [development plan](docs/development-plan.md).

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

## Stack and prerequisites

Use Node.js `^20.19.0 || >=22.12.0`, npm, Git, Windows PowerShell, and MySQL 8.0.16 or newer for enforced CHECK constraints. The project uses React/Vite and React Router, Express, `mysql2`, and server-side sessions when authentication is later authorized. Chart.js is reserved for dashboard/report visualizations. The current foundation does not mount `express-session`, create cookies, or implement login. See [architecture](docs/architecture.md) and [API design](docs/api-design.md) for the planned security contract.

## Install and run the current application foundation

From the repository root, open separate PowerShell terminals:

```powershell
Set-Location .\backend
npm.cmd ci
npm.cmd test
npm.cmd run check:db
npm.cmd run dev
```

`npm.cmd run check:db` runs `SELECT 1`; it requires a private `backend/.env` with a working local database connection. Without it the command fails safely with `DATABASE_NOT_CONFIGURED`. The user reports that this check succeeded with the configured application account; the private file is ignored by Git. The server can run without database configuration for API liveness.

```powershell
Set-Location .\frontend
npm.cmd ci
npm.cmd run dev
```

Open `http://localhost:5173`. The current UI reports backend and database health only; it is not the planned role-based application. Run `npm.cmd run build` in `frontend/` to build the client. The earlier Phase 4 foundation checks are recorded in [`docs/phase-1-verification.md`](docs/phase-1-verification.md); the separate user-reported database setup and live connectivity evidence is summarized in [`docs/implementation-readiness.md`](docs/implementation-readiness.md).

## Local database setup

Each developer uses a separate local MySQL database. Do not point routine work at shared/live data. Inspect and preserve any existing database. The foundation setup path, stable BloodGroup identifiers, required privileges, exact PowerShell/MySQL client steps, and rerun/failure behavior are documented in [`database/README.md`](database/README.md). Do not apply future placeholder migration/seed files. Keep connection secrets only in the ignored `backend/.env`; never place them in tracked files or command arguments.

## Integration workflow

Thulasi works on continuing branch `thulasiram`; Lathikaa works on `lathikaa`. Reviewed work enters `main` through PRs. Coordinate shared SQL objects and migration numbering; after syncing integrated SQL from `origin/main`, apply it to each person's own local database using the reviewed setup instructions. See [team workflow](docs/team-workflow.md).
