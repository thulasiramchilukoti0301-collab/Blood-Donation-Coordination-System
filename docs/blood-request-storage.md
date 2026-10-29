# Feature 7 — Blood Request database milestone

**Superseding activation update, 2026-10-27:** the tested history table/trigger has been promoted to `database/migrations/012_request_status_history.sql`, preserving its table/index/FK definitions and strengthening human actor/reason validation by disabling the old UUID-only system bypass. The numbered migration is disposable-verified; it has not been applied to development. The original proposal is historical, not an installation script. See [the activation runbook](feature7-activation.md) for current API, migration, audit and verification status. Earlier milestone evidence below remains revision-specific.

Authored and verified on 2026-10-25 on `lathikaa`, starting from clean committed AuditEvent checkpoint `5b7f45acf38bba3e583b245939b2959c88efcf12` (the cached origin/lathikaa ref matched). No development database or private environment file was accessed. No backend route or frontend was implemented. Existing Hospital/Donor/authentication/AuditEvent code and migration 010 are preserved.

## Delivered objects and coordination boundary

`database/migrations/008_blood_requests.sql` now contains HospitalRequest and two row guards. The reserved 008 number is retained. Its FK parents are Hospital (004) and BloodGroup (001), with Account (002) already the Hospital parent. AuditEvent is independent storage, required by future business operations rather than a HospitalRequest FK.

RequestStatusHistory and `trg_request_status_history_update` remain a **separate migration whose number/filename is UNASSIGNED**. The tested SQL is prepared at `database/proposals/request-status-history.sql`, outside the migration directory. Before development application, Lathikaa and Thulasi must record the selected migration number, immutable application order and connection-context contract. This milestone neither chooses a number nor claims that coordination has occurred. Do not move history into 008, append it to 010, or apply the proposal automatically. The existing foundation setup remains unchanged.

| Artifact/object | State |
|---|---|
| HospitalRequest | Implemented in 008; verified on disposable MySQL |
| `trg_request_initial_status`, BEFORE INSERT | Rejects creation with a status other than SUBMITTED |
| `trg_request_update_guard`, BEFORE UPDATE | Rejects changed quantity, terminal-state changes and transitions outside the approved static graph |
| RequestStatusHistory | Approved seven-column relation prepared/tested as an unnumbered proposal |
| `trg_request_status_history_update`, AFTER UPDATE | One conditional update-history writer prepared/tested in that proposal |
| Initial Submitted history | Future creation service inserts it once in the request/history/audit transaction; there is no AFTER INSERT history trigger |
| Request APIs, fulfillment/cancellation workflow, UI | Not implemented in this milestone |

## HospitalRequest physical contract

| Column | Exact storage |
|---|---|
| request_id | BIGINT UNSIGNED NOT NULL AUTO_INCREMENT, primary key |
| hospital_account_id | BIGINT UNSIGNED NOT NULL, FK to Hospital.account_id |
| recipient_group_id | BIGINT UNSIGNED NOT NULL, FK to BloodGroup.blood_group_id |
| quantity_requested | SMALLINT UNSIGNED NOT NULL, CHECK > 0; range 1–65535; immutable after insert |
| priority | VARCHAR(10), ASCII/ascii_bin, NOT NULL DEFAULT NORMAL |
| needed_by | DATETIME NOT NULL |
| request_note | Nullable VARCHAR(500), utf8mb4/utf8mb4_0900_ai_ci; no patient-identifying or sensitive clinical details |
| request_status | VARCHAR(20), ASCII/ascii_bin, NOT NULL DEFAULT SUBMITTED |
| rejection_reason_code | Nullable VARCHAR(40), utf8mb4/utf8mb4_0900_ai_ci; required when REJECTED |
| created_at, updated_at | DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP; updated_at maintained explicitly by future application updates |

Exact priorities: EMERGENCY, URGENT, NORMAL. Exact statuses: SUBMITTED, UNDER_REVIEW, AWAITING_INVENTORY, PARTIALLY_FULFILLED, FULFILLED, REJECTED, CANCELLED. Binary comparisons in the code CHECKs also reject case/space variants; no enum value was added. FKs use ON DELETE RESTRICT and ON UPDATE RESTRICT. InnoDB and the established utf8mb4 default are retained. No cancelled_at, reviewed_at, derived fulfillment counter or new lifecycle field is added.

