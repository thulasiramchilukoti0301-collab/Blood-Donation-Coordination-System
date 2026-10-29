# Blood Donation Coordination System

College DBMS Laboratory group project. The approved stack is React, Node.js with Express, MySQL, and `mysql2`.

## Current status

- **Thulasi-owned Dashboard and Password Settings follow-up:** ACTIVE Donors have a Rose Quartz Focus Dashboard on Screen 4 using own profile, advisory eligibility and new owner-scoped booking/Donation activity counts. Screen 30 adds authenticated password change for PENDING/ACTIVE Donors/Hospitals and ACTIVE Admins, with current-password proof, bcrypt cost 12, same-transaction all-session revocation and a non-sensitive audit event. Both paths use existing tables and have automated/fixture checks; live MySQL and browser-to-backend verification remain pending. Individual NO_SHOW after slot end and staff Booking cancellation before slot start are implemented with fixed audit mappings; live MySQL checks remain pending. See [the bounded guide](docs/donor-dashboard-password-settings.md).

- **Bounded Donation Processing application milestone (current working tree):** ACTIVE Admins can record one same-day final Donation outcome for a checked-in visit, atomically complete its Booking and write two audit events; Admins can search outcomes and ACTIVE Donors can read only their high-level history. Screens 20 and 9 use Mint Gauge and Rose Quartz Focus respectively. Recording adds no SQL or migration and creates no BloodUnit. Release approval and unit creation are addressed by the later bounded milestone below; corrections remain pending; later booking controls implement NO_SHOW and individual staff cancellation. Database-free checks and live verification boundaries are in [the milestone guide](docs/donation-processing.md).
- **Bounded release/inventory and Inventory Lifecycle application milestones (current working tree):** ACTIVE Admins can decide release for a pending collected Donation. Approval with an explicitly selected active BloodGroup creates one BloodUnit atomically; rejection creates none. Mint Screens 21â€“23 include inventory reads, explicit expiry reconciliation for due unallocated AVAILABLE units and discard for unallocated, unexpired AVAILABLE units. These additions use existing schemas without SQL or migration. Allocated expiry/discard conflicts until Allocation cancellation and request-state recomputation are integrated. No scheduler is implemented. Live MySQL/browser verification, allocation, issue, corrections and lifecycle contention/rollback checks remain pending. See [the release and inventory guide](docs/release-inventory.md).

- **Bounded Admin Donor Management milestone (current working tree):** ACTIVE Admins can search/filter Donors, read safe profile/high-level visit details, correct approved profile fields, and separately select a staff-confirmed blood group on existing Screens 16â€“17. Confirmed-group changes are checked against existing BloodUnit history; self-reported values are never promoted and historical unit/Donation rows are not rewritten. Account status remains managed through the existing Account Management flow. The feature adds no migration or broader Donor workflows. Automated verification and live-check boundaries are in [the Admin Donor Management guide](docs/admin-donor-management.md).

