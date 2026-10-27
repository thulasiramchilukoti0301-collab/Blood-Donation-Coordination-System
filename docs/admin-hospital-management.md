# Admin Hospital Management — Feature 6

Screen 24 at `/admin/hospitals` provides authenticated, read-only Hospital management using the real API and existing mysql2 Hospital repository/service. An ACTIVE ADMIN may search, filter, page through saved Hospital profiles and open a profile details panel. A Hospital's Account status is displayed as saved. Account approval, suspension and reactivation are shared dependencies; this screen has no nonfunctional status-action buttons or Hospital-only Account update path.

The complete bounded Hospital checkpoint contains five implemented APIs: public Hospital registration, own-profile GET/contact-only PATCH, and the two Admin GET routes below. Hospital Registration within Login, Hospital Profile and Screen 24 are the three implemented Mint Gauge surfaces. See [Hospital frontend status](hospital-frontend.md) for the applicant flows; these delivered reads/forms do not imply the full approved Feature 6 account-status workflow is complete.

`/api/admin/hospitals/` is the trailing-slash form of the list route. The approved identifier-based detail route is `/api/admin/hospitals/:hospitalId`. The details panel remains within Screen 24 rather than adding a screen to the 30-screen baseline.

## Mounted API contracts

| Method and route | Input | Successful response |
|---|---|---|
| `GET /api/admin/hospitals` | Optional `search`, `accountStatus`, `page` query parameters | HTTP 200 `{ success: true, hospitals: [profile], pagination: { page, pageSize: 20, total } }` |
| `GET /api/admin/hospitals/:hospitalId` | Required Hospital shared Account ID in path | HTTP 200 `{ success: true, profile }` |

Both responses set `Cache-Control: no-store`. Each `profile` contains exactly these management fields:

| Field | Contract |
|---|---|
| `hospitalId` | Positive unsigned BIGINT Account/Hospital shared key, represented as a decimal string |
| `organizationName` | Saved organization name |
| `registrationNumber` | Saved registration number, or `null` |
| `contactName` | Saved contact name |
| `phone` | Saved contact phone |
| `address` | Saved address |
| `createdAt`, `updatedAt` | Saved Hospital timestamps |
| `accountStatus` | Exact `PENDING`, `ACTIVE` or `SUSPENDED` Account status |

No password, hash, email, session identifier, CSRF token or unrelated Account fields are selected. A detail lookup must identify a Hospital joined to an Account whose role remains HOSPITAL. It cannot retrieve another role's profile by guessing its Account ID. `HospitalRequest` storage/services are not implemented: the response and UI omit request summaries rather than fabricating zero requests, fulfillment counts or statistics. The approved future operational summary is still deferred.

Example list requests, to be used only in an already authenticated trusted browser session:

```http
GET /api/admin/hospitals?page=1
GET /api/admin/hospitals?accountStatus=PENDING&page=1
```

For search, supply a URL-encoded fragment from an existing Hospital's organization name, registration number, contact name or phone. For detail, use that real row's returned `hospitalId` as the final path segment. These instructions do not provision records or prescribe fictitious IDs.

### Validation and query behavior

- Only `search`, `accountStatus` and `page` are accepted on the list. An unknown property, duplicate parameter array or structured query value fails validation. No client-selected actor ID, role, page size or SQL sort expression is accepted.
- `search` is trimmed, optional/blank for all matches, at most 180 Unicode code points, and excludes ASCII control characters. It matches organization, registration, contact name or phone. Values are bound parameters, with `%`, `_` and `!` escaped for literal LIKE searches. Address, email and arbitrary Account IDs are not search fields. Case/accent matching follows the installed MySQL column collation.
- Omit `accountStatus` for all statuses. When supplied it must be exactly `PENDING`, `ACTIVE` or `SUSPENDED`; an empty status value is invalid. An ACTIVE Admin may view any of those target Hospital statuses.
- `page` defaults to 1. It must be a canonical positive decimal integer within the existing safe offset bound. Page size is fixed at 20. Results sort by organization name then Account ID. An out-of-range page returns an empty `hospitals` array with the real total; it does not invent another page's rows.
- A detail ID must be a positive decimal unsigned BIGINT no greater than `18446744073709551615`, without leading zeros. IDs remain strings to avoid JavaScript integer precision loss.
- Count and list are separate SQL reads; a concurrent registration/status change may make a displayed total temporarily differ from that page. Refresh/retry obtains current data; these reads do not claim a transactional snapshot.

