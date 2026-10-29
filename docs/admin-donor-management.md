# Admin Donor Management

This bounded Thulasi-owned feature implements existing Screens 16 and 17 with Mint Gauge at `/admin/donors` and `/admin/donors/:donorId`. It adds no database schema, migration, seed, dependency, or new screen. Account approval/suspension/reactivation remains in the shared Account management page.

## Authorization and reads

All three routes require the authenticated current `ACTIVE` Admin, use server-side session identity, and return `Cache-Control: no-store`. A session cookie or client-supplied actor, role, status, or Donor ID never substitutes for server authorization. Donor ownership is resolved from the route and stored schema; this is an Admin directory operation, not a Donor self-service endpoint.

### `GET /api/admin/donors`

Optional query fields are exactly:

- `search`: trimmed literal search across full name, phone, area, and decimal Donor ID; at most 120 Unicode code points. SQL wildcard characters are escaped.
- `accountStatus`: `ANY` (default), `PENDING`, `ACTIVE`, or `SUSPENDED`.
- `bloodGroupId`: a positive unsigned BIGINT decimal-string identifier. The UI offers the eight canonical seed groups; an unknown ID yields no matches.
- `groupMatch`: `EITHER` (default), `REPORTED`, or `CONFIRMED`; applies only when `bloodGroupId` is supplied.
- `page`: positive decimal page number, default `1`; page size is fixed at 20.

The stable order is `full_name ASC, account_id ASC`. Each row contains only `donorId`, `fullName`, `phone`, nullable `area`, `accountStatus`, and distinct nullable `reportedBloodGroup` and `confirmedBloodGroup` summaries (`bloodGroupId`, `code`). Email, date of birth, address, eligibility answers, session data, and credentials are not list fields. Unknown/invalid query values return safe `400 VALIDATION_ERROR`.

### `GET /api/admin/donors/{donorId}`

The positive unsigned BIGINT path identifier names the Donor's shared Account key. A found Donor returns `donorId`, `email`, `accountStatus`, `fullName`, `dateOfBirth`, `phone`, `address`, nullable `area`, separate nullable reported/confirmed group details (`bloodGroupId`, `code`, `displayName`), `createdAt`, `updatedAt`, and a high-level `context`. Context contains booking and Donation counts, latest booking status/appointment time, and latest Donation outcome/release status/collection time. It omits eligibility decisions/answers, medical details, notes, staff narratives, collection references, unit provenance, session fields, and credentials. Missing/non-Donor targets return `404 DONOR_NOT_FOUND`; valid Admin access remains intact.

## `PATCH /api/admin/donors/{donorId}`

This CSRF- and trusted-Origin-protected operation uses only the currently supported Donor fields. A nonempty plain JSON body must be exactly one of these forms:

| Correction | Allowed fields | Required audit reason |
|---|---|---|
| Staff profile correction | Any nonempty subset of `fullName`, `dateOfBirth`, `phone`, `address`, `area`, plus `originalValues` and `reasonCode` | `STAFF_PROFILE_CORRECTION` |
| Staff-confirmed group selection | `confirmedBloodGroupId`, `originalValues`, and `reasonCode` | `STAFF_GROUP_CONFIRMATION` |

Text is trimmed and control characters are rejected. Maxima are 120/30/255/100 Unicode code points for full name/phone/address/area; blank or null area clears it. Date of birth must be a real `YYYY-MM-DD` date no later than the current Asia/Kolkata date, checked again after locks. A confirmed group must be a positive unsigned BIGINT decimal-string ID that exists in `BloodGroup` on the transaction connection; the UI offers the eight canonical choices. This does not define an inactive-group eligibility/allocation policy. Group confirmation is deliberately separate from other profile changes in one request. Clearing an established confirmed group is not supported by this contract.

`originalValues` is a required plain JSON object whose keys exactly match the fields proposed for change; each value is what the Admin read before editing. No missing, extra, inherited, or mixed-category keys are accepted. Original nonnullable text is an exact nonempty string within its column's documented code-point limit, with no control characters; it is compared without trimming. Original `area` is either its exact string or JSON `null`, never an empty-string substitute for null. Original `dateOfBirth` is a real `YYYY-MM-DD` date. Original `confirmedBloodGroupId` is a positive unsigned BIGINT decimal string or JSON `null` for an unconfirmed group. The server compares every original value with the locked Donor row before writing. A mismatch returns `409 DONOR_EDIT_CONFLICT`, without an update or audit event. Unrelated fields may change independently. `updated_at` is not the precondition because its `DATETIME` precision may miss same-second edits.

