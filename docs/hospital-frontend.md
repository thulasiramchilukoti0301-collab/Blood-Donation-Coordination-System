# Feature 6 Hospital frontend

The current Feature 6 checkpoint implements three Mint Gauge surfaces: Hospital Registration within Login, Screen 11 Hospital Profile, and Screen 24 read-only Admin Hospital Management. They use five mounted Hospital APIs listed below and the existing shared authentication/session/CSRF APIs. Shared Donor workflows are preserved. Runtime forms start with empty inputs and saved Hospital information comes from real API responses; isolated tests alone supply mocked responses. Requests, allocation, compatibility, audit, reports and shared account-status mutations remain outside this delivered scope.

Lathikaa reports successful real local Hospital registration and login, with the Profile displaying the saved organization, registration/contact information and PENDING status. This is user-demonstrated local evidence, separate from automated tests and from checks performed by Codex. Live Admin management, failure/rollback/concurrency and approval/revocation verification remain pending; this evidence does not make all of Feature 6 complete.

## Screens, APIs and state

| Mounted Hospital API | Access and behavior |
|---|---|
| `POST /api/auth/register/hospitals` | Public registration with session-bound CSRF; atomically creates HOSPITAL/PENDING Account and Hospital without automatic login |
| `GET /api/hospitals/me` | PENDING/ACTIVE HOSPITAL; returns only the current verified Account's saved profile |
| `PATCH /api/hospitals/me` | PENDING/ACTIVE HOSPITAL with session-bound CSRF; changes only contactName, phone and address |
| `GET /api/admin/hospitals` | ACTIVE ADMIN; documented search/status filters and fixed 20-row pagination |
| `GET /api/admin/hospitals/:hospitalId` | ACTIVE ADMIN; reads the identified Hospital profile, without an invented request summary |

Screen 24 is implemented at `/admin/hospitals` with list/detail loading, empty, error and retry states, role-appropriate shared navigation and read-only Account status. Its detail panel stays within Screen 24. See [Admin Hospital Management](admin-hospital-management.md) for exact contracts, guards, pagination and pending shared approval dependencies.

Hospital registration is the `/login?register=hospital` mode of the existing Login screen, reached through a visible Hospital registration entry point. It uses `POST /api/auth/register/hospitals` with only email, password, organizationName, optional registrationNumber, contactName, phone and address. Client validation follows the existing server limits and password policy, while the server remains authoritative. Blank optional registration numbers become null. Passwords are preserved exactly and kept only in transient form state; no localStorage/browser persistence is introduced.

The actual HTTP 201 response contains success, string accountId/hospitalId, PENDING accountStatus and the safe saved profile. Success explains that the account is pending review and offers the existing sign-in route. Registration does not call login or claim approval. Known duplicate-email/registration conflicts attach to the corresponding fields; backend general form validation is shown as a form error rather than attributed to an invented field.

Hospital Profile is Screen 11 at `/hospital/profile`. A restored PENDING/ACTIVE HOSPITAL session can read its own saved profile through `GET /api/hospitals/me`. The page shows real organization, optional registration number, account status and relevant timestamps. Only contactName, phone and address are editable. Save sends only changed permitted fields to `PATCH /api/hospitals/me`; no Account/Hospital ID, organization, registration, role, status or timestamp chooses or changes ownership.

The existing credentialed Axios client and server-side signed session are reused. Mutations obtain a session-bound token from `GET /api/auth/csrf` and submit `X-CSRF-Token`; login rotates the session/token. Protected-session 401 responses follow the existing authentication invalidation flow. Signed-out users return to login; DONOR/ADMIN are denied Hospital Profile. PENDING is a permitted own-profile state, not operational approval. The server remains the access-control boundary.

Loading, field validation, safe API failure, missing profile, retry, saving, cancellation and saved-data confirmation are part of the forms. No missing/failed response is replaced with a fabricated Hospital. Account changes or invalid sessions must clear protected data; stale responses must not populate another user's view.

## Mint Gauge scope

The user cancelled the previous Hospital Rose Quartz selection. Hospital Registration, Hospital Profile and Admin Hospital Management use scoped Mint Gauge without replacing unrelated pages' CSS or introducing a second navigation bar. The existing authenticated navigation has a Hospital-only Profile entry and an ACTIVE-ADMIN-only Hospital Management entry; Donor navigation remains role-appropriate.