### Authentication, authorization and safe errors

The router reuses the established persistent session middleware, `requireCurrentAccount`, `requireRole('ADMIN')` and `requireActiveAccount`. Only the verified `req.authAccount.accountId` becomes the trusted actor passed to the existing Hospital service, which also reloads current Account role/status. Request headers, query/body roles and arbitrary actor IDs cannot select the acting Admin. Shared authentication/login/Donor behavior is retained.

| Condition | Safe result |
|---|---|
| No authenticated session | HTTP 401 `AUTHENTICATION_REQUIRED` |
| Valid DONOR/HOSPITAL session, including permitted pending sessions | HTTP 403 `FORBIDDEN` |
| Current Account missing, SUSPENDED, role-changed, or PENDING ADMIN | Current session invalidated; HTTP 401 `ACCOUNT_UNAVAILABLE` |
| Account changes after the shared guard but before domain authorization | Denied by service; no Hospital read returned |
| Invalid query or detail ID | HTTP 400 `VALIDATION_ERROR` |
| Missing Hospital profile or non-Hospital target Account | HTTP 404 `HOSPITAL_NOT_FOUND` |
| Database/storage failure | Safe service/session error; no raw driver details or SQL |

Errors retain `{ success: false, error: { code, message } }`, with approved optional validation fields where applicable. The new endpoints read application data and need no CSRF header. Existing state-changing routes still require session-bound CSRF and the trusted Origin. Credentialed CORS remains restricted to the configured frontend origin; no cross-origin wildcard or security relaxation is needed for these GET reads. No Admin Account mutation endpoint is mounted here.

## Frontend and Mint Gauge scope

`frontend/src/features/hospitals/AdminHospitalManagement.jsx` implements Screen 24. It restores shared authentication before requesting Hospital data, redirects signed-out users to login, denies non-ACTIVE-ADMIN users and offers an Admin-only entry in the existing shared navigation. Backend guards remain authoritative. List search/status changes start at page 1; Previous/Next use the returned pagination. Opening a saved row loads its real detail. The list and details have independent loading, empty/not-found, safe error and retry states. Cached details are cleared when identity or selection changes, and stale/cancelled request results must not replace the current selection.

The selected theme is **Mint Gauge**, scoped to Hospital surfaces: background `#F1FAF6`, white cards, alternate `#E8F6F1`, borders `#DDEFE8`/`#C5E3D8`, teal `#2FA58A`, deep teal actions `#1E8A71`, active tint `#D5ECE4`, periwinkle `#7C93E8`, text `#1F3A33`/`#5C7A72`, placeholder `#8FA89F`, and status accents `#46B37E`/`#F2B84B`/`#E5636D`. Sora headings and Nunito Sans body/controls match Hospital Registration/Profile. Rounded cards, mint borders, a responsive table, visible focus and text-labelled status chips support keyboard/phone use. Status meaning does not rely on color. No decorative gauge, fabricated metric or application-wide navigation/theme redesign is included.

## Database and shared approval dependencies

These profile reads reuse the existing `Account`, `Hospital` and `app_session` structures. They require the application's configured MySQL connection to read Account/Hospital and the existing session-store privileges for normal authentication. No new table, migration, grant or permanent record is needed for the list/detail integration. Existing Hospital registration still assigns HOSPITAL/PENDING atomically; these reads never promote an Account.

