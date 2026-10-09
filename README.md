# Blood Donation Coordination System

The Blood Donation Coordination System is a college DBMS Laboratory group mini-project. Its planned application uses React, Node.js with Express, and MySQL through `mysql2`.

## Current repository state

Phases 0–2 are complete as scope, requirements, and database-design documentation. The initial scaffold commit (`88fd043`, `chore: initialize project structure`) is present in `main` ancestry through merge commit `3335268`. This one-time folder/file setup is not a completed runnable application foundation: the tracked backend, frontend, and database scaffold files remain empty placeholders. No SQL schema, seed data, application runtime, or feature behavior is implemented or verified. See the [implementation readiness review](docs/implementation-readiness.md) and [development plan](docs/development-plan.md).

The repository contains `docs/` for approved design, `database/` for setup/migration/seed placeholders, `backend/` for the Express scaffold, and `frontend/` for the React/Vite scaffold. At this checkpoint the tracked `.sql`, `.js`, `.jsx`, `.json`, and example configuration files in the implementation folders are zero bytes; in particular, the package manifests are not runnable. The directory structure is present, while database and application implementation remain unstarted.

## Project documentation

- [Project scope](docs/project-scope.md)
- [Proposed architecture](docs/architecture.md)
- [Development plan](docs/development-plan.md)
- [Database design](docs/database-design.md)
- [UI screen map](docs/ui-screen-map.md)
- [UI design themes](docs/ui-design.md)
- [Implementation readiness review](docs/implementation-readiness.md)
- [Team workflow](docs/team-workflow.md)
- [Database setup and collaboration plan](database/README.md)
- [Academic handoff checklist](docs/project-report-checklist.md)

The database design phase is complete. Database implementation and application code have not been authorized yet; see the [development plan](docs/development-plan.md) for phase boundaries.
# Blood Donation Coordination System

An academic DBMS Laboratory project for coordinating donors, blood bank staff,
and hospitals through a React client, Express API, and MySQL database.

**Implementation status: Phase 1 foundation and connectivity only.** The client
shows live API/database checks. Authentication, registration, role permissions,
donor workflows, hospitals, donations, inventory, blood requests, allocation,
audit, and reporting are not implemented. All business module folders and SQL
scripts remain placeholders.

## Documentation alignment

The existing design documents use **Blood Bank and Donor Network** as the project
name and number foundation work as **Phase 4** in `docs/development-plan.md`.
This implementation follows the user's separately authorized **Phase 1 — Project
Foundation, Initialization & Connectivity** and requested display name. Existing
requirements and logical design documents are preserved; their earlier phase
numbers describe planning work, not implemented application features.

`docs/team-workflow.md` is empty. The explicit collaboration rules for this work
are: develop on `lathikaa`, integrate through shared `main`, preserve others'
work, and do not automatically switch, commit, push, merge, or rebase.

## Technology stack

| Area | Installed stack |
|---|---|
| Frontend | React, Vite, JavaScript/JSX, React Router DOM, Axios, CSS |
| Backend | Node.js, Express, mysql2/promise, dotenv, cors, express-session |
| Database | MySQL; future SQL migrations, foreign keys, InnoDB transactions |

`express-session` is installed but not mounted. No sessions or cookies are
created yet. Session-store selection is deferred to authentication implementation;
no MemoryStore or database session tables are enabled. Future session work must
include a persistent store appropriate to deployment, HttpOnly/SameSite cookies,
Secure cookies under HTTPS, rotation/invalidation, CSRF protection, and bcrypt
as documented in `docs/api-design.md`. No bcrypt/chart dependencies are needed
for connectivity alone.

## Repository structure

```text
backend/
  src/config/       Environment configuration and MySQL connection pool
  src/middleware/   Central errors; auth/roles are comments only
  src/routes/       Operational health checks
  src/modules/      Reserved business module directories
  src/utils/        Safe HTTP errors and database-check command
  src/app.js        Express application (also importable for tests)
  src/server.js     Startup and graceful shutdown
  tests/            Node test runner health/connectivity tests
frontend/
  public/
  src/components/   Connection status presentation
  src/layouts/      Responsive foundation shell
  src/services/     Reusable Axios client and health requests
  src/styles/       Global CSS
  src/features/     Reserved business feature directories
database/           Empty SQL setup/migration/seed placeholders; preparation README
docs/               Approved project scope, requirements and database design
report/             Reserved submission artifacts
tests/              Reserved cross-application integration/e2e tests
```

## Prerequisites

- Node.js satisfying `^20.19.0 || >=22.12.0` and npm. This workspace was verified
  with Node 20.20.2 and npm 10.8.2; use a currently supported Node release for new
  installations. Vite's [official requirements](https://vite.dev/guide/) specify
  the compatible versions.
- Local MySQL 8.0.16+ and an existing database/application user for a successful
  database check. The API and frontend can run without database configuration;
  database health then correctly returns HTTP 503.
- Git and Windows PowerShell. Use `npm.cmd` to avoid PowerShell script execution
  policy issues. Commands below start from the repository root.

Check the branch with `git branch --show-current` before editing. This phase
must be developed on `lathikaa`.

## Backend installation and development

```powershell
Set-Location .\backend
npm.cmd ci
Copy-Item .env.example .env   # First setup only; do not overwrite an existing .env
notepad .env
npm.cmd run dev
```

The API defaults to `http://localhost:5000`. `dev` uses Node's built-in watch
mode; `npm.cmd start` runs without watching. Restart after changing `.env`.
Ctrl+C triggers shutdown: stop accepting requests, finish active requests, close
the database pool, and exit. Shutdown is bounded to ten seconds.

```powershell
npm.cmd test
npm.cmd run check:db
```

