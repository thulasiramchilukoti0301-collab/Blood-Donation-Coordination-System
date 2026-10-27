# Admin Account management frontend

## Implemented boundary

The user selected **Mint Gauge** for the shared `/admin/accounts` supporting flow. The heading and navigation label are **Account management**. Only restored, authenticated ACTIVE ADMIN identities may open it; signed-out users go to sign-in and other roles/states go to access denied. The Admin landing route remains `/admin/hospitals`, and navigation stays in the shared header.

Thulasi owns shared Account authentication/status management. Lathikaa retains Hospital/Audit ownership. Hospital Management remains read-only and has no Hospital-only mutation. The existing Account supporting flow extends Screens 16/24 without adding a 31st screen or completing Donor Management. Password change, staff creation, donor corrections, group confirmation, audit viewing and operational workflows remain outside scope. Continuing personal branches, cumulative open PR #5 and deferred main integration are unchanged.

## Queue and exact actions

The page retains the existing credentialed GET, email search, PENDING/Both roles defaults and Clear behavior, role/status filters, 20-row pagination, safe field projection, BIGINT decimal strings and explicit Asia/Kolkata/IST timestamps. Loading, empty, error/retry, responsive Mint/Sora/Nunito Sans styling, accessible labels and focus states are retained.

Each DONOR/HOSPITAL row has exactly one source-state action, excluding self targets and Admin targets:

- PENDING: **Approve**, sending exactly `{ accountStatus: "ACTIVE", reason: "REGISTRATION_REVIEWED" }`.
- ACTIVE: **Suspend**, sending exactly `{ accountStatus: "SUSPENDED", reason: "ACCESS_RESTRICTED" }`.
- SUSPENDED: **Reactivate**, sending exactly `{ accountStatus: "ACTIVE", reason: "ACCESS_RESTORED" }`.

All use the existing PATCH `/api/admin/accounts/:accountId`. No actor, role, profile fields, arbitrary reason or new endpoint is sent. The legacy `approveAccount` service remains a fixed approval wrapper; it cannot reinterpret approval as reactivation. Backend authorization and transition checks remain authoritative.

## Confirmation and request lifecycle

A confirmation captures a frozen Account ID/email/role, source status and intended action. The named confirmation region displays that identity, exact source/destination, controlled reason code and consequence. Suspension ends existing sessions and prevents login; reactivation requires fresh login and never restores old sessions. Approval keeps its existing fresh-sign-in explanation. The heading receives focus; Cancel/Escape before submission closes the region, restores trigger focus and sends no mutation.

The page validates its captured selection against the current queue row and action. Fresh CSRF is fetched in the same shared-client auth lifecycle, and identity/selection/source/action are checked again immediately before dispatch. An obsolete confirmation is discarded, never changed into a different action. A backend source-state conflict refreshes the queue without claiming success.

One synchronous submission guard covers all actions and remains held across filter/page changes until a dispatched PATCH settles. Read/CSRF cancellation or an obsolete UI does not abort or undo that PATCH. Mutations are never automatically retried. Success requires HTTP 200, `success: true`, the selected string Account ID and the intended destination status. Only then does the page announce the specific saved action and reload the queue, correcting an out-of-range last page.

A confirmed save followed by failed refresh is explicitly shown as **Approval/Suspension/Reactivation was saved, but the queue could not be refreshed**. Retry performs GET only. ACCOUNT_APPROVAL_CONFLICT and ACCOUNT_STATUS_CONFLICT have safe conflict messages. Dispatched timeouts, unknown commits, malformed/mismatched success and server failures produce uncertain-outcome messages and read recovery. A matching current status is not proof this request caused the change; reading it never manufactures success or triggers a blind PATCH retry.

## Authentication and stale responses

The workspace remains keyed by auth lifecycle plus Account identity/role/status, including same-ID re-login. Logout and protected-401 invalidation clear rows, confirmations and notices. Obsolete reads, CSRF and mutation completions cannot populate a newer workspace, and an older identity's 401 cannot clear a newer login. A transient preflight 503 preserves identity and dispatches nothing. Existing shared Donor/Hospital authentication/profile flows are unchanged.

## Verification of the status-control extension (2026-10-27)

