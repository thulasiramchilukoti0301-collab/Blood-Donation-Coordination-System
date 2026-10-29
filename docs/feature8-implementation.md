# Feature 8 storage and internal FEFO milestone

Migration 009 creates the approved 64-row directed BloodCompatibility matrix (27 compatible, 37 incompatible) and Allocation with a generated active-unit unique key. It does not change BloodUnit, Donation, HospitalRequest, or Feature 7 files. Cancelled rows retain history and release the unique active-unit key; issued rows continue to occupy it.

The internal preview reads the real recipient group, current allocations, approved collected donations and available unexpired compatible units. FEFO orders by expiry, collection time and numeric unit ID. It is a snapshot, not a reservation. The pure selector enforces capacity and reports shortfall. The read-only ACTIVE Admin routes are `GET /api/admin/blood-compatibility` and `GET /api/admin/requests/{requestId}/allocation-preview`; both revalidate the current stored session, validate inputs, use parameterized queries, return safe projections and `Cache-Control: no-store`, and fail closed if required Feature 8 storage or metadata is unavailable. The new Admin pages are `/admin/allocations` and `/admin/compatibility`, using the scoped Indigo Inventory theme. No allocation confirmation or inventory mutation is available.

## Transaction and audit handoff

The storage and read-only selector do not yet implement a production allocation transaction. Proposed common order for allocation, issue, cancellation, discard and expiry writers:

1. Lock the acting ACTIVE Admin Account row, then validate the authoritative stored SID on the same connection. For trusted expiry work, use the separately reviewed system actor/context.
2. Lock the HospitalRequest row.
3. Lock all candidate BloodUnit rows in ascending `blood_unit_id` order.
4. Lock relevant existing Allocation rows in ascending `allocation_id` order (including active allocations for the candidates).
5. Recheck request state/capacity, compatibility, donation approval, unit status, intended issue date and allocation uniqueness under these locks.
6. Set the verified RequestStatusHistory actor/reason connection context, update unit/allocation rows, then update HospitalRequest. The existing trigger writes history exactly once and checks the active actor/reason. Clear context before releasing the connection.
7. Insert audit rows on the same transaction connection, then commit. Any error rolls back all writes; failed rollback or uncertain commit destroys the connection and is never blindly retried.

This is a proposal for review with Thulasi and all future inventory writers; it is not concurrency verified. RequestStatusHistory already accepts `ALLOCATION_UPDATED` when moving to `PARTIALLY_FULFILLED`; `FULFILLED` is reserved for issued units. The AuditEvent writer has no allocation action in its approved registry. Proposed action for review: `ALLOCATION_CREATED`, subject `Allocation`, one event per unit with a shared server-generated operation ID and fixed summary. Do not add it to a production registry until reviewed. The existing `HOSPITAL_REQUEST_STATUS_CHANGED` action covers request status changes only and should not stand in for allocation traceability.

The migration passed a fresh MySQL 8.0.39 disposable verifier with exact 001–008 prerequisites, all 64 directed mappings (27 compatible), metadata/FK/CHECK/generated-key checks, duplicate active-unit rejection, cancelled-history retention/reallocation and transaction rollback. The verifier checked that only the two intended base tables were added. No development database was configured or contacted. Migration 009 is ready for a reviewed, manual development installation after a read-only preflight confirms canonical IDs/codes and both target objects are absent; execute it once and inspect its postconditions. Never rerun 001–008 or this non-idempotent DDL after partial failure without inspecting the schema.

## Feature 9 handoff

Reuse `database/migrations/010_audit.sql`, the existing AuditEvent actor/subject indexes, and `backend/src/modules/audit/writer.js`. Feature 9 can independently define and review an explicit action registry, add an ACTIVE Admin read-only Audit Log service/route with strict pagination and parameterized filters for actor, subject type/ID, action and occurred-at bounds, and render safe summaries without exposing credentials or private medical data. It can use `RequestStatusHistory` as a separate request timeline read; that table is not AuditEvent and has its own request/actor joins and access checks. Allocation subject events must remain absent from results as real activity until a reviewed action is activated and allocation writes are mounted. Aggregate reporting should consume safe projections and avoid replacing operational traceability with inferred audit data.
