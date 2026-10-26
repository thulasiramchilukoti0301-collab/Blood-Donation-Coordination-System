# Shared Account approval backend

## Implemented boundary

Thulasi owns the shared Authentication & Role Access implementation. This bounded backend milestone mounts `GET /api/admin/accounts` and `PATCH /api/admin/accounts/:accountId` for current ACTIVE ADMIN sessions. Its original milestone implemented **DONOR/HOSPITAL PENDING -> ACTIVE approval**. The later [bounded suspension/reactivation extension](account-status-backend.md) reuses this PATCH with two separately controlled reason/status pairs; this guide retains the approval contract and its historical evidence. This backend milestone itself made no frontend changes. The later [Mint Account approval supporting flow](account-approval-frontend.md) mounts `/admin/accounts`; Hospital Management still displays status read-only, and no screen is added to the 30-screen baseline.

Suspension/reactivation are bounded extensions documented in the status guide; the later Mint Account management UI implements their controls with fixture-based checks, with a separate [USER-RUN Donor page cycle reported 2026-10-27](account-approval-frontend.md#user-run-account-management-ui-evidence-reported-2026-10-27) following the [earlier Console cycle](account-status-backend.md#user-run-donor-status-cycle-evidence-reported-2026-10-27); Hospital UI status and deeper live checks remain pending. Password changes, staff account creation, blood-group confirmation, audit search/UI and other operational workflows remain deferred. First-Admin bootstrap remains separate manual/out-of-band provisioning; it does not approve applicants. Lathikaa retains Audit/Hospital ownership; her audit writer and its connection/validation contract are unchanged. Continuing personal branches, reviewed pushed checkpoints, open cumulative PR #5 and deferred main integration remain unchanged.

## Account queue

- ACTIVE ADMIN authentication is required; the service rechecks the actor's current database role/status in addition to the shared HTTP guard.
- Allowed query keys are `role`, `accountStatus`, `search`, `page` only. `role` is optional DONOR or HOSPITAL; ADMIN Accounts are always excluded. `accountStatus` defaults to PENDING and may explicitly be PENDING, ACTIVE or SUSPENDED. No ALL token is introduced.
- `search` is an optional email substring, at most 254 Unicode code points before trimming, without control characters; accepted input is trimmed. Literal `!`, `%` and `_` are escaped with `!` before parameterized LIKE matching. No profile/medical fields are searched.
- `page` defaults to 1 and is a canonical positive decimal string within the safe offset bound. Pages contain 20 rows; ordering is `created_at`, then numeric `account_id`, ascending. Out-of-range pages are empty and retain the real total. Count/list are separate reads and do not promise a concurrent snapshot.
- HTTP 200 returns `{ success: true, accounts, pagination: { page, pageSize: 20, total } }`. Each Account has only `accountId` (decimal string), `email`, `role`, `accountStatus`, `createdAt` (project-local DATETIME text `YYYY-MM-DD HH:mm:ss`). There are no hashes, sessions or profile details. Responses use `Cache-Control: no-store`.

## Exact approval contract

Use the target's canonical positive unsigned-BIGINT Account ID in the path. The JSON body must contain exactly:

```json
{
  "accountStatus": "ACTIVE",
  "reason": "REGISTRATION_REVIEWED"
}
```

Extra body/query fields, arbitrary text reasons and unsupported transitions are rejected. The additional exact suspension/reactivation pairs are documented separately; REGISTRATION_REVIEWED still permits only PENDING -> ACTIVE. The actor comes only from the verified server session; identity/role headers cannot override it. Shared trusted-Origin and session-bound `X-CSRF-Token` checks apply. Admin targets and self-targets are refused; a missing target is not found. An already ACTIVE or SUSPENDED target conflicts. Repeated approval produces no additional audit event. Role, profile, password and blood-group fields are never changed.

Success is HTTP 200 `{ success: true, accountId, accountStatus: "ACTIVE" }`, only after commit and successful connection cleanup; it is `no-store`. Existing safe error envelopes apply: 400 VALIDATION_ERROR; 401 AUTHENTICATION_REQUIRED/ACCOUNT_UNAVAILABLE; 403 FORBIDDEN, ACCOUNT_TARGET_FORBIDDEN or the shared Origin/CSRF errors; 404 ACCOUNT_NOT_FOUND; 409 ACCOUNT_APPROVAL_CONFLICT; sanitized 503 storage/transaction errors. Unconfigured runtime dependencies fail closed.

## Transaction and audit mapping

One connection/transaction locks actor and target Accounts in ascending **numeric Account ID** order and rechecks current ACTIVE ADMIN actor and eligible PENDING target. It updates only target `account_status` plus application-maintained `updated_at`, tombstones all target sessions through `revokeAccountSessions(targetId, connection)`, then invokes the existing audit writer once on that same connection. Commit occurs only after all steps succeed. No pool-based revocation is used inside this transaction.

The caller's explicit registry now contains the three controlled Account action codes in the status guide; this approval operation writes only `ACCOUNT_APPROVED`. Its server-generated event has:

- `actionCode`: ACCOUNT_APPROVED.
- `actorAccountId`: verified locked Admin ID.
- `subjectType`: Account; `subjectId`: target ID.
- `reasonCode`: REGISTRATION_REVIEWED.
- `changeSummary`: fixed text `PENDING -> ACTIVE`.
- `operationId`: a server-generated UUID.

The request body is never passed to the writer. No credentials, profile or medical data are included. The later status extension also resolves ACCOUNT_SUSPENDED / ACCESS_RESTRICTED and ACCOUNT_REACTIVATED / ACCESS_RESTORED; other production mappings remain OPEN. The writer acquires no connection and independently starts/commits no transaction.

All failures roll back the complete operation. A rollback failure destroys the connection. Failed release also attempts destruction; no uncertain connection is returned for reuse. Ambiguous commit or cleanup after commit returns a safe `TRANSACTION_OUTCOME_UNKNOWN`, never success; inspect current status before retrying. A committed retry conflicts rather than duplicating the event.

## Login and session coordination

The existing Account and `app_session` schema are sufficient; no migration is added. All cooperating authenticated session writers use the same Account-before-session lock order:

1. Login verifies bcrypt before acquiring locks. Under the Account lock it rechecks the verified Account's email, hash and role, plus current allowed account state. Changed credentials/role or unavailable state are denied. PENDING -> ACTIVE that committed while bcrypt ran may establish a fresh ACTIVE login.
2. While that lock is held, login rotates the SID, tombstones the previous SID, sets a new CSRF token and explicitly saves the authenticated session on the **same transaction connection**. `MysqlSessionStore.withLoginTransaction` uses a per-async-context connection, not a global mutable connection. The session is durable with the transaction commit before the lock is released. No bcrypt comparison runs while locked.
3. Authenticated JSON now contains `accountId`, `role` and the login-time `accountStatus`. Protected middleware rejects a state mismatch as ACCOUNT_UNAVAILABLE and destroys the session. The later status extension also locks/revalidates the stored SID alongside Account state at the guard and again within profile-write transactions; matching ACTIVE state after a complete cycle is insufficient. See the status guide for authorization points and in-flight behavior. **Existing authenticated sessions without this state snapshot must log in again after rollout.** This is an internal JSON format change, not a schema or public payload expansion.
4. Only the coordinated login path may INSERT a new authenticated SID, with no upsert. Normal authenticated `set`/`touch` acquire the Account lock, verify current role/state, then lock the session row with `SELECT ... FOR UPDATE`. They read fresh time only after both locking reads complete, so expiry during either lock wait cannot be extended. The expiry predicate and finite TTL use that post-lock time. UPDATE still requires an existing, unexpired, non-revoked SID with matching stored principal/state. An expired row is left unchanged by `set`/`touch`; subsequent `get` rejects and tombstones it. They cannot insert a missing SID or upgrade a pending snapshot. Anonymous CSRF saves retain their guarded upsert and cannot overwrite an authenticated payload.
5. The installed Express session implementation can save or touch again at response end even after explicit login save. Those calls use the guarded normal path above. Failed/uncertain login clears the request session and cookie; response cleanup tombstones the SID rather than implicitly authenticating it. Logout tombstones, finite expiry, CSRF handling and retained-tombstone stale-save protection remain in effect.

If login commits first, approval subsequently revokes that durable pending session. If approval commits first, login waits and establishes a new session using post-approval state. A session already loaded before approval cannot gain ACTIVE access through current-account reload or later saves. Controlled database doubles exercise these interleavings; they do not prove real MySQL scheduling or locking behavior.

## Prerequisites and verification

The already approved Account, InnoDB `app_session` and AuditEvent 010 structures must be installed, with existing private database/session configuration. The application identity needs the appropriate Account reads/locking read/update, session reads/inserts/updates and AuditEvent INSERT. No grants or schema are created by runtime startup. Use a legitimate ACTIVE Admin through normal login; do not rerun bootstrap to obtain test Accounts. The existing separate Hospital/Donor setup evidence remains as dated records.

### Historical automated results

Codex's initial database-free approval run on 2026-10-26 passed **215 backend tests, 0 failed, 0 skipped**, including **23 Account approval/session tests**, all prior Donor/Hospital/Audit and first-Admin regressions. All 18 relevant JavaScript syntax checks and git diff --check passed; documentation checks resolved 162 local links/anchors and confirmed 56 unique API method/path rows and 30 baseline screens. The no-private-env loader and whitelisted OS environment plus NODE_ENV=test excluded database variables and NODE_OPTIONS. Tests use injected SQL/session dependencies and local ephemeral HTTP servers, never MySQL or private configuration. Existing Hospital assertions still count domain transactions separately from new login/session coordination transactions. The initial pre-new-test run had seven obsolete fixture/count/404 expectations; those fixtures were adapted without removing domain assertions, and complete reruns passed.

The session-expiry follow-up on 2026-10-26 passed **223 backend tests, 0 failed, 0 skipped**, including 31 Account approval/session tests. Eight added controlled-clock cases suspend the actual store path at Account or session-row locking reads for both `set` and `touch`: expiry during the wait leaves the stored row unchanged and subsequent `get` rejects/tombstones it; unexpired writes retain successful persistence, matching principals and fresh-time TTL/predicates. The five changed JavaScript files passed syntax checks, and git diff --check passed. This uses the same private-configuration-disabled runner and injected database dependencies; real MySQL lock waits remain unverified.

### USER-RUN Account approval evidence (2026-10-26)

Source: observations supplied by the user, separate from the historical automated runs above. This documentation task did not execute approvals, database queries or tests.

- An authenticated Admin retrieved the pending-account queue successfully; it initially contained two Donors and one Hospital.
- Admin approval changed one pending Donor to ACTIVE.
- Refreshing that Donor's previously open Incognito profile required sign-in; fresh sign-in displayed ACTIVE.
- Workbench confirmed the Donor approval audit record: ADMIN actor, ACCOUNT_APPROVED action, REGISTRATION_REVIEWED reason, fixed `PENDING -> ACTIVE` summary and a populated operation ID. No identity or operation-ID value is copied here.
- Admin approval changed the pending Hospital to ACTIVE.
- Repeating Hospital approval returned HTTP 409 ACCOUNT_APPROVAL_CONFLICT.
- Refreshing the Hospital's previously open Incognito profile required sign-in; fresh sign-in displayed ACTIVE.
- A read-only Workbench count confirmed exactly one ACCOUNT_APPROVED event for each approved Account, including after the Hospital retry.

Approval requests were invoked through the **browser Console**. Existing profile screens displayed the resulting ACTIVE state. **At that Console verification checkpoint, no frontend approval controls had been implemented.** The later [Mint Account approval supporting flow](account-approval-frontend.md) has separate isolated verification and subsequent [USER-RUN Donor UI evidence](account-approval-frontend.md#user-run-frontend-evidence-2026-10-26); neither is part of the earlier Console evidence or proof of Hospital UI approval. These observations verify only the stated queue, Donor/Hospital approval, retry conflict, observed profile sign-in requirement and audit-record/count outcomes. They do not establish all-session or multi-device revocation.

### Remaining verification boundary

The user-run observations do not prove real concurrent login/approval, expiry during MySQL lock waits, transaction failure/rollback, ambiguous commits, all-session/multi-device revocation or the full security/API-tampering matrix. Those boundaries remain unverified live; controlled automated interleavings are not real MySQL concurrency evidence. Further checks require separate authorization and an appropriate local/disposable target, including both login/approval orderings, delayed response-time saves/touches, permissions and cleanup/error cases. Queue filtering/pagination and safe-field coverage beyond the reported retrieval also remain database-free only. No new live check is claimed by this documentation task. Suspension/reactivation have backend implementation/database-free coverage and the later bounded Mint controls; the separate Donor page cycle is recorded in the frontend guide; Hospital UI status and further verification remain pending. Password change and other deferred workflows remain unimplemented; the bounded Mint approval frontend is now implemented under its later authorization, with separate [USER-RUN evidence of one Donor approval through the page](account-approval-frontend.md#user-run-frontend-evidence-2026-10-26). Live Hospital UI approval, multi-page/mobile/tablet and edge-case frontend verification remain pending.