| Purpose | Exact value |
|---|---|
| Background, white cards, alternate/input surface | #F1FAF6, #FFFFFF, #E8F6F1 |
| Soft/strong border | #DDEFE8, #C5E3D8 |
| Primary accent, solid primary, active tint | #2FA58A, #1E8A71, #D5ECE4 |
| Secondary information | #7C93E8 |
| Main, muted, faint text | #1F3A33, #5C7A72, #8FA89F |
| Success | #46B37E |
| Warning accent/text/tint | #F2B84B, #9A6B10, #FBEBC8 |
| Critical accent/text/tint | #E5636D, #C0485A, #FDE8EA |
| Typography | Sora headings; Nunito Sans body, labels and controls |

Solid primary buttons use #1E8A71 with white labels. Every status includes text. Responsive cards/forms, proper labels, field descriptions, live feedback, focus indicators, comfortable targets and reduced-motion support take priority over illustrative dashboard styling. No approved registration/Profile percentage exists, so no ring gauge, approval progress or stock/request metric is invented. Domain color references do not enable future features.

## Frontend checkpoint files

| Area | Files |
|---|---|
| Shared frontend integration | `frontend/package.json`, `frontend/src/App.jsx`, `frontend/src/features/auth/AuthLayout.jsx`, `LoginPage.jsx`, `AccountStatusPage.jsx`; new `accountHome.js` in that auth directory |
| New Hospital components/styles | `frontend/src/features/hospitals/HospitalRegistration.jsx`, `registration.js`, `HospitalProfilePage.jsx`, `profile.js`, `AdminHospitalManagement.jsx`, `adminHospitals.js`, `hospital.css` |
| New real API wrappers | `frontend/src/services/hospitalApi.js`, `frontend/src/services/hospitals.js` |
| New isolated tests | `frontend/tests/hospitalApi.test.js`, `hospitalRegistration.test.js`, `hospitalProfile.test.js`, `adminHospitals.test.js`, `hospital-browser.test.js`, `frontend/tests/browser/index.html`, `frontend/tests/browser/hospital-scenarios.jsx` |
| Focused documentation | `docs/hospital-frontend.md`, `docs/admin-hospital-management.md`, the Hospital contracts/storage documents, approved API/permissions/UI status documents, `backend/src/modules/hospitals/README.md`, and focused current-state notes in `docs/implementation-readiness.md` |

Unrelated backend behavior, database artifacts, Donor Profile, AuthProvider, global CSS, API-client configuration, index font configuration and dependency lockfiles are preserved. No package was installed. The shared layout gains scoped Mint rendering and Hospital/Admin navigation entries; other pages retain their existing styling. Shared Login keeps Donor registration behavior and adds Hospital registration plus role-appropriate Hospital/ACTIVE Admin landing. Hospital `/account/status` resolves to its Profile, which includes status. The API integration and backend tests are documented separately in the linked Hospital contracts.

## Isolated verification record

Final backend-cleanup checkpoint on 2026-10-25: **115 backend tests and 34 frontend tests passed, 0 failed, 0 skipped**. The browser rerun passed the same 20 Hospital/Admin/shared-auth scenarios at four widths, 161 assertions each (644 total), including preserved Donor registration/login/Profile. Vite production compilation passed for 99 modules with private environment loading disabled and output in memory. The backend cleanup fix changes no frontend behavior or Mint Gauge styles; all fixtures remain test-only. Live Admin and database failure/concurrency verification remain pending.

The original Registration/Profile frontend checkpoint was exercised on 2026-10-25 without private environment-file reads or development database access. These are historical results for that checkpoint:

| Check | Actual result |
|---|---|
| Complete frontend `node --test` suite (also available as `npm test`) | **23 passed, 0 failed, 0 skipped**: 22 unit/service checks plus the real-browser suite |
| Headless Chrome browser scenarios | **13 scenarios and 116 assertions at each of four measured viewports**: 1258, 768, 390 and 337 CSS pixels; corresponding available content widths 1243, 753, 375 and 322 pixels. Total 52 scenario executions / 464 assertions. |
| Frontend production compilation | Passed with 97 modules transformed; existing React plugin, `configFile: false`, `envDir: false`, and in-memory output (`write: false`) |
| Complete backend regression suite | **92 passed, 0 failed, 0 skipped**, using the existing no-private-env-loader and no DB environment settings |
| Visual review | Desktop Registration/Profile and 390px test-only phone previews rendered and inspected; responsive cards/fields/navigation remained readable without horizontal overflow |

