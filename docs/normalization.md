# Normalization Through Third Normal Form

## Method and notation

Functional dependencies (FDs) below use `X -> Y` to mean that values of X determine values of Y within the proposed relation. Keys and alternate keys are stated in `relational-schema.md`. The design separates repeating groups and independent facts, then checks partial and transitive dependencies. A primary key alone does not establish 3NF.

## 1NF

Every attribute is a single value of its domain: one email, one status, one timestamp, one blood group, one quantity, or one concise audit summary. Repeating values are represented as rows: one compatibility pair per row, one booking per donor/slot, one unit per inventory item, one allocation per request/unit, and one history/audit event per event. Lists of blood groups, unit IDs, request history, or compatibility groups are not stored in delimited columns or JSON arrays.

## 2NF

Most relations use a single-column primary key, so every non-key attribute depends on the whole key. BloodCompatibility uses composite key `(donor_group_id, recipient_group_id)` and has only `is_compatible`, which depends on the complete ordered pair; neither group ID alone determines compatibility. All 64 ordered pairs are represented explicitly. No descriptive group labels are copied into the pair relation.

## 3NF

For each relation, non-key attributes depend on a key, the whole key, and no other non-key attribute. Descriptive facts are kept with their determinant: account email/password/role in Account; hospital organization attributes in Hospital; group labels in BloodGroup; request attributes in HospitalRequest; event details in their history relation. Blood-unit expiry is retained as an operational snapshot derived at creation from collection date and configured rule, but collection date and donor are not duplicated on BloodUnit. Request totals and donor next-eligible date are derived rather than repeated.

## Important decomposition examples

### Registration, account, and role profiles

**Unnormalized conceptual record:** one `User` row repeats email, password, role, donor name/DOB/address/blood group, hospital registration/name/contact, plus multiple bookings or requests. It contains nullable role-specific columns and repeating activity.

**Decomposition:** Account(account identity/authentication/role/status), Donor(account FK + donor facts), Hospital(account FK + hospital facts); activity moves to Booking, Donation, and HospitalRequest.

**FDs:** `account_id -> email, password_hash, role, account_status`; `email -> account_id, password_hash, role, account_status`. For a donor subtype, `account_id -> full_name, DOB, contact/address, reported/confirmed group`; for a hospital subtype, `account_id -> organization/contact facts`.

**Anomaly removed:** changing a password does not rewrite profile rows, and adding many appointments/requests does not repeat credentials or profile details. Role-specific facts are not repeated once per activity.

### Blood inventory

**Unnormalized conceptual record:** inventory summary row with group label, donor identity, collection date, expiry, current request and hospital details; multiple units or requests appear as lists.

**Decomposition:** BloodGroup(code/name); Donation(booking, outcome/release); BloodUnit(one source donation, confirmed group, expiry/status); HospitalRequest; Allocation(one request/unit association).

**FDs:** `blood_group_id -> code, display_name, is_active`; `donation_id -> booking_id, outcome, release decision...`; `blood_unit_id -> donation_id, blood_group_id, expiry_date, status`; `allocation_id -> request_id, blood_unit_id, allocation state...`.

**Anomaly removed:** correcting a group label is done once; a donation's release result is independent from the request that later uses a unit; one unit is not copied across multiple request records. Confirmed unit group is stored only on BloodUnit, not repeated on Donation. Collection date and donor are obtained through the source donation/booking joins, avoiding redundant determinants.

### Compatibility

**Unnormalized conceptual record:** an `A+` row stores a comma-separated list of recipient groups, while the same compatibility facts may be hard-coded in application branches.

**Decomposition:** BloodGroup stores each group once; BloodCompatibility stores one directed donor-group/recipient-group pair, with a true/false value.

**FD:** `(donor_group_id, recipient_group_id) -> is_compatible`; each group ID alone does not determine the pair's compatibility.

**Anomaly removed:** changing a pair is one row and all consumers query the same authoritative data; no list parsing or repeated matrix copies. Storing all pairs makes an absent row a data-integrity error rather than an ambiguous incompatible result.

### Request fulfillment and history

**Unnormalized conceptual record:** a request repeats hospital name/contact, blood group label, allocated unit IDs, status timeline, and derived outstanding quantity.

**Decomposition:** HospitalRequest stores request facts; Hospital and BloodGroup store descriptions; Allocation stores unit assignment/issue/cancellation; RequestStatusHistory stores status transitions.

**FDs:** `request_id -> hospital_account_id, recipient_group_id, requested quantity, priority, need-by, current status`; `allocation_id -> request_id, blood_unit_id, allocation status/timestamps`; `history_id -> request_id, old/new status, actor/time`.

**Anomaly removed:** hospital or group changes are not repeated across requests; partial allocations are represented as individual rows; status events do not overwrite one another. Outstanding and issued totals are calculated from allocations instead of being independently edited copies.

### Audit history

**Unnormalized conceptual record:** an entity row contains `last_action`, actor name, and a mutable list of changes, which overwrites past facts.

**Decomposition:** current state remains in its entity; each general event is an AuditEvent; request status transitions have dedicated RequestStatusHistory.

**FD:** `audit_event_id -> actor_account_id, action_code, subject type/id, occurred_at, safe summary`; `history_id -> request_id, old/new status, actor/time`.

**Anomaly removed:** each event is independently retained and queryable. Subject is a typed reference because conventional relational FKs cannot target multiple possible entity tables; this limits target FK enforcement but does not create a transitive dependency.

## Functional dependency review by relation

| Relation | Main FDs / keys | 3NF reasoning |
|---|---|---|
| Account | account_id -> attributes; email -> account_id and other account attributes | Both determinants are candidate keys. Role is stored once. |
| Donor | account_id -> donor attributes | Profile facts are dependent on the account key; blood-group descriptions remain in BloodGroup. |
| Hospital | account_id -> hospital attributes; registration_number -> account_id when present | Alternate registration key determines profile facts; no copied account credentials. |
| BloodGroup | id -> code/name/active; code -> id/name/active | Candidate keys determine other attributes. |
| BloodCompatibility | (donor group, recipient group) -> compatibility | Pair is the key; no partial dependency on one component. |
| DonationSlot | slot_id -> slot facts | Created-by account is an FK, not a copied actor name. |
| Booking | booking_id -> booking facts; (donor, slot) -> booking facts | Candidate keys; slot time/capacity stays in DonationSlot. |
| EligibilityDecision | decision_id -> decision facts | Donor and actor descriptive data are joined from parent relations. |
| Donation | donation_id -> donation facts; booking_id -> donation facts | One donation per booking; donor is derived through Booking. |
| BloodUnit | unit_id -> unit facts; donation_id -> unit facts | Unique donation source; donor/collection are not duplicated. Expiry is a dated inventory fact set at creation. |
| HospitalRequest | request_id -> request facts | Hospital/group labels are not copied; quantities are not duplicated as totals. |
| RequestStatusHistory | history_id -> transition facts | Request and actor descriptions are joined, not repeated. |
| Allocation | allocation_id -> allocation facts | Request/unit details are referenced; unique active-unit generated value enforces exclusivity. |
| AuditEvent | audit_event_id -> event facts | Actor FK; typed subject reference is an explicit polymorphic relation tradeoff. |

## Intentional derived/snapshot values

`expiry_date` is computed from collection date plus the configured 42-day rule when a unit is created, then retained as an inventory snapshot. Changing the policy later must not silently recalculate existing units. `next_eligible_date`, request totals, and available stock counts are derived at read time. These choices avoid update anomalies while preserving the operational expiry assigned to each unit.