Thulasi's shared Authentication & Role Access backend now mounts `GET /api/admin/accounts` and `PATCH /api/admin/accounts/:accountId` for queue and bounded DONOR/HOSPITAL approval, suspension and reactivation. The exact controlled reason is REGISTRATION_REVIEWED, with transactional ACCOUNT_APPROVED audit and session tombstones. See [implemented subset, login protocol and live limits](account-approval-backend.md). The later [backend-only status extension](account-status-backend.md) fixes ACCESS_RESTRICTED / ACCOUNT_SUSPENDED and ACCESS_RESTORED / ACCOUNT_REACTIVATED, with authoritative Account/SID checks and same-transaction tombstones/audit. The later shared Mint Account management UI implements the exact controls with fixture-based checks and a separate [user-reported Donor page cycle](account-approval-frontend.md#user-run-account-management-ui-evidence-reported-2026-10-27); Hospital UI status checks remain pending, and Screen 24 itself still has no status controls. Before the Hospital UI may integrate mutations, the shared implementation must be reviewed and tested for:

1. Current ACTIVE ADMIN authorization, target/transition validation, safe errors and trusted server identity.
2. Existing trusted-Origin/session-bound CSRF protection on PATCH.
3. Required reason and a durable safe audit event for approval, suspension and reactivation; no secret values in audit records.
4. Account-wide session revocation, fail-closed failure behavior and fresh login after reactivation. The existing `MysqlSessionStore.revokeAccountSessions` primitive alone is not an integrated approval/suspension workflow.
5. Isolated boundary/transaction/revocation tests and authorized live integration evidence before enabling controls.

`database/migrations/010_audit.sql` and the internal AuditEvent writer are now authored and integrated. The corrected verifier requires metadata visibility in both modes. Separate USER-RUN evidence dated 2026-10-25 confirms its normal-mode pass at `15ac4cf`, Thulasi's local AuditEvent installation/structure and application-account SELECT access; corrected dedicated-server mode was not live-reverified. The bounded approval backend and mapping have historical database-free coverage plus separate [USER-RUN Console approval/audit/fresh-login evidence dated 2026-10-26](account-approval-backend.md#user-run-account-approval-evidence-2026-10-26). No application audit-write test was performed at the earlier 2026-10-25 AuditEvent setup checkpoint; the later approval audit-record/count observations are distinct. Real concurrent login/approval, expiry during MySQL lock waits, failure/rollback, ambiguous commits, all-session/multi-device revocation and full security/API-tampering verification remain pending. The later [shared Mint approval page](account-approval-frontend.md) implements PENDING-to-ACTIVE controls at `/admin/accounts`, leaving Screen 24 status read-only. Separate [USER-RUN Donor UI evidence](account-approval-frontend.md#user-run-frontend-evidence-2026-10-26) records cancellation and approval of one Donor, empty-queue refresh and a one-event count. Live Hospital UI approval, multi-page/mobile/tablet and edge-case UI checks remain pending; Hospital UI suspension/reactivation and deeper live checks remain pending, and unrelated mappings and audit APIs/UI remain unimplemented. See [audit foundation](audit-foundation.md). `008_blood_requests.sql` is empty, so HospitalRequest/request-history work remains a separate prerequisite for request summaries and Feature 7. The original Hospital management milestone did not implement either schema or modify grants. That original milestone did not create an Admin. Later [USER-RUN evidence with browser confirmation reported 2026-10-26](first-admin-bootstrap.md#user-run-evidence-browser-confirmation-reported-2026-10-26) records manual first-Admin creation and the basic authenticated Hospital read flow. It does not establish the shared approval/status workflow.

## Verification evidence and manual checks

