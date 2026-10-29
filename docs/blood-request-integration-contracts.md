# Feature 7 — HTTP integration contract review

**APPROVED and implemented update — 2026-10-27.** The latest user request records Thulasi's approval of migration 012, verified connection context, active-only groups for new requests, future explicit-offset timestamps serialized +05:30, controlled request AuditEvent vocabulary and fixed pagination/order. The create/list/detail/lookup subset is now mounted with real frontend clients. Allocation fields are omitted from bounded reads; cancellation/fulfillment/review/priority routes remain disabled. See [current contracts, exact responses and deployment instructions](feature7-activation.md). Everything below is the earlier proposed review, retained as historical rationale rather than current mounting status.

Subsequent implementation: [Feature 7 fast-track report](feature7-fast-track.md). Four Sky Pipeline screens and unmounted backend adapters now exist, including optional history/timestamp and isolated context integration. This does not approve the proposed migration/audit/BloodGroup/date/projection contracts below or mount any request endpoint. Production screens show unavailable states until the integration gates are satisfied.

**Status: PROPOSED for joint review; not an approval or migration assignment.** Reviewed against the current approved project documents and the untracked internal request module on 2026-10-27. No request HTTP route is mounted. No development database or private environment was accessed.

This review records what the documents and implementation establish, separates remaining decisions, and proposes a migration number and integration protocol for Lathikaa and Thulasi to review. It does not authorize request endpoint mounting, production audit action codes, or SQL application.

## Resolved from current contracts and implementation

### Shared authorization and errors

- Mount any future route through the existing session middleware and `requireCurrentAccount`, `requireRole`, and, for operational work, `requireActiveAccount` guards. Mutations also use the shared trusted-Origin/CSRF guard. Do not add a request-specific identity/session system.
- Pass the server-only verified context `{ accountId: req.authAccount.accountId, session: req.authSession }` into write services, matching the existing Hospital profile mutation. The request service re-reads Account state; creation re-locks Account, validates that stored SID through the shared `requireStoredSession` guard on the same transaction connection, then checks the Hospital profile and BloodGroup. The session context is never accepted from body/query data. Client-supplied actor, role, or Hospital IDs are rejected as unexpected fields.
- Thulasi's merged approval service is the shared Account implementation: it approves only PENDING DONOR/HOSPITAL accounts, locks Accounts in ascending numeric ID order, and commits status change, target-session revocation, and one `ACCOUNT_APPROVED` AuditEvent together. Login persists the new session under the Account lock on the same connection. Reuse those shared paths; do not add a request-specific approval or session workflow. The reported basic approval evidence does not establish concurrency/failure coverage or authorize broader account-state actions.
- The current-account guard reloads the database Account and destroys the session if the Account is missing, suspended, or differs from the login-time role/status snapshot. PENDING Donor/Hospital sessions can reach only explicitly allowed profile/status paths; `requireActiveAccount` blocks operational request actions. CSRF checks compare the supplied token to the current server-side session token and check a supplied Origin against the configured frontend origin.
- Use the existing safe envelope `{ success: false, error: { code, message } }`. Existing shared codes include `AUTHENTICATION_REQUIRED`, `ACCOUNT_UNAVAILABLE`, `FORBIDDEN`, `ACTIVE_ACCOUNT_REQUIRED`, and `CSRF_TOKEN_INVALID`. Request validation uses `400 VALIDATION_ERROR`; missing or out-of-scope requests use the same `404 REQUEST_NOT_FOUND`; invalid transitions use `409 INVALID_REQUEST_TRANSITION`; database failures use safe `503 DATABASE_UNAVAILABLE`. Do not return driver details.
- A missing internal dependency currently returns `503 REQUEST_FEATURE_NOT_READY`. That is a fail-closed implementation guard, not an approved public API response.

### Request creation and reads

