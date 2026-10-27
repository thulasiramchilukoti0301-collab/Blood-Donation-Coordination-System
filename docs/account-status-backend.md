# Audited Account suspension and reactivation backend

## Implemented boundary

Thulasi's bounded Authentication & Role Access extension reuses `PATCH /api/admin/accounts/:accountId` and the existing Account, app_session and AuditEvent structures. No new endpoint, schema, frontend, dependency or bootstrap behavior is added. Lathikaa retains Hospital/Audit ownership; her audit writer remains unchanged. At this backend milestone the Mint Account page was approval-only. The later [bounded Account management UI](account-approval-frontend.md) now supports the same three exact actions; a [later user-reported Donor page cycle](account-approval-frontend.md#user-run-account-management-ui-evidence-reported-2026-10-27) exercised Suspend and Reactivate, with Hospital UI checks still pending. Hospital Management itself still has no status controls. The 30-screen baseline, continuing personal branches, cumulative open PR #5 and deferred main integration are unchanged.

The [original approval contract and historical evidence](account-approval-backend.md) remain valid. This extension adds only ACTIVE -> SUSPENDED and SUSPENDED -> ACTIVE for DONOR/HOSPITAL targets. PENDING -> SUSPENDED, Admin/self targets, role/profile changes, password change, staff creation, donor corrections, group confirmation and other operational workflows remain outside scope.

## Exact request, response and audit mapping

Use a canonical positive unsigned-BIGINT decimal-string Account ID in the path. The body contains exactly `accountStatus` and `reason`, with one of these pairs:

- Approval: `{"accountStatus":"ACTIVE","reason":"REGISTRATION_REVIEWED"}` requires PENDING; writes ACCOUNT_APPROVED, reason REGISTRATION_REVIEWED, fixed summary `PENDING -> ACTIVE`.
- Suspension: `{"accountStatus":"SUSPENDED","reason":"ACCESS_RESTRICTED"}` requires ACTIVE; writes ACCOUNT_SUSPENDED, reason ACCESS_RESTRICTED, fixed summary `ACTIVE -> SUSPENDED`.
- Reactivation: `{"accountStatus":"ACTIVE","reason":"ACCESS_RESTORED"}` requires SUSPENDED; writes ACCOUNT_REACTIVATED, reason ACCESS_RESTORED, fixed summary `SUSPENDED -> ACTIVE`.

Reasons are controlled codes, never free text. Extra body/query properties, malformed IDs and mismatched reason/status pairs return safe HTTP 400 VALIDATION_ERROR. The current ACTIVE ADMIN actor comes only from the verified session; supplied actor headers/IDs cannot replace it. Existing trusted-Origin and session-bound CSRF checks apply. A missing target returns 404 ACCOUNT_NOT_FOUND; Admin/self targets return 403 ACCOUNT_TARGET_FORBIDDEN. Missing or invalid authentication returns the existing safe 401; other roles receive 403 FORBIDDEN.

Wrong source state or retry returns 409 ACCOUNT_STATUS_CONFLICT for the two new operations. Approval retains 409 ACCOUNT_APPROVAL_CONFLICT and its existing message for ACTIVE/SUSPENDED targets: an old REGISTRATION_REVIEWED request can never reactivate an Account. Refused operations create no audit event.

Success is the existing HTTP 200 envelope `{ success: true, accountId, accountStatus }` with the committed target status and `Cache-Control: no-store`. No success is returned before commit and connection cleanup. Storage/transaction failures use sanitized 503 errors, including TRANSACTION_OUTCOME_UNKNOWN for an ambiguous commit or cleanup after commit; refresh current status before deciding whether to retry. A committed retry conflicts instead of writing a second event.

## One transaction and connection

1. Lock actor and target Account rows in ascending numeric Account ID order using the existing transaction owner.
2. Recheck the actor's ACTIVE ADMIN state and authoritative stored SID, then the target's role and exact source state.
3. Parameterize the target status update, including explicit `updated_at = CURRENT_TIMESTAMP` and the expected source-state predicate.
4. Tombstone every existing target session with `revokeAccountSessions(targetId, connection)` on that same connection. This applies to approval and **both** new transitions.
5. Write exactly one event through the unchanged transaction-aware Audit writer. The caller registry contains ACCOUNT_APPROVED, ACCOUNT_SUSPENDED and ACCOUNT_REACTIVATED. Actor is the locked verified Admin; subjectType is Account, subjectId is the target; action/reason/summary are the fixed mapping above, and operationId is a server-generated UUID.
6. Commit only after all steps succeed. Earlier failures roll back status, sessions and audit together. Failed rollback destroys the connection; failed release attempts destruction. Uncertain disposal never reports success or knowingly returns an unsafe connection for reuse.

