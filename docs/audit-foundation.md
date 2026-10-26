# Minimal AuditEvent foundation

This bounded milestone authors AuditEvent storage and an internal transaction-aware writer for later shared Account approval/status work. It does not implement approval, suspension, reactivation, an HTTP audit endpoint, Audit UI, request history, allocation, expiry or reports. The later shared Account backend calls the unchanged writer for bounded approval and the [backend-only suspension/reactivation extension](account-status-backend.md); see also [the original approval contract](account-approval-backend.md). Authored source, isolated tests, disposable MySQL evidence and development application are distinct statuses; verification results are recorded below without treating one as proof of another.

## Explicit dependency-plan amendment

The previous reserved 010 unit combined AuditEvent with request-status history. The authorized minimal foundation keeps `database/migrations/010_audit.sql` numbered **010** and makes it **AuditEvent only**, because its sole FK parent is Account. No subject-type entry creates a FK to a future request/allocation table. The proposed dependency sequence for reviewed assembly is **001 → 002 → 010**; the optional existing BloodGroup reference seed may also be used for a disposable verifier target. Neither HospitalRequest (008) nor Allocation (009) is a dependency of AuditEvent storage.

This dependency amendment is integrated at checkpoint `15ac4cf`; Thulasi's subsequent user-run local application is recorded below. That evidence does not transfer feature ownership or authorize the future history migration. Lathikaa retains audit/request-history ownership; Thulasi retains shared Account/authentication/approval/status ownership. No migration is renumbered and foundation setup is unchanged. RequestStatusHistory and `trg_request_status_history_update` require a separate future coordinated migration whose number/filename is **UNASSIGNED**. They are not moved into 008 and must not be appended to 010 later. Their initial application-written Submitted event, conditional AFTER UPDATE history and pooled-connection actor/reason cleanup contract stays unchanged.

## Exact storage contract

010 contains one plain `CREATE TABLE AuditEvent`, with no `IF NOT EXISTS`, drop, seeds, triggers, routines, events or additional table. InnoDB and the existing utf8mb4 default/collation are retained.

| Column | Type and rule |
|---|---|
| `audit_event_id` | `BIGINT UNSIGNED NOT NULL AUTO_INCREMENT`; primary key |
| `actor_account_id` | Nullable `BIGINT UNSIGNED`; FK to `Account.account_id`, `ON DELETE RESTRICT ON UPDATE RESTRICT` |
| `action_code` | `VARCHAR(48)` ASCII `ascii_bin`, required; no SQL enum or literal action CHECK |
| `subject_type` | `VARCHAR(32)` ASCII `ascii_bin`, required; case-sensitive entity-name whitelist below |
| `subject_id` | Nullable `BIGINT UNSIGNED`; NULL exactly when subject type is `SYSTEM_TASK` |
| `occurred_at` | Required `DATETIME DEFAULT CURRENT_TIMESTAMP`; interpreted in the established project `+05:30` session timezone |
| `reason_code` | Nullable `VARCHAR(40)`, utf8mb4 `utf8mb4_0900_ai_ci`; no reason enum |
| `change_summary` | Nullable `VARCHAR(1000)`, utf8mb4 `utf8mb4_0900_ai_ci`; concise safe scalar summary |
| `operation_id` | Nullable `CHAR(36)` ASCII `ascii_bin`; groups events from an operation; not unique |

The whitelist is the 14 approved entity names plus `SYSTEM_TASK`: `Account`, `Donor`, `Hospital`, `BloodGroup`, `BloodCompatibility`, `DonationSlot`, `Booking`, `EligibilityDecision`, `Donation`, `BloodUnit`, `HospitalRequest`, `RequestStatusHistory`, `Allocation`, `AuditEvent`, `SYSTEM_TASK`. Future entity names here do not claim their tables exist. `fk_audit_event_actor` protects a real actor Account; typed subject existence is validated by the consuming service, because a polymorphic target has no conventional FK. Operational records remain retained.