- Creation accepts exactly `recipientGroupId`, `quantityRequested`, `priority`, `neededBy`, and optional `note`. Quantity is an integer from 1 to 65,535; priority/status values are exact uppercase codes; IDs are canonical positive unsigned BIGINT decimal strings. Reject unknown fields.
- Exact statuses are `SUBMITTED`, `UNDER_REVIEW`, `AWAITING_INVENTORY`, `PARTIALLY_FULFILLED`, `FULFILLED`, `REJECTED`, and `CANCELLED`; exact priorities are `EMERGENCY`, `URGENT`, and `NORMAL`. The row guard allows `SUBMITTED → UNDER_REVIEW/CANCELLED`; `UNDER_REVIEW → AWAITING_INVENTORY/PARTIALLY_FULFILLED/REJECTED/CANCELLED`; `AWAITING_INVENTORY → PARTIALLY_FULFILLED/CANCELLED`; and `PARTIALLY_FULFILLED → FULFILLED/AWAITING_INVENTORY/CANCELLED`. `FULFILLED`, `REJECTED`, and `CANCELLED` are terminal. REJECTED requires a reason code. These are storage transitions only: fulfillment and cancellation still require allocation-derived predicates, and Admin cancellation after partial issue remains open.
- Hospital/Admin list filters are the documented structured fields: `requestStatus`, `priority`, `recipientGroupId`, `submittedFrom`, `submittedTo`, `neededByFrom`, `neededByTo`, and `page`; Admin may additionally filter by `hospitalId`. Hospital ownership is always part of the SQL predicate. No free-text `q`/`search` or client-provided SQL sort is approved.
- Pagination is one-based with fixed page size 20 in the internal implementation. Values are bound parameters. The Admin work queue has the documented fixed order: EMERGENCY, URGENT, NORMAL; earliest `needed_by`; oldest `created_at`; stable ascending request ID.
- The internal Hospital list defaults to newest first (created time descending, then request ID descending). `role-permissions.md` also names Hospital sorts by needed-by and status, but the API route does not define a sort parameter and the storage contract rejects an unapproved SQL sort parameter. The internal module therefore exposes no such parameter; this difference needs review before treating those choices as HTTP behavior.
- Current internal base projections contain the request’s own stored fields and BloodGroup code/name. Admin projection additionally contains Hospital ID and organization name. IDs remain decimal strings. Projections exclude credentials, session fields, donor identity, and unit provenance. The implementation does not fabricate list/detail allocation totals or history. Full documented list/detail responses still depend on real Allocation and RequestStatusHistory data.
- Cross-Hospital detail lookups return the same not-found error as absent requests. Hospital request reads must not reveal donor identity, unit-level donor provenance, or staff-only notes.

## RequestStatusHistory migration plan — PROPOSED

### Proposed number and ordering

Propose `012_request_status_history.sql`, subject to Lathikaa/Thulasi coordination. This is a proposal only: do not create or rename a migration, edit the migration registry, or apply SQL until they approve the number and immutable application order.

Existing ownership remains intact: 008 is HospitalRequest and its row guards (Lathikaa); 009 is reserved for BloodCompatibility/Allocation (Lathikaa, currently empty); 010 is AuditEvent only (Lathikaa ownership, Account dependency); 011 is reserved for coordinated views/reports/deferred work and is currently empty. Do not repurpose 009, append history to 010, or move history into 008.

RequestStatusHistory itself depends on Account (002) and HospitalRequest (008). The request operations that write AuditEvent also require 010. Proposed fresh-schema order for the request integration is:

`001 → 002 → reference_data.sql → 004 → 008 → 010 → 012_request_status_history.sql`

009 is not a history-table dependency, though it is needed for allocation-derived responses and allocation workflows. If 011 contains objects that read request history, apply 012 before 011 and record that nonnumeric application order explicitly; do not infer order from filename alone. Confirm the 011 dependency and sequence with its owner before approval.

### Proposed write/trigger protocol