The automated checks use test-only API fixtures. The [earlier USER-RUN Donor cycle](account-status-backend.md#user-run-donor-status-cycle-evidence-reported-2026-10-27) used the browser Console; the later [USER-RUN page cycle](#user-run-account-management-ui-evidence-reported-2026-10-27) exercised these controls. Historical automated and USER-RUN evidence below retains its original scope. The final full frontend run passed **57 tests: 56 unit/service tests plus one real isolated Chrome suite; 0 failed, 0 skipped**. Twelve added unit/service tests exercise both roles and all exact actions, frozen confirmations, invalid targets/source pairs, delayed-CSRF cancellation/identity/source changes, expected-destination validation and safe conflict/uncertainty behavior. All prior approval, Hospital, Donor and shared-auth tests are retained.

The browser suite passed **69 scenarios at each of four viewports**, with **460 assertions per viewport (1840 total)**: 1262 px desktop (1247 px content), 768/753 px tablet, 390/375 px phone and 337/322 px narrow mobile. It preserves the 40 earlier scenarios and adds 29 rendered status-control scenarios for role/action visibility, identity/transition/reason/consequence confirmations, Cancel/Escape/focus, exact CSRF/PATCH, duplicate guards across filters/pages, stale approval/source conflicts, success/refresh failure, conflict/timeout/unknown/malformed responses, same-ID re-login, old 401s and current-session cleanup. Labels and overflow are checked at all four widths.

The first expanded browser run exposed Chrome rapid-history throttling during the increased fixture navigation volume: three retained Hospital navigation cases stalled on a blank intermediate route. Disabling the history IPC throttle only in each isolated temporary Chrome profile allowed all assertions to pass; no production Hospital/router behavior, test timeout or assertion was weakened. Test-only timeout diagnostics now identify the route and heading. The final full rerun after service cleanup passed with the counts above.

Vite **8.3.4** production compilation passed for **106 modules**, with configFile:false, envDir:false and write:false; output remained in memory. The runner whitelisted OS environment settings and set NODE_ENV explicitly; DB variables and NODE_OPTIONS were excluded. Seven plain JavaScript syntax checks and git diff --check passed; JSX was compiled by Vite and the real browser harness. No backend tests were rerun. No private configuration was read, and no live API/MySQL operation was performed. These fixture/browser results do not establish live status-control behavior, audit counts, MySQL concurrency, rollback, multi-device revocation or the full security matrix.

## Automated verification (2026-10-26)

With only whitelisted OS environment settings and NODE_ENV=test, the full frontend run passed **45 tests: 44 unit/service tests plus one real isolated Chrome suite; 0 failures, 0 skipped**. Nine new unit/service tests cover filter/ID/time/response validation, exact CSRF/PATCH calls, obsolete preflight completions, safe conflicts and uncertain outcomes. The real browser suite retains the 20 previous Hospital/Donor/shared scenarios and adds 20 Account approval scenarios.

All **40 scenarios passed at each of four viewports**, with 237 assertions per viewport (**948 total**): 1262 px desktop (1247 px content), 768/753 px tablet, 390/375 px phone and 337/322 px narrow mobile. Coverage includes guards/restoration/retry, filters/paging/empty/error states, keyboard Escape/focus restoration, responsive overflow and Mint styling, exact payload, duplicate prevention, last-page correction, saved/refresh-failed distinction, conflict/timeout/unknown/malformed outcomes, stale reads/CSRF, same-ID re-login, older-identity 401 and session invalidation. The first run exposed a test timing assertion that checked navigation before the destination rendered; waiting for the actual Hospital heading fixed the assertion, and the full rerun passed. Final review also retained the in-flight guard across filter changes until a dispatched PATCH settles; the added rendered regression passed in the final 40-scenario run.

Count reconciliation uses the existing implementation-task execution output in the project conversation, not a new test run: an earlier successful Chrome run recorded **39 scenarios and 234 assertions at each viewport (936 total)**. The subsequent in-flight filter-change guard regression produced the final **40 scenarios and 237 assertions at each viewport (948 total)** quoted above. Both successful outputs recorded 45 frontend tests passing with zero failures/skips. The earlier counts remain historical; the latest counts are substantiated by that later execution output. No tests were rerun for this documentation update.

Vite 8.3.4 production compilation passed for **106 modules**, with `configFile: false`, `envDir: false` and `write: false`; output stayed in memory and private configuration was not loaded. Five plain JavaScript syntax checks passed; JSX was compiled by Vite. `git diff --check` passed. The initial sandbox denied subprocess creation (EPERM); authorized isolated runs completed successfully afterward. No backend tests were rerun in this frontend milestone.

These are test-only Axios fixtures in a real browser, not live approval/MySQL evidence or an application login bypass. The historical **215/223 backend runs (31 Account tests after expiry correction)** and **USER-RUN Console/Workbench evidence** remain separate in the [backend guide](account-approval-backend.md#historical-automated-results).

## USER-RUN frontend evidence (2026-10-26)

Source: observations supplied by the user, separate from the automated runs above and the earlier [backend Console/Workbench evidence](account-approval-backend.md#user-run-account-approval-evidence-2026-10-26). This documentation task did not run approvals, query MySQL or rerun tests.

- Admin navigation opened `/admin/accounts` with Mint Gauge styling.
- The ACTIVE status filter displayed previously approved accounts.
- Clear filters restored PENDING and Both roles.
- Opening and cancelling Account 1's approval confirmation left that Donor pending.
- The Admin subsequently approved that Donor through the actual page.
- The page displayed success and refreshed to an empty pending queue.
- Refreshing the applicant's previously open Incognito profile required sign-in; fresh sign-in displayed ACTIVE.
- A read-only Workbench query confirmed exactly one ACCOUNT_APPROVED event for that Account.

Repeated manual sign-ins also displayed the existing rate-limit warning. No backend restart, timed recovery or comprehensive rate-limit test was reported.

This is one live **Donor approval through the new UI**. It does not establish live Hospital approval through this UI; the earlier Hospital approval evidence used the browser Console. No personal profile values, credentials, session material or operation-ID values are recorded here.

## USER-RUN Account management UI evidence (reported 2026-10-27)

Source: observations supplied by the user, separate from the earlier [Console-driven Donor cycle](account-status-backend.md#user-run-donor-status-cycle-evidence-reported-2026-10-27), the 2026-10-26 approval-page observation and the automated results above. This documentation update did not run status changes, query MySQL or rerun tests. No exact execution time is claimed.

- Admin opened Account management and filtered ACTIVE accounts. Cancelling Suspend left the test Donor ACTIVE.
- Confirming Suspend succeeded and refreshed the ACTIVE queue. The Donor's previously open Incognito profile required sign-in, and login while suspended was refused.
- Cancelling Reactivate left the Donor SUSPENDED. Confirming Reactivate succeeded; the old session remained signed out, and a fresh login displayed ACTIVE.
- A read-only Workbench query showed ACCOUNT_SUSPENDED and ACCOUNT_REACTIVATED counts for that Account increasing from **one each before this UI cycle to two each afterward**. Both actions retained their approved ADMIN actors, reasons and transition summaries: ACCESS_RESTRICTED / `ACTIVE -> SUSPENDED` and ACCESS_RESTORED / `SUSPENDED -> ACTIVE`.

This is one reported **Donor suspension/reactivation cycle through the Mint Account management page**. It does not verify Hospital controls, real concurrency, rollback, all-session/multi-device revocation or the broader security/API-tampering matrix. No personal identifiers, credentials or session material are recorded.

## Remaining manual verification

The following remain pending; further live checks require separate authorization and appropriate intended/disposable data:

- Live multi-page pagination and mobile/tablet visual verification. The automated responsive checks above do not replace these live observations.
- Live conflict, uncertainty, saved-approval/failed-refresh and authentication-race UI cases; do not blindly retry PATCH after an uncertain outcome.
- Live Hospital approval through the shared UI, beyond the earlier Console evidence.
- Real concurrent MySQL login/approval, expiry during MySQL lock waits, transaction failure/rollback, ambiguous commits, all-session/multi-device revocation and the broader security/API-tampering matrix.
- Suspension/reactivation have the separately documented backend extension and two distinct reported Donor cycles: the earlier [Console cycle](account-status-backend.md#user-run-donor-status-cycle-evidence-reported-2026-10-27) and the later [page cycle](#user-run-account-management-ui-evidence-reported-2026-10-27). Hospital UI status controls and further live edge cases remain pending. Password change and other deferred workflows remain unimplemented.

The existing backend authorization remains mandatory regardless of hidden UI actions. The historical Donor approval success, cancellation, empty queue, observed sign-in requirement and one-event count, together with the later Donor status page cycle, do not prove those pending guarantees or complete Phase 3, authentication, Feature 6 or the 30-screen baseline.