The writer neither obtains a connection nor begins/commits a transaction. It receives only the controlled event fields, never the request body, credentials, session material, personal/medical details or raw errors. This resolves these three Account mappings only; unrelated audit mappings remain pending.

## Authoritative session authorization and in-flight requests

Role/status equality alone cannot authorize a loaded session after ACTIVE -> SUSPENDED -> ACTIVE. No `updated_at` generation or process-local revocation map is used.

- Every protected HTTP guard takes the principal and SID from the server session, locks its Account, then locks the stored app_session row on the same connection. It checks current permitted Account role/state, existence of the SID, null revoked_at, non-null valid payload, matching stored Account ID/role/login-time state, and finite unexpired stored expiry. Fresh time is sampled **after** the session-row lock wait. A missing, expired, tombstoned or mismatched row fails closed, even if the Account is ACTIVE again. Database/cleanup failures are safe 503 responses, not authorization success.
- The guard's authorization point is the successful Account/SID check while both locks are held. Its short transaction completes before downstream read handling. A read already authorized may finish after a later suspension/logout; revocation does not recall a response or undo committed work. A later guard must recheck the stored SID.
- Donor and Hospital self-profile writes repeat that same authoritative SID check **inside their existing write transaction**, after locking Account and before locking/updating the domain profile. Account and SID locks remain held through the write transaction. A request delayed across the complete status cycle cannot write using its old in-memory principal. If the profile transaction owns those locks first, it may commit before a waiting suspension; that already committed edit is not undone.
- Account status mutations likewise revalidate the acting Admin's stored SID after acquiring the numerically ordered Account locks. The internal session context is server-created and never accepted from body/query data or returned publicly.
- SUSPENDED Accounts cannot establish authenticated sessions. Login still verifies bcrypt before locking, rechecks credentials/role/current state under Account lock, rotates SID and CSRF, and inserts the new authenticated SID on that same transaction connection before commit. If login commits first, suspension then revokes its durable SID. If suspension wins, login's locked recheck refuses it. A credential request begun earlier may create a **new** SID if its locked recheck occurs after reactivation and credentials still match; it never reuses a revoked SID.
- Reactivation tombstones target sessions again; it never restores payload, clears revoked_at, or makes an old cookie valid. Fresh credential login is required. Existing guarded authenticated set/touch remain update-only, preserving stored principal, finite expiry and post-Account/session-lock expiry checks. Stale response-time writes cannot recreate missing SIDs or revive tombstones. Logout and anonymous-CSRF behavior are preserved.

## Automated verification (2026-10-26)

The initial complete backend suite passed **251 tests, 0 failed, 0 skipped**, using the no-private-env loader and only whitelisted OS variables plus NODE_ENV=test. DB environment variables and NODE_OPTIONS were excluded. This includes all historical approval/expiry, Donor/Hospital, Audit and bootstrap coverage, plus **28 new status/session tests**. Existing HTTP fixtures explicitly provide stored-session evidence; production has no MemoryStore fallback.

New injected service/repository/HTTP tests cover both roles and transitions, exact mappings, current Admin/role/CSRF/Origin guards, forbidden inputs/targets, actor forgery, stale approval/retries, one-connection writes, all-step rollback, ambiguous commits and failed disposal. Controlled interleavings cover login/status ordering, delayed credential proofs, competing transitions, stale set/touch, loaded sessions across a same-time complete cycle, post-row-wait expiry, and both delayed and already-authorized profile writes. Existing eight set/touch Account/session-lock expiry regressions remain passing.

The first expanded run passed 244/245; the new combined-role HTTP fixture exceeded the unchanged five-attempt login limiter. Isolating each role's complete HTTP flow kept rate limiting intact. The final run includes additional credential-proof, competing-transition and profile-before-suspension regressions. All 22 changed/new JavaScript files passed `node --check`, and `git diff --check` passed. Documentation checks resolved 234 relative links/anchors and confirmed 56 unique API method/path rows and exactly 30 baseline screens. Historical 215/223 backend, 192 bootstrap, frontend and USER-RUN evidence remain separate in their original guides.