Final rollback-cleanup rerun (2026-10-25): **115 backend tests and 34 frontend tests passed, 0 failed, 0 skipped**. Chrome again passed 20 scenarios and 161 assertions at each of the four widths below (644 total). Vite production compilation passed for 99 modules with environment-file loading disabled and output in memory. Hospital Profile transactions now destroy a connection after rollback failure, preserve the original safe error, and never release that connection; isolated tests also cover commit failures and disposal exceptions. No development database was contacted. This resolves the preceding cleanup review finding without claiming live failure/concurrency or Admin verification.

At the completed Admin integration checkpoint on 2026-10-25, the full isolated backend suite passed **108 tests, 0 failed, 0 skipped**, including 16 new Admin HTTP tests alongside existing authentication, Hospital registration and own-profile suites. Coverage includes ACTIVE Admin reads, other-role/pending/suspended rejection, search/filter/page validation, literal wildcard handling, valid/invalid/missing IDs, safe field allowlists/errors, forged actor claims and unmounted protected mutation/request/report boundaries. The full frontend suite passed **34 tests, 0 failed, 0 skipped**. Its Chrome browser test exercised 20 scenarios at four viewport widths (1258, 768, 390 and 337 px): the 13 preceding registration/Profile/Donor scenarios plus seven Admin cases, with 161 assertions per width (644 total). Measured document widths were 1243, 753, 375 and 322 px, with no horizontal overflow. The Vite 8.3.4 production compilation passed for **99 modules** with `configFile: false`, `envDir: false` and `write: false`, avoiding private environment-file loading and preserving existing build output. These are historical completed-run results; any later cleanup changes require their own actual rerun result before being described as verified. Tests use isolated database/session doubles and browser-only fixtures; no development database is contacted and no running-application mock identity is created. That isolated run did not establish a live Admin/MySQL result; the later USER-RUN evidence is separate. Source review and isolated tests do not prove live privileges, installed schema consistency, real concurrent transactions or shared approval integration.

For the preceding Hospital milestone, Lathikaa reports that real local Hospital registration and login now succeed and the Profile shows the saved organization, registration/contact fields and PENDING status. This is **user-reported local evidence**, not an Admin run or database inspection performed by this implementation task. No real account details are recorded here.