Indexes:

- `ix_request_status_priority_needed_created (request_status, priority, needed_by, created_at)`.
- `ix_request_hospital_created (hospital_account_id, created_at)`.
- `ix_request_recipient_group (recipient_group_id)`, also supporting the FK.

The row guards enforce only row-local rules. FK existence does not prove the Hospital's current role/status or the actor's web-session ownership. Quantity stays unchanged even while SUBMITTED; submitting a different quantity requires a separate approved cancellation/new-request flow. Relative needed-by cutoffs, safe text and other input rules still require server validation. No wall-clock CHECK or unapproved cutoff is invented.

Static graph: SUBMITTED → UNDER_REVIEW/CANCELLED; UNDER_REVIEW → AWAITING_INVENTORY/PARTIALLY_FULFILLED/REJECTED/CANCELLED; AWAITING_INVENTORY → PARTIALLY_FULFILLED/CANCELLED; PARTIALLY_FULFILLED → FULFILLED/AWAITING_INVENTORY/CANCELLED. FULFILLED, REJECTED and CANCELLED cannot change status. Whether a permitted graph edge is actually justified by allocations/permissions remains a transaction-service invariant. In particular, storage allowing a CANCELLED edge does not prove that cancellation is pre-issue.

## Unnumbered history proposal

The table has exactly `request_status_history_id` (generated unsigned BIGINT PK), `request_id` (required restrictive HospitalRequest FK), nullable `old_status` VARCHAR(20), required `new_status` VARCHAR(20), nullable `changed_by_account_id` (restrictive Account FK), nullable `reason_code` VARCHAR(40), and `changed_at` DATETIME DEFAULT CURRENT_TIMESTAMP. Status columns use ASCII/ascii_bin and the same seven values; NULL old status is allowed only with new SUBMITTED. The timeline index is `(request_id, changed_at)`; the actor FK has its supporting index. There is no speculative uniqueness rule that would prohibit legitimate repeated status cycles.

Initial creation must insert `(old_status=NULL, new_status=SUBMITTED, actor=verified Hospital)` exactly once. The conditional AFTER UPDATE trigger inserts subsequent history only when OLD and NEW status differ. Priority-only, timestamp-only and no-op updates create no history. The application must never manually insert a second update event alongside that trigger. Deterministic display orders same-time history by changed_at then history PK.

The **proposed** connection context is:

- `@request_actor_account_id`: canonical positive unsigned-BIGINT ID derived from the verified server Account; never from client identity/role fields.
- `@request_reason_code`: optional nonblank safe scalar text, at most 40 characters, without controls. Rejection requires it to match the request's rejection_reason_code.
- `@request_system_operation_id`: NULL for normal actor operations. A trusted internal system operation may use a UUID-shaped value and NULL actor; having a UUID is not proof of authorization.

The draft trigger rejects missing, malformed or ambiguous context. For a normal actor it reloads/locks Account and requires ACTIVE status. An owning HOSPITAL may only move its own request to CANCELLED; ADMIN may perform other graph-permitted transitions. Admin cancellation is denied in the draft because its API/policy is not approved. Trusted system history permits a NULL actor, as the existing schema allows for maintenance. These checks are defense in depth: context does not authenticate a web session, authorize raw SQL callers or establish allocation-derived counts. The future backend must authorize every operation independently and must never let browser input select system mode.

Before using a pooled connection, clear stale context. Set verified context before each status mutation. In `finally`, after commit or rollback, clear all three variables before release; they are session-scoped and are **not** cleared by transaction rollback. If rollback or context cleanup fails, destroy the connection and preserve the original safe operation error. Never both release and destroy it. The proposed names/system path and deployment privileges must be reviewed before this SQL is assigned a migration number. Trigger creation uses the applying identity as definer; no hard-coded DEFINER or grant change is supplied.

## Backend dependency contract — next milestone only

All listed routes remain planned/unmounted:

