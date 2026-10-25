# Hospital storage milestone

## Status and boundary

Authored on branch `lathikaa` after confirming checkpoint `be0b775` is integrated and the working tree was clean. `database/migrations/004_hospitals.sql` was a zero-byte placeholder. The approved Account migration has an InnoDB `BIGINT UNSIGNED` primary key compatible with Hospital's shared key.

| Evidence | Status |
|---|---|
| Hospital DDL and dedicated verifier | Authored; source reviewed |
| Static checks | See the static verification record below |
| Disposable MySQL verification | Not executed by Codex; requires separately authorized target |
| Development schema | Lathikaa reports 004 applied with Account, Hospital and app_session present in her environment's blood_donation_coordination, and has demonstrated real Hospital registration/login with correct saved PENDING Profile. Full metadata/constraint/failure/concurrency verification remains separate |
| Development application of 004 | Lathikaa-environment user-reported execution; not executed or independently verified by Codex. Do not rerun 004 there |
| Thulasi's development schema/access (USER-RUN, 2026-10-25) | 004 applied; SHOW CREATE TABLE matched the approved eight-column schema/keys/FK; configured application-account Hospital SELECT passed. Existing database-level grants were observed without changes. See [separate evidence and limits](implementation-readiness.md#user-run-hospital-evidence-in-thulasis-environment-2026-10-25); the dedicated Hospital constraint verifier remains pending |
| Hospital Profile authorization/API | GET/PATCH `/api/hospitals/me` are mounted with shared session/current-account/HOSPITAL guards and PATCH CSRF. The original Profile checkpoint passed 70 isolated tests; later Admin-read checkpoint passed 108 backend/34 frontend tests. See [API contracts and read-only checks](hospital-profile-api.md) |
| Hospital registration | POST `/api/auth/register/hospitals` is implemented atomically in shared auth. The original registration checkpoint passed 92 isolated backend tests. No development records were created by implementation/testing; Lathikaa's real registration in her environment is separate evidence. See [registration contract](hospital-registration-api.md) |
| Hospital React UI | Registration, own Profile and Screen 24 Admin Hospital Management are implemented with scoped Mint Gauge, Sora headings and Nunito Sans body/controls; unrelated themes are preserved. No DDL, seeds or database-verifier changes are required |
| Admin APIs/UI | GET `/api/admin/hospitals` and GET `/api/admin/hospitals/:hospitalId` plus Screen 24 are implemented for ACTIVE ADMIN. Real status remains read-only; live Admin verification and Thulasi's shared audited Account approval/status workflow remain pending. See [Admin contracts and dependencies](admin-hospital-management.md) |

The eight columns match `database-design.md` and `relational-schema.md`. Hospital uses `account_id` as its non-generated shared PK and restrictive FK to Account, plus nullable unique `registration_number`. Text uses `utf8mb4_0900_ai_ci`; registration uniqueness therefore follows the existing case/accent-insensitive collation. Multiple NULL registration numbers are allowed. The timestamps default to current time; `updated_at` has no automatic update clause or trigger. Phone and organization name are not unique. NOT NULL does not reject empty strings; input normalization and business validation belong to later services.

The FK establishes Account existence only. Account role matching, Donor/Hospital exclusivity and atomic registration are shared service invariants rather than FK guarantees; the implemented registration service assigns HOSPITAL/PENDING and creates both rows transactionally. The original storage-only milestone changed no other domain tables, permanent seeds, APIs, screens, shared configuration or dependency files. Later Profile/registration/Admin-read integrations do not modify this DDL or its verifier. Thulasi's shared approval/status API requires durable AuditEvent infrastructure and verified CSRF/audit/revocation integration; no Hospital-only approval bypass is added.

## Development Workbench preflight (read-only)

Current update: Lathikaa's earlier installation evidence remains separate from Thulasi's USER-RUN 2026-10-25 evidence confirming successful 004 application and an approved-structure inspection in his environment. Use the post-application metadata queries below to inspect it; do not repeat CREATE TABLE or the earlier absence preflight as an application gate. The original before/after instructions are retained as a reproduction reference, not as a request to rerun migrations.

Run these queries yourself on the intended local connection. They do not apply a migration. Confirm the schema name below is your intended development schema before selecting it. Do not run any setup wrapper or rerun 001, 002, 003 or reference data in this database.

