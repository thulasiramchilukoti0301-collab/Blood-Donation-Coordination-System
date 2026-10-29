# Feature 10 — Dashboards & Reports Handoff

Feature 10 adds read-only Admin and Hospital dashboards and filtered Admin report APIs/UI. It does not modify database schema or query development data.

## Routes and pages

- `GET /api/admin/dashboard`, ACTIVE Admin only: donor and Hospital profile totals, pending Account/Hospital counts, Donation totals by stored outcome, monthly collected-donation trend, BloodUnit counts by canonical group and stored unit status, and HospitalRequest status/quantity totals.
- `GET /api/hospitals/me/dashboard`, PENDING or ACTIVE Hospital: organization name and Account status, own request totals by status, requested quantities, and latest eight requests. Every query is scoped by the Account ID loaded from the current server session.
- `GET /api/admin/reports/inventory`: stored BloodUnit count by group and status.
- `GET /api/admin/reports/donations?from=&to=&interval=DAY|WEEK|MONTH`: recorded outcome totals by time bucket.
- `GET /api/admin/reports/requests?from=&to=&interval=DAY|WEEK|MONTH`: request status totals and quantities, daily trend, and hospital/status aggregates.
- UI pages: `/admin`, `/hospital`, and `/admin/reports`. Feature10 styles live in `frontend/src/features/reports/dashboards.css`; earlier Feature 6–9 styles were not edited.

## Data limits

- Counts are database aggregates. Donor/hospital totals include all rows in their profile tables; pending counts are Account-backed.
- Donation outcomes are `COLLECTED`, `INCOMPLETE`, and `DEFERRED`. Trends use `collected_at` and only collected rows for the Admin dashboard trend.
- Inventory values use actual `BloodUnit.unit_status` CHECK values. A stored `ALLOCATED`/`ISSUED` status is a count only; there is no operational allocation/issue lifecycle in this report contract.
- Request status/quantity aggregates come from HospitalRequest. Requested quantities are not issued quantities. No fulfillment rate is inferred.
- Recent Admin dashboard activity reuses persisted Feature 9 AuditEvent reads; failure of AuditEvent storage leaves dashboard metrics usable and the activity panel reports unavailable.
- Feature 8 `Allocation`/`BloodCompatibility` tables are not queried and are not prerequisites. Missing/unreadable report tables return `REPORTS_UNAVAILABLE` (503), not invented empty totals. No CSV export is provided.
- Dates are strict `YYYY-MM-DD`, real calendar dates, and at most 366 days apart when both ends are supplied. Unknown filters and unsupported interval values fail with `VALIDATION_ERROR`.

## Authorization and safety

All routes reuse shared stored-session authorization and set `Cache-Control: no-store`. Admin routes require ACTIVE ADMIN. Hospital dashboard permits PENDING Hospital accounts for their own status and read-only request summary; suspended accounts cannot retain an authenticated session. No endpoint accepts a Hospital ID as an authorization selector. SQL values are parameterized; trend SQL fragments come only from a fixed interval allowlist. Safe projections omit emails, contact details from aggregate reports, patient notes and donor identity.

## Verification status

Automated tests are in `backend/tests/reports.test.js`. Test/build results and browser coverage should be recorded after running the project commands in the target development environment. No database fixture or MySQL connection was used by this implementation. Before final demonstration, verify against a disposable copy assembled from migrations 001–008, 010 and 012; Feature 8 migration 009 is not needed for reports.