Named indexes are `ix_audit_event_subject (subject_type, subject_id, occurred_at)` and `ix_audit_event_actor (actor_account_id, occurred_at)`. CHECKs are `ck_audit_event_subject_type` and `ck_audit_event_subject_id`. NULL actor is not restricted to run-level `SYSTEM_TASK`: future trusted system per-unit expiry events have real BloodUnit subjects and may share an operation ID with the run-level event. No extra actor/subject equivalence, Account mutation, secret payload, JSON column or before/after field is added.

## Internal writer contract

`backend/src/modules/audit/writer.js` exports `createAuditWriter({ allowedActionCodes })`. The registry is mandatory: a nonempty array of unique printable non-whitespace ASCII strings, each 1–48 characters. Membership is exact and case-sensitive. There is no default registry or production action literal. The later approval caller now explicitly supplies ACCOUNT_APPROVED / REGISTRATION_REVIEWED with fixed `PENDING -> ACTIVE` summary and a server UUID. The later status caller also explicitly supplies ACCOUNT_SUSPENDED / ACCESS_RESTRICTED (`ACTIVE -> SUSPENDED`) and ACCOUNT_REACTIVATED / ACCESS_RESTORED (`SUSPENDED -> ACTIVE`), each with a server UUID. Those three Account mappings are resolved; other production mappings remain OPEN. The generic writer contract does not invent a default registry.

The factory returns two methods, each returning the inserted `auditEventId` as a plain decimal string:

| Method | Actor boundary |
|---|---|
| `write(connection, event)` | `actorAccountId` is required and must identify the verified real acting Account |
| `writeSystemEvent(connection, event)` | Rejects any supplied `actorAccountId` property; writes NULL actor. Internal trusted-system use only, never a route-controlled option |

Event properties are exactly `actorAccountId` (user method only), `actionCode`, `subjectType`, `subjectId`, and optional `reasonCode`, `changeSummary`, `operationId`. Unknown keys, accessors, symbols, hidden extra properties, nested data and unsupported scalar types are rejected. The action must belong to the injected registry; subject type must match the schema whitelist. Actor/entity IDs must be canonical positive unsigned-BIGINT decimal strings or safe positive integers and are returned to SQL as strings. `subjectId` must be explicitly NULL for `SYSTEM_TASK`, otherwise a positive ID. No client timestamp or audit ID property is accepted; the database supplies occurrence time and ID.

Omitted optional properties and explicit NULL become SQL NULL; explicitly supplied `undefined` and blank strings are invalid. Reason/summary text is preserved rather than silently trimmed or truncated, limited to 40/1000 Unicode code points and excludes control characters. `operationId`, when supplied, is a 36-character UUID-shaped hexadecimal string (8-4-4-4-12 groups), preserved in its original letter case. Storage allows NULL; future real scheduler run events must supply their required grouping/summary under the existing domain contract.

The writer accepts the caller's mysql2 **connection**, requiring `execute`, `beginTransaction`, `commit` and `rollback` capabilities and rejecting a pool with `getConnection`. It only invokes parameterized `execute`. It does not acquire/release connections, begin/commit/roll back, retry writes, create schema, select subjects, authorize actors or log event/driver details. Presence of transaction methods cannot prove a transaction is active: beginning one and maintaining one connection for business mutation plus audit insertion remain caller obligations. The caller must use the configured project timezone, verify current role/status/subject ownership/existence, construct a safe summary and roll back the entire operation if any mutation/audit step fails. Never supply passwords, hashes, tokens, secrets, detailed medical answers or unnecessary personal data in any event field.

| Failure | Safe internal error |
|---|---|
| Invalid event | HTTP-compatible 400 `VALIDATION_ERROR`: `Audit event input is invalid.` |
| Missing/invalid explicit action registry | 500 `AUDIT_CONFIGURATION_ERROR` |
| Missing required connection capabilities or supplied pool | 500 `AUDIT_CONNECTION_REQUIRED` |
| Database/insert-ID failure | 503 `DATABASE_UNAVAILABLE`: `Audit data is temporarily unavailable.` |

