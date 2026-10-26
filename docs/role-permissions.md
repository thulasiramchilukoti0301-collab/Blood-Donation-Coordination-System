# Role Permissions

The bounded authentication work implements public Donor/Hospital registration, login/logout, current-account status, Donor self-profile read/edit, and Hospital self-profile read/contact edit. Donor edits are limited to full name, phone, address, area, and optional self-reported blood group; confirmed group remains staff-controlled. Hospital registration atomically creates HOSPITAL/PENDING Account and Hospital rows without automatic login; see [its exact contract](hospital-registration-api.md). The Hospital Profile integration mounts own-profile GET and contact-only PATCH for PENDING/ACTIVE Hospitals with shared session/current-account/HOSPITAL guards and PATCH CSRF. Admin Hospital Management adds ACTIVE ADMIN-only list/detail reads and Screen 24, including read-only display of each Hospital's current Account status. The remaining permission matrix describes the approved broader application; only implemented routes listed in `api-design.md` are available. The shared Account queue and audited PENDING-to-ACTIVE approval backend are implemented for ACTIVE ADMIN only; basic USER-RUN Console approval/audit/fresh-login evidence dated 2026-10-26 is recorded in the Account approval guide; further live concurrency/failure/security and multi-device checks remain pending. The [Mint Account approval supporting flow](account-approval-frontend.md) now guards `/admin/accounts` for restored ACTIVE ADMIN sessions, with separate [USER-RUN Donor UI evidence](account-approval-frontend.md#user-run-frontend-evidence-2026-10-26); live Hospital approval, multi-page/mobile/tablet and edge-case UI checks remain pending. Audited DONOR/HOSPITAL suspension/reactivation are now [backend-only operations](account-status-backend.md) for current ACTIVE ADMIN sessions, with exact controlled reasons and authoritative Account/SID checks. Separate [USER-RUN evidence reported 2026-10-27](account-status-backend.md#user-run-donor-status-cycle-evidence-reported-2026-10-27) records one Donor cycle through the Console and its observed sign-in/audit outcomes. This is not Hospital verification or proof of concurrency, rollback, multi-device revocation or all security cases. Their UI and further live checks, password change, staff corrections and other operational actions remain pending; the Mint page stays approval-only. See [Hospital Profile integration](hospital-profile-api.md) and [Admin Hospital Management](admin-hospital-management.md).

## Permission principles

- Default deny: each endpoint requires authentication and an explicit role/ownership check.
- A Hospital can see only its own profile and requests. A Donor can see only their own profile, bookings, and donation history. Admin / Blood Bank Staff can access operational records needed to run the bank.
- Public registration never creates an Admin account. The bounded [first-Admin CLI](first-admin-bootstrap.md) implements manual/out-of-band creation of one new ACTIVE Admin on an explicitly selected loopback development database; successful first-Admin creation and the basic Admin Hospital read/session flow have separate USER-RUN evidence with browser confirmation reported 2026-10-26. It refuses any existing Admin regardless of status, never promotes or resets an Account, and does not implement applicant approval.
- Every protected request checks the current account status, role, and resource ownership; a session cookie alone does not preserve access after status changes.
- PENDING Donor/Hospital accounts may authenticate only to view approval status, read/update permitted fields on their own profile, change their password, and log out. They cannot book, request blood, or perform other operational actions.
- SUSPENDED accounts cannot establish a session. Suspension revokes existing sessions. Reactivation requires an audited staff action and a fresh login; a revoked session is never restored.
- Password change is authenticated, verifies the current password, validates the new password server-side using the registration policy, stores only a bcrypt hash, audits without password material, and revokes all account sessions including the current one. CSRF protection applies; successful change requires a fresh login. Public password recovery is out of scope.
- Delete means logical cancellation/deactivation where history matters. Completed donations, allocations, issued units, audit events, and requests are retained; no user can hard-delete traceable history through the application.

## Permission matrix

The existing permission statements for staff-created non-admin accounts and corrections to completed Donation records do not yet have API contracts. They remain policy/contract decisions to resolve as listed in `implementation-readiness.md`; this matrix does not authorize an undocumented endpoint or implementation.

The broad Admin request-status permission does not resolve whether staff may cancel a request after partial issue. That permission and its operation contract remain OPEN; Hospital cancellation remains limited to before any unit is issued.

