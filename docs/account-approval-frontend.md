# Admin Account approval frontend

## Implemented boundary

The user selected **Mint Gauge** for the shared `/admin/accounts` supporting flow. Only restored, authenticated ACTIVE ADMIN identities may open it; signed-out users go to sign-in and other roles/states go to access denied. The existing Admin landing route remains `/admin/hospitals`. Header navigation keeps its placement and adds Account approvals beside Hospital management; active navigation is derived from the current route, including when both pages use Mint.

Thulasi owns shared Account authentication/approval. Lathikaa retains Hospital/Audit ownership. Hospital list/detail reads and their read-only status display remain intact: this page uses the shared Account endpoints, not a Hospital-only mutation. It supports the account-approval portions of planned Donor Management and Hospital Management without adding a 31st baseline screen or implementing complete Donor Management. Suspension/reactivation, password change, donor corrections, blood-group confirmation, audit viewing, dashboards and other workflows remain unimplemented. Open cumulative PR #5, continuing personal branches and deferred main integration are unchanged.

## Queue and confirmation

- The existing credentialed Axios client calls `GET /api/admin/accounts`. Initial/Clear filters use PENDING, both roles and page 1. Both roles omits `role`; there is no ALL token or all-status option. Role options are DONOR/HOSPITAL; statuses are PENDING/ACTIVE/SUSPENDED.
- Applied email search is trimmed after validating the backend's raw 254-code-point limit and control-character exclusion. Search/Clear resets page 1. Pagination uses the server's total and fixed 20-row pages; no synthetic records or totals are supplied.
- Only Account ID, email, role, account status and created time enter the queue view. IDs remain decimal strings, including values beyond JavaScript's safe numeric range. Project-local `YYYY-MM-DD HH:mm:ss` timestamps are parsed with the explicit `+05:30` offset and displayed in Asia/Kolkata/India Standard Time.
- Loading, empty, validation, safe failure/retry and success states are present. Only PENDING DONOR/HOSPITAL rows have Approve; ACTIVE/SUSPENDED rows are read-only.
- Approve opens a labelled, non-modal confirmation region showing the selected ID, email and role, the fresh-sign-in consequence, and fixed reason **Registration reviewed**. Its heading receives focus. Cancel or Escape before submission closes it and restores trigger focus; no mutation is sent. Native form buttons remain keyboard accessible, with visible focus and announced progress/errors. Confirmation/Cancel are disabled during submission; navigation/filter changes can invalidate the view without undoing a dispatched transaction.
- Confirm fetches fresh CSRF with `GET /api/auth/csrf`, validates its response, rechecks the current authentication lifecycle and selected query/page, then sends only the existing body below with `X-CSRF-Token`:

```json
{
  "accountStatus": "ACTIVE",
  "reason": "REGISTRATION_REVIEWED"
}
```

`PATCH /api/admin/accounts/:accountId` receives no actor, role, email or extra fields. A synchronous submission guard prevents duplicate clicks and remains held across filter changes until the request settles. Success requires HTTP 200, `success: true`, the matching string Account ID and ACTIVE status; the UI never optimistically activates a row or invents an audit result.

Success reloads the real queue. If the last row disappears and its page is out of range, the page moves to the server-derived last page. A saved approval followed by a failed GET is explicitly shown as **approval saved / queue refresh failed**; retry reloads GET only. HTTP 409 ACCOUNT_APPROVAL_CONFLICT shows changed/stale state and refreshes without claiming this Admin approved it. Dispatched network/timeouts, TRANSACTION_OUTCOME_UNKNOWN and unconfirmed success payloads show an uncertain outcome and refresh for checking. PATCH is never retried automatically; a pending-looking row after uncertainty is not proof that a previous transaction failed.

## Authentication lifecycle and stale requests

The shared AuthProvider exposes a lifecycle version and a current-ref accessor. Restored identities, login, logout and protected-session invalidation produce fresh scopes, including signing out and back into the same Account. The approval workspace is keyed by that version plus identity/role/status, clearing protected rows, confirmation, messages and drafts on replacement/unmount.

Reads use AbortController and applied-filter/page/revision keys. Obsolete responses cannot populate a newer scope, and the current selection/lifecycle is rechecked after awaiting CSRF and immediately before PATCH. The existing version-aware session-invalidation interceptor remains in use: an older request's 401 cannot clear a newer login. Aborting obsolete reads/CSRF does not abort a dispatched mutation or roll back its server transaction; late mutation responses are ignored by obsolete workspaces.

## Visual boundary

Reuse the existing Mint viewport background `#F1FAF6`, white rounded cards, mint borders, `#1E8A71` primary buttons with white labels, Sora headings and Nunito Sans controls. Explicit status text, labelled filters, wrapping emails/IDs, scoped responsive table/cards, focus outlines and existing reduced-motion support are retained. No decorative gauges, invented metrics, UI dependencies or Rose Quartz restyling are added. At narrow/tablet widths the queue uses labelled stacked rows; navigation stays in the shared header.

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

## Remaining manual verification

The following remain pending; further live checks require separate authorization and appropriate intended/disposable data:

- Live multi-page pagination and mobile/tablet visual verification. The automated responsive checks above do not replace these live observations.
- Live conflict, uncertainty, saved-approval/failed-refresh and authentication-race UI cases; do not blindly retry PATCH after an uncertain outcome.
- Live Hospital approval through the shared UI, beyond the earlier Console evidence.
- Real concurrent MySQL login/approval, expiry during MySQL lock waits, transaction failure/rollback, ambiguous commits, all-session/multi-device revocation and the broader security/API-tampering matrix.
- Suspension/reactivation, password change and other deferred workflows remain unimplemented.

The existing backend authorization remains mandatory regardless of hidden UI actions. The stated Donor success, cancellation, empty queue, observed sign-in requirement and one-event count do not prove those pending guarantees or complete Phase 3, authentication, Feature 6 or the 30-screen baseline.
