# Feature 7 fast-track implementation — 2026-10-27

This is the historical fast-track checkpoint. The later [approved activation implementation](feature7-activation.md) supersedes its disabled/unmounted status, candidate contracts and pending migration number. Preserve the earlier evidence as revision-specific; use the activation runbook for current behavior and results.

This session extends the existing untracked Feature 7 module on `lathikaa`, HEAD `a1c3217a6133c9ef92fae07571a17ec8445964f0`. The four Sky Pipeline frontend screens are implemented and routed. Request backend adapters and internal transaction/history preparation are implemented, but **no request API is mounted**. The feature is not operational or production-ready.

No migration, development database query/write, grant, Account change, private `.env` access, commit, push, merge or stash operation was performed. Existing untracked work was extended in place. Migration 008, AuditEvent-only 010, the unnumbered history proposal, shared Account services and donor/hospital services remain intact.

## Frontend screens

| Screen | Frontend route | Behavior |
|---|---|---|
| 12 Create Blood Request | `/hospital/requests/new` | Labelled blood-group/quantity/priority/IST date/note form; candidate validation; injected real lookup loader; production submission disabled. |
| 13 My Blood Requests | `/hospital/requests` | Hospital-only list client, structured filters, fixed 20-row paging, responsive table/cards, loading/empty/error/retry/detail navigation. Production displays unavailable state. |
| 14 Blood Request Details | `/hospital/requests/:requestId` | Validated ID, overview, actual current lifecycle stage, supplied history only, optional genuine totals. No invented timeline/totals or cancellation button. Production displays unavailable state. |
| 25 Admin Blood Request Management | `/admin/requests` | ACTIVE Admin-only queue, documented filters, priority indicators, inline request details with keyboard focus management. No mutation controls. Production displays unavailable state. |

The shared AuthProvider and AuthLayout are reused. Only ACTIVE HOSPITAL/ADMIN accounts reach their respective workspaces; PENDING/SUSPENDED/wrong-role accounts are redirected and trigger no request API calls. Account navigation gains a role-appropriate Blood requests link. Sky Pipeline CSS is scoped to `.sky-app-shell`; other themes keep their existing styles. Lexend/Mulish use the same optional Google Fonts pattern as existing themes, with local fallbacks.

The frontend availability object defaults to `{ reads: false, creation: false }`. The production API client also independently disables creation. No environment flag, URL parameter or browser-supplied identity enables mutations. Positive browser scenarios enable capabilities **only in the isolated test harness**. All synthetic records live under `frontend/tests/`; none are imported by production components.

## Backend adapter and transaction boundaries

`createBloodRequestRouter` is a dependency-injected, unmounted factory. It registers no operational routes by default. Read adapters require explicit `storageInstalled` and `readProjectionApproved` readiness; creation requires `storageInstalled` and `creationContractsApproved`. These flags are integration assertions, not a schema probe or evidence of deployment. Never enable them against the current incomplete projection.

| Implemented adapter | Required service behavior before mounting |
|---|---|
| `POST /api/hospitals/me/requests` | Installed request/history/audit storage, approved group/timestamp/audit contracts, atomic creation and legitimate ACTIVE Hospital identity/session. |
| `GET /api/hospitals/me/requests` | Scoped rows plus the documented genuine fulfillment totals, with approved filters/timestamps. |
| `GET /api/hospitals/me/requests/:requestId` | Scoped detail plus genuine history and allocation-derived counts. |
| `GET /api/admin/requests` | Approved complete queue projection and deterministic priority/needed-by/submission/ID order. |
| `GET /api/admin/requests/:requestId` | Complete Admin detail including real allocation history/totals and safe Hospital data. |

Adapters reuse `requireCurrentAccount` (including authoritative stored-session verification), role/ACTIVE guards and Origin/CSRF on creation. They reject unknown/malformed queries, paths and bodies, pass only server-produced actor/session context, use safe errors and `Cache-Control: no-store`. Shared CORS can reject an untrusted Origin before the request adapter runs. Detail responses use the candidate envelope `{ success: true, request }`; lists use `{ success: true, requests, pagination }`; creation returns `{ success: true, requestId, requestStatus, outstandingQuantity }`. The detail envelope must be recorded in the final HTTP contract before activation.