Existing `HttpError` values are preserved; raw MySQL errors, SQL text, values and stack traces are not returned by this writer. These are internal service errors, not a newly mounted public endpoint. See [module README](../backend/src/modules/audit/README.md).

## Read-only development preflight

This preflight documents checks before a separately authorized first application. Thulasi's completed preflight and 010 installation are recorded in the USER-RUN evidence below; this documentation update executes no SQL. These queries read metadata only, not Accounts or audit payloads:

```sql
USE blood_donation_coordination;
SELECT DATABASE() AS selected_schema, VERSION() AS server_version;
SELECT TABLE_NAME, ENGINE, TABLE_COLLATION
FROM information_schema.TABLES
WHERE TABLE_SCHEMA = DATABASE()
  AND LOWER(TABLE_NAME) IN ('account', 'auditevent');
SHOW CREATE TABLE Account;
SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT, EXTRA
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
  AND LOWER(TABLE_NAME) IN ('account', 'auditevent')
ORDER BY TABLE_NAME, ORDINAL_POSITION;
```

Metadata visibility is privilege-filtered. Confirm the Account key matches the FK. If AuditEvent already exists, inspect its definition/indexes/constraints rather than reapplying plain CREATE or hiding drift with `IF NOT EXISTS`. This source milestone does not install grants, create users, infer development credentials or run setup wrappers. Runtime use later needs only the agreed database-scoped privileges; schema setup and disposable verification identities remain separate administrative responsibilities.

## Manual migration application boundary

For a new local installation, complete the disposable verification below and review the 010-only dependency amendment with Thulasi before development application. In a fresh isolated schema the dependency sequence is 001 → 002 → 010; the storage verifier additionally requires the existing eight-row BloodGroup reference seed, so its assembly is 001 → 002 → reference_data.sql → 010. The seed is a verifier prerequisite, not an AuditEvent FK dependency.

For an existing local schema with canonical Account already installed, do **not** rerun 001/002, seeds or foundation setup. In Workbench, select the intended schema, run the read-only preflight above, and confirm AuditEvent is absent. Only after the isolated pass and shared review, open and execute the reviewed `database/migrations/010_audit.sql` once, then inspect `SHOW CREATE TABLE AuditEvent` and `SHOW INDEX FROM AuditEvent`. DDL is not transactionally rolled back; an unexpected existing table or error means stop and inspect, not rerun or drop. No migration is automatically applied by the backend or this writer. Thulasi needs the Account parent and verified AuditEvent table before using audit insertion; HospitalRequest, RequestStatusHistory and Allocation are not prerequisites.

## Verification evidence

`backend/tests/audit-schema.test.js` checks migration source contracts; `database/tests/verify-audit.mjs` is a separate disposable-only SQL verifier. Source checks cannot prove MySQL enforcement. The verifier reads no private environment file and has no `DB_NAME` or application-credential fallback. It requires all of:

- `PHASE3_AUDIT_TEST_DATABASE` exactly matching `bddc_phase3_test_audit_<label>`, at most 64 characters.
- `PHASE3_AUDIT_TEST_EMPTY_DATABASE=YES`, explicit loopback `DB_HOST`, explicit valid `DB_PORT`, and disposable-only `PHASE3_TEST_DB_USER`/`PHASE3_TEST_DB_PASSWORD`.
- For a dedicated workspace server, `PHASE3_AUDIT_TEST_DATA_DIRECTORY` must identify an absolute `.tmp/audit-mysql-<label>/data` directory in this checkout, on a non-3306 port. The verifier compares it with the connected server's `@@datadir` and checks `@@port` before inspecting the fresh schema. Instance identity does not establish metadata visibility; this mode also requires the SHOW GRANTS validation described below. It accepts a deliberately supplied empty test password; an absent password variable still fails configuration. No credential is discovered or modified.
- BOTH normal and dedicated-server modes run the existing SHOW GRANTS validation before object inventory or fixtures: directly granted global SELECT/SHOW_ROUTINE/TRIGGER/EVENT, or ALL PRIVILEGES, must be established. Missing or incomplete evidence fails before writes. This is the verifier's conservative visibility policy, not a universal MySQL requirement or an application-account privilege requirement. No grants are changed; use an already authorized disposable verification identity and do not broaden development privileges to run this test.
- An already assembled target with exactly Account, AuditEvent and BloodGroup as InnoDB/utf8mb4 tables, no views/triggers/routines/events, empty Account/AuditEvent and the eight exact canonical BloodGroup rows. Strict SQL mode, FK and unique checks must be enabled.