| API | Required boundary |
|---|---|
| POST /api/hospitals/me/requests | Current ACTIVE HOSPITAL, session-derived hospital ID; recipientGroupId, quantityRequested, priority, neededBy, optional note only |
| GET /api/hospitals/me/requests | Only current Hospital's records; approved requestStatus/priority/recipientGroupId/submittedFrom/submittedTo/neededByFrom/neededByTo/page filters |
| GET /api/hospitals/me/requests/:requestId | Canonical ID, ownership from session; safe fields/history and real allocation-derived totals |
| POST /api/hospitals/me/requests/:requestId/cancellation | ACTIVE owner; no issued unit; release/cancel unissued allocations and preserve issued history in one authorized transaction |
| GET /api/admin/requests and /:requestId | Current ACTIVE ADMIN; same approved filters plus hospitalId; no donor identity or staff-only notes leaked to Hospitals |
| POST /api/admin/requests/:requestId/review | ACTIVE ADMIN, approved graph and allocation-derived predicates; reason for rejection; trigger-owned update history plus audit |
| PATCH /api/admin/requests/:requestId/priority | ACTIVE ADMIN, exact priority and required audit reason; no Hospital self-upgrade |

Reuse shared current-account/role/ACTIVE guards and session-bound Origin/CSRF for mutations. Reject client actor/Hospital IDs, roles, statuses, timestamps, derived totals and quantity edits. Use prepared/bound SQL for values and fixed approved filter/order expressions. IDs remain decimal strings. Search currently means the approved structured filters; no free-text `q`, SQL sort parameter or speculative full-text index is approved. Priority ordering is EMERGENCY > URGENT > NORMAL, then needed_by, created_at and stable request ID. Lexical VARCHAR order is not that business order; the future query needs a fixed CASE expression. Index performance/EXPLAIN on representative data remains unverified.

Creation transaction: lock/recheck current Account and Hospital; validate recipient group under the agreed active-group/lookup rules; insert SUBMITTED request; insert initial history once; call the existing AuditEvent writer with the same connection and a reviewed production action code; commit only when all succeed. The test action strings used in fixtures are not production vocabulary. Any request/history/audit failure must roll back every write. Use the established safe JSON error envelope and existing failed-rollback disposal conventions; never return raw SQL or driver details.

For updates, use a consistent reviewed lock order, recheck current status/ownership, set trusted context, make one status UPDATE, let the trigger insert history, write general audit on the same connection, and commit. Agree/test the shared Account/request/allocation lock strategy; trigger row locks do not establish concurrency correctness by themselves. No shared authentication or Account approval workflow is duplicated.

Allocated/issued/outstanding totals come from real Allocation rows. Migration 009 now stores Allocation and the directed compatibility matrix; it has passed a fresh MySQL 8.0.39 disposable check. No application allocation/issue/cancellation writer is mounted yet, so read projections must remain tied to real rows and cancellation/issue predicates remain gated by those operations. `cancelledAt` in the approved API can be derived from the CANCELLED history event; there is no new HospitalRequest cancellation timestamp column. Storage verification does not prove live fulfillment or pre-issue cancellation semantics. See [Feature 8 implementation](feature8-implementation.md).

## Verification and safe reproduction

On 2026-10-25:

| Check | Actual result |
|---|---|
| Feature 7 static tests | 6 passed, 0 failed/skipped |
| Full isolated backend regression | 143 passed, 0 failed/skipped; preserves Hospital/Donor/auth/AuditEvent coverage |
| MySQL 8.0.39 disposable run | 68 negative checks passed; 11 request and 16 history fixtures, plus related Account/Hospital/audit fixtures, rolled back |
| Schema/trigger checks | Exact columns/defaults/encodings/FKs/indexes/CHECKs; start state, immutable quantity, graph/terminal guards; proposed history actor/reason/system context; no duplicate no-op history; DELETE/UPDATE FK restrictions |
| Failure atomicity | Initial history failure and audit failure rolled back the new request/initial history using caller-owned savepoints; final transaction rollback left all operational tables empty |
| Cleanup | Context cleared and checked NULL; connection closed; this run's disposable schema removed; isolated server normal shutdown |