The body rejects `reportedBloodGroupId`, email, actor/ownership IDs, role, account status, password/hash, Donation outcome, BloodUnit group, timestamps, arbitrary reason text, unknown fields, and mixed profile/group correction requests. The Donor's self-reported value is never copied to the confirmed column. Profile corrections are accepted for `PENDING` and `ACTIVE` Donors; a `SUSPENDED` target returns `409 DONOR_STATE_CONFLICT`, and missing/wrong-role targets return `404 DONOR_NOT_FOUND`. These target errors do not invalidate the Admin session.

Before a confirmed-group update, the service checks existing BloodUnit history reached through the Donor's Bookings. If any stored unit group differs from the proposed confirmation, it returns `409 DONOR_GROUP_HISTORY_CONFLICT`. Existing Donation and BloodUnit records and their group values are never rewritten. A missing reference returns a field validation error; a uniqueness/FK race is handled safely. A no-op or failed conditional update returns a safe conflict rather than claiming a correction.

For a mutation, the service locks actor and target Account rows in ascending numeric ID order, locks/rechecks the authoritative Admin SID, then locks the Donor, and for group confirmation the BloodGroup and related unit history. It revalidates the SID after those domain waits and immediately before the first write. The fixed-field update explicitly maintains `Donor.updated_at`; a same-transaction AuditEvent uses `DONOR_PROFILE_CORRECTED` / `STAFF_PROFILE_CORRECTION` or `DONOR_BLOOD_GROUP_CONFIRMED` / `STAFF_GROUP_CONFIRMATION`, with a static non-sensitive summary. Audit and profile change commit or roll back together. Safe cleanup and uncertain-commit handling use the established Account transaction helper.

The response is `{ success: true, donor }` with the same safe detail projection, returned only after commit. Validation, missing-target, suspended-target, group-history, and stale-update errors are safe. A dispatched PATCH is never retried automatically; after conflict or an uncertain/malformed outcome the UI performs GET-only recovery and does not infer that this request caused a matching current value.

## Screens and implementation boundaries

Screen 16 provides search/status/group filters, stable 20-row pagination, loading/empty/error states, and links to detail. Screen 17 distinguishes reported from staff-confirmed groups, shows Account status read-only and links status actions to Account management, and provides an explicit confirmation for one correction category. Cancel sends no mutation. Identity, exact changes, and fixed reason are captured; preflight, authentication lifecycle, duplicate submission, and obsolete-result guards apply. The UI exposes no detailed eligibility or medical data.

## Automated verification

The initial Codex-run checks on 2026-10-29 used the no-private-environment loader and a strict allowlist for the full backend suite: **347/347 passed**. The frontend unit and fixture-browser suite passed **75/75 tests**. Its real browser run passed with a 1280 px desktop window request (Chrome reported 1262 px inner width) and exact 768, 390, and 337 px iframe viewports; each run reported **120 scenarios and 809 assertions passed**. The environment-disabled, in-memory Vite production build passed. These are historical automated/injected results; the later optimistic-precondition checks are reported separately below. Neither constitutes USER-RUN evidence or live MySQL verification.

The optimistic-precondition follow-up passed **351/351 protected backend tests** and **75/75 frontend tests**. The isolated fixture browser passed **121 scenarios/813 assertions at each of the four widths** above, including a stale-draft 409 and GET-only recovery. The `envDir: false`, in-memory Vite build transformed 121 modules. Targeted tests cover two Admins using the same reviewed value, same-second updates, independent unrelated-field edits, multi-field conflicts, nullable area, confirmed-group conflicts, exact HTTP preconditions and no audit on a mismatch. These checks use injected stores and browser fixtures, not live MySQL.

Live MySQL concurrency, audit rollback, transaction cleanup under real failures, session expiry during real lock waits, API tampering, and user-run browser behavior against the configured backend remain unverified. This feature does not implement group confirmation workflow evidence/attachments, staff eligibility override, Donation correction, BloodUnit editing, or Account status changes.