The verifier performs no DDL. Its fresh **isolated/disposable** assembly is 001 → 002 → reference_data.sql → 010, after the 010 review boundary is satisfied; root setup of that target is separate from the verifier. Fixtures comprise one unusable-hash Account and 19 audit rows covering all 15 subject types, optional NULLs, shared operation IDs, generated/timestamp defaults and the 1000-code-point Unicode boundary. There are 23 negative SQL checks. Success is reported only after rollback, post-rollback empty Account/AuditEvent and successful connection closure; rollback may leave auto-increment gaps, which is why development is never a verifier target. This fixture setup is not usable account provisioning or permanent sample data.

After a separately authorized isolated server/schema assembly, the following PowerShell block from the repository root runs only the verifier, with its credentials prompted rather than embedded. The development server/port is not used by this example. Save results without secrets; this block is documentation, not evidence that it ran:

```powershell
$auditVariableNames = @('DB_HOST', 'DB_PORT', 'PHASE3_AUDIT_TEST_DATABASE', 'PHASE3_AUDIT_TEST_DATA_DIRECTORY',
  'PHASE3_AUDIT_TEST_EMPTY_DATABASE', 'PHASE3_TEST_DB_USER', 'PHASE3_TEST_DB_PASSWORD')
$auditPreviousValues = @{}
foreach ($name in $auditVariableNames) {
  $auditPreviousValues[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
}
try {
  $auditSchema = Read-Host 'Exact preassembled disposable audit schema'
  if ($auditSchema -cnotmatch '^bddc_phase3_test_audit_[a-z0-9_]+$' -or $auditSchema.Length -gt 64) {
    throw 'Invalid disposable audit schema.'
  }
  $auditPort = Read-Host 'Isolated MySQL server port (not 3306)'
  if ($auditPort -notmatch '^[1-9][0-9]{0,4}$' -or [int]$auditPort -gt 65535 -or [int]$auditPort -eq 3306) {
    throw 'Invalid isolated port.'
  }
  $env:DB_HOST = '127.0.0.1'
  $env:DB_PORT = $auditPort
  $env:PHASE3_AUDIT_TEST_DATABASE = $auditSchema
  $env:PHASE3_AUDIT_TEST_DATA_DIRECTORY = Read-Host 'Absolute workspace .tmp/audit-mysql-<label>/data directory'
  $env:PHASE3_AUDIT_TEST_EMPTY_DATABASE = 'YES'
  $env:PHASE3_TEST_DB_USER = Read-Host 'Disposable-only verification user'
  $auditTestSecret = Read-Host 'Disposable-only verification password' -AsSecureString
  $env:PHASE3_TEST_DB_PASSWORD = [System.Net.NetworkCredential]::new('', $auditTestSecret).Password
  if ($auditTestSecret.Length -eq 0) {
    # Pass an explicit empty value to the child; PowerShell may remove an empty
    # environment variable. This uses the existing test login without changing it.
    @'
import { spawnSync } from 'node:child_process';
const env = {};
for (const name of ['SystemRoot', 'PATH', 'TEMP', 'TMP', 'DB_HOST', 'DB_PORT',
  'PHASE3_AUDIT_TEST_DATABASE', 'PHASE3_AUDIT_TEST_DATA_DIRECTORY',
  'PHASE3_AUDIT_TEST_EMPTY_DATABASE', 'PHASE3_TEST_DB_USER']) {
  if (process.env[name] !== undefined) env[name] = process.env[name];
}
env.PHASE3_TEST_DB_PASSWORD = '';
const result = spawnSync(process.execPath, ['database/tests/verify-audit.mjs'], { env, stdio: 'inherit' });
process.exitCode = result.status ?? 1;
'@ | node --input-type=module
  } else {
    node .\database\tests\verify-audit.mjs
  }
  if ($LASTEXITCODE -ne 0) { throw 'Audit verification failed; inspect the safe stage/code.' }
} finally {
  foreach ($name in $auditVariableNames) {
    [Environment]::SetEnvironmentVariable($name, $auditPreviousValues[$name], 'Process')
  }
  $auditTestSecret = $null
  $auditPreviousValues.Clear()
}
```

