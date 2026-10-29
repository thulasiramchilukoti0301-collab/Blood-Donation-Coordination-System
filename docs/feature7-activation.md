# Feature 7 — approved non-allocation activation, 2026-10-27

## Current route update — 2026-10-29

The runtime now also mounts the approved Hospital cancellation and Admin review subset in the current working tree. `POST /api/hospitals/me/requests/:requestId/cancellation` is ACTIVE owning-Hospital only, requires same-session CSRF, rejects non-empty bodies, and refuses cancellation while active Allocation rows exist. It emits one `HOSPITAL_REQUEST_CANCELLED` event with fixed summary/reason and the migration 012 trigger writes one history row. `POST /api/admin/requests/:requestId/review` is ACTIVE Admin only, requires same-session CSRF and the exact `{ "decision": "UNDER_REVIEW" }` body; it permits only `SUBMITTED → UNDER_REVIEW`, uses `REVIEW_STARTED`, writes one `HOSPITAL_REQUEST_STATUS_CHANGED` event, and relies on the history trigger. Both audit rows share the corresponding mutation transaction.

These routes are present in uncommitted working-tree changes and passed the database-free backend suite; the Hospital UI cancellation flow passed real-browser fixture checks at desktop, tablet and mobile widths. No live request existed in the development DB during this verification, so neither mutation has been exercised against real HTTP/MySQL data. Allocation, fulfillment, priority, rejection and other status transitions remain unavailable.

The approved subset is implemented and mounted: Hospital creation/list/detail, Admin list/detail and the real authenticated active-group lookup. All four existing Sky Pipeline screens use their production API clients. **Ready for live end-to-end testing after manual development schema/permission preflight.** No development database connection, migration, data change, account/grant/credential change, commit, staging or push was performed by Codex.

Branch `lathikaa`; HEAD `a1c3217a6133c9ef92fae07571a17ec8445964f0`. Read-only `git ls-remote` confirmed `origin/thulasiram` at `f002796a3abe7598c05eef31a3eeaf7c03415f30` and `origin/lathikaa` at `5b7f45acf38bba3e583b245939b2959c88efcf12`. Migration 012 was absent from the current tree/untracked files, reachable migration history and the confirmed teammate commit. No separate local thulasiram worktree exists; unpublished files on another computer are not observable. This reservation follows the user's explicit report of Thulasi's approval. No existing migration was renumbered.

## Installed code and exact public subset

| Method/path | Protection and response |
|---|---|
| `GET /api/blood-groups` | ACTIVE HOSPITAL/ADMIN only; `{ success: true, bloodGroups: [{ bloodGroupId, code, displayName }] }`; database-backed active rows, stable ID order, no query parameters or compatibility matrix. |
| `POST /api/hospitals/me/requests` | ACTIVE Hospital, authoritative profile/session and Origin/CSRF; `{ success: true, requestId, requestStatus: 'SUBMITTED', outstandingQuantity }`, HTTP 201 after commit. Initial outstanding is exactly requested; no allocation exists for the new request. |
| `GET /api/hospitals/me/requests` | ACTIVE Hospital; SQL ownership predicate; `{ success: true, requests, pagination: { page, pageSize: 20, total } }`. |
| `GET /api/hospitals/me/requests/:requestId` | ACTIVE owning Hospital; `{ success: true, request }`, with genuine `requestStatusHistory`. Missing and foreign records have the same 404. |
| `GET /api/admin/requests` | ACTIVE Admin; same list envelope, safe Hospital summary. |
| `GET /api/admin/requests/:requestId` | ACTIVE Admin; same detail envelope plus safe Hospital summary and genuine history. |

The bounded request fields are `requestId`, `recipientGroupId`, `recipientBloodGroupCode`, `recipientBloodGroupName`, `quantityRequested`, `priority`, `neededBy`, `note`, `requestStatus`, `rejectionReasonCode`, `createdAt`, `updatedAt`. Admin adds `hospital: { hospitalId, organizationName }`. Detail adds `requestStatusHistory: [{ oldStatus, newStatus, changedAt }]` ordered by stored timestamp/history ID. It excludes staff notes, donor identifiers/provenance, credentials and sessions. Allocation arrays and allocated/issued/outstanding **read** totals are omitted, not zero-filled. The frontend labels unavailable totals honestly. This explicitly implements a bounded subset of the future Allocation projection in api-design.md.