- Request creation inserts the HospitalRequest in `SUBMITTED`, then inserts exactly one initial history row `(old_status = NULL, new_status = 'SUBMITTED', changed_by_account_id = verified Hospital Account)` in the same transaction as the request and AuditEvent. The proposal has no AFTER INSERT history trigger.
- `trg_request_status_history_update` is the only writer for later status changes. It writes exactly one row after an UPDATE only when status changes. Priority-only, timestamp-only, and no-op updates write none. The service must not separately insert transition history. Display ordering for equal `changed_at` uses the history primary key as a stable tie-break.
- For an HTTP status update, set `@request_actor_account_id` from the verified server principal, never from request JSON; set `@request_reason_code` only from an approved safe reason code; set `@request_system_operation_id = NULL`. The actor must be rechecked as ACTIVE. The proposed trigger additionally permits a Hospital actor to cancel only its own request, permits Admin graph transitions except Admin cancellation, and requires a REJECTED reason to match `HospitalRequest.rejection_reason_code`. These trigger permissions remain proposed and must align with the final service policy.
- The proposed system path uses a UUID-shaped `@request_system_operation_id` with a NULL actor. A UUID proves neither identity nor authorization. Keep it unused by HTTP; approve a specific trusted internal caller or remove this path before deployment.
- On checkout, clear all three session variables on the borrowed connection before transaction work. Set verified values on that same connection immediately before the status mutation. In `finally`, clear them after commit or rollback and before release; MySQL user variables survive rollback. If rollback or either context reset fails, destroy the connection and do not also release it. Preserve the original safe operation error when cleanup fails.
- Use one reviewed Account → request → allocation lock order. The proposed trigger re-locks the actor Account; application code should acquire the Account lock before request/allocation locks. The trigger is defense in depth, not session authentication or concurrency proof. Do not expose status mutation until the context, permissions, lock strategy, definer, and cleanup have been jointly reviewed and verified.

The proposal SQL has been exercised only in its documented disposable test. Its mechanics are not evidence of a numbered/deployed migration, web authorization, production privileges, or concurrent correctness.

## AuditEvent actions — PROPOSED, production codes disabled

The writer requires an explicit reviewed action registry and a transaction connection. Its generic API does not approve vocabulary. Existing `ACCOUNT_APPROVED` / `REGISTRATION_REVIEWED` is specific to Account approval and must not be reused for requests. Test-only request action strings do not authorize production codes.

| Operation | Proposed action code | Proposed reason/summary handling |
|---|---|---|
| Create request | `HOSPITAL_REQUEST_CREATED` | No reason code. Fixed summary `Hospital request created`. |
| Review/status transition | `HOSPITAL_REQUEST_STATUS_CHANGED` | Reason code only from a reviewed allowlist. For rejection, use the same approved code stored as `rejection_reason_code`. Fixed summary built from canonical statuses, e.g. `Request status changed: UNDER_REVIEW -> REJECTED`. |
| Hospital cancellation | `HOSPITAL_REQUEST_CANCELLED` | Reason-code requirement and accepted values need approval. Fixed summary `Hospital request cancelled`. Use this action for the cancellation event rather than also writing a generic status-change event. |
| Priority change (additional API dependency) | `HOSPITAL_REQUEST_PRIORITY_CHANGED` | The API requires a reason; approve a code allowlist and a fixed summary built from canonical priorities before mounting the priority route. |

Each action uses subject type `HospitalRequest`, the server-derived request ID, the verified actor, and a server-generated UUID operation ID. Do not put a request note, cancellation note, safeNote, Hospital name, contact, patient/clinical detail, or arbitrary user text in `reasonCode` or `changeSummary`. The AuditEvent scalar/length checks do not establish content safety. For status/priority summaries, interpolate only exact values from the server-side enum; keep all free text out. Add proposed action codes to the production writer registry only after review approval.

## BloodGroup validation policy

- `BloodGroup.is_active` **does exist** in 001: `BOOLEAN NOT NULL DEFAULT TRUE`, constrained to 0/1. The request repository selects it; no column addition is needed.
- The schema CHECK permits exactly the eight canonical codes `O-`, `O+`, `A-`, `A+`, `B-`, `B+`, `AB-`, `AB+`. `reference_data.sql` seeds those eight stable IDs 1–8, all active. This is the full set currently permitted by the approved schema, not a reason to hardcode additional groups.
- A request accepts a database-backed `recipientGroupId`. Unknown/nonexistent IDs must be rejected with safe validation; unsupported codes cannot be created under the schema CHECK. Keep historical request display joined to its stored group row.
- Whether `is_active = 1` is required for a new request is still OPEN. `implementation-readiness.md` lists excluding inactive groups as a candidate, and the request service deliberately requires an injected `requestableBloodGroup` policy and fails closed without it. Thulasi must confirm this cross-cutting reference-data rule and whether already-pending requests remain fulfillable after deactivation. Role/status visibility for any future group lookup is separately OPEN.