Lathikaa's historical diagnostic and verification recorded on 2026-10-25 in incoming checkpoint `5b7f45acf38bba3e583b245939b2959c88efcf12` (before the metadata-visibility correction):

| Check | Result |
|---|---|
| Audit-specific backend tests | **22 passed**, 0 failed/skipped: 16 writer, four migration-text, metadata-representation and configuration-boundary tests |
| Complete backend regression | **137 passed**, 0 failed/skipped, including preserved Hospital/Donor flows |
| Disposable SQL assembly | MySQL **8.0.39**, `bddc_phase3_test_audit_resume_8bbd49b9d6` on **127.0.0.1:50469**, with `--no-defaults` and an independently checked workspace data directory |
| Disposable verifier | **Passed** exact columns/defaults/encodings, CHECKs, indexes and actor FK; **19 valid audit fixtures and 23 negative checks**, successful rollback to empty Account/AuditEvent tables and connection closure |
| Real writer transaction checks | Passed: uncommitted business/audit rows were invisible to a second connection; caller rollback removed both; audit FK failure propagated safely and the caller rolled back its business fixture |
| Cleanup | Both schemas created during this diagnostic were dropped only after empty-table checks; isolated server completed normal shutdown |

The failed assertion compared subject literals extracted from `information_schema.CHECK_CONSTRAINTS.CHECK_CLAUSE` with the approved subject list. MySQL returned escaped quote delimiters; the old regex retained the closing delimiter's backslash, yielding a value such as `Account` followed by a backslash. `database/tests/helpers/audit-metadata.mjs` now normalizes those quote escapes before parsing the whitelist or subject-ID expression. Regression coverage verifies that case, unexpected backslashes and extra expression text are not erased. **The approved DDL, subject whitelist, FK and CHECK constraints were not changed.** This was a metadata-representation/verifier expectation defect, not a schema defect.

The earlier 20-audit/135-backend run and initial declined retry are historical; the user subsequently authorized this successful diagnostic. The Feature 6 115-backend/34-frontend results also remain historical; no frontend rerun is claimed here. Development database, existing Account/session records, credentials and grants were neither inspected nor changed during the authorized diagnostic. All Account rows used here were new disposable fixtures and were rolled back. These results apply to the incoming tested revision on the isolated MySQL version. That dedicated-server run used the earlier identity-only visibility path. The integration correction added SHOW GRANTS validation in both modes. The later normal-mode USER-RUN pass is recorded separately below; this historical run does not live-verify the corrected dedicated-server mode. At that incoming diagnostic checkpoint, Account approval/revocation integration and production concurrency remained pending. Later approval observations are recorded separately below.

Reproduce the backend checks from `backend/` without loading private environment files:

```powershell
@'
import { spawnSync } from 'node:child_process';
const env = { SystemRoot: process.env.SystemRoot, PATH: process.env.PATH,
  TEMP: process.env.TEMP, TMP: process.env.TMP, NODE_ENV: 'test' };
for (const args of [
  ['--test', 'tests/audit.test.js', 'tests/audit-schema.test.js', 'tests/audit-verifier-preflight.test.js'],
  ['--experimental-loader', './tests/helpers/no-private-env-loader.mjs', '--test'],
]) {
  const result = spawnSync(process.execPath, args, { env, encoding: 'utf8' });
  process.stdout.write((result.stdout || '') + (result.stderr || ''));
  if (result.error || result.status !== 0) { process.exitCode = 1; break; }
}
'@ | node --input-type=module
```

## USER-RUN local AuditEvent setup (2026-10-25)

The user reported the following results from **Thulasi's environment**, using the corrected verifier at checkpoint **`15ac4cf`**. These are user-run observations, not MySQL queries or tests executed by this documentation update. They are separate from Lathikaa's historical incoming-revision MySQL evidence and the earlier Codex-run automated checks.

- **Normal-mode disposable verification:** `database/tests/verify-audit.mjs` passed on **127.0.0.1:3306**, against `bddc_phase3_test_audit_20261025_first`, assembled in order **001 -> 002 -> reference_data.sql -> 010**. All **23 negative checks** passed. **Nineteen AuditEvent fixtures and one Account fixture** were rolled back; both fixture tables were empty afterward and the connection closed.
- **Development installation and structure:** preflight found Account as InnoDB and AuditEvent absent. Only `database/migrations/010_audit.sql` was then applied to `blood_donation_coordination`. `SHOW CREATE TABLE` and `SHOW INDEX` matched the approved nine columns, primary key, restrictive actor FK, two CHECKs and two composite indexes.
- **Application-account read access:** the configured application account passed AuditEvent SELECT access. Existing database-level SELECT/INSERT/UPDATE/DELETE grants were observed. No grants were changed and no application audit-write test was performed.

This verifies the corrected normal-mode disposable verifier and the stated local storage setup/read access only. **Dedicated-server mode was not live-reverified here.** At this 2026-10-25 AuditEvent setup checkpoint, Account approval, production action/reason mappings, transactional session revocation, Admin provisioning, audit APIs/UI and concurrency remained pending. Later first-Admin/basic browser evidence is separate from this audit setup evidence. Rolled-back fixtures are not permanent sample data.

Lathikaa retains Audit feature ownership; Thulasi retains Account/authentication/approval ownership. This local installation is not evidence of a change to Lathikaa's database. The continuing personal branches, reviewed pushed-checkpoint exchange and deferred main merge remain as documented in [team workflow](team-workflow.md); PR #5 remains cumulative and open.

## Resume assessment and checkpoint