```sql
SELECT DATABASE() AS initially_selected_schema, VERSION() AS server_version;
USE blood_donation_coordination;
SELECT DATABASE() AS selected_schema, @@SESSION.sql_mode AS sql_mode;

SELECT TABLE_NAME, TABLE_TYPE, ENGINE, TABLE_COLLATION
FROM information_schema.TABLES
WHERE TABLE_SCHEMA = DATABASE()
ORDER BY TABLE_NAME;

SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_KEY, EXTRA
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
  AND LOWER(TABLE_NAME) IN ('account', 'donor')
ORDER BY TABLE_NAME, ORDINAL_POSITION;

SELECT TABLE_NAME, TABLE_TYPE
FROM information_schema.TABLES
WHERE TABLE_SCHEMA = DATABASE() AND LOWER(TABLE_NAME) = 'hospital';

SELECT TRIGGER_NAME, EVENT_OBJECT_TABLE
FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA = DATABASE();
SELECT ROUTINE_NAME, ROUTINE_TYPE
FROM information_schema.ROUTINES WHERE ROUTINE_SCHEMA = DATABASE();
SELECT EVENT_NAME, STATUS
FROM information_schema.EVENTS WHERE EVENT_SCHEMA = DATABASE();
```

For Lathikaa's user-reported installed schema, expect Account, Donor and Hospital to be existing InnoDB tables; Account.account_id is `bigint unsigned`, NOT NULL, primary key. The Hospital existence query should return its table row. Only the original pre-004 absence preflight expected zero rows; that historical gate does not apply to Lathikaa's installed database. Metadata is privilege-filtered: use an authorized schema inspection identity with adequate visibility. If prerequisites differ or visibility is insufficient, stop and inspect; do not recreate anything.

For original installation reproduction, these queries captured a before baseline in Workbench; they remain safe read-only comparison checks on the installed schema:

```sql
SHOW CREATE TABLE Account;
SHOW CREATE TABLE Donor;
SHOW CREATE TABLE BloodGroup;
SELECT 'Account' AS table_name, COUNT(*) AS row_count FROM Account
UNION ALL SELECT 'Donor', COUNT(*) FROM Donor
UNION ALL SELECT 'BloodGroup', COUNT(*) FROM BloodGroup;
```

Save these result tabs locally. Also save definitions and exact COUNT results for any other tables already present, using their names from the object inventory. Do not select account data or credentials. Compare in a quiet local session without concurrent application mutations; counts alone do not prove every row is unchanged.

## Original development application reference (do not rerun locally)

Lathikaa reports 004 installed in her environment, and Thulasi separately reports successful application on 2026-10-25. Do not execute it again in either installed database. These original instructions are retained only for separately reviewed/authorized reproduction in a schema lacking Hospital, not as a current setup step: review the complete canonical `database/migrations/004_hospitals.sql`, confirm the intended connection/schema and execute only that script. It contains one plain CREATE TABLE, no parent-table changes or data writes. Check Action Output before continuing. If an error occurs, stop and inspect; never drop/recreate a table or rerun setup to recover.

DDL is not rolled back by the verifier's transaction. An existing Hospital table intentionally makes plain CREATE TABLE fail. Do not use IF NOT EXISTS to conceal drift.

After successful application, run these read-only checks:

```sql
SHOW CREATE TABLE Hospital;
SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT, EXTRA,
       CHARACTER_SET_NAME, COLLATION_NAME
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE() AND LOWER(TABLE_NAME) = 'hospital'
ORDER BY ORDINAL_POSITION;
SELECT k.CONSTRAINT_NAME, k.COLUMN_NAME, k.REFERENCED_TABLE_NAME,
       k.REFERENCED_COLUMN_NAME, r.UPDATE_RULE, r.DELETE_RULE
FROM information_schema.KEY_COLUMN_USAGE k
LEFT JOIN information_schema.REFERENTIAL_CONSTRAINTS r
  ON r.CONSTRAINT_SCHEMA = k.CONSTRAINT_SCHEMA
 AND r.TABLE_NAME = k.TABLE_NAME AND r.CONSTRAINT_NAME = k.CONSTRAINT_NAME
WHERE k.CONSTRAINT_SCHEMA = DATABASE() AND LOWER(k.TABLE_NAME) = 'hospital';
SHOW INDEX FROM Hospital;
SELECT COUNT(*) AS hospital_rows FROM Hospital;
```

Expect exactly eight approved columns, no AUTO_INCREMENT or ON UPDATE, the PK on account_id, `uq_hospital_registration_number`, and `fk_hospital_account` with RESTRICT/RESTRICT. Zero Hospital rows was expected immediately after the original DDL-only installation; it is not the expected current state after the user's successful real registration. Preserve all current records. The before/after object/count comparison applies to that original installation boundary. Never run the fixture verifier on development.

