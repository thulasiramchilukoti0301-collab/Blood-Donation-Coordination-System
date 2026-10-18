# Database setup and collaboration

## Current Phase 3 boundary

The approved bounded foundation milestone contains exactly:

1. `migrations/001_foundation.sql` — `BloodGroup` only.
2. `migrations/002_auth.sql` — `Account` only.
3. `seeds/reference_data.sql` — the eight stable `BloodGroup` rows only.
4. `scripts/apply-foundation.mjs` — loopback-only setup runner that checks required metadata visibility, verifies the selected schema is empty, applies only those two migrations and that seed in order, and exits nonzero on SQL errors. `setup.sql` creates a new named schema (and therefore refuses an existing one) before applying the same objects.
5. `tests/verify-foundation.mjs` — disposable-schema checks for schema metadata, constraints, defaults, reference values, account status/role values, and expected SQL rejection.

No other migration or seed placeholder is executable content. Do not apply empty future modules. `BloodCompatibility`, its 64 directed pairs, and its administration remain Lathikaa's coordinated compatibility milestone. No Donor/Hospital profile or permanent Account fixture belongs in this setup. Account/profile completeness requires their future profile tables and application transaction.

This is not the complete Phase 3 database deliverable. The other 11 major tables and 12 remaining logical entities, other domain modules and seeds, routines, view, history/audit infrastructure, expiry, sample data, and concurrent workflow verification remain for later explicitly authorized work. The eventual requirement is at least ten coherent rows in each of the 12 major tables; the eight lookup rows here do not satisfy that requirement for any major table.

## Physical foundation contract

The database default is `utf8mb4` / `utf8mb4_0900_ai_ci`; both tables use InnoDB. Case-insensitive `utf8mb4_0900_ai_ci` is used for email and display names. The app normalizes email to lowercase before storage; the unique index also treats differently cased email as a duplicate. Role/status and group code values use ASCII `ascii_bin` so their documented exact uppercase/literal values are case-sensitive. Times are `DATETIME` interpreted in `Asia/Kolkata`; set SQL/application sessions to `+05:30`. `updated_at` defaults at insert and is maintained explicitly by the application; no `ON UPDATE` clause or timestamp trigger is present.

| Physical table | Columns and exact types | Constraints |
|---|---|---|
| `BloodGroup` | `blood_group_id BIGINT UNSIGNED AUTO_INCREMENT`; `code CHAR(3) ASCII ascii_bin`; `display_name VARCHAR(12) utf8mb4_0900_ai_ci`; `is_active BOOLEAN` (`TINYINT(1)`) | `PRIMARY KEY (blood_group_id)`; `uq_blood_group_code`; `uq_blood_group_display_name`; `ck_blood_group_code`; `ck_blood_group_is_active` |
| `Account` | `account_id BIGINT UNSIGNED AUTO_INCREMENT`; `email VARCHAR(254) utf8mb4_0900_ai_ci`; `password_hash VARCHAR(255) utf8mb4_0900_ai_ci`; `role VARCHAR(16) ASCII ascii_bin`; `account_status VARCHAR(16) ASCII ascii_bin`; `created_at DATETIME`; `updated_at DATETIME` | `PRIMARY KEY (account_id)`; `uq_account_email`; `ck_account_role`; `ck_account_status` |

MySQL exposes these primary keys in `INFORMATION_SCHEMA.TABLE_CONSTRAINTS` with the physical name `PRIMARY` and type `PRIMARY KEY`. Verification also checks the corresponding single `KEY_COLUMN_USAGE` column (`blood_group_id` or `account_id`); `pk_blood_group` and `pk_account` are not physical constraint names.

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

Alternatively, for manual MySQL-client use, run the CLI from `database/` and source the wrapper:

```text
source setup.sql
```

`setup.sql` creates `blood_donation_coordination` without `IF NOT EXISTS`, selects it, sets the current client session timezone to `+05:30`, then sources only the two completed migrations and reference seed. The MySQL client working directory must be `database/` so `SOURCE` paths resolve; connect without a selected database and start it with `--abort-source-on-error`. Existing schema names are refused by `CREATE DATABASE`, so this wrapper does not inspect a potentially privilege-filtered existing schema. Confirm setup with the disposable verifier before claiming verification.

To exit MySQL, use `exit`. If the application `.env` is missing, configure its database host, port, user, password, and database name privately in `backend/.env` using an authorized application user. Preserve existing `.env` values and unrelated settings. Never paste secrets into tracked files, examples, shell arguments, reports, or chat. User-run foundation setup and connectivity results are summarized in the [implementation readiness review](../docs/implementation-readiness.md); this document does not store or display private settings.

## Disposable verification

The verifier refuses to run unless its target database name matches `bddc_phase3_test_<label>`. Create a **new empty disposable schema** with that prefix, apply the same foundation setup there, then run from the repository root:

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