| State | Assessment |
|---|---|
| SOURCE COMPLETE | Approved DDL/indexes, internal writer, parameterized insertion and validation/error boundaries; database-free visibility correction and regressions are integrated. Historical MySQL evidence applies to the incoming tested revision |
| LOCAL SETUP USER-VERIFIED | Thulasi's 2026-10-25 evidence records application of only 010, matching structure/indexes and application-account SELECT access; no application audit-write test was performed |
| APPLICATION APPROVAL USER-OBSERVED | Separate [USER-RUN evidence dated 2026-10-26](account-approval-backend.md#user-run-account-approval-evidence-2026-10-26) covers Console-driven Donor/Hospital approval, observed profile fresh-login behavior, Hospital retry conflict and one ACCOUNT_APPROVED event per approved Account; it is not an Audit verifier rerun |
| DONOR STATUS CYCLE USER-OBSERVED | Separate [USER-RUN evidence reported 2026-10-27](account-status-backend.md#user-run-donor-status-cycle-evidence-reported-2026-10-27) records one Console-driven Donor cycle and Workbench confirmation of exactly one ACCOUNT_SUSPENDED and one ACCOUNT_REACTIVATED event with ADMIN actors and approved reasons/summaries; this is separate from automated tests and does not verify Hospital cycles or concurrency/rollback/multi-device/security guarantees |
| OPEN / OUT OF SCOPE | Real concurrent login/approval, expiry during MySQL lock waits, failure/rollback, ambiguous commits, all-session/multi-device revocation, full security/API-tampering verification, Hospital/further Donor status-cycle checks, suspension/reactivation UI and other mappings, remaining live frontend checks, audit APIs/UI and the separately coordinated request-history migration |
| NORMAL MODE USER-VERIFIED / DEDICATED MODE PENDING | The corrected verifier at `15ac4cf` passed the normal-mode disposable run reported above; corrected dedicated-server mode was not live-reverified |

The published AuditEvent checkpoint is `5b7f45acf38bba3e583b245939b2959c88efcf12`, based on Hospital checkpoint `4cd32bf659068ccd360dc05e77427caadac37e3b`. Its integration on `thulasiram` preserves both developers' Hospital evidence and the existing Donor contact/reported-group features. Lathikaa retains Audit feature ownership; this is the authorized shared verifier correction, not an Account approval implementation.

The new `backend/tests/audit-verifier-preflight.test.js` executes the actual standalone verifier in isolated subprocesses. A test-only loader replaces its mysql2 acquisition dependency, and a preloaded socket guard blocks outbound connections. The ten cases cover missing/incomplete visibility in both modes, sufficient named/ALL privileges advancing through preflight in both modes, and dedicated datadir/port mismatches rejecting. The successful-preflight cases deliberately stop before fixtures; they are not SQL/storage verification. Every case asserts zero fixture writes, zero transaction starts, no outbound connection attempt and connection closure. Final integration check results are recorded separately in `implementation-readiness.md`.

Separate [USER-RUN first-Admin/basic browser evidence, with browser confirmation reported 2026-10-26](first-admin-bootstrap.md#user-run-evidence-browser-confirmation-reported-2026-10-26), now records manual provisioning and the basic Admin Hospital read flow. It does not verify any Account approval or application audit-write integration.

## Thulasi integration dependency

Shared `GET /api/admin/accounts` and `PATCH /api/admin/accounts/:accountId` now implement the [bounded queue/approval backend](account-approval-backend.md), with controlled reason, same-transaction audit/revocation and coordinated login persistence. The status extension adds controlled ACTIVE -> SUSPENDED and SUSPENDED -> ACTIVE on that same PATCH; basic USER-RUN Console approval/audit/fresh-login observations are linked above. Further live concurrency/failure/security and multi-device verification, plus remaining live frontend checks, remain pending; the later [shared Mint frontend](account-approval-frontend.md) implements only PENDING-to-ACTIVE controls. Thulasi's local storage/structure and application-account read prerequisites have the USER-RUN evidence above. The later shared approval frontend is separately authorized and implemented at `/admin/accounts`, not within Hospital Management. Its isolated checks, separate USER-RUN Donor UI evidence and remaining live verification are documented in the frontend guide; the Console observations remain historical and do not verify the later UI. Further status UI/other workflows and live security/failure/concurrency checks still require their own authorization. The approval action/reason mapping and transactional login/approval/revocation protocol are implemented with database-free coverage; real MySQL concurrency remains unverified. Suspension/reactivation and their fixed mappings have database-free backend coverage plus the separately linked USER-RUN observations for one Donor cycle reported 2026-10-27. This does not establish Hospital verification, concurrency, rollback or all-session/multi-device revocation. The status guide records the authoritative Account/SID authorization and the latest 260 passing backend tests, including the Donor cleanup follow-up. No Hospital-only Account update or bypass is added; Screen 24 keeps status read-only.

Feature 7 still needs HospitalRequest, the later UNASSIGNED history migration/trigger and required lookup/transition contracts. Feature 8 needs compatibility/Allocation and transaction/locking verification. Full Feature 9 audit search/UI and Feature 10 reports remain later work. The minimal foundation supplies a shared dependency without implementing those features.