| Resource/action | Admin / Blood Bank Staff | Hospital | Donor |
|---|---|---|---|
| Register account | Create/approve/suspend all non-admin profiles; Admin account provisioning outside public flow | Create own pending account | Create own pending account |
| Login/logout | Active Admin; manual/out-of-band provisioning | Own account; PENDING may authenticate only for the limited operations above | Own account; PENDING may authenticate only for the limited operations above |
| Account status | Approve/suspend/reactivate non-admin accounts; every action audited | View own approval/status through current-account/profile screens | View own approval/status through current-account/profile screens |
| Profile | View/update all operational profiles; approve/suspend/reactivate account | View/update permitted own hospital contact/profile fields while PENDING or ACTIVE | View/update permitted own donor profile fields while PENDING or ACTIVE |
| Password | Change own password; no password material in responses/logs | Change own password while PENDING or ACTIVE | Change own password while PENDING or ACTIVE |
| Donor eligibility | View history; record staff day-of acceptance/deferral and deferral date/reason category | None | View own advisory eligibility and next eligible date; no ability to mark accepted |
| Donation history | View/search all; create/correct donation record with audited reason | None | View own records, read-only |
| Donation slots | Create/manage slot availability; view all; cancel with reason; check in/no-show | None | View open slots; book/cancel own booking under cutoff; view own booking status |
| Testing/release | Record approval/rejection; Admin-only | None | No access to testing details; may see high-level donation outcome if approved for disclosure |
| Blood groups/compatibility | View; manage approved reference data with audit (compatibility edits restricted to controlled admin operation) | View requestable groups | View own group if confirmed |
| Blood units/inventory | Create from approved donation; view/search; discard with reason; run/review expiry; allocate/issue/deallocate | No unit-level inventory; may view request fulfillment | None |
| Hospital requests | View all; review, prioritize, reject, allocate, issue, update status; audit overrides | Create own, view/track/cancel own before issue; cannot alter staff status or allocations | None |
| Audit log | View/search operational audit | None | None |
| Reports/dashboard | Operational aggregate reports across system | Own request/fulfillment summary only | Own donation/booking summary only |

## Admin-only operations

The implemented Hospital management reads (`GET /api/admin/hospitals` and `GET /api/admin/hospitals/{hospitalId}`) require an authenticated current ACTIVE ADMIN. A PENDING or SUSPENDED target Hospital may be listed/viewed by that Admin; its state does not grant the target Hospital Admin permissions. DONOR/HOSPITAL sessions cannot use these reads. PENDING/SUSPENDED ADMIN accounts cannot establish or retain a permitted protected session. Client-supplied actor IDs, roles or status never replace the verified server Account. Screen 24 still has no approve/suspend/reactivate controls. Thulasi's shared `GET /api/admin/accounts` and `PATCH /api/admin/accounts/{accountId}` now implement queue/bounded approval, suspension and reactivation with transactional audit/revocation; [exact subset and live limits](account-approval-backend.md) are documented. Basic Console approval observations are recorded separately in that guide. The shared `/admin/accounts` frontend now implements the bounded approval controls separately from Screen 24; remaining live frontend/further backend verification and suspension/reactivation UI integration remain dependencies. No Hospital-only Account update endpoint is authorized by this read integration.

Only an ACTIVE Admin / Blood Bank Staff account may: approve/suspend/reactivate accounts; confirm blood group for operational use; make final day-of donor acceptance/deferral; record and correct completed donations; approve/reject testing; create, discard, expire, allocate, deallocate, or issue blood units; review/reject hospital requests; change request priority/status on behalf of workflow; edit blood-group/compatibility reference data; access audit logs and system-wide reports. Any correction, override, account-state change, or reactivation requires reason and audit event. Reactivation invalidates old sessions; the account must log in again.

Hospital and Donor operational permissions in the matrix require `ACTIVE` account status. Pending users are limited to approval/status view, permitted own-profile read/update, password change, and logout. Suspended users cannot log in and have no valid protected requests; middleware/service logic checks current status on every request.

Hospitals cannot allocate units, view unit-level donor provenance, change staff decisions, or see other hospitals' requests. Donors cannot self-approve, record donations, alter eligibility outcome, or see other donors. User-supplied identifiers are never trusted in place of authenticated ownership.

## Search and filtering

### Admin / Blood Bank Staff

- Donors: name/identifier/contact, blood group, account status, eligibility/next eligible date, area.
- Bookings/donations: donor, slot/date range, booking/donation status, donation outcome/testing status.
- Inventory: blood group, exact unit ID, unit status, collection/expiry date range, available-only, expiry-soon.
- Hospitals (implemented reads): organization name, registration number, contact name or phone; exact Account-status filter (`PENDING`, `ACTIVE`, `SUSPENDED`); positive page number, fixed 20-row pages. No email, credentials, request summaries or arbitrary Account lookup is exposed.
- Hospital requests: hospital, request ID, status, priority, blood group, submitted/needed-by range, outstanding quantity.
- Audit: actor, entity type/id, action, date range.

### Hospital

- Own requests: request ID, blood group, status, priority, submitted/needed-by date range. Sort by newest, need-by date, or status. No inventory query by unit.

### Donor

- Own bookings: status/date range.
- Own donation history: donation date range/status. Donor profile lookup is self-only; public directory/search of donors is not included.