**Later USER-RUN evidence (browser confirmation reported 2026-10-26):** normal sign-in opened Mint Gauge `/admin/hospitals`; the registered Hospital list/search/details, session persistence on refresh and sign-in required after logout were reported successful. See the [canonical first-Admin/browser evidence and remaining limits](first-admin-bootstrap.md#user-run-evidence-browser-confirmation-reported-2026-10-26). This is separate from the dated isolated runs and both developers' earlier environment evidence. Real MySQL concurrency/failure/rollback/cancellation, live existing-Admin/duplicate-email refusal and API tampering remain pending, along with account approval/suspension/reactivation, production action/reason mappings, transactional session revocation, audit search/UI and other operational workflows.

Manual live verification reference, after the normal local backend/frontend are running; the reported basic flow does not mark every check below complete:

1. Use an existing legitimate ACTIVE ADMIN via the shared Login page. Open `/admin/hospitals` through the shared Hospital Management link. Confirm the screen displays the saved Hospital information and real PENDING status reported above. Inspect Network responses for the documented list/detail routes and `no-store`; do not copy cookies/tokens or private profile values into reports.
2. Search a fragment from each documented existing organization/registration/contact/phone field. Select PENDING, ACTIVE, SUSPENDED and All; verify matches/empty state reflect real records and that a filter/search change resets page 1. Clear filters to restore the list.
3. If more than 20 genuine matching Hospitals already exist, use Next/Previous and compare stable organization/ID ordering and returned pagination. With fewer rows, verify paging controls are disabled appropriately. Do not create demonstration rows to exercise pagination; its multi-page behavior is covered by isolated tests.
4. Open an actual Hospital row; confirm the details belong to that `hospitalId`, the registration number can be absent, and status is read-only. There must be no approve/suspend/reactivate buttons, request counts, passwords, hashes, email or session information. Close/reopen or change selection to confirm no previous row's detail appears.
5. Use browser Network offline mode to exercise the safe error/Retry behavior, then restore networking and retry. An unsuccessful read must not turn into a fabricated empty dataset or replace valid selected details with another Hospital. Inspect phone and desktop sizes, keyboard labels/focus and explicit status text.
6. Sign out and revisit `/admin/hospitals`; login is required. Using existing legitimate DONOR and HOSPITAL sessions, confirm this route is denied and the Admin navigation entry is absent. Retest Hospital own Profile and contact-only update with real intended changes only if desired; no test requires altering that data. Donor login/read-only Profile and shared logout should retain their existing behavior. Do not change Account statuses to create test cases.
7. Invalid IDs/query, pending/suspended Admin, revocation, SQL failure, data-leakage and protected-route boundary cases are exercised in isolated tests. They do not require development-DB edits or fictitious live users. Record any unavailable live prerequisites instead of bypassing authentication.

## Completion boundary and next feature

Hospital registration, own Profile and Admin list/detail code are implemented within this scope. **Feature 6 remains partial against the full approved account-management behavior** because other deferred work and remaining live frontend checks are pending; the shared Account management page now implements suspension/reactivation controls, with a separate user-reported Donor page cycle and pending Hospital UI status checks; real PENDING Hospitals cannot self-activate. The shared PENDING-to-ACTIVE backend has the separate USER-RUN Console observations linked above. The deferred request summary depends on Feature 7 and must not be represented as verified now.

Feature 7 may be designed against the existing trusted Hospital identity, but operational blood-request APIs must require ACTIVE HOSPITAL and cannot be used by PENDING applicants. The separate 2026-10-26 USER-RUN evidence records approval of the previously pending Hospital in Thulasi's environment; this does not implement or verify blood-request operations. Its approved HospitalRequest/RequestStatusHistory schema, role-scoped active blood-group choices, transitions and required audit/transaction behavior must be implemented and verified under separate authorization. Admin read-only management can be manually verified independently when a legitimate ACTIVE ADMIN already exists.

## Files in this Admin milestone

Existing uncommitted Hospital registration/Profile work is preserved. This manifest describes the Admin milestone, rather than every path already dirty in the working tree.

Created:

- `backend/tests/admin-hospitals-http.test.js`
- `backend/tests/helpers/admin-hospital-database.mjs`
- `frontend/src/features/hospitals/AdminHospitalManagement.jsx`
- `frontend/src/features/hospitals/adminHospitals.js`
- `frontend/tests/adminHospitals.test.js`
- `docs/admin-hospital-management.md`

Modified:

- `backend/src/modules/hospitals/router.js`
- `backend/src/modules/hospitals/README.md`
- `backend/tests/hospitals-boundaries.test.js`
- `backend/tests/hospitals-http.test.js`
- `frontend/src/App.jsx`
- `frontend/src/features/auth/AccountStatusPage.jsx`
- `frontend/src/features/auth/AuthLayout.jsx`
- `frontend/src/features/auth/accountHome.js`
- `frontend/src/features/hospitals/hospital.css`
- `frontend/src/services/hospitalApi.js`
- `frontend/src/services/hospitals.js`
- `frontend/tests/hospitalApi.test.js`
- `frontend/tests/hospital-browser.test.js`
- `frontend/tests/browser/hospital-scenarios.jsx`
- `docs/api-design.md`
- `docs/role-permissions.md`
- `docs/ui-screen-map.md`
- `docs/ui-design.md`
- `docs/implementation-readiness.md`

No development-database query or mutation, private environment-file access, migration, grant, account provisioning, dependency installation, commit, push or merge was performed. Production compilation disabled Vite environment-file loading and output writing; isolated test/build runs used a sanitized child environment. Read-only Git checks found no whitespace errors, unmerged entries or staged changes.
