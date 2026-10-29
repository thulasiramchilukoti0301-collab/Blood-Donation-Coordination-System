# Donor Dashboard and Password Settings

This bounded follow-up uses the existing 30-screen baseline. Screen 4 is an ACTIVE Donor-only Rose Quartz Focus dashboard, as selected by the user. Screen 30 adds password settings for authenticated ACTIVE Admins and PENDING/ACTIVE Donors and Hospitals. No migration, seed, new table, dependency, or public recovery flow is included.

## Screen 4: Donor Dashboard

`GET /api/donors/me/reports/activity` uses only the authenticated Donor Account ID. It accepts optional real `YYYY-MM-DD` `from`/`to` dates, inclusive in Asia/Kolkata, with `from <= to`; unknown query fields are refused. It returns counts for each existing Booking status (`BOOKED`, `CANCELLED_BY_DONOR`, `CANCELLED_BY_STAFF`, `CHECKED_IN`, `NO_SHOW`, `COMPLETED`) and Donation outcome (`COLLECTED`, `INCOMPLETE`, `DEFERRED`) for that Donor and period, with zero counts represented explicitly. It returns no other Donor identity, medical details, or account/session material. ACTIVE Donor and current-session checks are required, and the response is `no-store`.

The dashboard composes this owner-scoped activity read with existing `GET /api/donors/me` and `GET /api/donors/me/eligibility`. It shows profile, advisory eligibility, recorded activity and links to slots, bookings and donation history. Reads settle independently: loading, empty, partial failure, complete failure and read-only refresh are distinct. Eligibility remains advisory; booking rechecks the appointment date. Counts come from persisted rows; no stock threshold or invented metric is used. No Dashboard write exists.

## Screen 30: Password Settings

`POST /api/auth/password` accepts exactly `currentPassword` and `newPassword`. The current password is preserved exactly, must be nonempty and no longer than 72 UTF-8 bytes, and must match the Account's stored bcrypt hash. The new password follows the existing registration policy: at least eight Unicode code points, at most 72 UTF-8 bytes, a Unicode number and a punctuation/symbol character, no control characters. Neither password is trimmed, normalized, truncated, returned or audited. Bcrypt cost remains 12.

The protected operation requires a current non-suspended session, trusted Origin and session-bound CSRF; PENDING Donor/Hospital sessions may use it. It locks the Account then the authoritative SID, checks the current password, rechecks the SID after bcrypt work, conditionally updates the hash, tombstones **all** Account sessions on the same transaction connection, and writes a fixed non-sensitive `ACCOUNT_PASSWORD_CHANGED` / `SELF_SERVICE_PASSWORD_CHANGE` Account audit event in that transaction. Failure rolls back hash, session and audit changes; an uncertain commit never produces confirmed success. The response is exactly `{ success: true, loginRequired: true }`, clears the current cookie and requires a fresh login. `INVALID_CURRENT_PASSWORD` is a safe 401 distinct from session-invalidating 401 codes; validation and rate-limit errors are safe. Public recovery remains out of scope.

The Rose settings page shows current Account status, password fields and the successful fresh-login consequence. It sends a fresh CSRF token, blocks duplicate submits, does not echo password input, and gives uncertainty guidance without an automatic POST retry.

## Feature 3 boundary

The current domain model includes `BOOKED -> NO_SHOW` and `BOOKED -> CANCELLED_BY_STAFF`, while the bounded API only implements `BOOKED -> CHECKED_IN` and slot-wide cancellation. An individual NO_SHOW action still needs an exact allowed time relative to the slot end and a fixed audit action/reason. An individual staff-cancellation action still needs its permitted time window and fixed reason/action (and whether it may act after the slot starts); the already documented `CHECKED_IN -> COMPLETED` Donation transaction must not be bypassed. These individual actions remain **OPEN**. Staff cancellation after partial issue concerns Hospital requests and remains separately OPEN under Lathikaa's request/allocation domain; it is not a Booking permission.

## Verification boundary

The final protected backend suite passed **359/359 tests** and the frontend unit suite passed **75/75 tests**. The isolated fixture browser suite passed **124 scenarios and 828 assertions at each width**: 1262 px actual desktop viewport, then 768, 390 and 337 px. These checks use injected database/session dependencies and browser API fixtures. Live MySQL session revocation, contention, audit rollback and browser-to-backend behavior remain unverified. Earlier USER-RUN and automated evidence in the other milestone guides remains historical and separate.