## Disposable verification setup (separate authorization required)

Use a new, exclusively used loopback schema such as `bddc_phase3_test_hospital_20261024_review1`, maximum 64 characters. Confirm the exact target with the person authorizing database writes. Read-only existence check in Workbench:

```sql
SELECT SCHEMA_NAME FROM information_schema.SCHEMATA
WHERE SCHEMA_NAME = 'bddc_phase3_test_hospital_20261024_review1';
```

Expect zero rows. If it exists, inspect it and choose a new unused name; never overwrite it. This dedicated verifier accepts exactly Account, BloodGroup and Hospital, with Account/Hospital empty and the eight canonical group rows. An existing schema is usable only if it was separately authorized as disposable and meets these checks; it must not be the development schema or contain Donor/other domain objects.

After explicit authorization, in Workbench create only that fresh schema:

```sql
CREATE DATABASE bddc_phase3_test_hospital_20261024_review1
  CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
USE bddc_phase3_test_hospital_20261024_review1;
SET time_zone = '+05:30';
```

Open and execute each canonical file separately, checking Action Output before moving on: **001_foundation.sql, 002_auth.sql, seeds/reference_data.sql, 004_hospitals.sql**. This foundation application is only in the new disposable schema. Donor is not a Hospital dependency and is omitted here. Do not use the development setup wrapper.

Alternatively, the following PowerShell block from the repository root prepares that same fresh disposable schema after authorization. Choose one setup method, not both. Read all files before database creation; direct batch mode and checked exit status stop on SQL errors. The password is entered at the MySQL prompt, never embedded in an argument.

```powershell
$mysqlExe = (Get-Command mysql.exe -ErrorAction Stop).Source
$hospitalTestSchema = 'bddc_phase3_test_hospital_20261024_review1'
if ($hospitalTestSchema -cnotmatch '^bddc_phase3_test_hospital_[a-z0-9_]+$' -or $hospitalTestSchema.Length -gt 64) { throw 'Invalid disposable target.' }
$hospitalSetupSql = @(
  "CREATE DATABASE $hospitalTestSchema CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;"
  "USE $hospitalTestSchema;"
  "SET time_zone = '+05:30';"
  (Get-Content -Raw -ErrorAction Stop .\database\migrations\001_foundation.sql)
  (Get-Content -Raw -ErrorAction Stop .\database\migrations\002_auth.sql)
  (Get-Content -Raw -ErrorAction Stop .\database\seeds\reference_data.sql)
  (Get-Content -Raw -ErrorAction Stop .\database\migrations\004_hospitals.sql)
) -join "`n"
$hospitalSetupUser = Read-Host 'Authorized local disposable-schema setup user'
& $mysqlExe --host=127.0.0.1 --port=3306 --user=$hospitalSetupUser --password --skip-force --execute="$hospitalSetupSql"
if ($LASTEXITCODE -ne 0) { throw 'Disposable assembly failed; stop and inspect the exact target.' }
```

## Running the verifier (disposable schema only)

The verifier needs a disposable-only identity with a **direct ALL PRIVILEGES grant on this exact disposable schema**. This is deliberately limited to the test schema, rather than global visibility grants. It lets the verifier establish table/trigger/routine/event visibility before refusing unexpected objects. Ask the authorized database owner to arrange that test identity separately if needed; no grant/user changes are performed here. Do not reuse the development runtime account or broaden its privileges.

After setup and separate authorization for rollback-only test DML, run from the repository root:

```powershell
$hospitalTestSchema = 'bddc_phase3_test_hospital_20261024_review1'
$hospitalVariableNames = @('DB_HOST','DB_PORT','PHASE3_HOSPITAL_TEST_DATABASE',
  'PHASE3_HOSPITAL_TEST_EMPTY_DATABASE','PHASE3_TEST_DB_USER','PHASE3_TEST_DB_PASSWORD')