Create accepts exactly `recipientGroupId`, integer `quantityRequested` 1–65,535, exact `priority` (`EMERGENCY`, `URGENT`, `NORMAL`), `neededBy`, optional non-sensitive `note` (500 code points; no controls). Server supplies Hospital/status/actor; unknown fields are rejected. The Hospital must be ACTIVE with a legitimate stored SID and linked Hospital profile. The group row must exist and have `is_active = 1`, rechecked under its creation lock. Later deactivation never invalidates an existing request or hides its historical group display.

Hospital/Admin filters remain `requestStatus`, `priority`, `recipientGroupId`, `submittedFrom`, `submittedTo`, `neededByFrom`, `neededByTo`, `page`; Admin also accepts `hospitalId`. Page numbers start at 1 with fixed 20 rows. Admin orders EMERGENCY/URGENT/NORMAL, neededBy ascending, createdAt ascending, requestId ascending. Hospital publicly exposes one stable newest-first order (createdAt descending, requestId descending); selectable sort/free-text search are not implemented. Unknown/repeated structured query values and malformed IDs are rejected.

`neededBy` accepts second-precision `YYYY-MM-DDTHH:mm:ssZ` or `YYYY-MM-DDTHH:mm:ss±HH:MM`. Seconds are required; fractions, leap seconds, date-only/offset-free values, invalid calendar dates and offsets beyond ±14:00 are rejected. The instant must be strictly future, checked before transaction work and again after lock waits. No extra lead-time cutoff is introduced. Numeric offsets describe instants even across DST boundaries; no server/browser local-time guess is used. Store IST wall time in the existing DATETIME and serialize request/history timestamps as `YYYY-MM-DDTHH:mm:ss+05:30`. The pool uses the established +05:30 driver/session convention. Filters accept ISO calendar dates and include complete local IST days; ranges must not be reversed. Filter bounds are not subject to the creation deadline rule.

Runtime only performs parameterized reads/DML and metadata preflight. It never creates schema. It checks visibility of HospitalRequest/RequestStatusHistory/AuditEvent and all three request triggers on each operation; absent or invisible objects return safe `503 REQUEST_STORAGE_UNAVAILABLE`. Missing database/session configuration remains a safe error through the existing shared guards. Driver details never reach the API. Protected request responses use `Cache-Control: no-store`.

## Migration, context and audit guarantees

`database/migrations/012_request_status_history.sql` is the canonical approved migration. Its table definition, seven columns, indexes and restrictive FKs exactly preserve the tested proposal. Only necessary trigger security is strengthened: UUID-only NULL-actor status changes are refused; every actual status change requires a verified ACTIVE human actor and controlled reason. Existing Admin cancellation refusal and owning-Hospital cancellation restriction remain. These storage checks do not implement Allocation predicates or authorize an HTTP cancellation route.

The single AFTER UPDATE trigger writes one history row only when status changes. It writes nothing on no-op status or priority-only updates, including without context. Creation has no AFTER INSERT history trigger; the service manually inserts exactly one NULL → SUBMITTED history row on the request transaction connection.

Controlled status/reason mapping is shared by code and migration:

| New status | Reason code |
|---|---|
| UNDER_REVIEW | REVIEW_STARTED |
| AWAITING_INVENTORY | INVENTORY_UNAVAILABLE |
| PARTIALLY_FULFILLED | ALLOCATION_UPDATED |
| FULFILLED | REQUEST_FULFILLED |
| REJECTED | REQUEST_REJECTED, also matching the request's rejection_reason_code |
| CANCELLED | HOSPITAL_CANCELLED; only the owning Hospital is allowed by this trigger |

The creation AuditEvent is `HOSPITAL_REQUEST_CREATED`, subject `HospitalRequest`, server ID/actor/UUID, NULL reason and fixed summary `Hospital request created`. The explicit registry also accepts the approved future `HOSPITAL_REQUEST_STATUS_CHANGED` and `HOSPITAL_REQUEST_CANCELLED`; no operational route emits them yet. Future cancellation must use only its specific code, never an additional generic status-change event. `HOSPITAL_REQUEST_PRIORITY_CHANGED` is not activated because priority editing is not implemented. Arbitrary notes, patient text, contact data and tokens never enter audit summaries/reasons. Internal review preparation remains disabled in the production runtime; future callers must use the exact mapping and a fixed canonical-status summary.

Creation transaction order is Account lock → authoritative stored SID check → Hospital lock → BloodGroup lock/activity/future deadline check → request insert → initial history insert → existing AuditEvent writer on the same connection → commit. Failure rolls back all writes; no audit writer transaction or separate connection is used. Status mutation preparation acquires Account/session before request; the trigger repeats actor checks. Future Allocation writers must agree on the full lock order before activation.