The database command performs `SELECT 1` only, returns exit code 1 on failure,
and prints a safe error without driver details. Startup checks connectivity but
continues to serve liveness while the development database is unavailable.

## Frontend installation and development

Open a second PowerShell terminal from the repository root:

```powershell
Set-Location .\frontend
npm.cmd ci
Copy-Item .env.example .env   # First setup only
npm.cmd run dev
```

Open `http://localhost:5173`. Both connection indicators begin in Checking and
reflect independent actual health responses. Use **Check again** to refresh.
Network/timeout failures display Unavailable without crashing the page.

```powershell
npm.cmd run build
npm.cmd run preview
```

Stop the development server before preview: both use port 5173 to keep the
credentialed CORS origin consistent. Vite uses a strict port and does not
silently move to another port. If you change the Vite origin, update backend
`FRONTEND_URL` to the exact same origin. Use `localhost` consistently; it is a
different browser origin from `127.0.0.1`.

## Environment variables

| File / variable | Default or example | Purpose |
|---|---|---|
| backend `NODE_ENV` | `development` | Environment label |
| backend `PORT` | `5000` | API listening port |
| backend `FRONTEND_URL` | `http://localhost:5173` | Single allowed credentialed browser origin, no trailing slash |
| backend `DB_HOST` | `127.0.0.1` | MySQL host (required) |
| backend `DB_PORT` | `3306` | MySQL port |
| backend `DB_USER` | `blood_donation_app` | Existing MySQL application user (required) |
| backend `DB_PASSWORD` | empty in example | Enter your real local password; empty means unconfigured |
| backend `DB_NAME` | `blood_donation_coordination` | Existing database (required) |
| backend `SESSION_SECRET` | empty in example | Reserved; unused until authentication is authorized |
| frontend `VITE_API_BASE_URL` | `http://localhost:5000/api` | Public backend API URL, including `/api` |

The frontend client enables `withCredentials`; backend CORS allows the explicit
frontend origin and credentials, never `*`. Only GET/HEAD/OPTIONS are currently
advertised for browser requests. Expand methods deliberately when business
routes are authorized. No login or CSRF implementation is included now.

All `VITE_` variables are public browser configuration. Put database credentials
only in backend `.env`. `.env` files, dependencies, build outputs, logs, temporary
files, and local database dumps are ignored; `.env.example` files stay trackable.

## Local MySQL configuration (PowerShell)

Inspect services without changing them:

```powershell
Get-Service -Name '*mysql*'
Test-NetConnection 127.0.0.1 -Port 3306
$mysqlExe = 'C:\Program Files\MySQL\MySQL Server 9.1\bin\mysql.exe'
& $mysqlExe --version
```

Adjust the executable path for your installed version. If MySQL is stopped,
start your intended service in an Administrator PowerShell, for example
`Start-Service -Name MySQL91`. Do not start another instance on the same port.

Use an existing local database/user where available. If you need a new empty
development database, open the MySQL client manually with an administrator
account (`-p` prompts securely for the password):

```powershell
& $mysqlExe -h 127.0.0.1 -P 3306 -u root -p
```

Optional manual provisioning only; **these commands have not been executed by
this implementation**. Replace the example password locally before using them:

```sql
CREATE DATABASE blood_donation_coordination CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'blood_donation_app'@'127.0.0.1' IDENTIFIED BY 'replace-with-your-local-password';
GRANT SELECT ON blood_donation_coordination.* TO 'blood_donation_app'@'127.0.0.1';
```

This creates no tables. Use the actual matching account host for your MySQL
installation. Configure `.env` with those credentials, then verify read-only:

```powershell
& $mysqlExe -h 127.0.0.1 -P 3306 -u blood_donation_app -p -D blood_donation_coordination -e 'SELECT 1 AS connected;'
Set-Location .\backend
npm.cmd run check:db
```

Do not run `database/setup.sql` or the empty migrations/seeds. See
`database/README.md` for planned migration ordering and later schema checks.
The pool uses `+05:30` for driver conversion and sets the MySQL session timezone
on each physical connection, consistent with the documented Asia/Kolkata dates.

## Health-check endpoints

```powershell
Invoke-RestMethod -Uri 'http://localhost:5000/api/health'
Invoke-RestMethod -Uri 'http://localhost:5000/api/health/db'
```

| Endpoint | Actual behavior |
|---|---|
| `GET /api/health` | 200 with `success: true` and `Blood Donation Coordination System API is running` |
| `GET /api/health/db` | 200 with `success: true, database: connected` only after a successful `SELECT 1` |
| Database unconfigured/unavailable | 503 with safe `error.code` and `error.message` |
| Unknown API route | 404 with `NOT_FOUND` |

To inspect failure status and JSON in Windows PowerShell:

```powershell
try {
    $response = Invoke-WebRequest -UseBasicParsing -Uri 'http://localhost:5000/api/health/db'
    $response.StatusCode
    $response.Content
} catch {
    [int]$_.Exception.Response.StatusCode
    $_.ErrorDetails.Message
}
```

These checks verify process/database connectivity only. They do not prove tables
exist, migrations ran, credentials have future write privileges, or the domain
schema is ready. API responses never contain SQL, driver errors, or stack traces.

## Verification and next work

See `docs/phase-1-verification.md` for executed checks, actual results, limitations,
and the complete changed-file inventory. Lockfiles pin the installed packages;
use `npm.cmd ci` to reproduce the installation.

Recommended next work is the separately authorized database implementation and
environment verification described as Phase 3 in the existing development plan.
Reconcile that numbering with your implementation-phase naming first. No next
phase, authentication, migration execution, commit, or push is authorized by
this foundation work.