$hospitalPreviousValues = @{}
foreach ($name in $hospitalVariableNames) {
  $hospitalPreviousValues[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
}
try {
  $env:DB_HOST = '127.0.0.1'
  $env:DB_PORT = '3306'
  $env:PHASE3_HOSPITAL_TEST_DATABASE = $hospitalTestSchema
  $env:PHASE3_HOSPITAL_TEST_EMPTY_DATABASE = 'YES'
  $env:PHASE3_TEST_DB_USER = Read-Host 'Disposable-only verification user'
  $hospitalTestSecret = Read-Host 'Disposable-only verification password' -AsSecureString
  $env:PHASE3_TEST_DB_PASSWORD = [System.Net.NetworkCredential]::new('', $hospitalTestSecret).Password
  node .\database\tests\verify-hospitals.mjs
  if ($LASTEXITCODE -ne 0) { throw 'Hospital verification failed; inspect the safe stage/code.' }
} finally {
  foreach ($name in $hospitalVariableNames) {
    [Environment]::SetEnvironmentVariable($name, $hospitalPreviousValues[$name], 'Process')
  }
  $hospitalTestSecret = $null
  $hospitalPreviousValues.Clear()
}
```

The verifier does not import the backend environment loader, read private files, use DB_NAME or fall back to application credentials. It requires an explicit disposable name, confirmation flag, loopback host and disposable credentials. It checks strict SQL mode, enabled FK/unique checks, exact Hospital columns/defaults/collations/keys/FK/indexes, Account key compatibility, and absence of triggers/routines/events or unexpected tables/views before inserting fixtures.

It inserts ten synthetic Hospital profiles plus eleven synthetic Account prerequisites in one transaction, including two NULL registration numbers. It tests duplicate keys, registration uniqueness under the approved collation, all seven required NULLs, missing parents, restrictive parent update/delete, invalid IDs/dates, overlength text, defaults and explicit timestamp maintenance. Expected MySQL error codes must match; permissions or connection failures cannot count as constraint passes. Success is printed only after rollback, zero Account/Hospital counts and connection closure. It performs no DDL or commits; errors never print driver details, grants or credentials. Fixture accounts have unusable hash markers and are not login accounts or permanent sample data.

In Workbench on the disposable schema, independently run `SHOW CREATE TABLE Hospital`, the metadata queries above and:

```sql
USE bddc_phase3_test_hospital_20261024_review1;
SELECT DATABASE();
SELECT COUNT(*) AS account_rows FROM Account;
SELECT COUNT(*) AS hospital_rows FROM Hospital;
SELECT COUNT(*) AS reference_rows FROM BloodGroup;
```

Expect 0, 0 and 8 rows respectively after a successful run. Rollback removes fixtures, but Account AUTO_INCREMENT gaps can remain; this is why the verifier requires a disposable schema. Do not share it with concurrent writers.

No cleanup DDL is authorized or performed. Retain the disposable schema for review. If deletion is later explicitly authorized, reconfirm its exact name, loopback connection, zero fixture counts and disposable ownership in Workbench before using **Drop Schema** on that exact schema only. Never select the development schema or issue wildcard/bulk cleanup. A failed DDL setup may leave objects because MySQL DDL implicitly commits; stop and inspect rather than assuming rollback removed them.

## Static verification record

Executed on 2026-10-24 without reading private environment files or connecting to MySQL:

- `node --check database/tests/verify-hospitals.mjs`: passed, including after final verifier review.
- Database-free source contract assertions: passed for one Hospital CREATE statement, the eight approved columns, shared key, nullable unique registration, defaults, restrictive FK, engine/collation and absence of parent changes, triggers, private-file loading, DDL execution or commit in the verifier.
- Eleven invalid-configuration subprocess checks: passed with exit code 2 before mysql2 loading/connection attempts (missing/unsafe/development/overlong target, missing confirmation, remote/missing host, invalid/out-of-range port and missing disposable user/password).
- Seven in-memory mocked paths: passed for missing grant, populated Account, unexpected table, unexpected trigger, fixture error, rollback failure and connection-close failure. Unsafe preflights wrote no fixtures; transaction failures attempted rollback and connection closure; no failed path printed success. mysql2 was replaced with an injected mock. These checks do not establish actual MySQL behavior.
- Both documented PowerShell blocks passed PowerShell parser checks without execution.
- `git diff --check`: passed; Git reported an LF/CRLF conversion warning for the migration, without whitespace errors.

The initial sandbox Node invocation was blocked by filesystem EPERM; the database-free checks above subsequently passed under the authorized user context. An initial Python check could not start because Python was not available; the contract assertions were executed successfully using Node instead. No live SQL parser/server check, disposable constraint test, database setup or development application was executed by Codex. Lathikaa's later 004 installation and real Hospital registration/login/PENDING Profile success in her environment are separate evidence; they do not establish all 21 negative checks in the dedicated disposable verifier, failure handling, concurrency or live Admin access.
