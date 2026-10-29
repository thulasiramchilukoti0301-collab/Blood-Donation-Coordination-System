# Blood Request backend service milestone

**Current activation (2026-10-27):** `runtime.js` wires the approved active-group policy, action registry, connection context, numbered history and +05:30 serializer. `app.js` mounts the bounded create/list/detail and authenticated active-group lookup routes. Every request checks installed table/trigger visibility; missing infrastructure returns a safe 503 without DDL. Review/cancellation/priority/allocation/fulfillment routes remain absent. [Current activation runbook](../../../../docs/feature7-activation.md) supersedes the historical unmounted milestone below.

The [2026-10-27 fast-track implementation report](../../../../docs/feature7-fast-track.md) describes the subsequent unmounted router, optional scoped history/timestamp reads, candidate context/transaction review integration, four routed Sky Pipeline frontend screens and verification evidence. All production request APIs and mutations remain disabled. The original internal milestone below is retained as historical scope; the report records the current additions and remaining gates.

This module contains internal service and repository code for the approved Feature 7 request contracts. No request route is registered in `app.js`; this milestone mounts **no** Blood Request API. The module has no environment import, pool construction, migration runner or database startup behavior.

The [HTTP integration contract review](../../../../docs/blood-request-integration-contracts.md) records resolved rules, open API choices, and the proposed history migration/audit contracts. It is a review document; proposed decisions are not approved production behavior.

## Implemented internally

- Strict validation for the approved creation fields, exact priority/status values, canonical unsigned BIGINT identifiers, the 1–65,535 quantity range, safe note length/control checks, and the documented structured list filters.
- A fixed page size of 20. Hospital rows currently default to deterministic newest-first ordering; Admin rows use the approved EMERGENCY/URGENT/NORMAL, need-by, submission-time and request-ID order. Values are bound parameters. No free-text `q`, `search`, or caller-supplied sort expression is accepted. Hospital selectable sorting remains a document-level decision.
- Parameterized HospitalRequest reads with SQL ownership constraints, explicit response allowlists, decimal-string IDs, and no credentials, session fields, donor identity, fabricated allocation totals or fabricated history.
- ACTIVE Hospital/Admin service authorization that reloads the current Account; Hospital methods also verify a Hospital profile. Creation locks/rechecks Account, validates the middleware's internal session context against the authoritative stored SID on that same transaction connection, then locks/rechecks Hospital and BloodGroup. Its internal caller passes `{ accountId, session: req.authSession }`, matching the existing Hospital write-service contract.
- Creation orchestration inserts SUBMITTED HospitalRequest, the initial RequestStatusHistory row, and one AuditEvent on the same connection. Missing request action mapping, audit writer or requestable-group policy fails closed before opening a transaction. The caller must inject a reviewed action code and group policy; this module defines neither.
- A pure helper for the approved static transition graph. Cancellation remains unavailable unless a caller can provide authoritative issued quantity; even zero issued units does not implement transactional release of existing allocations.
- Safe database errors and transaction cleanup. Request/history/audit failure rolls back; failed rollback destroys the connection; a commit or post-commit cleanup ambiguity returns a safe uncertain-outcome error.

`neededBy` parsing currently accepts strict ISO-8601 timestamps with an explicit offset and stores the equivalent Asia/Kolkata wall time. This is an internal candidate parser only; the public request timestamp serialization format has not been approved. Date filters currently treat ISO calendar-date `From`/`To` bounds as inclusive days; those wire formats and inclusive-bound semantics are also internal candidates, not approved public behavior. The API design names the structured filter fields but does not document their wire formats. The permissions document mentions Hospital sorting choices, while the API/storage contracts do not approve a sort parameter; this module therefore exposes no such parameter. A relative needed-by cutoff is open and is not enforced here. Keep the endpoints unmounted until these details are reconciled.

## Production gates

- Development installation of `008_blood_requests.sql` is not verified. The checked-in migration is not applied by this module.
- RequestStatusHistory exists only in the tested proposal `database/proposals/request-status-history.sql`; its migration number remains **UNASSIGNED**. Its trigger actor/reason/system context and deployment/definer contract require coordination. This module writes only the initial row and does not set trigger session variables or mutate request status.
- A request creation AuditEvent action/reason mapping is not approved. `ACCOUNT_APPROVED` / `REGISTRATION_REVIEWED` is the Account-approval mapping and is not reused here. Test-only action strings do not establish production vocabulary.
- BloodGroup existence is queried from the database, but whether inactive groups may be requested and which roles/statuses may see lookup data remain open. The service requires an injected policy and fails closed without one.
- Allocation is not implemented. List/detail HTTP contracts require fulfillment values/history; cancellation needs a locked authoritative issued-quantity query and release behavior. This module does not fabricate these values, implement FEFO, or permit cancellation/status/priority mutations.

The internal list/detail repository methods return only base request records and are not complete HTTP responses. They must remain unmounted until the installed storage and required Allocation/history response dependencies are ready. No router is defined in this milestone.

## Verification

`backend/tests/blood-requests.test.js` uses isolated repositories/connections to exercise validation, filtering, ownership scope, safe projection, creation ordering/atomicity, failure cleanup and lifecycle gates. These tests do not connect to MySQL or establish development installation. Run it with the existing no-private-env test loader; the complete suite remains `npm test` under the same sanitized child environment described in `docs/first-admin-bootstrap.md`.