Clear `@request_actor_account_id`, `@request_reason_code`, `@request_system_operation_id` on checkout and after commit/rollback before reuse. Status context sets only the verified server actor/allowlisted reason and keeps system-operation NULL. MySQL rollback does not reset these variables. Failed checkout/reset/rollback or ambiguous commit destroys the connection rather than releasing it. Preserve the safe original operation error on failed cleanup; post-commit reset failure reports `TRANSACTION_OUTCOME_UNKNOWN` and must not be blindly retried.

## Frontend integration and remaining scope

The original screens remain at `/hospital/requests/new`, `/hospital/requests`, `/hospital/requests/:requestId`, `/admin/requests`. Production capabilities are now enabled for the implemented subset. The create form loads the real `/api/blood-groups` choices, validates IST fields, gets fresh CSRF, prevents duplicate submission and navigates to the persisted request only after confirmed HTTP 201. Definite validation rejection permits correction; transport/commit uncertainty never displays success or retries automatically. Missing infrastructure keeps submission disabled and shows an unavailable state. Lists/details use real clients, filter/page keys, AbortController and auth lifecycle checks to discard stale responses, including same-account fresh login. Admin detail opening/closing moves/restores keyboard focus.

Sky Pipeline CSS remains scoped; the supplied palette and Lexend/Mulish setup are preserved. Mint Gauge Hospital and shared Donor/Account implementations remain intact. No compatibility matrix, FEFO, allocations, issue/fulfillment, cancellation, review/rejection HTTP mutation, priority edit, dashboards or audit-log UI is implemented. No fabricated records/totals/history are shipped in production.

## Verification evidence

All runs use sanitized environments; the backend loader disables private dotenv loading and Vite tests/build use `envDir: false`.

- Complete backend suite: **297 passed, 0 failed, 0 skipped** (including 31 focused request service/HTTP/context/timestamp checks plus schema checks).
- Complete frontend suite: **67 passed, 0 failed, 0 skipped**.
- Production frontend build: passed (main JS approximately 686 kB; non-blocking bundle-size advisory).
- Fresh MySQL 8.0.39: migration assembly **001 → 002 → canonical reference seed → 004 → 008 → 010 → 012** passed exact table/index/FK/trigger metadata, all 72 negative checks, initial/conditional/no-op/priority history, reason/actor rejection, status/history/audit rollback, restrictive references and context reset. 11 request/15 history fixtures rolled back and all operational fixture tables were empty afterward.
- Real disposable HTTP/session/MySQL verification: **115 assertions passed**. It exercises the actual mounted runtime, shared auth/store, CSRF, real creation/list/detail/lookup, cross-Hospital 404, ACTIVE/role restrictions, group deactivation, future/IST round trip, exact initial history/audit, audit-failure rollback, revocation and missing/extra-trigger refusal. Injected rollback/reset-method failures wrap real mysql2 sockets to verify physical destruction/no release; this is failure injection, not a natural network outage.
- Browser: **15 Sky Pipeline scenarios per viewport**, with **170/170/171/171 assertions passed** at actual desktop 1258px, tablet 768px and mobile 390px/337px. These cover actual App routes, authenticated group lookup, production client create → persisted-detail navigation, list/detail filters/pagination, real supplied history only, unavailable totals, unavailable infrastructure, denied roles/statuses, stale identity replies, focus and responsive layouts. Existing shared Donor/Hospital/Account browser regression also passed **69 scenarios/460 assertions per viewport**. Test records live only under `frontend/tests/`; no real-development browser flow is claimed. Basic labels, keyboard focus and no horizontal overflow were checked, not a full assistive-technology audit.
- `git diff --check`: **passed**. A separate whitespace scan passed for **all 50 manifest files**, including untracked files.

Disposable instances are fresh workspace `.tmp/requests-mysql-feature7_<unique>/data` directories, use a random non-3306 loopback port with `--no-defaults`, and shut down only their own newly spawned server. Schema names/data directories are checked before DML. No existing server/config/login is reused. Source verifier entry point is `node database/tests/run-request-disposable.mjs --allow-fresh-disposable --http`; run only after explicit disposable-instance authorization. Its Windows binary path is the existing MySQL Server 8.0 install. It never reads `.env`. It leaves disposable files in ignored `.tmp` rather than deleting unrelated directories. No development installation, development live browser flow, MySQL 9.x replay or multi-connection workflow concurrency is claimed.

## Safe manual development installation