The final target was `bddc_phase3_test_requests_94daf8fff1` on the separately authorized workspace-only MySQL server at 127.0.0.1:50469, started with `--no-defaults`. An earlier metadata query alias (`generated`) caused a parser error; it was corrected to `generation_text`, and the complete final run passed. No DDL/constraint was weakened for that correction. No development connection, private environment access, grant/credential changes or permanent records were used.

The history proposal was installed **only for this isolated test**, not assigned a migration number or applied to development. Synthetic status paths test stored enums/graph/history mechanics; they do not establish real Allocation totals, clinical/inventory decisions, pre-issue cancellation, web-session authentication, production deployment or multi-connection concurrency. Disposable fixtures do not satisfy the eventual permanent sample-data requirement.

The standalone verifier performs no DDL and imports no private configuration. Before writes it requires an already assembled, fresh, dedicated schema with exactly Account, Hospital, BloodGroup, HospitalRequest, RequestStatusHistory and AuditEvent, the eight canonical BloodGroup rows, the three expected triggers and no views/routines/events. It verifies the connected data directory/port, strict mode and enabled FK/unique checks. Refusal of populated operational tables protects existing work. All DML is one rollback-only transaction; no success is printed unless rollback, empty-table checks, context reset and close succeed.

Safe isolated assembly, after explicit authorization of the target: **001 → 002 → reference_data.sql → 004 → 008 → 010 → unnumbered history proposal**. Only that isolated test may install the proposal before numbering is settled. `database/tests/helpers/mysql-script.mjs` handles the checked-in Workbench DELIMITER directives without sending them to MySQL; it is not an untrusted SQL parser or a new migration framework. Never run an installed-development setup batch or seed to reproduce this test.

Run static/regression checks from backend with a sanitized child environment and the existing no-private-env loader, as documented in the Hospital/AuditEvent READMEs. The disposable SQL verifier is `node database/tests/verify-blood-requests.mjs` from the repository root, with all of these explicitly supplied process variables:

- PHASE3_REQUEST_TEST_DATABASE: `bddc_phase3_test_requests_<label>`, maximum 64 characters.
- PHASE3_REQUEST_TEST_EMPTY_DATABASE: YES, only for the separately authorized fresh target.
- DB_HOST: explicit loopback; DB_PORT: explicit valid port other than 3306.
- PHASE3_REQUEST_TEST_DATA_DIRECTORY: absolute checkout `.tmp/audit-mysql-<label>/data` or `.tmp/requests-mysql-<label>/data`, matching the actual server.
- PHASE3_TEST_DB_USER and PHASE3_TEST_DB_PASSWORD: existing disposable-only login, explicitly passed (an explicit empty test password is allowed on that dedicated instance). No application-credential or DB_NAME fallback exists.