The subsequent Admin integration checkpoint passed **108 backend tests and 34 frontend tests**, with no failures/skips. Its browser suite covered 20 scenarios at each of four measured widths, 161 assertions per width (644 total); the production compilation passed with 99 modules. These are the latest completed historical checkpoint results, not a claim that later cleanup changes have already been rerun. Final verification results must be recorded from the actual new run. See [the Admin verification record](admin-hospital-management.md#verification-evidence-and-manual-checks).

The browser checks exercise actual React components, routing, AuthProvider, Axios wrappers and DOM interactions. Only their test entry's Axios adapter supplies isolated responses; production entry/components never import those fixtures. Coverage includes field labels/required and optional inputs, client validation/focus, duplicate conflicts, in-flight duplicate-submit prevention, exact PENDING/201 handling, no automatic login, explicit Hospital login and refresh-style remount, Profile GET/loading/empty/error/retry, read-only organization/registration, contact-only PATCH/fresh CSRF, PENDING/ACTIVE saves, cancel, role denial, session expiry, persistent 403 without a restore/retry loop, CSRF errors without resubmission, and the existing Donor registration/login/styling.

Chrome uses new temporary browser profiles inside the ignored workspace test directory and never the user's browser profile. Exact-width iframes overcome Windows headless Chrome's minimum top-level window size; reported dimensions are measured rather than assumed. External font requests are blocked in deterministic browser checks; scoped Sora/Nunito Sans declarations are checked, and the actual Hospital UI loads those families through the project's existing Google Fonts approach. The build runs with private Vite environment-file loading disabled. Test doubles and screenshots do not establish a real MySQL flow.

From `frontend/`, `npm test` uses the existing Node test runner and an already installed Chrome/Edge executable for browser interaction tests; no package installation was needed. The Codex runs launched Node with whitelisted OS variables and NODE_ENV=test, excluding database settings. The backend run additionally used its existing loader to disable dotenv file reads. Frontend build output was kept in memory to preserve existing generated files.

## Manual real-MySQL follow-up — user-run only

Lathikaa has already demonstrated the real registration/login/saved PENDING Profile flow described above. The procedure below remains a reference for safe user-run checks; Codex has not executed it or inspected the development database. Use the existing legitimate Hospital account for follow-up. Steps 4–7 describe initial registration only and need not be repeated to verify an existing account; create another account only for a genuine institution that requires one. Do not run migration/setup/seed scripts, add demonstration users, change Account status directly, or inspect password hashes/session payloads. Admin live checks are recorded separately in [Admin Hospital Management](admin-hospital-management.md#verification-evidence-and-manual-checks).

1. Confirm MySQL is running on 127.0.0.1:3306 and Workbench is connected to `blood_donation_coordination`. Account, Hospital and app_session existence is user-reported; the server version is likewise user-reported as 9.1.0. Use the existing private backend configuration without displaying or committing it. Account SELECT/INSERT, Hospital SELECT/INSERT/UPDATE and app_session SELECT/INSERT/UPDATE are needed for the implemented operations. Table presence alone does not prove runtime privileges or transaction behavior.
2. In a terminal, start the actual Express server using the existing configuration:

   ```powershell
   Set-Location -LiteralPath 'C:\Users\91787\Documents\dbms proj\Blood-Donation-Coordination-System\backend'
   npm run dev
   ```

3. In a second terminal, start React/Vite:

   ```powershell
   Set-Location -LiteralPath 'C:\Users\91787\Documents\dbms proj\Blood-Donation-Coordination-System\frontend'
   npm run dev
   ```

   Defaults are backend `http://localhost:5000` and frontend `http://localhost:5173`. If existing configuration uses another origin/port, use that exact configured frontend origin consistently. Do not mix `127.0.0.1` and `localhost` in browser URLs as an ad hoc authentication fix. The database host is independent of the browser host. Starting the application normally reads its own private configuration; no command here prints that configuration.
4. Open `http://localhost:5173/login`, then choose Hospital registration, or open `http://localhost:5173/login?register=hospital` directly. Confirm grouped organization/contact/login fields, required indicators and optional registration number. Enter actual details you intend to retain; do not use demonstration values. Leave registration number blank only if that is appropriate for the actual institution.
5. Before submitting, record safe counts in Workbench in a quiet local session:

   ```sql
   SELECT COUNT(*) AS hospital_accounts
   FROM blood_donation_coordination.Account WHERE role = 'HOSPITAL';
   SELECT COUNT(*) AS hospital_profiles
   FROM blood_donation_coordination.Hospital;
   SELECT COUNT(*) AS hospital_accounts_without_profiles
   FROM blood_donation_coordination.Account a
   LEFT JOIN blood_donation_coordination.Hospital h ON h.account_id = a.account_id
   WHERE a.role = 'HOSPITAL' AND h.account_id IS NULL;
   ```

6. Submit once. Expect the Mint Gauge PENDING confirmation and a sign-in link, without automatic login. In browser Network tools, confirm POST `/api/auth/register/hospitals` returned 201 and contains the documented safe Account/Hospital IDs and profile. Do not share the request body, password, cookie or CSRF header. Use the returned numeric Account ID locally for the next targeted read-only query.
7. Repeat the count queries. With no concurrent writer, the Account/Hospital counts should each increase by one; the orphan count should remain zero. Replace the placeholder below with the numeric Account ID returned for this registration, then run this safe join:

   ```sql
   SELECT CAST(a.account_id AS CHAR) AS account_id, a.role, a.account_status,
          CAST(h.account_id AS CHAR) AS hospital_id,
          h.organization_name, h.registration_number, h.contact_name,
          h.phone, h.address, h.created_at, h.updated_at
   FROM blood_donation_coordination.Account a
   LEFT JOIN blood_donation_coordination.Hospital h ON h.account_id = a.account_id
   WHERE a.account_id = <numeric Account ID from the 201 response>;
   ```

   Expect one matching HOSPITAL/PENDING Account/Hospital pair and the normalized details you submitted. This validates the successful creation observed for that request. It does **not** prove rollback under failure, concurrent uniqueness, or every atomicity edge case; those were exercised with isolated test doubles only. Do not deliberately break constraints, corrupt data or force connection failures in development to manufacture live rollback evidence.
8. Follow Sign in and log in with that real email/password. Expect Hospital Profile at `/hospital/profile` through Hospital navigation. GET `/api/hospitals/me` should return the safe profile with the same ID and saved fields. Confirm optional registration shows a clear not-provided state if null, organization/registration are read-only, and PENDING is explicitly labelled.
9. Choose Edit Contact Information. Change only the actual contact details you intend to retain, then Save Changes. Network tools should show PATCH `/api/hospitals/me` with only changed contactName/phone/address properties and the shared CSRF header, followed by a successful saved-profile response. The browser manages its HttpOnly session cookie; do not edit cookies or supply Account IDs manually.
10. Refresh the browser. Confirm authentication restores and the saved contact values remain. Rerun the targeted join to compare persisted values. Organization, registration, role and PENDING status should be unchanged. A same-second update can legitimately retain the same displayed second of updated_at, so verify the saved values rather than requiring a timestamp difference.
11. Confirm the PENDING explanation remains visible and there are no enabled blood-request, approval, allocation or other operational actions for that Hospital. Admin Hospital list/detail APIs are implemented for ACTIVE ADMIN, but shared approval/suspension/reactivation APIs remain unavailable. Sign out, then revisit `/hospital/profile` and confirm the login flow replaces protected content. Any existing legitimate Donor/Admin account may be used for manual wrong-role checks; do not create or provision an Admin just for this test.

Keep observations local and record only non-secret outcomes. Distinguish the reported Hospital success from follow-up checks that have not been exercised. Registration attempts are rate limited, so repeated invalid/duplicate submissions may return 429 and require waiting for Retry-After rather than weakening the limiter.

## Remaining Feature 6 work

Hospital Registration, own Profile/contact update and read-only Admin Hospital Management are implemented with the five mounted APIs and three Mint Gauge surfaces above. **The full Feature 6 account-management behavior remains incomplete** until Thulasi's shared approval/suspension/reactivation API integrates required reasons, session-bound CSRF, durable AuditEvent storage/writes and account-wide session revocation/fresh login after reactivation. There is no Hospital-only approval bypass or nonfunctional mutation button.

Live Admin list/detail verification using an existing legitimate ACTIVE ADMIN remains pending, as do deeper live failure/rollback/concurrency and status-transition/audit/revocation checks. Request summaries require the separate HospitalRequest implementation; they are omitted now. Features 7–10 are not implemented by this checkpoint, and the reported PENDING Hospital needs legitimate shared approval before future ACTIVE-only operational requests.