These are instructions for the user/schema owner; Codex did not run them. Select the intended local development schema in MySQL Workbench first. Never run foundation/seed/setup batches over existing data.

1. Run this **read-only** metadata preflight in the owner connection:

```sql
USE blood_donation_coordination;
SELECT DATABASE() AS selected_schema, CURRENT_USER() AS connected_as,
       VERSION() AS server_version, @@port AS server_port,
       @@session.time_zone AS session_zone, @@session.sql_mode AS sql_mode;
SELECT TABLE_NAME, ENGINE, TABLE_COLLATION
FROM information_schema.TABLES
WHERE TABLE_SCHEMA = DATABASE()
  AND LOWER(TABLE_NAME) IN ('account','hospital','bloodgroup','app_session',
                            'hospitalrequest','auditevent','requeststatushistory');
SELECT TRIGGER_NAME, ACTION_TIMING, EVENT_MANIPULATION, EVENT_OBJECT_TABLE,
       DEFINER, ACTION_STATEMENT
FROM information_schema.TRIGGERS
WHERE TRIGGER_SCHEMA = DATABASE()
  AND LOWER(EVENT_OBJECT_TABLE) = 'hospitalrequest';
SHOW CREATE TABLE Account;
SHOW CREATE TABLE Hospital;
SHOW CREATE TABLE BloodGroup;
SHOW CREATE TABLE app_session;
```

2. For each existing target, separately run `SHOW CREATE TABLE HospitalRequest;`, `SHOW CREATE TABLE AuditEvent;`, `SHOW CREATE TABLE RequestStatusHistory;` as applicable. Compare checked-in SQL, unsigned keys/InnoDB/check constraints/indexes/FKs and trigger bodies. Parent prerequisites are 001/002/004 and the existing session infrastructure; do not rerun those or the reference seed. Metadata presence does not prove a migration version. Existing history objects from the old proposal must be reviewed against 012; do not blindly rerun CREATE or drop/replace a populated object.

3. Open only the missing reviewed scripts in Workbench using these paths (PowerShell lists them; it does not execute SQL):

```powershell
Set-Location -LiteralPath 'C:\Users\91787\Documents\dbms proj\Blood-Donation-Coordination-System'
Get-Item -LiteralPath database/migrations/008_blood_requests.sql,
  database/migrations/010_audit.sql,
  database/migrations/012_request_status_history.sql
```

If HospitalRequest and both 008 guards are entirely absent, apply **008 once**. If AuditEvent is absent, apply **010 once** after Account; preserve the approved AuditEvent DDL. If RequestStatusHistory and its AFTER UPDATE trigger are entirely absent, apply **012 once** after Account/HospitalRequest. Keep Workbench DELIMITER directives intact. A valid existing 008/010 is left alone; often only 012 is missing. 009/011 are not dependencies of this subset. If a future 011 object reads history, 012 must precede it. On a partial DDL error/inconsistent object set, **stop and inspect**, because MySQL DDL auto-commits; do not rerun/drop objects as a shortcut.

4. Repeat the metadata query and inspect `SHOW CREATE TRIGGER trg_request_initial_status;`, `SHOW CREATE TRIGGER trg_request_update_guard;`, `SHOW CREATE TRIGGER trg_request_status_history_update;`. Confirm the numbered trigger's human actor, controlled reason, Account lock, matching rejection reason and no UUID-only bypass. Confirm exactly three request triggers and no duplicate AFTER INSERT/AFTER UPDATE history writer.

5. In the **existing application-user connection**, run read-only checks:

```sql
SELECT CURRENT_USER(), DATABASE(), @@session.time_zone;
SHOW GRANTS FOR CURRENT_USER;
SELECT request_id FROM HospitalRequest LIMIT 0;
SELECT request_id FROM RequestStatusHistory LIMIT 0;
SELECT audit_event_id FROM AuditEvent LIMIT 0;
SELECT blood_group_id, code, display_name, is_active FROM BloodGroup ORDER BY blood_group_id;
SELECT TRIGGER_NAME FROM information_schema.TRIGGERS
WHERE TRIGGER_SCHEMA = DATABASE() AND EVENT_OBJECT_TABLE = 'HospitalRequest';
```

Confirm existing Account/Hospital/BloodGroup/session access, request/history/audit SELECT and required INSERT permissions, SELECT/locking access to authorization rows, existing session-write permissions and visibility of the three request triggers. Trigger metadata visibility can require TRIGGER privilege on this server; runtime intentionally fails closed if it is absent. Trigger definer/runtime privileges must also be valid. Do not grant anything or create accounts automatically; report missing permissions to the schema owner. Do not use INSERT/UPDATE probes against development records to test grants. InnoDB locking-read permissions should be checked for the target MySQL version by the owner; no grant change is included here.

