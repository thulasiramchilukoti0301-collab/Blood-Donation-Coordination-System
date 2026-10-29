# Feature 9 — Audit and operational tracking

## Delivered read-only scope

Feature 9 adds the ACTIVE Admin endpoint `GET /api/admin/audit-events` and screen `/admin/audit`. Both reuse the stored-session current-account guard. The API validates query fields strictly, returns `Cache-Control: no-store`, uses parameterized SQL, and returns a bounded page of safe AuditEvent projections. It reads the existing `AuditEvent` table and checks its primary, actor and subject indexes; no migration, fixture or write path is added.

Supported query parameters are `actorAccountId`, `actionCode`, `subjectType`, `subjectId`, `from`, `to`, `page`, and `pageSize`. IDs must be canonical unsigned BIGINT decimal strings. Action code is an exact printable ASCII value of at most 48 characters; subject type is from the schema whitelist. Dates are strict `YYYY-MM-DD` calendar days in the project timezone; both ends are inclusive. Page defaults to 1; page size defaults to 25 and is limited to 1–100. Results sort by `occurred_at DESC, audit_event_id DESC` for deterministic newest-first pagination. The screen offers 25, 50, or 100 rows per page. There is deliberately no free-text summary search.

The response includes event ID, nullable actor Account ID, action code, subject type/ID, timestamp serialized with `+05:30`, reason code, and stored change summary. It omits operation ID and all Account profile/authentication fields. Unknown filters and invalid identifiers, dates, or pages return `400 VALIDATION_ERROR`; absent/incomplete/unreadable AuditEvent storage returns a safe `503 AUDIT_READ_UNAVAILABLE`. Empty pages return an empty event list and real pagination totals.

## Request status timeline

The existing ACTIVE Admin `GET /api/admin/requests/{requestId}` detail projection now includes each genuine RequestStatusHistory row's prior/current status, timestamp, `changedByAccountId` as a safe decimal Account ID (wire property `actorAccountId`), and `reasonCode` when stored. Feature 7's trigger remains the only writer for status updates; request creation continues inserting its initial `SUBMITTED` history entry in its existing transaction. No history row is synthesized or duplicated. Hospital request detail continues to omit actor IDs and staff reason codes. The existing Admin request queue's View Details panel displays this timeline.

## Audit action coverage and gaps

Existing production call sites atomically record `ACCOUNT_APPROVED`, `ACCOUNT_SUSPENDED`, and `ACCOUNT_REACTIVATED` with the shared Account status/session transaction. Hospital request creation records `HOSPITAL_REQUEST_CREATED` in the same transaction as the HospitalRequest and initial history event. The existing request action registry also lists `HOSPITAL_REQUEST_STATUS_CHANGED` and `HOSPITAL_REQUEST_CANCELLED`, but no corresponding status/cancel HTTP mutation is mounted. The internal request review method requires an injected `statusIntegration`, which production runtime does not provide. These are existing action codes; this feature adds no action vocabulary.

Hospital/Donor registration and profile changes have no approved action mapping and currently have no AuditEvent call. No audit action is invented here. The request review implementation is internal preparation only and is not enabled in production runtime; status changes must continue to use the trigger-backed RequestStatusHistory and require a separately approved route/transaction contract before activation. Allocation commit, issue, cancellation and `ALLOCATION_CREATED` audit are not implemented or displayed. Other donation/inventory/booking/admin mutation workflows do not currently have mounted mutation paths or approved writer integrations. Those action mappings and atomic integrations remain cross-feature/Thulasi dependencies.

## Verification and manual checks

Database-free tests cover authorization roles/session rejection, query validation, parameterized filters, ordering, pagination bounds, empty/unavailable storage, safe projections, and Admin versus Hospital request-history fields. Frontend tests cover filters, reset, pagination contracts, response validation and read-only requests. Browser tests cover the Admin screen at desktop/tablet/mobile sizes, focus, error/retry, empty and paginated states. Build and full test-suite results are reported with the implementation milestone.

Manual development verification requires no schema work: with migration 010 already installed, log in as an ACTIVE Admin, open `/admin/audit`, filter a known persisted Account/request event, inspect its summary and reason, and open an Admin request's View Details panel to compare the recorded timeline to its RequestStatusHistory rows. Check empty filters and access as Hospital/Donor without exposing those records. Do not rerun migration 010 or insert test events into the development database.

## Feature 10 handoff

Feature 10 can begin independently with read-only reports over existing tables: inventory totals by BloodGroup/status, donation outcomes and release timing, request counts/quantities by status/priority, and safely scoped Hospital/Donor summaries. Audit Log filter conventions and the existing RequestStatusHistory timeline can be reused for operational traceability. Allocation-derived reporting must remain unavailable until the atomic allocation lifecycle and audited actions are approved and implemented; do not infer allocations from preview candidates.
