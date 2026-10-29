# Database setup and collaboration

The [migration and installation ledger](migration-ledger.md) records numbered SQL source revisions, dependencies, ownership, and separately attributed local installation evidence for Thulasi and Lathikaa. Unknown dates or installed revisions are explicitly marked **UNKNOWN**. Update the ledger during future SQL handoffs; do not infer an installed revision from table presence.

## Hospital storage and Feature 6 status

`004_hospitals.sql` and `tests/verify-hospitals.mjs` implement the bounded Hospital storage artifacts. Codex has not executed them against MySQL. Lathikaa reports 004 installed in her own `blood_donation_coordination`, with Account/Hospital/app_session present and successful real Hospital registration/login with correct saved organization, registration/contact fields and PENDING Profile. This positive-flow evidence does not establish the full disposable constraint verifier, failure/rollback/concurrency or live Admin access. Do not rerun 001–004, reference seeds or foundation setup on Lathikaa's installed development database.

Later [USER-RUN evidence dated 2026-10-25 from Thulasi's environment](../docs/implementation-readiness.md#user-run-hospital-evidence-in-thulasis-environment-2026-10-25) records successful 004 application, approved Hospital structure, application-account SELECT access, and the bounded registration/profile flow. Existing database-level SELECT/INSERT/UPDATE/DELETE grants were observed without permission changes; this does not alter the documented privilege requirements. Do not rerun 004 on either installed database. Use [read-only Hospital structure checks](../docs/hospital-storage.md); historical first-install and disposable-only instructions there are reproduction references, not current migration requests. Foundation setup below remains foundation-only.

Feature 6 code now includes atomic Hospital registration, own GET/PATCH Profile, ACTIVE ADMIN Hospital list/profile-detail APIs and Screen 24. Registration, Profile and Admin Hospital Management use scoped Mint Gauge with Sora/Nunito Sans. The completed Admin-read checkpoint passed **108 backend and 34 frontend isolated tests**, plus production compilation; these are historical application-test results, not database-verifier results or a new run by this documentation update. Separate [USER-RUN evidence with browser confirmation reported 2026-10-26](../docs/first-admin-bootstrap.md#user-run-evidence-browser-confirmation-reported-2026-10-26) confirms first-Admin creation and the basic Admin Hospital read/session/logout flow; deeper live checks remain pending. Thulasi now implements the shared Account queue and bounded PENDING-to-ACTIVE approval backend with transactional audit/revocation; [protocol and live limits](../docs/account-approval-backend.md) are documented. Hospital status stays read-only in the unchanged frontend; basic Console approval/audit/fresh-login observations now have [USER-RUN evidence dated 2026-10-26](../docs/account-approval-backend.md#user-run-account-approval-evidence-2026-10-26); the later [shared Mint approval frontend](../docs/account-approval-frontend.md) implements the supporting controls without SQL changes; separate [USER-RUN Donor approval through the page](../docs/account-approval-frontend.md#user-run-frontend-evidence-2026-10-26) records the bounded 2026-10-26 success and one-event count. Live Hospital UI approval, multi-page/mobile/tablet and edge-case UI/further backend checks and broader status actions remain pending. See [Admin Hospital contracts and evidence](../docs/admin-hospital-management.md).

## Minimal AuditEvent foundation (local setup user-verified; workflows pending)

`migrations/010_audit.sql` authors **AuditEvent only**, with the nine approved fields, restrictive Account actor FK, subject whitelist/ID CHECKs and actor/subject indexes. Its only parent table is Account; no request/allocation/history table, trigger, routine or permanent record is created. The internal writer accepts an explicit reviewed action registry and an existing transaction connection; it does not acquire a pool connection or commit/roll back the caller's operation. No production action vocabulary is introduced. Historical verification recorded by incoming checkpoint `5b7f45a` on 2026-10-25 passed 22 audit-specific and 137 full backend tests, plus the MySQL 8.0.39 disposable verifier (19 valid audit fixtures, 23 negative checks, rollback/empty tables/close). Real writer rollback checks also passed. The former CHECK metadata quote-escaping mismatch was corrected in verification code without altering DDL. Exact isolation/cleanup and remaining integration limits are recorded in [audit foundation](../docs/audit-foundation.md). The corrected verifier now runs SHOW GRANTS validation in BOTH normal and dedicated-server modes before object inventory/fixtures; a matching datadir/port never waives visibility. Its conservative direct-global visibility policy is separate from application privileges. Separate [USER-RUN evidence dated 2026-10-25](../docs/audit-foundation.md#user-run-local-auditevent-setup-2026-10-25) confirms the corrected normal-mode verifier at `15ac4cf`, Thulasi's application of only 010 to `blood_donation_coordination`, structure/index inspection and application-account SELECT access. Existing database-level SELECT/INSERT/UPDATE/DELETE grants were observed without changes; no application audit-write test was performed at that 2026-10-25 setup checkpoint. Corrected dedicated-server mode was not live-reverified. Later USER-RUN Console approval and audit-record/count observations are linked above, separately from setup evidence. Real concurrent login/approval, expiry during MySQL lock waits, failure/rollback, ambiguous commits, all-session/multi-device revocation and full security/API-tampering verification remain pending, as do remaining live frontend checks, remaining mappings and other workflows. The bounded approval backend now uses the existing schema and writer without migrations. First-Admin provisioning and basic Admin reads have the separate user-run evidence below.

The previous reserved 010 unit also included RequestStatusHistory. The integrated minimal foundation explicitly amends that plan: **010 remains numbered 010 and contains AuditEvent only**, with an Account-only dependency so the reviewed assembly may use 001 → 002 → 010 before 008. RequestStatusHistory and its trigger require a separate future coordinated migration, number/filename **UNASSIGNED**. They are not moved into 008 and must not be appended to 010 later. Thulasi's subsequent local 010 application is recorded separately from Lathikaa's historical evidence; it does not transfer Audit ownership or authorize the future history migration. Foundation setup and existing migrations are unchanged; no automatic application is added. Exact production action codes and Account PATCH reason mapping remain OPEN.

## Manual first-Admin provisioning

The bounded [first-Admin CLI](../docs/first-admin-bootstrap.md) uses the existing Account table and configured application pool with an explicit loopback development target. It performs one parameterized ADMIN/ACTIVE insert, refuses any existing Admin or duplicate email, and serializes cooperating invocations with a per-schema MySQL named lock held through commit/rollback. It requires authorized Account reads (including the locking read), INSERT and metadata visibility; no migration, grant, AuditEvent actor or applicant approval is introduced. The CLI and injected tests are authored. Separate [USER-RUN evidence with browser confirmation reported 2026-10-26](../docs/first-admin-bootstrap.md#user-run-evidence-browser-confirmation-reported-2026-10-26) records one ADMIN/ACTIVE creation through hidden prompts and the basic Admin Hospital read flow. Real MySQL concurrency/failure/rollback/cancellation, live existing-Admin/duplicate-email refusal and API tampering remain unverified. Do not run it as a setup batch or server startup step; use the linked private invocation only after separate authorization.

## Current Phase 3 boundary

See the [database migration and installation ledger](migration-ledger.md) for the eight authored numbered migration artifacts with reported installation evidence, shared reference seed, session infrastructure, inventory view, source revisions, dependencies, and separate developer attribution. The current Eligibility & Slot Booking application milestone adds **no SQL changes**; its 2026-10-27 USER-RUN flow and audit observations are recorded in the [feature guide](../docs/eligibility-booking.md#user-run-booking-evidence-reported-2026-10-27).

The artifacts for the completed Account/BloodGroup foundation and Donor milestones, user-verified eligibility/booking, Donation storage, BloodUnit storage, and grouped read-only inventory view milestones are:

1. `migrations/001_foundation.sql` — `BloodGroup` only.
2. `migrations/002_auth.sql` — `Account` only.
3. `seeds/reference_data.sql` — the eight stable `BloodGroup` rows only.
4. `migrations/003_donors.sql` — Donor only; apply once after the existing Account/BloodGroup foundation and reference seed.
5. `migrations/005_eligibility_booking.sql` — creates `DonationSlot`, `Booking`, and `EligibilityDecision` in that order; depends on 001, 002, the BloodGroup reference seed, and 003. Migration 004 Hospital is not a dependency.
6. `scripts/apply-foundation.mjs` — loopback-only foundation setup runner; it remains limited to the empty schema and applies only 001, 002, and the BloodGroup seed. It does not apply 003, 005, or any later module. `setup.sql` is likewise foundation-only.
7. `tests/verify-foundation.mjs` — disposable-schema checks for foundation metadata, constraints, defaults, reference values, and expected SQL rejection.
8. `tests/verify-donors.mjs` — schema and behavior verification for Donor in a specifically named disposable schema; it inserts at least ten synthetic Account/Donor pairs in a transaction and requires a successful rollback before reporting success.
9. `tests/verify-eligibility-booking.mjs` — metadata and rollback-only storage checks for the three tables in a specifically named disposable schema. It does not verify concurrency or booking workflows.
10. `migrations/006_donations.sql` — creates only `Donation`; depends on `Account` and `Booking` (therefore 001, 002, and 005); 004 Hospital is not a dependency.
11. `tests/verify-donations.mjs` — metadata and rollback-only storage checks for Donation in a specifically named disposable schema; it does not verify donation workflows, atomic/idempotent BloodUnit creation, authorization, or concurrency.
12. `migrations/007_inventory.sql` — creates only `BloodUnit`; depends on `Donation` and canonical `BloodGroup` rows, so the fresh order is 001, 002, reference data, 003, 005, 006, then 007. Migration 004 Hospital is not a dependency. User-run results reported 2026-10-24 verify this storage milestone.
13. `tests/verify-inventory.mjs` — metadata and rollback-only storage checks for BloodUnit; user-run results reported 2026-10-24 passed all 16 negative checks. It does not verify inventory workflows or BloodUnit creation from approval.
14. `views/available_inventory.sql` and `tests/verify-available-inventory.mjs` — define and verify the grouped read-only `v_available_inventory_by_group` view. User-run results reported 2026-10-24 verify this view milestone; details follow below. This is not an application API/report/screen verification.
15. `queries/donor_inventory.sql` — seven named parameterized read-only SELECT demonstrations for Thulasi's donor/donation/inventory modules; user-run disposable verification passed on 2026-10-24.
16. `tests/verify-donor-inventory-queries.mjs` — extracts and runs those canonical query sections against a specifically named disposable schema using rollback-only fixtures; user-run verification passed on 2026-10-24.
17. `migrations/004_hospitals.sql` and `tests/verify-hospitals.mjs` — Hospital shared-key storage and dedicated disposable verifier. Lathikaa reports installation and a working real Hospital profile in her environment; separate USER-RUN 2026-10-25 evidence confirms installation/structure and the bounded flow in Thulasi's environment. The dedicated constraint verifier remains pending; Codex has not run it against MySQL. Hospital depends on Account and is independent of the Donor/005/006/007 storage sequence.
18. `migrations/010_audit.sql` — newly authored AuditEvent-only storage; Account is its only FK dependency. It does not apply itself or modify Account. Its independent writer and isolated verification are documented in [audit foundation](../docs/audit-foundation.md), separately from live application.

User-run evidence dated 2026-10-20 records that `bddc_phase3_test_donor_20261020_first` was assembled from 001, 002, `reference_data.sql`, then 003; `verify-donors.mjs` passed all 13 negative checks and confirmed rollback of ten synthetic Account/Donor pairs and connection cleanup. The same evidence records that development preflight found Account and BloodGroup with Donor absent, then applying only 003 to `blood_donation_coordination` succeeded. These are user-provided results, not queries or setup actions performed by this documentation update.

Other reserved migration/seed placeholders remain non-executable content. Do not apply empty future modules. Feature 8's 009 now stores the 64 directed BloodCompatibility pairs and Allocation records; disposable verification is documented in [the Feature 8 handoff](../docs/feature8-implementation.md). It does not implement or authorize allocation commits, issue/cancel/expiry writers, compatibility administration, or a mounted endpoint. No Hospital profile or permanent Account fixture belongs in the Donor storage milestone. Account/Donor role matching and atomic registration are service invariants that foreign keys do not enforce; the later bounded web feature assigns the DONOR role and creates both rows transactionally, while failure/rollback behavior remains unverified live.

This is not the complete Phase 3 database deliverable. User-reported results dated 2026-10-24 cover the 005 eligibility/booking, 006 Donation storage, 007 BloodUnit storage, grouped inventory-view and donor/inventory SQL demonstration milestones; Lathikaa's Hospital evidence and Thulasi's later USER-RUN 2026-10-25 Hospital installation/structure/profile evidence are separate, as recorded above. Donation outcome recording creates no BloodUnit; future approval/unit creation must be atomic and idempotent after the required audit infrastructure exists. Storage, view and query checks do not establish authorization, application workflows, lifecycle enforcement, allocation, expiry transitions or concurrency.

HospitalRequest is authored in 008 and was disposable-verified with its two row guards. RequestStatusHistory and its conditional AFTER UPDATE trigger are in approved migration 012 and disposable-verified. These storage checks do not establish development installation, allocation-derived responses, pre-issue cancellation, authenticated sessions, or the shared allocation/issue/cancel/expiry concurrency protocol. Feature 8's real Allocation schema and FEFO preview are documented in [Feature 8 implementation](../docs/feature8-implementation.md); the Feature 7 request contracts and evidence remain in [Feature 7 storage](../docs/blood-request-storage.md).

The AuditEvent metadata verifier correction changes no approved DDL, writer contract or constraints. The corrected verifier checks SHOW GRANTS visibility in both normal and dedicated-server modes. Separate USER-RUN evidence dated 2026-10-25 confirms the corrected normal-mode verifier at `15ac4cf` and Thulasi's local 010 installation, structure/index inspection and application-account SELECT access; corrected dedicated-server mode was not live-reverified. Separate USER-RUN evidence dated 2026-10-26 records the shared Account approval backend's `ACCOUNT_APPROVED` writes and read-only audit/fresh-login observations. Real MySQL concurrency, lock-wait expiry, failure/rollback, ambiguous commits, all-session/multi-device revocation and the full security/API-tampering matrix remain unverified; frontend approval controls and other account workflows remain pending. Full standalone Hospital constraint/failure/concurrency verification also remains pending. The AuditEvent-only 010 and separate history-migration plan preserve existing migration numbers and ownership. The eventual sample-data target remains at least ten coherent rows in each of the 12 major tables; rollback-only fixtures do not count as permanent sample data. Other seeds, routines, compatibility/allocation modules, expiry work and concurrency checks retain their authorization and verification gates.

## Application session infrastructure

`infrastructure/auth_sessions.sql` creates the persistent `app_session` table required by the bounded Express authentication feature. It is infrastructure, not one of the 14 logical entities or 12 major tables, and it has no academic sample-row requirement. It is intentionally separate from numbered domain migrations and from `apply-foundation.mjs`; the application does not create it at runtime.

For any local schema that lacks `app_session`, confirm the selected database, then execute only `database/infrastructure/auth_sessions.sql` there. The schema/setup identity needs permission to create this table. The configured application identity needs `SELECT`, `INSERT`, and `UPDATE` on `app_session` for session reads/writes, expiry, logout, and future account-wide revocation. Manage those privileges separately under local database administration; this documentation does not create users or grant privileges. Do not add this file to a numbered migration batch or apply it to a shared/live database.

Revocation retains a row with `revoked_at` set and `session_data` cleared. The design prevents an in-flight save or touch from restoring a revoked or expired row; a new login receives a rotated session ID. Expired rows are tombstoned when read. Do not delete tombstones while requests using those IDs could still be in flight. No automatic retention cleanup is implemented, so a later deployment must define a safe cleanup window and verify it with concurrent MySQL connections. Concurrent revocation has not been live-verified.

Authentication requires this table, a working backend DB configuration, and a private `SESSION_SECRET` (at least 32 random UTF-8 bytes). Optional `SESSION_TTL_MINUTES` defaults to 120 and must be 5–1440. Runtime schema creation remains disabled. `backend/.env.example` names the settings; configure the developer's ignored `backend/.env` privately without committing secrets. Registration and login are protected by a bounded in-process rate limiter, so this setting is suitable only for the current single-process development server; multi-process deployment needs shared rate-limit storage.

User-run local evidence dated 2026-10-25: `app_session` was created in `blood_donation_coordination`, and `SHOW CREATE TABLE` confirmed nullable `session_data` and `revoked_at`. The corrected connectivity checker accepted the mysql2 string `"1"` result while keeping `supportBigNumbers` and `bigNumberStrings`; the project connectivity check and backend startup succeeded. Session configuration was completed privately. These observations establish the reported local setup and basic connectivity, not live transaction-failure/rollback behavior or concurrent session revocation. The complete user-run authentication flow is recorded separately in [`docs/implementation-readiness.md`](../docs/implementation-readiness.md). This documentation update did not query MySQL or inspect private configuration.

## Physical schema contract

The database default is `utf8mb4` / `utf8mb4_0900_ai_ci`. Non-empty migrations 001–008 and 010 now author eleven InnoDB domain tables; the unnumbered history proposal is a separate draft. These source counts do not assert development installation. Case-insensitive `utf8mb4_0900_ai_ci` is used for email, display names, Donor/Hospital text and audit reason/summary text. The app normalizes email to lowercase before storage; its unique index also treats differently cased email as duplicate. Role/status/group/request-priority codes and AuditEvent action/subject codes use ASCII `ascii_bin`; audit operation IDs also use ASCII. Times are `DATETIME` interpreted in `Asia/Kolkata`; set SQL/application sessions to `+05:30`. Application-maintained `updated_at` behavior is unchanged. See [Hospital storage](../docs/hospital-storage.md) and [AuditEvent exact contract](../docs/audit-foundation.md).

| Physical table | Columns and exact types | Constraints |
|---|---|---|
| `BloodGroup` | `blood_group_id BIGINT UNSIGNED AUTO_INCREMENT`; `code CHAR(3) ASCII ascii_bin`; `display_name VARCHAR(12) utf8mb4_0900_ai_ci`; `is_active BOOLEAN` (`TINYINT(1)`) | `PRIMARY KEY (blood_group_id)`; `uq_blood_group_code`; `uq_blood_group_display_name`; `ck_blood_group_code`; `ck_blood_group_is_active` |
| `Account` | `account_id BIGINT UNSIGNED AUTO_INCREMENT`; `email VARCHAR(254) utf8mb4_0900_ai_ci`; `password_hash VARCHAR(255) utf8mb4_0900_ai_ci`; `role VARCHAR(16) ASCII ascii_bin`; `account_status VARCHAR(16) ASCII ascii_bin`; `created_at DATETIME`; `updated_at DATETIME` | `PRIMARY KEY (account_id)`; `uq_account_email`; `ck_account_role`; `ck_account_status` |
| `Donor` | `account_id BIGINT UNSIGNED` (shared PK, not auto-generated); `full_name VARCHAR(120)`; `date_of_birth DATE`; `phone VARCHAR(30)` (not unique); `address VARCHAR(255)`; `area VARCHAR(100)` NULL; reported/confirmed blood group IDs `BIGINT UNSIGNED` NULL; `created_at` / `updated_at DATETIME` | `PRIMARY KEY (account_id)`; `fk_donor_account`; `fk_donor_reported_blood_group`; `fk_donor_confirmed_blood_group`; `ix_donor_confirmed_blood_group_id`; `ix_donor_full_name`; `ix_donor_reported_blood_group_id` |

MySQL exposes these primary keys in `INFORMATION_SCHEMA.TABLE_CONSTRAINTS` with the physical name `PRIMARY` and type `PRIMARY KEY`. Verification also checks the corresponding single `KEY_COLUMN_USAGE` column (`blood_group_id`, `account_id`, or `Donor.account_id`); `pk_blood_group` and `pk_account` are not physical constraint names.

The Donor primary key supplies the `account_id` FK index; no duplicate account index is added. Each nullable BloodGroup FK has its own supporting index, and the name index follows the approved donor-filter design. `phone` is not unique. The Donor migration does not enforce Account role/profile matching, atomic registration, future-date rejection, or authorization of confirmed-group changes. The bounded web feature now handles role assignment, Account/Donor transaction creation, and future-date validation; confirmed-group editing remains future authorized service work. The migration's timestamp defaults do not automatically update `updated_at`.

`BloodGroup.code` is limited case-sensitively to exactly `O-`, `O+`, `A-`, `A+`, `B-`, `B+`, `AB-`, or `AB+`; `is_active` defaults to TRUE and permits only 0/1. `Account.role` is exactly `ADMIN`, `HOSPITAL`, or `DONOR`; `account_status` is exactly `PENDING`, `ACTIVE`, or `SUSPENDED`, defaulting to `PENDING`. Account `email` is unique and normalized to lowercase at the application boundary. `created_at` and `updated_at` default to the current session timestamp; the application explicitly maintains `updated_at` when it changes an account. Password hashes are stored only in `password_hash`; this migration does not implement authentication or hashing. The exact logical design is in [database design](../docs/database-design.md) and [relational schema](../docs/relational-schema.md). CHECK values are case-sensitive because the checked code columns use `ascii_bin`.

### Stable BloodGroup reference identifiers

Keep these IDs identical in every developer database. Downstream foreign keys refer to these IDs after the reference seed is applied.

| `blood_group_id` | `code` | `display_name` |
|---:|---|---|
| 1 | `O-` | O negative |
| 2 | `O+` | O positive |
| 3 | `A-` | A negative |
| 4 | `A+` | A positive |
| 5 | `B-` | B negative |
| 6 | `B+` | B positive |
| 7 | `AB-` | AB negative |
| 8 | `AB+` | AB positive |

Do not renumber, update, or silently reconcile these canonical rows. A duplicate or altered row is a setup error to inspect, not a reason to use `INSERT IGNORE` or `ON DUPLICATE KEY UPDATE`.

## Local database setup (Windows PowerShell)

Each person creates and uses a separate local database. Inspect the intended server/database before any writes. Preserve an existing populated database; use a new name if it already contains data or schema. The user reports foundation setup succeeded on `blood_donation_coordination`; this documentation records that result without recording credentials or asserting that this task queried the database.

The setup identity must be able to create tables and insert the reference rows in the selected schema. As a conservative setup policy, the guarded Node runner also requires directly granted global `SELECT`, `SHOW_ROUTINE`, `TRIGGER`, and `EVENT` privileges so its `INFORMATION_SCHEMA` checks can see tables/views, routines, triggers, and events. It fails before writes when those grants cannot be established from `SHOW GRANTS`; schema-scoped visibility alone is insufficient for this runner to establish that no inspected object is hidden. This is a policy of this runner, not a universal MySQL requirement. These metadata-visibility grants apply only to the local setup identity, not the routine application identity.

Inspect your intended local server first. The Node runner requires a newly created empty schema. An authorized administrator may create one with this PowerShell/MySQL command. `-p` prompts interactively; no password is in the command. If the schema already exists, creation fails without changing it—inspect it and choose a new database name rather than dropping or overwriting it. Workbench can be used for the same operation.

```powershell
$mysqlExe = (Get-Command mysql.exe -ErrorAction Stop).Source
$adminUser = Read-Host 'Local MySQL administrator user'
& $mysqlExe --host=127.0.0.1 --port=3306 --user=$adminUser --password --execute="CREATE DATABASE blood_donation_coordination CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci"
if ($LASTEXITCODE -ne 0) { throw 'Database creation failed; inspect the local server and selected schema.' }
```

Keep schema setup credentials separate from routine application credentials. The current connectivity probe needs only database-scoped `SELECT`; later application operations should receive only the database-scoped DML privileges they require. For the Node runner, use an authorized local setup identity with schema `CREATE` and `INSERT`, plus this runner's conservative global metadata-visibility grants above. Creating the schema itself requires database-creation authority for the administrator running the separate creation step. For manual `setup.sql`, the identity additionally needs `CREATE DATABASE`. Add routine/event creation privileges only in the later milestone that implements those objects. Configure the application account with only its required database-scoped privileges; it does not need the setup runner's global metadata grants.

From the repository root, use the setup identity (not the routine application identity) to run the guarded setup. Create a new empty schema with the stated character set/collation first. Set connection host/port in the process environment or private `backend/.env`; enter the setup user/password into the current PowerShell process without placing a password in command arguments:

```powershell
$previousDbHost = $env:DB_HOST
$previousDbPort = $env:DB_PORT
try {
  $env:DB_HOST = '127.0.0.1'
  $env:DB_PORT = '3306'
  $env:PHASE3_SETUP_DATABASE = 'blood_donation_coordination'
  $env:PHASE3_SETUP_EMPTY_DATABASE = 'YES'
  $env:PHASE3_SCHEMA_USER = Read-Host 'Local schema setup user'
  $setupSecret = Read-Host 'Local schema setup password' -AsSecureString
  $env:PHASE3_SCHEMA_PASSWORD = [System.Net.NetworkCredential]::new('', $setupSecret).Password
  node .\database\scripts\apply-foundation.mjs
  if ($LASTEXITCODE -ne 0) { throw 'Foundation setup failed; inspect the selected local schema.' }
} finally {
  Remove-Item Env:PHASE3_SCHEMA_PASSWORD, Env:PHASE3_SCHEMA_USER, Env:PHASE3_SETUP_DATABASE, Env:PHASE3_SETUP_EMPTY_DATABASE -ErrorAction SilentlyContinue
  $setupSecret = $null
  if ($null -eq $previousDbHost) { Remove-Item Env:DB_HOST -ErrorAction SilentlyContinue } else { $env:DB_HOST = $previousDbHost }
  if ($null -eq $previousDbPort) { Remove-Item Env:DB_PORT -ErrorAction SilentlyContinue } else { $env:DB_PORT = $previousDbPort }
}
```

If `backend/.env` is absent, set `DB_HOST` and `DB_PORT` as shown; the setup identity and selected database are supplied separately through the `PHASE3_*` variables. The runner accepts only loopback hosts (`localhost`, `127.0.0.1`, or `::1`). Before writes, it verifies global metadata visibility and checks tables/views, routines, triggers, and events. Any failed visibility check, nonempty schema, connection issue, or SQL error exits nonzero with a safe message. It does not create a database or user. The `finally` block clears the temporary credentials and connection variables even on failure.

For manual MySQL-client setup, use a direct batch assembled from the canonical SQL files. The supported CLI invocation is `--skip-force --execute`; check the process exit code immediately. Do not rely on interactive `SOURCE` or `setup.sql`'s nested `SOURCE` statements to stop all subsequent statements after an error. For a new foundation database, run this only when the schema name is unused and the local setup identity is authorized to create it:

```powershell
$mysqlExe = (Get-Command mysql.exe -ErrorAction Stop).Source
$schemaUser = Read-Host 'Local schema setup user'
$foundationSql = @(
  'CREATE DATABASE blood_donation_coordination CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;'
  'USE blood_donation_coordination;'
  "SET time_zone = '+05:30';"
  (Get-Content -Raw -ErrorAction Stop .\database\migrations\001_foundation.sql)
  (Get-Content -Raw -ErrorAction Stop .\database\migrations\002_auth.sql)
  (Get-Content -Raw -ErrorAction Stop .\database\seeds\reference_data.sql)
) -join "`n"
& $mysqlExe --host=127.0.0.1 --port=3306 --user=$schemaUser --password --skip-force --execute="$foundationSql"
$mysqlExitCode = $LASTEXITCODE
if ($mysqlExitCode -ne 0) { throw 'Foundation batch failed; inspect the selected local schema before retrying.' }
```

The direct batch creates only the foundation objects and reference rows. `apply-foundation.mjs` remains the guarded setup path and remains foundation-only. `setup.sql`, if used, is also foundation-only, creates `blood_donation_coordination` without `IF NOT EXISTS`, selects it, sets the client session timezone, then issues nested `SOURCE` commands. It is a convenience wrapper, not a fail-fast guarantee: a MySQL client may continue after a sourced-file error, so its completion does not prove all files succeeded. For guarded foundation setup, use `apply-foundation.mjs`; for a manual path, use the direct batch and check its exit code. Existing schema names are refused by `CREATE DATABASE`; inspect before any retry. Confirm setup with the disposable verifier before claiming verification.

To exit MySQL, use `exit`. If the application `.env` is missing, configure its database host, port, user, password, and database name privately in `backend/.env` using an authorized application user. Preserve existing `.env` values and unrelated settings. Never paste secrets into tracked files, examples, shell arguments, reports, or chat. User-run foundation setup and connectivity results are summarized in the [implementation readiness review](../docs/implementation-readiness.md); this document does not store or display private settings.

## Disposable verification

The foundation verifier refuses to run unless its target database name matches `bddc_phase3_test_<label>`. Create a **new empty disposable schema** with that prefix, apply the foundation sequence there, then run from the repository root:

```powershell
$previousDbHost = $env:DB_HOST
$previousDbPort = $env:DB_PORT
try {
  $env:PHASE3_TEST_DATABASE = 'bddc_phase3_test_first'
  $env:DB_HOST = '127.0.0.1'
  $env:DB_PORT = '3306'
  $env:PHASE3_TEST_DB_USER = Read-Host 'Disposable-schema test user'
  $testSecret = Read-Host 'Disposable-schema test password' -AsSecureString
  $env:PHASE3_TEST_DB_PASSWORD = [System.Net.NetworkCredential]::new('', $testSecret).Password
  node .\database\tests\verify-foundation.mjs
  if ($LASTEXITCODE -ne 0) { throw 'Foundation verification failed; inspect the disposable schema.' }
} finally {
  Remove-Item Env:PHASE3_TEST_DB_PASSWORD, Env:PHASE3_TEST_DB_USER, Env:PHASE3_TEST_DATABASE -ErrorAction SilentlyContinue
  $testSecret = $null
  if ($null -eq $previousDbHost) { Remove-Item Env:DB_HOST -ErrorAction SilentlyContinue } else { $env:DB_HOST = $previousDbHost }
  if ($null -eq $previousDbPort) { Remove-Item Env:DB_PORT -ErrorAction SilentlyContinue } else { $env:DB_PORT = $previousDbPort }
}
```

Repeat on a second newly created empty schema (for example `bddc_phase3_test_second`) and the same setup steps to verify reproducibility. If `backend/.env` is absent, explicitly set `DB_HOST` and `DB_PORT` as shown. The verifier overrides `DB_NAME` with the explicitly named disposable target; alternatively supply connection variables in the current process environment. If the app user is not authorized for the disposable schemas, provide a separate disposable-only identity through `PHASE3_TEST_DB_USER` and `PHASE3_TEST_DB_PASSWORD` process environment variables. The verifier requires read visibility for the inspected schema metadata plus DML on the disposable schema; insufficient visibility or SQL privileges fail the run. It does not need DDL. It prints safe negative-test labels and expected MySQL error codes only, never connection values or raw driver details. It inserts synthetic Account rows inside a transaction and rolls them back. It never seeds a permanent Account, creates/drops a database, drops a table, or changes a non-disposable schema. Do not point it at a project, shared, or production database.

### Donor-only apply and disposable verification

For a local database that already has the verified Account/BloodGroup foundation and reference rows, apply `003_donors.sql` exactly once, after confirming Donor is absent. User-run evidence dated 2026-10-20 records this application succeeding on `blood_donation_coordination`. Do not rerun `scripts/apply-foundation.mjs` on an initialized database: it remains foundation-only, expects an empty schema, and does not apply the Donor module. Do not add Donor or Hospital to `setup.sql` or the foundation runner.

From the repository root, apply the canonical migration as a direct batch to the existing local foundation database, only after confirming `Donor` is absent. The schema setup identity needs `CREATE` on that schema and `REFERENCES` on the parent tables `Account` and `BloodGroup`; it does not need the runner's conservative global metadata-visibility grants merely to execute this migration.

```powershell
$mysqlExe = (Get-Command mysql.exe -ErrorAction Stop).Source
$schemaUser = Read-Host 'Local schema setup user'
$donorSql = Get-Content -Raw -ErrorAction Stop .\database\migrations\003_donors.sql
& $mysqlExe --host=127.0.0.1 --port=3306 --user=$schemaUser --password --database=blood_donation_coordination --skip-force --execute="$donorSql"
$mysqlExitCode = $LASTEXITCODE
if ($mysqlExitCode -ne 0) { throw 'Donor migration failed; inspect the schema before retrying.' }
```

The migration uses plain `CREATE TABLE` and is intentionally not idempotent. Apply it only to an existing foundation where `Donor` is absent. If `Donor` already exists or a previous application stopped partway, inspect the schema and resolve it deliberately; do not rerun blindly or rebuild the development database.

For a fresh disposable Donor verification schema, create a **new disposable** schema named `bddc_phase3_test_donor_<label>` with default charset/collation `utf8mb4` / `utf8mb4_0900_ai_ci`. Assemble a direct batch from canonical files in this exact order: `001_foundation.sql`, `002_auth.sql`, `reference_data.sql`, then `003_donors.sql`. Use `--skip-force --execute` and require a zero process exit code; never rely on interactive/nested `SOURCE` to stop after an error. Keep this verification schema separate from the existing development database.

```powershell
$donorTestSchema = 'bddc_phase3_test_donor_20261020_review'
if ($donorTestSchema -notmatch '^bddc_phase3_test_donor_[a-z0-9_]+$') { throw 'Choose a valid donor disposable-schema name.' }
$createTestSchemaSql = "CREATE DATABASE $donorTestSchema CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;"
& $mysqlExe --host=127.0.0.1 --port=3306 --user=$schemaUser --password --skip-force --execute="$createTestSchemaSql"
$mysqlExitCode = $LASTEXITCODE
if ($mysqlExitCode -ne 0) { throw 'Disposable schema creation failed; choose a new unused name and inspect before retrying.' }

$donorTestSql = @(
  "USE $donorTestSchema;"
  "SET time_zone = '+05:30';"
  (Get-Content -Raw -ErrorAction Stop .\database\migrations\001_foundation.sql)
  (Get-Content -Raw -ErrorAction Stop .\database\migrations\002_auth.sql)
  (Get-Content -Raw -ErrorAction Stop .\database\seeds\reference_data.sql)
  (Get-Content -Raw -ErrorAction Stop .\database\migrations\003_donors.sql)
) -join "`n"
& $mysqlExe --host=127.0.0.1 --port=3306 --user=$schemaUser --password --skip-force --execute="$donorTestSql"
$mysqlExitCode = $LASTEXITCODE
if ($mysqlExitCode -ne 0) { throw 'Disposable schema assembly failed; inspect that disposable schema before retrying.' }
```

Run `verify-donors.mjs` only against that explicitly selected loopback disposable schema. It requires SELECT, INSERT, UPDATE, and DELETE privileges scoped to that disposable schema; these test privileges are separate from both migration setup privileges and the routine application account. If `backend/.env` is absent, explicitly set `DB_HOST` and `DB_PORT` as in the earlier verifier example. The script uses `PHASE3_DONOR_TEST_DATABASE` for its required target name and the established temporary `PHASE3_TEST_DB_USER` / `PHASE3_TEST_DB_PASSWORD` overrides. Always clear temporary credentials in `finally`.

The donor verifier checks the exact Donor metadata, indexes, and restrictive FKs; creates at least ten pairs using synthetic `PENDING` DONOR accounts and an intentionally unusable password-hash marker; exercises nulls, shared phone values, differing reported/confirmed groups, duplicate profiles, missing parents, restrictive deletes, and timestamp defaults/update behavior; then rolls back the whole transaction. These are disposable verifier fixtures, not usable login accounts or permanent shared seeds. It reports success only after rollback and connection cleanup succeed. On any verification or cleanup failure it exits nonzero and prints only a safe stage/label and sanitized code. The verifier never applies migrations, creates/drops schemas, prints connection settings, or targets the ordinary development database.

The verifier checks the exact table/column order and types, NOT NULL, defaults, physical primary-key type/name/column, named unique/check constraints, case-sensitive role/status/group constraints, unique email/reference data, timestamps without automatic update behavior, InnoDB, the eight exact group IDs/codes/names, all nine role/status combinations, and negative cases. Each negative case must produce its expected MySQL code (`ER_DUP_ENTRY`, `ER_BAD_NULL_ERROR`, `ER_CHECK_CONSTRAINT_VIOLATED`, or `ER_NO_SUCH_TABLE`). A different code—including permission, connection, or syntax errors—or unexpected success fails verification. It reports safe case labels and MySQL error codes; raw driver details are suppressed.

### DonationSlot, Booking, and EligibilityDecision apply and verification

Migration `005_eligibility_booking.sql` creates only `DonationSlot`, `Booking`, and `EligibilityDecision`, in that dependency order. For an existing development schema, inspect it and confirm its Account, Donor, and BloodGroup prerequisites are present and the three target tables are absent; then apply **only 005**. Do not rerun the foundation runner. User-reported results described above record successful application and disposable verification; the commands below document the reviewed setup path.

From the repository root, apply 005 as a direct batch and check the client exit code:

```powershell
$mysqlExe = (Get-Command mysql.exe -ErrorAction Stop).Source
$schemaUser = Read-Host 'Local schema setup user'
$eligibilityBookingSql = Get-Content -Raw -ErrorAction Stop .\database\migrations\005_eligibility_booking.sql
& $mysqlExe --host=127.0.0.1 --port=3306 --user=$schemaUser --password --database=blood_donation_coordination --skip-force --execute="$eligibilityBookingSql"
$mysqlExitCode = $LASTEXITCODE
if ($mysqlExitCode -ne 0) { throw 'Eligibility/booking migration failed; inspect the schema before retrying.' }
```

For a fresh loopback disposable schema, use a new name matching `bddc_phase3_test_booking_<label>`. Hospital migration 004 is not required. Read the canonical files with `-ErrorAction Stop` before invoking the client; assemble and execute them in this exact order: 001, 002, `reference_data.sql`, 003, then 005. The example creates a new disposable schema, applies the modules as one checked batch, and refuses to overwrite an existing schema:

```powershell
$mysqlExe = (Get-Command mysql.exe -ErrorAction Stop).Source
$schemaUser = Read-Host 'Local schema setup user'
$testSchema = 'bddc_phase3_test_booking_20261023_review'
if ($testSchema -notmatch '^bddc_phase3_test_booking_[a-z0-9_]+$') { throw 'Choose a valid booking disposable-schema name.' }
$moduleSql = @(
  (Get-Content -Raw -ErrorAction Stop .\database\migrations\001_foundation.sql)
  (Get-Content -Raw -ErrorAction Stop .\database\migrations\002_auth.sql)
  (Get-Content -Raw -ErrorAction Stop .\database\seeds\reference_data.sql)
  (Get-Content -Raw -ErrorAction Stop .\database\migrations\003_donors.sql)
  (Get-Content -Raw -ErrorAction Stop .\database\migrations\005_eligibility_booking.sql)
)
$batchSql = @(
  "CREATE DATABASE $testSchema CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;"
  "USE $testSchema;"
  "SET time_zone = '+05:30';"
  $moduleSql
) -join "`n"
& $mysqlExe --host=127.0.0.1 --port=3306 --user=$schemaUser --password --skip-force --execute="$batchSql"
$mysqlExitCode = $LASTEXITCODE
if ($mysqlExitCode -ne 0) { throw 'Disposable schema assembly failed; inspect that disposable schema before retrying.' }
```

Run `database/tests/verify-eligibility-booking.mjs` with `PHASE3_BOOKING_TEST_DATABASE` set to that exact schema name and the established temporary `PHASE3_TEST_DB_USER` / `PHASE3_TEST_DB_PASSWORD` values. Set `DB_HOST=127.0.0.1` and `DB_PORT=3306` explicitly if the private backend environment file is absent. Use a disposable-only identity with the required schema DML and metadata-read privileges; never use the verifier against the development database. Clear temporary credential environment variables in `finally` as in the existing verifier examples. The verifier inserts synthetic Account/Donor prerequisites and at least ten records in each of the three new tables in a rollback-only transaction. A pass checks storage constraints and safe expected SQL errors only; it does not verify concurrency, capacity races, overlapping bookings, authorization, eligibility calculations, or lifecycle workflows.

The later bounded application milestone resolves booking evaluation at the selected appointment's IST date, `REVIEW_REQUIRED` blocking until superseded, and inclusive temporary deferral; see `../docs/eligibility-booking.md`. Its service implements the specified capacity, donor overlap, schedule-edit, current Account/session, eligibility and cancellation rules with database-free checks. The DDL and this storage verifier alone do not implement or verify those rules, and real MySQL concurrency/failure and staff attendance transitions remain pending.

### Donation apply and verification

Migration `006_donations.sql` creates only `Donation` and depends on Account and Booking; the fresh sequence is 001, 002, `reference_data.sql`, 003, 005, then 006. Migration 004 Hospital is not required. For an existing development schema, inspect the target and confirm Account, Booking, and the other required dependencies exist and `Donation` is absent, then apply **only 006**. Do not rerun the foundation runner. User-run evidence reported 2026-10-24 records successful disposable verification and application to the development schema; this verifies Donation storage only.

From the repository root, apply 006 to the inspected development schema as a direct batch and check the client exit code:

```powershell
$mysqlExe = (Get-Command mysql.exe -ErrorAction Stop).Source
$schemaUser = Read-Host 'Local schema setup user'
$donationSql = Get-Content -Raw -ErrorAction Stop .\database\migrations\006_donations.sql
& $mysqlExe --host=127.0.0.1 --port=3306 --user=$schemaUser --password --database=blood_donation_coordination --skip-force --execute="$donationSql"
$mysqlExitCode = $LASTEXITCODE
if ($mysqlExitCode -ne 0) { throw 'Donation migration failed; inspect the schema before retrying.' }
```

For a fresh loopback disposable schema, use a new name matching `bddc_phase3_test_donation_<label>`. Read every canonical SQL file successfully before invoking MySQL, then execute this exact order as one checked batch; 004 is omitted:

```powershell
$mysqlExe = (Get-Command mysql.exe -ErrorAction Stop).Source
$schemaUser = Read-Host 'Local schema setup user'
$donationTestSchema = 'bddc_phase3_test_donation_20261024_review'
if ($donationTestSchema -notmatch '^bddc_phase3_test_donation_[a-z0-9_]+$') { throw 'Choose a valid Donation disposable-schema name.' }
$modules = @(
  (Get-Content -Raw -ErrorAction Stop .\database\migrations\001_foundation.sql)
  (Get-Content -Raw -ErrorAction Stop .\database\migrations\002_auth.sql)
  (Get-Content -Raw -ErrorAction Stop .\database\seeds\reference_data.sql)
  (Get-Content -Raw -ErrorAction Stop .\database\migrations\003_donors.sql)
  (Get-Content -Raw -ErrorAction Stop .\database\migrations\005_eligibility_booking.sql)
  (Get-Content -Raw -ErrorAction Stop .\database\migrations\006_donations.sql)
)
$batchSql = @(
  "CREATE DATABASE $donationTestSchema CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;"
  "USE $donationTestSchema;"
  "SET time_zone = '+05:30';"
  $modules
) -join "`n"
& $mysqlExe --host=127.0.0.1 --port=3306 --user=$schemaUser --password --skip-force --execute="$batchSql"
$mysqlExitCode = $LASTEXITCODE
if ($mysqlExitCode -ne 0) { throw 'Disposable schema assembly failed; inspect that disposable schema before retrying.' }
```

Run `database/tests/verify-donations.mjs` with `PHASE3_DONATION_TEST_DATABASE` set to the exact disposable name and the established temporary `PHASE3_TEST_DB_USER` / `PHASE3_TEST_DB_PASSWORD` overrides. Explicitly set `DB_HOST=127.0.0.1` and `DB_PORT=3306`; the verifier refuses non-loopback hosts and has no development-database default. The test identity needs schema-scoped SELECT, INSERT, and DELETE privileges plus sufficient `INFORMATION_SCHEMA` visibility to inspect the target metadata; it is separate from migration setup and routine application identities. Clear temporary credential variables in `finally`, restoring prior host/port values as in the existing examples.

User-run evidence reported 2026-10-24: fresh disposable schema `bddc_phase3_test_donation_20261024_first` was assembled in order 001, 002, reference data, 003, 005, 006. `verify-donations.mjs` passed all 31 negative checks; ten synthetic Donation fixtures and their prerequisites rolled back successfully, and the connection closed. Development preflight found Account, BloodGroup, Donor, DonationSlot, Booking, and EligibilityDecision present with Donation absent; applying only `006_donations.sql` to `blood_donation_coordination` completed successfully. These are user-run results, not queries or actions performed by this documentation update.

The verifier checks exact Donation columns, defaults, primary/unique keys, indexes, InnoDB/collation, named CHECK/FK constraints, referenced columns, FK ordinals, and restrictive actions. CHECK behavior is verified by permitted outcome/release pairs and negative SQL cases; no CHECK-expression text normalizer is used. Ten Donation fixtures and their synthetic Account, Donor, DonationSlot, and Booking prerequisites are inserted inside one transaction and rolled back. The synthetic accounts use an unusable hash marker and are disposable fixtures, not usable logins or permanent seeds. Success is printed only after rollback and connection cleanup both succeed. The checks do not implement or verify actor authorization, day-of eligibility, lifecycle transitions, timestamp policy, corrections, concurrency, or atomic/idempotent BloodUnit creation. Recording any Donation outcome creates no unit; approval/unit creation and its atomicity/idempotency require later service work after inventory and audit schema exist.

### BloodUnit apply and verification

Migration `007_inventory.sql` creates only BloodUnit and depends on Donation plus the eight canonical BloodGroup reference rows. The fresh dependency order is 001, 002, `reference_data.sql`, 003, 005, 006, then 007; 004 Hospital is not required. User-run results reported 2026-10-24 verify 007 storage in the disposable schema and `blood_donation_coordination`. For any other developer database, preflight that Account, BloodGroup, Donor, DonationSlot, Booking, EligibilityDecision, and Donation exist and BloodUnit is absent; then apply **only 007**, once. Do not reapply 007 to the already verified `blood_donation_coordination` schema or rerun the foundation runner.

Use the schema migration/setup identity, separately scoped from both the verifier identity and the runtime application identity. The migration identity must be authorized for the reviewed DDL in the selected schema; do not grant DDL privileges to the application account. The disposable verifier uses the established temporary test identity with only the required schema-scoped verification/data privileges and sufficient metadata visibility. Runtime application privileges will be specified during application preparation and are not established by these migration instructions.

For a developer schema where preflight confirms BloodUnit is absent, apply only 007 from the repository root as a direct batch and check the client exit code. The current user-verified `blood_donation_coordination` schema already contains BloodUnit; do not execute this example against it again:

```powershell
$mysqlExe = (Get-Command mysql.exe -ErrorAction Stop).Source
$schemaUser = Read-Host 'Local schema setup user'
$developmentSchema = Read-Host 'Preflighted local schema where BloodUnit is absent'
$inventorySql = Get-Content -Raw -ErrorAction Stop .\database\migrations\007_inventory.sql
& $mysqlExe --host=127.0.0.1 --port=3306 --user=$schemaUser --password --database=$developmentSchema --skip-force --execute="$inventorySql"
$mysqlExitCode = $LASTEXITCODE
if ($mysqlExitCode -ne 0) { throw 'BloodUnit migration failed; inspect the schema before retrying.' }
```

For a new loopback disposable schema, choose a unique name matching `bddc_phase3_test_inventory_<label>`. Read all canonical files successfully before invoking MySQL; then assemble in the listed order as one checked batch. This setup is separate from the disposable verifier and application account:

```powershell
$mysqlExe = (Get-Command mysql.exe -ErrorAction Stop).Source
$schemaUser = Read-Host 'Local schema setup user'
$inventoryTestSchema = 'bddc_phase3_test_inventory_review'
if ($inventoryTestSchema -notmatch '^bddc_phase3_test_inventory_[a-z0-9_]+$') { throw 'Choose a valid inventory disposable-schema name.' }
$modules = @(
  (Get-Content -Raw -ErrorAction Stop .\database\migrations\001_foundation.sql)
  (Get-Content -Raw -ErrorAction Stop .\database\migrations\002_auth.sql)
  (Get-Content -Raw -ErrorAction Stop .\database\seeds\reference_data.sql)
  (Get-Content -Raw -ErrorAction Stop .\database\migrations\003_donors.sql)
  (Get-Content -Raw -ErrorAction Stop .\database\migrations\005_eligibility_booking.sql)
  (Get-Content -Raw -ErrorAction Stop .\database\migrations\006_donations.sql)
  (Get-Content -Raw -ErrorAction Stop .\database\migrations\007_inventory.sql)
)
$batchSql = @(
  "CREATE DATABASE $inventoryTestSchema CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;"
  "USE $inventoryTestSchema;"
  "SET time_zone = '+05:30';"
  $modules
) -join "`n"
& $mysqlExe --host=127.0.0.1 --port=3306 --user=$schemaUser --password --skip-force --execute="$batchSql"
$mysqlExitCode = $LASTEXITCODE
if ($mysqlExitCode -ne 0) { throw 'Disposable schema assembly failed; inspect that disposable schema before retrying.' }
```

Run `database/tests/verify-inventory.mjs` with `PHASE3_INVENTORY_TEST_DATABASE` set to the exact disposable schema and temporary `PHASE3_TEST_DB_USER` / `PHASE3_TEST_DB_PASSWORD` overrides. Explicitly set `DB_HOST=127.0.0.1` and `DB_PORT=3306`; the verifier has no development-database default and refuses non-loopback hosts. Its test identity requires schema-scoped SELECT/INSERT/DELETE and sufficient `INFORMATION_SCHEMA` visibility. Keep temporary test credentials separate from setup and runtime credentials and clear temporary environment values in `finally`.

User-run evidence reported 2026-10-24: `bddc_phase3_test_inventory_20261024_first` was assembled in order 001, 002, reference data, 003, 005, 006, 007. `verify-inventory.mjs` passed all 16 negative checks; ten synthetic BloodUnit fixtures and their prerequisites rolled back successfully, and the connection closed. Development preflight found all seven prerequisites (Account, BloodGroup, Donor, DonationSlot, Booking, EligibilityDecision, Donation) present and BloodUnit absent; applying only `007_inventory.sql` to `blood_donation_coordination` succeeded. A subsequent read-only `SHOW CREATE TABLE` confirmed the expected BloodUnit columns, keys, foreign keys, CHECK constraints, and engine. An accidental second invocation failed authentication with `using password: NO` before SQL execution; it is not evidence of a successful migration-rerun guard. These are user-run results, not actions or queries performed by this documentation update.

The verifier checks exact columns/defaults/collations, engine, keys, indexes, enforced CHECK metadata and behavior, FK columns/ordinals/actions, and specific negative SQL error codes. It inserts at least ten synthetic BloodUnit rows plus synthetic Account/Donor/slot/booking/approved Donation prerequisites in one transaction, then requires rollback and connection cleanup before success. These fixtures are disposable, are not usable login accounts, and do not count toward permanent ten-row sample-data targets.

Migration 007 stores BloodUnit rows only. It does not create units from Donation approval or validate actor authorization, confirmed blood group, expiry against source collection date, shelf-life calculation, allocation, issue, discard/expiry workflows, transitions, concurrency, or audit writes. Approval and unit creation must eventually be atomic and idempotent once the required audit infrastructure exists. The candidate index has not been validated with `EXPLAIN`; defer the optional broad expiry-scan index until query evidence supports it.

### Available inventory view

`database/views/available_inventory.sql` contains only the plain `CREATE SQL SECURITY INVOKER VIEW v_available_inventory_by_group`. It exposes `blood_group_id`, `code`, `display_name`, and `available_unit_count`; each returned group has at least one unit whose status is `AVAILABLE`, whose `expiry_date` is strictly later than the MySQL session's `CURRENT_DATE()`, and whose source Donation is `COLLECTED` and `APPROVED`. It omits groups with zero qualifying units and makes no row-order promise. The caller supplies any `ORDER BY`. The view does not filter `BloodGroup.is_active` or `expired_at`, and it does not perform allocation or expiry transitions.

User-run results reported 2026-10-24 verify the grouped read-only view milestone. Disposable schema `bddc_phase3_test_inventory_view_20261024_first` was assembled in order 001, 002, reference data, 003, 005, 006, 007, then `database/views/available_inventory.sql`. `verify-available-inventory.mjs` passed its 14 fixture cases, metadata checks, exact group counts, and date-boundary checks; fixtures were rolled back, the view was empty afterward, and the connection closed successfully. Development preflight found eight base tables and the view absent; applying only `database/views/available_inventory.sql` to `blood_donation_coordination` completed successfully. These are user-reported results, not MySQL actions performed by this documentation update. This verifies only the grouped read-only view. It does not verify application-account access, APIs, reports/screens, approval/unit creation, allocation, expiry transitions, audit writes, or concurrency.

For any future local application, preflight the 001/002/reference-data/003/005/006/007 dependencies and confirm that the view name is absent. Apply only the view file once; do not reapply migrations or use the foundation runner:

```powershell
$mysqlExe = (Get-Command mysql.exe -ErrorAction Stop).Source
$schemaUser = Read-Host 'Local schema setup user'
$developmentSchema = Read-Host 'Preflighted local schema with inventory prerequisites and no view'
$viewSql = Get-Content -Raw -ErrorAction Stop .\database\views\available_inventory.sql
& $mysqlExe --host=127.0.0.1 --port=3306 --user=$schemaUser --password --database=$developmentSchema --skip-force --execute="$viewSql"
$mysqlExitCode = $LASTEXITCODE
if ($mysqlExitCode -ne 0) { throw 'Available inventory view creation failed; inspect the schema before retrying.' }
```

For a fresh disposable schema, create a new loopback name matching `bddc_phase3_test_inventory_view_<label>`. The required dependency order is 001, 002, reference data, 003, 005, 006, 007, then `database/views/available_inventory.sql`; 004 Hospital is not required. This complete batch reads every canonical file before invoking MySQL, creates only the explicitly named disposable schema, and checks the client exit code:

```powershell
$mysqlExe = (Get-Command mysql.exe -ErrorAction Stop).Source
$schemaUser = Read-Host 'Local disposable-schema setup user'
$viewTestSchema = 'bddc_phase3_test_inventory_view_review'
if ($viewTestSchema -notmatch '^bddc_phase3_test_inventory_view_[a-z0-9_]+$') { throw 'Choose a valid inventory-view disposable-schema name.' }
$modules = @(
  (Get-Content -Raw -ErrorAction Stop .\database\migrations\001_foundation.sql)
  (Get-Content -Raw -ErrorAction Stop .\database\migrations\002_auth.sql)
  (Get-Content -Raw -ErrorAction Stop .\database\seeds\reference_data.sql)
  (Get-Content -Raw -ErrorAction Stop .\database\migrations\003_donors.sql)
  (Get-Content -Raw -ErrorAction Stop .\database\migrations\005_eligibility_booking.sql)
  (Get-Content -Raw -ErrorAction Stop .\database\migrations\006_donations.sql)
  (Get-Content -Raw -ErrorAction Stop .\database\migrations\007_inventory.sql)
  (Get-Content -Raw -ErrorAction Stop .\database\views\available_inventory.sql)
)
$batchSql = @(
  "CREATE DATABASE $viewTestSchema CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;"
  "USE $viewTestSchema;"
  "SET time_zone = '+05:30';"
  $modules
) -join "`n"
& $mysqlExe --host=127.0.0.1 --port=3306 --user=$schemaUser --password --skip-force --execute="$batchSql"
$mysqlExitCode = $LASTEXITCODE
if ($mysqlExitCode -ne 0) { throw 'Inventory-view disposable schema assembly failed; inspect that disposable schema before retrying.' }
```

Run the verifier with `PHASE3_INVENTORY_VIEW_TEST_DATABASE` set to that exact disposable schema, plus temporary `PHASE3_TEST_DB_USER` and `PHASE3_TEST_DB_PASSWORD` values. Set `DB_HOST=127.0.0.1` and `DB_PORT=3306` explicitly when needed; the verifier refuses non-loopback hosts and has no development-database default. It inspects an already-created view and never executes DDL. Before writes it requires all seven operational tables to be empty and the exact canonical eight BloodGroup rows; it refuses a populated target without deleting anything. Its synthetic Account/Donor/slot/booking/Donation/BloodUnit fixtures are transaction-only storage-level cases, not usable login accounts or permanent seeds. The verifier compares exact rows, including tomorrow as included and today/yesterday as excluded, and fails with a controlled diagnostic if the MySQL session date changes. Success requires rollback, an empty view result afterward, and successful connection closure.

Keep privileges separate by purpose. The setup identity needs `CREATE VIEW` authorization and `SELECT` on the referenced tables to define the view. The verifier identity needs schema-scoped `SELECT`, `INSERT`, and `DELETE` for rollback-only fixture checks, `SHOW VIEW`, and sufficient metadata visibility to inspect view columns/security and prerequisite objects. The runtime identity is a separate application concern: because the view is `SQL SECURITY INVOKER`, the invoker must have applicable `SELECT` rights on the view and its underlying relations. These instructions do not change or broaden any grants.

This read-only view does not require audit writes and does not establish application authentication or API/UI behavior. Donation approval/unit creation, allocation, expiry updates/events, audit integration, concurrency, permanent sample data and other Phase 3 deliverables remain pending. The view adds no domain entity. At that storage/view checkpoint six logical entities remained; later Hospital and AuditEvent authoring/application evidence is separated in the current boundary above. The bounded audit foundation does not make the pending inventory workflows or expiry task implemented.

### Donor and inventory SQL-query demonstrations

`database/queries/donor_inventory.sql` contains seven uniquely marked, parameterized read-only SELECT templates. It is not a migration and must not be applied wholesale as a setup batch. Each marker is `-- query: <name>` and is followed by query-specific parameter order, returned columns, null-filter behavior, and ordering/date semantics. The verifier reads these sections directly, rejects missing/duplicate/unexpected query names, checks placeholder counts, and executes the extracted statements through `mysql2`; it does not duplicate their SQL and performs no DDL.

| Query | Parameters and behavior |
|---|---|
| `donor-donation-history` | Donor account ID; optional inclusive lower and exclusive upper `collected_at` DATETIME bounds. With a bound, rows having NULL `collected_at` are excluded. Returns only safe donor name and booking/slot/donation history fields, ordered newest collection first with donation ID tie-break. |
| `blood-unit-traceability` | BloodUnit ID. Returns group, unit state/expiry, source donation/booking/donor IDs, collection time, and release status; missing IDs return no rows. No credentials, contact fields, or detailed medical data. |
| `donation-search` | Optional donor account ID, outcome, lower `collected_at` DATETIME, upper `collected_at` DATETIME. Each optional argument is bound twice (NULL or the filter value). DATETIME range is lower-inclusive/upper-exclusive; bounded searches exclude NULL collection times. One row per Donation, newest collection first with ID tie-break. |
| `inventory-search` | Optional blood group ID, unit status, lower expiry DATE, upper expiry DATE. Each optional argument is bound twice. Both DATE bounds are inclusive; all stored unit statuses remain eligible for this general search. Ordered by expiry, group, then unit ID. |
| `donation-outcome-counts` | Optional lower-inclusive/upper-exclusive collection DATETIME bounds, each bound parameter is bound twice. Groups exact outcome codes; when either bound is supplied, NULL collection times are excluded. |
| `inventory-status-counts` | No parameters. Counts by blood group and exact unit status; zero-row groups are absent. |
| `approved-collection-to-release-duration` | No parameters. Counts COLLECTED/APPROVED donations with both timestamps and averages elapsed seconds divided by 3600.0. Empty input yields count zero and NULL average. |

Together these statements demonstrate multi-table joins, traceability across normalized records, parameterized optional filtering, inclusive/exclusive temporal ranges, `COUNT`/`GROUP BY`, and fractional-hour `AVG`. They are educational query demonstrations for Thulasi's donor/donation/inventory modules, not Lathikaa's report APIs or dashboards. Executing SELECT statements does not provide application-level authorization: future request ownership must be derived from the authenticated server session, with role and resource checks enforced by the API. These queries do not implement authentication, authorization, UI, workflow mutations, allocation, or concurrency.

The query verifier requires an explicitly selected loopback schema named `bddc_phase3_test_donor_inventory_queries_<label>` through `PHASE3_DONOR_INVENTORY_QUERY_TEST_DATABASE`; it has no development-database default. Fresh disposable assembly is exactly 001, 002, reference data, 003, 005, 006, 007. It does not depend on Hospital migration 004 or the availability view. This PowerShell example reads every file successfully before invoking MySQL and applies only that dependency sequence to a new schema; `CREATE DATABASE` fails if the name already exists:

```powershell
$mysqlExe = (Get-Command mysql.exe -ErrorAction Stop).Source
$schemaUser = Read-Host 'Local disposable-schema setup user'
$queryTestSchema = 'bddc_phase3_test_donor_inventory_queries_review'
if ($queryTestSchema -notmatch '^bddc_phase3_test_donor_inventory_queries_[a-z0-9_]+$') { throw 'Choose a valid donor/inventory-query disposable-schema name.' }
$modules = @(
  (Get-Content -Raw -ErrorAction Stop .\database\migrations\001_foundation.sql)
  (Get-Content -Raw -ErrorAction Stop .\database\migrations\002_auth.sql)
  (Get-Content -Raw -ErrorAction Stop .\database\seeds\reference_data.sql)
  (Get-Content -Raw -ErrorAction Stop .\database\migrations\003_donors.sql)
  (Get-Content -Raw -ErrorAction Stop .\database\migrations\005_eligibility_booking.sql)
  (Get-Content -Raw -ErrorAction Stop .\database\migrations\006_donations.sql)
  (Get-Content -Raw -ErrorAction Stop .\database\migrations\007_inventory.sql)
)
$batchSql = @(
  "CREATE DATABASE $queryTestSchema CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;"
  "USE $queryTestSchema;"
  "SET time_zone = '+05:30';"
  $modules
) -join "`n"
& $mysqlExe --host=127.0.0.1 --port=3306 --user=$schemaUser --password --skip-force --execute="$batchSql"
$mysqlExitCode = $LASTEXITCODE
if ($mysqlExitCode -ne 0) { throw 'Donor/inventory query schema assembly failed; inspect that disposable schema before retrying.' }
```

The verifier requires empty operational tables and the canonical eight BloodGroup rows, inserts synthetic prerequisites and fixtures in one transaction, and requires rollback, post-rollback empty-table checks, and connection closure before success. Its synthetic accounts are not usable logins or permanent sample data.

Run `database/tests/verify-donor-inventory-queries.mjs` with `PHASE3_DONOR_INVENTORY_QUERY_TEST_DATABASE` set to the exact disposable schema and temporary `PHASE3_TEST_DB_USER` / `PHASE3_TEST_DB_PASSWORD` overrides. Set `DB_HOST=127.0.0.1` and `DB_PORT=3306` explicitly when needed. The verifier session uses `+05:30`. Use a disposable-only account with the required schema `SELECT` and `INSERT` privileges; rollback cleans up fixture writes without issuing DELETE. Setup and verifier identities remain separate, and no grants are changed by these instructions.

User-run results reported 2026-10-24: disposable schema `bddc_phase3_test_donor_inventory_queries_20261024_first` was assembled from 001, 002, reference data, 003, 005, 006, and 007. `verify-donor-inventory-queries.mjs` passed all seven canonical queries and their fixture assertions, covering donor isolation, traceability, optional filters, ordering, date boundaries, grouped counts, fractional-hour averages, and empty results. Synthetic fixtures were rolled back, post-rollback empty-state checks passed, and the connection closed successfully. This verifies only these SQL demonstrations and their disposable-fixture checks. It does not verify application authorization, APIs, reports/screens, authentication, workflow mutations, or concurrency. These are user-provided database results; this documentation update did not connect to MySQL.

## Rerun and failure behavior

The migrations and seed intentionally use plain `CREATE TABLE` and `INSERT`, with no `IF NOT EXISTS`, `INSERT IGNORE`, upsert, or destructive cleanup. This makes schema drift and duplicate reference data visible. Before writes, the guarded runner requires an explicit empty-schema confirmation, directly verifiable global metadata-visibility grants, and zero tables/views, routines, triggers, and events. It fails clearly before writes if visibility cannot be established. Setup succeeds once. A complete rerun is rejected by the empty-schema guard before any SQL is applied; applying a migration directly also fails at the existing table. Existing rows are not overwritten or removed. If setup fails partway, stop and inspect the disposable schema; do not blindly rerun on a populated/project database or remove data to make it pass. For verification/reproduction, create a fresh disposable schema and apply the checked-in setup sequence again.

Use the existing `mysql2` dependency for setup and verification; no migration framework is added. Unexpected SQL errors produce nonzero process exits. The verifier's intentional invalid statement demonstrates that SQL errors are observed; always follow setup with the verifier against a disposable schema before claiming database verification.

## Module ownership, numbering, and dependency order

SQL migrations and reviewed seeds in Git are the shared schema source. Local-only schema edits are not authoritative. Coordinate migration numbers and shared objects before editing; one migration number is assigned to one reviewed unit of schema change, with no concurrent reuse.

| Reserved number | Module | Owner / dependency |
|---:|---|---|
| 001 | Shared foundation + `BloodGroup` | Coordinated; Thulasi implements this bounded foundation. |
| 002 | `Account` | Thulasi (Authentication & Role Access); depends on foundation. |
| 003 | `Donor` | Thulasi; depends on Account and BloodGroup. |
| 004 | `Hospital` | Lathikaa; depends on Account. |
| 005 | `DonationSlot`, `Booking`, and `EligibilityDecision` | Thulasi; depends on Account, Donor, and BloodGroup reference data. 004 Hospital is not a dependency. |
| 006 | `Donation` | Thulasi; depends on Booking and Account. |
| 007 | `BloodUnit` storage only (user-run verified 2026-10-24) | Thulasi; depends on Donation and BloodGroup. Inventory lifecycle is later work. |
| 008 | `HospitalRequest` and row-local creation/update guards | Lathikaa; authored/disposable-verified; depends on Hospital, Account and BloodGroup. No history/Allocation/AuditEvent objects created. |
| 009 | `BloodCompatibility` and `Allocation` | Lathikaa; depends on BloodGroup, BloodUnit, HospitalRequest. Includes the directed 64-pair matrix under the documented RBC model. |
| 010 | `AuditEvent` only | Integrated Account-only dependency amendment; Lathikaa retains ownership. Thulasi's local installation/structure/read access has USER-RUN evidence dated 2026-10-25. Fresh reviewed assembly may apply it after 002 and before 008. No history/trigger or operational workflow is included. |
| 011 | Views/reports and deferred routines/expiry integration | Coordinated after referenced tables and audit/history dependencies exist. |
| 012 | `RequestStatusHistory` and `trg_request_status_history_update` | Lathikaa; approved 2026-10-27 and authored in migrations/012_request_status_history.sql. Depends on 002/008; creation additionally requires 010. Human actor + controlled reason required; no UUID-only system bypass. Disposable verified; development installation remains manual. |

Reserved numbers are not an instruction to execute every file numerically or a claim that placeholders are implemented. Request history is now reserved as 012 after current branch/remote-ref review. Apply 012 after 002/008; request creation also requires 010. Any 011 report that references history must follow 012 even though numbering differs. Foundation setup remains unchanged and never automatically installs 010/012 or placeholders. See the manual activation runbook; do not rerun already installed objects.

Each developer applies reviewed SQL to their own local DB after syncing reviewed work. Do not apply another developer's unfinished local branch changes or routinely share database instances. Setup/seed order follows dependencies; later account/profile fixtures depend on the associated profile tables. Audit/history infrastructure must accompany the first operations that require them, even if their screens are later. See [team workflow](../docs/team-workflow.md) for branches, PRs, and synchronization.

The explicitly coordinated pushed-checkpoint exchange documented in `team-workflow.md` is Git integration only. A Git merge does not execute SQL; each developer separately applies reviewed migrations to their own private local database after confirming the dependency order and target schema.

## Next dependencies for Lathikaa

- Foreign keys may use the stable `BloodGroup` IDs listed above once the foundation migration and seed have been applied locally.
- `Account` is the stable parent key for Hospital. Account existence alone cannot prove profile completeness; Lathikaa's later successful real Hospital registration/login/saved PENDING Profile in her environment is separate positive-flow evidence, not a full constraint/failure/concurrency or Admin verification.
- Thulasi's local AuditEvent installation/structure and application-account read access now have USER-RUN evidence. The shared Account backend now consumes the unchanged writer for controlled PENDING-to-ACTIVE approval and the backend-only ACTIVE-to-SUSPENDED/SUSPENDED-to-ACTIVE extension. See [exact mappings, authorization and database-free coverage](../docs/account-status-backend.md). Account updates, target-session tombstones and audit share one transaction; protected guards and profile-write transactions lock/revalidate the authoritative SID as well as Account state. No new SQL/schema/grants or setup step is introduced. The [bounded implementation](../docs/account-approval-backend.md) has historical database-free tests plus the separate USER-RUN Console approval/audit/fresh-login evidence linked above; deeper live concurrency/failure/security, multi-device, Hospital UI status and frontend checks remain pending. Separate [USER-RUN evidence reported 2026-10-27](../docs/account-status-backend.md#user-run-donor-status-cycle-evidence-reported-2026-10-27) records one Donor Console-driven cycle and Workbench confirmation of its exact audit counts/mappings, without verifying Hospital cycles, concurrency, rollback, multi-device revocation or all security cases. This documentation task executed no queries or mutations. Hospital management keeps status read-only; the shared Mint Account management page now implements all three exact controls using the same backend/schema; [fixture-based verification and a separate user-reported Donor page cycle](../docs/account-approval-frontend.md#user-run-account-management-ui-evidence-reported-2026-10-27) are documented; Hospital UI status and further live checks remain pending. The explicit 010 split above preserves existing numbers/ownership and does not authorize applying placeholders.
- Migration 009 creates one row per directed donor-group/recipient-group pair and the approved 64-pair reference matrix; it passed a fresh MySQL 8.0.39 disposable verifier. The bounded `reference_data.sql` seed intentionally remains limited to BloodGroup and does not insert compatibility rows.
- HospitalRequest (008), Allocation (009), RequestStatusHistory (012), and AuditEvent (010) now have separate storage artifacts. Allocation/issue/cancellation/expiry writes still require the jointly reviewed transaction and audit contracts before activation; do not run them through an unmounted or partial service.
- To reproduce, synchronize the reviewed migration and seed files, use a separate local schema, and apply only the approved assembled setup order. No shared or live database is the target.