6. Restart the existing backend process normally, then start/refresh the frontend. Do not start a duplicate server on the same port. In separate PowerShell terminals, using your existing private configuration without displaying it:

```powershell
Set-Location -LiteralPath 'C:\Users\91787\Documents\dbms proj\Blood-Donation-Coordination-System\backend'
npm run dev
```

```powershell
Set-Location -LiteralPath 'C:\Users\91787\Documents\dbms proj\Blood-Donation-Coordination-System\frontend'
npm run dev
```

7. Use a legitimately approved ACTIVE Hospital session. At `/hospital/requests/new`, confirm real active group options, choose a whole quantity/priority/future IST deadline, and manually submit **one intentional real request**. Confirm navigation to its saved ID, one initial SUBMITTED history row and correct timestamp. Verify it in `/hospital/requests`, refresh/detail and structured filters. Using a different legitimate Hospital, the same ID must return the same 404 as a missing request; do not treat a frontend route guard as the backend ownership check. ACTIVE Admin `/admin/requests` must show the saved request in priority/neededBy/submission/ID order and show real history in details. PENDING/wrong-role/signed-out sessions must be refused. Cancellation/fulfillment/review/priority controls remain absent. No demo request or Account-status change is automated by these instructions. Check safe 503s if setup is incomplete; never infer success from a submitted form.

## Reviewed files and Git checkpoint commands

The exact complete checkpoint allowlist is [feature7-checkpoint-manifest.json](feature7-checkpoint-manifest.json). It includes the previously untracked Feature 7 implementation, numbered SQL, server integration, four existing screens, tests and documentation. It excludes `.env`, dependencies, build outputs, test logs/profiles/data directories and unrelated work. Ordinary `git diff` omits untracked files; review the manifest entries directly too. Existing 008/010 and shared Account/Donor/Hospital service implementations are unchanged.

Run these commands manually from the repository root after review. Codex has not staged, committed or pushed anything:

```powershell
Set-Location -LiteralPath 'C:\Users\91787\Documents\dbms proj\Blood-Donation-Coordination-System'
if ((git branch --show-current) -ne 'lathikaa') { throw 'Stop: expected lathikaa.' }
$feature7Paths = Get-Content -LiteralPath docs/feature7-checkpoint-manifest.json -Raw | ConvertFrom-Json
foreach ($feature7Path in $feature7Paths) {
  if (-not (Test-Path -LiteralPath $feature7Path -PathType Leaf)) { throw "Missing file: $feature7Path" }
}
$unexpectedStaged = @(git diff --cached --name-only | Where-Object { $_ -notin $feature7Paths })
if ($unexpectedStaged.Count) { throw 'Stop: unrelated staged work exists; preserve and review it separately.' }
git status --short --branch
git diff --check
if ($LASTEXITCODE -ne 0) { throw 'Fix whitespace before staging.' }
git diff --stat
# Review every listed untracked file before the next line; no wildcard staging.
git add -- $feature7Paths
if ($LASTEXITCODE -ne 0) { throw 'Staging failed; inspect without discarding work.' }
git diff --cached --check
if ($LASTEXITCODE -ne 0) { throw 'Fix staged whitespace before committing.' }
git diff --cached --stat
git diff --cached --name-only
git diff --cached -- $feature7Paths
# Continue only after reviewing the exact staged patch:
git commit -m "Activate bounded Feature 7 requests and Sky Pipeline integration"
if ($LASTEXITCODE -ne 0) { throw 'Commit failed; stop.' }
if ((git branch --show-current) -ne 'lathikaa') { throw 'Stop: branch changed.' }
git push origin lathikaa
```

No force-push, merge, stash application, reset/clean or automatic migration is part of the checkpoint. A non-fast-forward push must be inspected separately; do not rewrite shared history.

Final Git state: `lathikaa` at the unchanged HEAD above; **14 tracked modified files and 36 untracked files**, including preserved prior Feature 7 work. The **50-file manifest exactly matches** their union and was checked for missing paths and secrets/artifact exclusions. Nothing staged, no unmerged paths, no commit/push. Existing 008/010, the original history proposal and shared Account/authentication/Hospital backend service files remain unchanged. Remaining live-testing gates are manual development 008/010/012 installation/structure/metadata visibility/permissions and legitimate ACTIVE sessions; Feature 8 dependencies do not block testing this explicitly bounded create/read subset.