Do not print secrets or use a development login. Do not change grants/credentials if verification lacks permission; stop and report that blocker. The verifier does not create schemas or install prerequisites. A passwordless test bootstrap can be passed through a sanitized Node child environment, following the existing [AuditEvent verification instructions](audit-foundation.md#verification-evidence); do not modify its login to satisfy a harness.

## Review and development application

1. Review 008 and its two guards with the schema owner. Inspect Account/Hospital/BloodGroup metadata in the intended local schema using SHOW CREATE TABLE; verify canonical unsigned keys/InnoDB. Confirm HospitalRequest is absent and inspect triggers before application. These are manual read-only preflight steps, not commands executed against development by this task.
2. On a fresh disposable schema use the exact assembly above and reproduce the verifier. Do not treat source/static tests as a live MySQL pass.
3. For an existing development schema with 001/002/004 already installed, **apply only the reviewed 008 once** in Workbench, preserving DELIMITER directives. Do not rerun foundation, seed, Hospital or AuditEvent setup. DDL auto-commits; on any partial error stop and inspect rather than rerun/drop populated objects.
4. Coordinate the separate history migration number, proposed context names/trusted-system policy and application sequence before promoting its SQL. Do not apply `database/proposals/request-status-history.sql` directly to development or repurpose 010. Initial request APIs must not be mounted until the reviewed history objects and AuditEvent are installed.
5. Development/teammate installation, trigger-definer/runtime privileges, lookup rules and concurrency still require their own review/verification. This task changes no grants and runs no development migration.

Optional manual preflight in Workbench reads metadata only:

```sql
USE blood_donation_coordination;
SELECT DATABASE() AS selected_schema, VERSION() AS server_version;
SELECT TABLE_NAME, ENGINE, TABLE_COLLATION
FROM information_schema.TABLES
WHERE TABLE_SCHEMA = DATABASE()
  AND LOWER(TABLE_NAME) IN ('account', 'hospital', 'bloodgroup', 'hospitalrequest', 'requeststatushistory', 'auditevent');
SHOW CREATE TABLE Account;
SHOW CREATE TABLE Hospital;
SHOW CREATE TABLE BloodGroup;
SELECT TRIGGER_NAME, ACTION_TIMING, EVENT_MANIPULATION
FROM information_schema.TRIGGERS
WHERE TRIGGER_SCHEMA = DATABASE() AND LOWER(EVENT_OBJECT_TABLE) = 'hospitalrequest';
```

Treat 008 alone as storage. Do not perform operational request/status DML until the coordinated history objects and authenticated transaction services are integrated. If a request/history object already exists, inspect it and stop rather than rerun CREATE or remove data to make the migration succeed.

## Sky Pipeline — recorded frontend requirements only

Screens 12 Create Blood Request, 13 My Blood Requests, 14 Blood Request Details and 25 Admin Blood Request Management are assigned **Sky Pipeline**. Proposed routes remain `/hospital/requests/new`, `/hospital/requests`, `/hospital/requests/:requestId`, `/admin/requests`. No React route/component/CSS is implemented here; Feature 6 keeps Mint Gauge.

| Token | Value |
|---|---|
| Background / cards / alternate | #F3F9FF / #FFFFFF / #E8F2FD |
| Border / strong border | #D9E8F8 / #BFD6F0 |
| Primary / primary button / secondary yellow | #3B8BEB / #2F78D6 / #F7C948 |
| Main / muted text | #1E3050 / #6B80A0 |
| Success / warning / emergency | #3FB68B / #F2B84B / #E5636D |
| Typography | Lexend headings; Mulish body/controls |

Use responsive cards/tables, accessible labelled statuses and real API data. Request history is a branching/repeating lifecycle with terminal cancellation/rejection, not a fabricated linear completion percentage. Show authoritative current status/history timestamps and separately labelled real allocated/issued/outstanding quantities only when that dependency is implemented. Include loading, empty, safe error/retry and denied-access states; no fake records or statistics.

## Remaining decisions and readiness

- History migration number/application coordination and acceptance of the proposed context/definer contract remain OPEN. Its SQL/mechanics are tested, not deployed.
- Shared Account approval remains Thulasi's work. The user's PENDING Hospital cannot perform ACTIVE-only request operations without legitimate approval; no bypass or temporary application account is provided.
- Role/status-specific blood-group lookup visibility, inactive-group behavior and any relative needed-by cutoff must be settled before request creation is mounted.
- Real Allocation storage/transaction interfaces are required for fulfillment reads and cancellation. Admin cancellation after partial issue remains OPEN and has no new endpoint here.
- Production request audit action/reason mappings and shared locking/concurrency verification remain pending; test strings do not approve them.

HospitalRequest storage is ready for review/application. Backend design and isolated service work can build on the tested draft, but mounting the full Feature 7 APIs is gated by coordinated history deployment and the actual Allocation/lookup contracts. No API or UI is claimed complete by this database milestone.

## Files in this milestone

Created: `database/proposals/request-status-history.sql`, `database/tests/helpers/mysql-script.mjs`, `database/tests/verify-blood-requests.mjs`, `backend/tests/requests-schema.test.js`, this document.

Modified: `database/migrations/008_blood_requests.sql`, `database/README.md`, `docs/database-design.md`, `docs/relational-schema.md`, `docs/implementation-readiness.md`, `docs/ui-design.md`. No commit, push or merge was performed.