- **Bounded eligibility and slot booking application milestone (current working tree):** the existing Donor booking and Admin slot/queue features now include ACTIVE Admin check-in during the appointment interval and same-day eligibility decisions for checked-in visits. These use fixed CSRF-protected routes, current Account/session authorization, same-transaction AuditEvent writes, and the existing schema. Donor pages use Rose Quartz Focus; Admin pages use Mint Gauge. No SQL changes are introduced. Codex checks on 2026-10-28 passed 302 backend and 63 frontend tests; the four-width fixture browser suite passed 95 scenarios/635 assertions per viewport and environment-disabled in-memory production compilation passed. Live MySQL verification, concurrency and failure-path checks remain pending. Individual Admin NO_SHOW and pre-start staff cancellation are now implemented in the later booking follow-up. Testing/release approval, inventory workflows, and the rest of Phase 3 remain separate. See [the milestone guide](docs/eligibility-booking.md).

  Separate USER-RUN evidence reported 2026-10-27 records advisory eligibility, slot browsing, booking persistence, Admin queue access, creation audit observations, and a capacity-one cancellation/rebooking flow. The user reported one slot-created, two booking-created, and one Donor-cancellation audit event in that separate flow, each once with the expected reason. This is not the historical 280-test run or the later 290-backend/63-frontend automated run and browser checks; it does not verify live concurrency, rollback, lock-wait expiry, or the broader security matrix. This application milestone adds no SQL changes. See the [full evidence and scope](docs/eligibility-booking.md#user-run-booking-evidence-reported-2026-10-27).

- **Phases 0â€“2:** scope, requirements, domain/API design, relational schema, ER design, and normalization are documented and complete.
- **Approved design baseline:** 14 logical entities, 12 major tables, the approved account and workflow status names, the educational 56-day donor interval and 42-day unit shelf life, Asia/Kolkata date/time interpretation, bcrypt with server-side sessions, and a 30-screen baseline. Themes remain OPEN for unimplemented screens. These remain design rules; the bounded features do not complete the associated operational workflows.
- **Official Phase 4/5 application work:** Lathikaa's integrated foundation (`39e6a3c`) provides React/Vite, Express, mysql2 pool/configuration, health checks, and foundation tests. The bounded Auth/Donor work adds Donor registration, login/logout, persistent server-side sessions, current-account status, self-profile read/edit, and optional self-reported group selection from the canonical seed. The integrated Hospital checkpoint adds public Hospital registration, PENDING/ACTIVE Hospital own-profile read/contact edit, ACTIVE Admin Hospital list/detail reads, and their Mint Gauge screens. User-run Donor evidence belongs to Thulasi's local environment. Separate Hospital evidence is recorded for Lathikaa's environment and, on 2026-10-25, Thulasi's integrated installation/structure, application-account SELECT access, registration/login and profile contact-edit flow. Password change is implemented in the bounded follow-up above; further live approval/status/security verification, other operational workflows, deeper Admin API/security and transaction/concurrency checks, and downstream group use remain unimplemented or unverified. See the [implementation readiness review](docs/implementation-readiness.md).
- **Official Phase 3 database work:** partially implemented. Foundation, Donor, 005 eligibility/booking storage, Donation storage, 007 BloodUnit storage, the grouped read-only `v_available_inventory_by_group` view, and seven donor/inventory SQL demonstrations have user-run setup/verification evidence. Hospital DDL is authored, with separately attributed installation evidence from both environments. Thulasi's USER-RUN 2026-10-25 evidence confirms 004 installation, approved structure and application-account Hospital SELECT access; the dedicated Hospital constraint verifier remains pending. The query/view results do not provide application access control or verify workflow mutations or concurrency; bounded application work has separate database-free evidence. Live verification of Donation approval/unit creation and the newer explicit expiry/discard routes remains pending; allocated-unit lifecycle coordination, scheduler, Donation corrections, remaining audit writes and concurrency are also pending. Separate [USER-RUN AuditEvent evidence dated 2026-10-25](docs/audit-foundation.md#user-run-local-auditevent-setup-2026-10-25) confirms the corrected normal-mode verifier at `15ac4cf`, Thulasi's local 010 installation/structure and application-account SELECT access. Lathikaa's incoming-revision evidence remains historical; corrected dedicated-server mode was not live-reverified. Separate [USER-RUN Account approval evidence dated 2026-10-26](docs/account-approval-backend.md#user-run-account-approval-evidence-2026-10-26) records Console-driven Donor/Hospital approval, profile sign-in requirements, retry conflict and one audit event per approved Account. Further concurrency/failure/security and all-session/multi-device revocation checks, remaining live frontend checks, remaining mappings and other workflows remain pending. Four logical entities, including three major tables, remain unauthored: BloodCompatibility, HospitalRequest, RequestStatusHistory, and Allocation. RequestStatusHistory and its trigger require a separate future migration with number/filename UNASSIGNED. Other domain seeds, procedures, triggers, reporting, permanent sample data, and concurrency verification are incomplete. See the [implementation readiness review](docs/implementation-readiness.md) and [database setup and verification record](database/README.md).
- Hospital registration/profile and Admin Hospital reads are implemented within their documented boundaries. The bounded booking workflow/API and the later testing/release approval and read-only inventory subset are described above; request/allocation, audit search and other operational application routes remain unimplemented; the bounded password-change route is described above. Audited Donor/Hospital suspension/reactivation now extend the existing Account backend; [exact mappings, authoritative SID checks and database-free results](docs/account-status-backend.md) are documented. Separate [USER-RUN evidence reported 2026-10-27](docs/account-status-backend.md#user-run-donor-status-cycle-evidence-reported-2026-10-27) records one Donor cycle through the browser Console, including observed sign-in behavior, suspended-login refusal, fresh-login ACTIVE display and exact audit counts/mappings. It is separate from the 260 automated tests and does not verify Hospital cycles, concurrency, rollback, multi-device revocation or all security cases. At that Console checkpoint the Mint page was approval-only. The bounded Mint Account management UI now implements Approve, Suspend and Reactivate with frozen confirmations, exact payloads, auth-lifecycle/duplicate guards and read-only recovery; [current verification and the separate user-reported Donor page cycle](docs/account-approval-frontend.md#user-run-account-management-ui-evidence-reported-2026-10-27) are documented; Hospital UI status controls and further live checks remain pending. The shared Account queue and PENDING-to-ACTIVE approval backend are implemented as a separate bounded milestone; a bounded Mint Gauge supporting flow at `/admin/accounts` now implements those controls through the existing APIs; separate [USER-RUN frontend evidence dated 2026-10-26](docs/account-approval-frontend.md#user-run-frontend-evidence-2026-10-26) records navigation/filters, cancellation and one Donor approval through the page, an empty pending queue, observed fresh-sign-in requirement and a one-event Workbench count. This does not verify Hospital approval through the UI or the remaining live pagination/mobile/tablet, edge-case, concurrency/failure/security and multi-device checks. The current storage DDL does not implement those workflows. Verifier fixtures are transactional and rolled back; no Account fixtures are permanent seeds. See the [implementation readiness review](docs/implementation-readiness.md) and [development plan](docs/development-plan.md).

- **First-Admin bootstrap:** an explicit local CLI is authored and database-free tested, using the existing Account schema and shared registration validation. [Private invocation and remaining live checks](docs/first-admin-bootstrap.md) are documented. USER-RUN evidence with browser confirmation reported 2026-10-26 records one ADMIN/ACTIVE creation via hidden prompts and normal sign-in to Mint Gauge Hospital Management, with list/search/details, refresh persistence and sign-in required after logout. These observations are separate from the 192 automated backend tests. The utility creates no session or approval/audit workflow; real MySQL concurrency/failure/cancellation, live refusal cases and API tampering remain pending.

## Project documents

- [Project scope](docs/project-scope.md)
- [Architecture](docs/architecture.md)
- [Requirements](docs/requirements.md)
- [Domain rules](docs/domain-rules.md)
- [Role permissions](docs/role-permissions.md)
- [Eligibility and slot booking milestone](docs/eligibility-booking.md)
- [Donation Processing milestone](docs/donation-processing.md)
- [Admin Donor Management milestone](docs/admin-donor-management.md)
- [Donation release and inventory visibility milestone](docs/release-inventory.md)
- [First-Admin bootstrap](docs/first-admin-bootstrap.md)
- [Shared Account approval backend](docs/account-approval-backend.md)
- [Account suspension/reactivation backend](docs/account-status-backend.md)
- [Admin Account approval frontend](docs/account-approval-frontend.md)
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
- [Database migration and installation ledger](database/migration-ledger.md)
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

Separate user-run selector checks dated 2026-10-25 confirm reported-group selection, persistence, cancellation, clearing, unchanged Save behavior, and registration with either the unknown choice or a selected group. The resulting PENDING profiles showed the expected reported group or â€œNot provided,â€ while confirmed group stayed unset. These observations and their unverified boundaries are recorded in the [implementation readiness review](docs/implementation-readiness.md).

## Local database setup

Each developer uses a separate local MySQL database. Do not point routine work at shared/live data. Inspect and preserve any existing database. The foundation setup path, stable BloodGroup identifiers, required privileges, exact PowerShell/MySQL client steps, and rerun/failure behavior are documented in [`database/README.md`](database/README.md). Do not apply future placeholder migration/seed files. Keep connection secrets only in the ignored `backend/.env`; never place them in tracked files or command arguments.

## Integration workflow

Thulasi works on continuing branch `thulasiram`; Lathikaa works on `lathikaa`. Reviewed work enters `main` through PRs. Coordinate shared SQL objects and migration numbering; after syncing integrated SQL from `origin/main`, apply it to each person's own local database using the reviewed setup instructions. See [team workflow](docs/team-workflow.md).