Creation retains the existing one-connection request + exactly one initial SUBMITTED history row + audit transaction. Optional history reads are ownership-scoped, ordered by timestamp/history ID and explicitly projected. They are disabled unless configured. They expose no staff note or free-text reason. Missing history/Allocation data is never replaced with fabricated rows or zero totals.

The candidate context adapter is explicitly opt-in, parameterizes the verified actor/allowlisted reason and forces `@request_system_operation_id = NULL`. Configured transactions clear all three context variables on checkout and after commit/rollback before release. Checkout/reset/rollback failure destroys the connection. Ambiguous commit now destroys rather than returning that connection to the pool. Existing safe operation errors survive cleanup failure; cleanup failure after commit reports uncertainty. There is no automatic mutation retry.

The internal `reviewRequest` preparation is disabled by default and has **no HTTP route**. It accepts only the documented review decisions, re-locks/revalidates Account and stored SID, locks the request, checks the lifecycle, requires an injected authoritative transition predicate, sets context, updates status, and writes audit on the same connection. Only the proposed AFTER UPDATE trigger may insert transition history. No production action registry is activated. Allocation-dependent transitions remain blocked without the required predicate; no cancellation, fulfillment, priority mutation, FEFO, allocation or issue operation is implemented.

`serializeRequestTimestamp` is an optional candidate, producing second-precision `YYYY-MM-DDTHH:mm:ss+05:30` from project-local DATETIME strings or Date instants. It is not wired into production. Existing internal timestamp semantics remain the default. Frontend forms label IST explicitly and use offset-bearing timestamps only behind the creation capability. Ambiguous timestamp strings display unavailable rather than guessing a timezone.

## Verification

Tests use a sanitized child environment; backend dotenv is intercepted by the existing no-private-env loader; Vite tests/build set `envDir: false`.

- Backend: **294 passed, 0 failed, 0 skipped** (complete suite).
- Frontend: **65 passed, 0 failed, 0 skipped** (complete suite, including both real-browser harnesses).
- Frontend production build: **passed**; non-blocking bundle-size advisory (main chunk approximately 684 kB before gzip).
- Sky Pipeline final browser run: **14 scenarios** at actual desktop **1258px**, tablet **768px**, mobile **390px/337px**; **162/162/163/163 assertions passed**. Checks cover all four actual App routes, ACTIVE/role boundaries, disabled production operations, loading/empty/error/retry, filters/pagination, genuine history, no fabricated totals, unavailable endpoints, expiry/logout/stale replies, same-account fresh-login lifecycle changes, labelled fields, keyboard focus movement/restoration and horizontal overflow. Desktop/mobile screenshots were captured and visually inspected. Fixtures do not prove live MySQL, installed storage or production concurrency.
- Existing Hospital/Donor/Account browser regression: **69 scenarios and 460 assertions at each of the four viewports passed**. All existing unit/API tests also passed in the complete frontend/backend suites.
- `git diff --check`: **passed**. A separate whitespace scan covered the untracked implementation files and found no trailing whitespace.

Screenshots/logs reside in ignored workspace `.tmp` directories; no browser profile or fixture is shipped as application data. Fonts were deliberately blocked in browser tests to verify fallback rendering; hosted font appearance was not verified. The browser runner uses an exact-width iframe for tablet/mobile because Windows headless Chrome enforces a minimum top-level width. Accessibility checks are basic DOM/focus/contrast-conscious styling checks, not a full assistive-technology audit.

## Files changed in this session

New backend files:

- `backend/src/modules/blood-requests/context.js`
- `backend/src/modules/blood-requests/timestamps.js`
- `backend/src/modules/blood-requests/router.js`
- `backend/tests/blood-requests-integration.test.js`

Extended existing untracked backend work:

- `backend/src/modules/blood-requests/repository.js`
- `backend/src/modules/blood-requests/service.js`
- `backend/src/modules/blood-requests/README.md`
- `backend/tests/blood-requests.test.js` (ambiguous commit must destroy, not release)

New frontend files:

- `frontend/src/features/blood-requests/model.js`
- `frontend/src/features/blood-requests/RequestShared.jsx`
- `frontend/src/features/blood-requests/RequestList.jsx`
- `frontend/src/features/blood-requests/RequestOverview.jsx`
- `frontend/src/features/blood-requests/CreateRequestPage.jsx`
- `frontend/src/features/blood-requests/MyRequestsPage.jsx`
- `frontend/src/features/blood-requests/RequestDetailPage.jsx`
- `frontend/src/features/blood-requests/AdminRequestsPage.jsx`
- `frontend/src/features/blood-requests/requests.css`
- `frontend/src/services/bloodRequestApi.js`
- `frontend/src/services/bloodRequests.js`
- `frontend/tests/bloodRequests.test.js`
- `frontend/tests/blood-requests-browser.test.js`
- `frontend/tests/browser/requests.html`
- `frontend/tests/browser/request-scenarios.jsx`

Modified tracked frontend files: `frontend/src/App.jsx`, `frontend/src/features/auth/AuthLayout.jsx`. Documentation: this report, the existing untracked `docs/blood-request-integration-contracts.md`, and `docs/implementation-readiness.md`. Ignored verification artifacts: `.tmp/feature7-check.mjs`, test logs, frontend build output and screenshot PNGs. Other pre-existing untracked request validation/lifecycle/response/errors files remain preserved.

## Remaining contracts and exact activation sequence

1. Coordinate migration 012 (still only proposed), dependency/application order, trigger permissions/definer and runtime privileges. Resolve or remove the SQL proposal's UUID-shaped NULL-actor system path; this application adapter never uses it. Keep 010 AuditEvent-only. A source merge does not install schema.
2. Approve actor/reason names and reason-code allowlists; approve the request audit action mappings and safe summaries. Do not reuse Account action codes. Priority changes need their separate reason contract before implementation.
3. Decide active BloodGroup policy and deactivation effects; approve a role/status-safe real lookup endpoint/response before wiring `loadGroups`. No speculative endpoint or seeded frontend group list has been added.
4. Approve neededBy input/output/precision, filter-day bounds, any relative cutoff, Hospital sorting and final response envelopes. Select the candidate serializer explicitly only after agreement.
5. Have the schema owner review and separately install the approved request/history objects in each intended development database. Codex has not checked whether 008/history are installed and has not applied them. Verify context/reset/trigger/audit atomicity, grants/definer and concurrent session/state changes against an explicitly authorized disposable MySQL target.
6. Implement/verify Feature 8 Allocation storage and locked predicates for real fulfillment totals/history, rejection/review dependencies and pre-issue cancellation. Preserve terminal states and immutable quantity. Until then, keep routes whose documented projections need Allocation unmounted, or obtain explicit agreement on a reduced response contract.
7. Configure the approved group policy, audit registry, history reads/serializer and complete read projections; integrate the router into `app.js` only after these gates pass. Then enable corresponding frontend capabilities and wire the approved real group loader. Verify actual browser HTTP flows with legitimate ACTIVE Hospital/Admin accounts, CSRF, ownership, revocation and rollback/concurrency before calling Feature 7 fully operational.

Git state at handoff: `lathikaa` remains at the HEAD above, 14 commits ahead of the locally recorded `origin/lathikaa`; 3 tracked files modified and 29 untracked files (including the 9 original untracked Feature 7 files). Nothing staged, no unmerged paths. No commit/push was performed. Ignored test/build artifacts do not appear in that count.

Safe review commands from the repository root: `git status --short --branch`, `git diff -- frontend/src/App.jsx frontend/src/features/auth/AuthLayout.jsx docs/implementation-readiness.md`, `git diff --check`. New files remain untracked; inspect them with PowerShell `Get-Content -LiteralPath <path>` because ordinary `git diff` omits them. Do not stage/commit/push or execute migrations as part of review.
