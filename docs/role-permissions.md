# Role Permissions

## Permission principles

- Default deny: each endpoint requires authentication and an explicit role/ownership check.
- A Hospital can see only its own profile and requests. A Donor can see only their own profile, bookings, and donation history. Admin / Blood Bank Staff can access operational records needed to run the bank.
- Public registration never creates an Admin account. Admin provisioning is out-of-band/manual for this project.
- Delete means logical cancellation/deactivation where history matters. Completed donations, allocations, issued units, audit events, and requests are retained; no user can hard-delete traceable history through the application.

## Permission matrix

| Resource/action | Admin / Blood Bank Staff | Hospital | Donor |
|---|---|---|---|
| Register account | Create/approve/suspend all non-admin profiles; Admin account provisioning outside public flow | Create own pending account | Create own pending account |
| Login/logout | Own account | Own account | Own account |
| Profile | View/update all operational profiles; approve/suspend account | View/update own hospital contact/profile | View/update own donor profile |
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

Only Admin / Blood Bank Staff may: approve/suspend accounts; confirm blood group for operational use; make final day-of donor acceptance/deferral; record and correct completed donations; approve/reject testing; create, discard, expire, allocate, deallocate, or issue blood units; review/reject hospital requests; change request priority/status on behalf of workflow; edit blood-group/compatibility reference data; access audit logs and system-wide reports. Any correction or override requires reason and audit event.

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