The verifier checks the exact table/column order and types, NOT NULL, defaults, physical primary-key type/name/column, named unique/check constraints, case-sensitive role/status/group constraints, unique email/reference data, timestamps without automatic update behavior, InnoDB, the eight exact group IDs/codes/names, all nine role/status combinations, and negative cases. Each negative case must produce its expected MySQL code (`ER_DUP_ENTRY`, `ER_BAD_NULL_ERROR`, `ER_CHECK_CONSTRAINT_VIOLATED`, or `ER_NO_SUCH_TABLE`). A different code—including permission, connection, or syntax errors—or unexpected success fails verification. It reports safe case labels and MySQL error codes; raw driver details are suppressed.

## Rerun and failure behavior

The migrations and seed intentionally use plain `CREATE TABLE` and `INSERT`, with no `IF NOT EXISTS`, `INSERT IGNORE`, upsert, or destructive cleanup. This makes schema drift and duplicate reference data visible. Before writes, the guarded runner requires an explicit empty-schema confirmation, directly verifiable global metadata-visibility grants, and zero tables/views, routines, triggers, and events. It fails clearly before writes if visibility cannot be established. Setup succeeds once. A complete rerun is rejected by the empty-schema guard before any SQL is applied; applying a migration directly also fails at the existing table. Existing rows are not overwritten or removed. If setup fails partway, stop and inspect the disposable schema; do not blindly rerun on a populated/project database or remove data to make it pass. For verification/reproduction, create a fresh disposable schema and apply the checked-in setup sequence again.

Use the existing `mysql2` dependency for setup and verification; no migration framework is added. Unexpected SQL errors produce nonzero process exits. The verifier's intentional invalid statement demonstrates that SQL errors are observed; always follow setup with the verifier against a disposable schema before claiming database verification.

## Module ownership, numbering, and dependency order

SQL migrations and reviewed seeds in Git are the shared schema source. Local-only schema edits are not authoritative. Coordinate migration numbers and shared objects before editing; one migration number is assigned to one reviewed unit of schema change, with no concurrent reuse.

| Order | Module | Owner / dependency |
|---:|---|---|
| 001 | Shared foundation + `BloodGroup` | Coordinated; Thulasi implements this bounded foundation. |
| 002 | `Account` | Thulasi (Authentication & Role Access); depends on foundation. |
| 003 | `Donor` | Thulasi; depends on Account and BloodGroup. |
| 004 | `Hospital` | Lathikaa; depends on Account. |
| 005 | Eligibility, `DonationSlot`, `Booking` | Thulasi; depends on Donor/Account. |
| 006 | `Donation` | Thulasi; depends on Booking and Account. |
| 007 | `BloodUnit` and inventory lifecycle | Thulasi; depends on Donation and BloodGroup. |
| 008 | `HospitalRequest` | Lathikaa; depends on Hospital, Account, and BloodGroup. |
| 009 | `BloodCompatibility` and `Allocation` | Lathikaa; depends on BloodGroup, BloodUnit, HospitalRequest. Includes the directed 64-pair matrix under the documented RBC model. |
| 010 | `AuditEvent` and request-status history infrastructure | Coordinated with Lathikaa ownership; must exist before the first operations/routines that need audit/history rows. The audit screen can be implemented later. |
| 011 | Views/reports and deferred routines/expiry integration | Coordinated after referenced tables and audit/history dependencies exist. |

The reserved filenames are a dependency plan, not a claim that those future files are implemented. If a shared object or dependency requires a numbering/order change, coordinate both owners and update the setup sequence before applying it. Foundation setup does not run placeholder files.

Each developer applies reviewed SQL to their own local DB after syncing the merged PR from `origin/main`. Do not apply another developer's unfinished local branch changes or routinely share database instances. Setup/seed order follows dependencies; later account/profile fixtures depend on the associated profile tables. Audit/history infrastructure must accompany the first operations that require them, even if their screens are later. See [team workflow](../docs/team-workflow.md) for branches, PRs, and synchronization.

## Next dependencies for Lathikaa

- Foreign keys may use the stable `BloodGroup` IDs listed above once the foundation migration and seed have been applied locally.
- `Account` is available as the parent key for `Hospital`; it is not evidence that Hospital exists or that registration/authentication works.
- Lathikaa's `BloodCompatibility` design remains one row per directed donor-group/recipient-group pair, with the approved 64-pair reference matrix owned by the later compatibility milestone. This bounded seed intentionally does not populate it.
- Hospital requests, allocation, audit, and request history depend on coordinated follow-on schema modules; do not implement operations against missing tables. Audit and request-history storage must land before the first operation that records them.
- To reproduce, synchronize the reviewed migration and seed files, use a separate local schema, and apply only the approved assembled setup order. No shared or live database is the target.