## Date/time, filters, sorting, projections, and errors

### Date/time

`needed_by` is MySQL `DATETIME`, so storage has no timezone marker. The API design names `neededBy` but does not specify wire format, timezone interpretation, response format, fractional seconds, or a relative cutoff. The internal parser currently accepts strict ISO-8601 with an explicit offset or `Z`, converts the instant to an Asia/Kolkata wall-clock DATETIME, and the SQL projection returns a local timestamp string without an offset. The response mapper's Date-object fallback instead emits UTC with `Z`, so the internal mapper does not yet define one uniform response representation. This is internal candidate behavior, not an approved public contract. Date-only filter inputs and inclusive whole-day bounds are likewise internal behavior; API docs name the filters but do not define their wire format or timezone semantics.

Proposal for review: require ISO-8601 `neededBy` with an explicit timezone, normalize the instant to Asia/Kolkata for DATETIME storage, return an ISO-8601 timestamp with `+05:30`, and define submitted/needed-by filter bounds as ISO calendar dates with inclusive local calendar days. Confirm this with Thulasi before exposing the validator/serializer over HTTP. The project’s Asia/Kolkata rule for donation slots does not by itself approve the request rule.

### Sorting and search

Search means the documented structured filters only. Admin order is resolved as stated above. Hospital newest-first is the current fixed internal default. Whether Hospital callers may select needed-by/status sorting is unresolved because permissions list those choices but API/storage do not define a `sort` field, direction, or tie-breaks. No free-text search or SQL order parameter is approved.

### Filters and pagination

Use the exact structured fields listed above, reject unknown query keys, use one-based positive `page`, and fixed 20-row pages. The internal validator currently requires valid calendar dates for date bounds and rejects reversed ranges. The public date serialization/bound semantics still require approval.

### Response projection and errors

Preserve the current explicit base allowlist. A complete documented list/detail response additionally needs allocation-derived counts and status history; those cannot be returned from the current internal base reads. Use safe consistent errors and do not disclose whether a request exists outside Hospital ownership. Align the eventual router response wrapper and `no-store` handling with the existing Hospital/Admin route conventions.

## Decisions still requiring review

1. Thulasi and Lathikaa: approve or change proposed migration 012, exact application order relative to 009/010/011, connection context names, trusted-system path, trigger permissions, definer, and Account/request/allocation lock order.
2. Thulasi: decide whether inactive BloodGroups can be newly requested and what deactivation means for pending requests; confirm any group lookup visibility for request creation.
3. Thulasi and Lathikaa: approve neededBy input/output timezone/format, filter date semantics, and whether there is a relative cutoff.
4. Thulasi and Lathikaa: reconcile Hospital selectable sorting in role-permissions with the API contract and choose supported options/tie-breaks.
5. Audit owner/reviewer: approve production action codes and reason-code allowlists, including the additional priority action. The proposed names above are not enabled.
6. Allocation owner/reviewer: complete 009 storage/transaction contracts before list/detail/cancellation routes that need allocation-derived values or release/issue predicates.

## Mount readiness and next milestone

**No safe request HTTP endpoint is ready to mount.** The history migration is unnumbered/uninstalled, request production audit actions are unapproved, the active-group rule and public date contract are unresolved, and the approved list/detail projections require real Allocation and history data. The shared current-account/role/CSRF guards are reusable, but they do not satisfy these missing domain dependencies.

**Next implementation milestone: Feature 7A — joint contract sign-off and request-history transaction integration.** Thulasi and Lathikaa first record the decisions above, especially the proposed 012 sequence, trigger context/lock protocol, BloodGroup activity rule, timestamp/sort API contract, and audit action/reason mappings. Then promote the history proposal under the approved number/order and implement only the approved context-setting/cleanup and audit wiring with focused tests. Do not apply the migration or mount routes in that milestone. The following milestone, Feature 7B — HTTP integration, starts only after the required schema is installed and Allocation/history-backed response dependencies are verified.