These automated runs are database-free tests using controlled injected SQL/session dependencies and local ephemeral HTTP servers. No private configuration, MySQL connection, schema change or live status mutation was used by those runs. They do not establish live suspension/reactivation, real database lock scheduling, multi-device revocation or browser status controls; later USER-RUN evidence is recorded separately below.

### Donor transaction-cleanup follow-up (2026-10-26)

The Donor repository now attempts destruction after failed rollback and never releases that connection, including when destruction throws. A failed release also attempts destruction and returns safe 503 DATABASE_UNAVAILABLE, without retrying release or exposing driver/cleanup details. Normal commit and successful rollback still release normally. A stored-SID authorization rejection with successful cleanup retains its original safe 401; failed rollback instead returns the safe storage error. A release failure after commit does not undo that commit or report success; refresh before retrying. Field allowlists, ownership and locked session checks are unchanged.

Nine new injected Donor regressions cover failed rollback and failed release with successful/failing destruction, including a revoked stored SID rejected before domain writes and a missing SID with successful rollback. Existing Account login regressions now compare the entire pre-existing fixture session map, assert the attempted login SIDs are absent, and assert no target-account session became durable; they do not rely on a fixed total that includes the two Admin fixtures.

The follow-up full backend run passed **260 tests, 0 failed, 0 skipped**, preserving the earlier 251 cases. It used the same private-configuration-disabled loader and sanitized environment. Syntax checks passed for the three changed JavaScript files, and `git diff --check` passed. These are injected tests only; live MySQL cleanup/concurrency remains unverified. The historical counts and USER-RUN evidence above and in the original guides are unchanged.

## USER-RUN Donor status-cycle evidence (reported 2026-10-27)

Source: observations supplied by the user, separate from the historical automated **260-test** result and earlier approval/bootstrap evidence. This documentation task did not access MySQL, execute a Workbench query, rerun mutations or run application tests. The date is the report date; no exact execution time is claimed.

- Admin suspended an ACTIVE Donor through the browser Console.
- The Donor's previously open Incognito profile required sign-in.
- Login while suspended was refused.
- Admin reactivated that Donor through the Console.
- The old session remained signed out after reactivation.
- Fresh credential login succeeded and displayed ACTIVE.
- A read-only Workbench query confirmed exactly one ACCOUNT_SUSPENDED event and one ACCOUNT_REACTIVATED event for the tested Account.
- Both events had ADMIN actors. ACCOUNT_SUSPENDED used reason ACCESS_RESTRICTED and summary `ACTIVE -> SUSPENDED`; ACCOUNT_REACTIVATED used reason ACCESS_RESTORED and summary `SUSPENDED -> ACTIVE`.

This establishes the reported outcomes for **one Donor suspension/reactivation cycle**, including the observed old-session rejection, fresh-login result and audit counts/mappings. Status changes used the Console; at that reported checkpoint the Mint page was approval-only. This historical evidence does not verify the later suspension/reactivation controls. It does not establish Hospital suspension/reactivation, concurrency, expiry during MySQL lock waits, rollback/failure/ambiguous-commit behavior, all-session or multi-device revocation, or the full security/API-tampering matrix. No personal identifiers, credentials or session material are recorded. Ownership, remaining scope, the 30-screen baseline, cumulative open PR #5 and deferred main integration are unchanged.

## Remaining live checks and setup

Existing installed Account, InnoDB app_session and AuditEvent structures and private application/session configuration are prerequisites; no new SQL or grant change is required by this extension. Existing scoped Account reads/updates, session reads/inserts/updates and AuditEvent INSERT must be available. This task did not inspect configuration or verify permissions.

Beyond the Console-driven Donor cycle above and the separately reported page cycle, remaining live checks require separate authorization and disposable/local data: the Hospital cycle and audit counts; additional Donor/security cases, stale approval/retry conflict; all-session/multi-device revocation; both login/status orderings; profile requests and expiry delayed by real Account/session locks; failure/rollback/cleanup and ambiguous commits; and the broader security/API-tampering matrix. The later Mint Account management UI has fixture-based verification and a separate [user-reported Donor page cycle](account-approval-frontend.md#user-run-account-management-ui-evidence-reported-2026-10-27). The earlier Console and approval-page observations retain their original scope; Hospital UI status controls and further live security/failure cases remain pending. Remaining Phase 3/domain workflows retain their authorization gates.
