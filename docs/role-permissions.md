# Role Permissions

## Permission principles

- Default deny: each endpoint requires authentication and an explicit role/ownership check.
- A Hospital can see only its own profile and requests. A Donor can see only their own profile, bookings, and donation history. Admin / Blood Bank Staff can access operational records needed to run the bank.
- Public registration never creates an Admin account. Admin provisioning is out-of-band/manual for this project.
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

Only an ACTIVE Admin / Blood Bank Staff account may: approve/suspend/reactivate accounts; confirm blood group for operational use; make final day-of donor acceptance/deferral; record and correct completed donations; approve/reject testing; create, discard, expire, allocate, deallocate, or issue blood units; review/reject hospital requests; change request priority/status on behalf of workflow; edit blood-group/compatibility reference data; access audit logs and system-wide reports. Any correction, override, account-state change, or reactivation requires reason and audit event. Reactivation invalidates old sessions; the account must log in again.

Hospital and Donor operational permissions in the matrix require `ACTIVE` account status. Pending users are limited to approval/status view, permitted own-profile read/update, password change, and logout. Suspended users cannot log in and have no valid protected requests; middleware/service logic checks current status on every request.

Hospitals cannot allocate units, view unit-level donor provenance, change staff decisions, or see other hospitals' requests. Donors cannot self-approve, record donations, alter eligibility outcome, or see other donors. User-supplied identifiers are never trusted in place of authenticated ownership.

## Search and filtering

### Admin / Blood Bank Staff

- Donors: name/identifier/contact, blood group, account status, eligibility/next eligible date, area.
- Bookings/donations: donor, slot/date range, booking/donation status, donation outcome/testing status.
- Inventory: blood group, exact unit ID, unit status, collection/expiry date range, available-only, expiry-soon.
- Hospital requests: hospital, request ID, status, priority, blood group, submitted/needed-by range, outstanding quantity.
- Audit: actor, entity type/id, action, date range.

### Hospital

- Own requests: request ID, blood group, status, priority, submitted/needed-by date range. Sort by newest, need-by date, or status. No inventory query by unit.

### Donor

- Own bookings: status/date range.
- Own donation history: donation date range/status. Donor profile lookup is self-only; public directory/search of donors is not included.
