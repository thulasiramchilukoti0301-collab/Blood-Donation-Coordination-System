# Database setup and collaboration plan

This file describes the approved future workflow; it is not executable setup guidance. At this documentation checkpoint, `setup.sql`, all tracked migration files, and all tracked seed files are zero-byte placeholders. No schema, data, routine, trigger, or event has been implemented. Do not execute these placeholders or infer working commands from their names.

## Shared source and local databases

- Each developer uses a separate local MySQL database. Versioned SQL under `database/migrations/` is the shared schema source after review and merge; local-only schema edits do not define the project schema.
- After syncing a reviewed integration from `origin/main`, each developer applies the newly integrated migrations to their own local database using the reviewed setup workflow. Do not apply routine setup/rebuild steps to a shared or live database.
- Coordinate migration numbering and edits to shared setup, reference data, constraints, triggers, procedures, events, and cross-domain objects before editing. Do not independently allocate the same migration number.
- A fresh rebuild is only for a disposable local database and must be explicitly documented as safe. Applying later migrations to an existing local database must not silently drop data or rerun seed inserts as though they were upgrades.
- A migration is authoritative only after it is reviewed and integrated. Record the applied migration version locally; do not treat a manually edited local schema as a migration.

## Feature and object ownership

Ownership follows the complete-feature boundaries in [`docs/team-workflow.md`](../docs/team-workflow.md). The module names below are the existing placeholders; exact SQL object definitions and any file splits remain to be coordinated before implementation.

| Existing migration placeholder | Planned object/domain responsibility | Feature owner / coordination |
|---|---|---|
| `001_foundation.sql` | Shared database foundation, including the common `BloodGroup` reference definition/data prerequisites | Shared coordination; agree exact contents before implementation |
| `002_auth.sql` | `Account` and authentication/account constraints | Thulasi |
| `003_donors.sql` | `Donor` profile and donor-specific constraints | Thulasi |
| `004_hospitals.sql` | `Hospital` profile and hospital-specific constraints | Lathikaa |
| `005_eligibility_booking.sql` | `DonationSlot`, `Booking`, and `EligibilityDecision` | Thulasi; coordinate the shared slot/booking boundary |
| `006_donations.sql` | `Donation` outcome and release fields | Thulasi |
| `007_inventory.sql` | `BloodUnit` lifecycle and inventory constraints | Thulasi |
| `008_blood_requests.sql` | `HospitalRequest` and `RequestStatusHistory` | Lathikaa; coordinate the common history contract |
| `009_compatibility_allocation.sql` | `BloodCompatibility`, `Allocation`, compatibility/FEFO allocation operations | Lathikaa; reference data is shared with Thulasi's inventory and request-group lookups |
| `010_audit.sql` | `AuditEvent` and agreed audit infrastructure | Lathikaa owns Audit & Operational Tracking; every feature owner coordinates the events their mutations require |
| `011_reports.sql` | Report views/queries or other approved reporting objects | Lathikaa; coordinate `v_available_inventory_by_group` with Thulasi because inventory consumes it; no new entity or stored duplicate metric without design approval |

The 14 approved entities are `Account`, `Donor`, `Hospital`, `BloodGroup`, `BloodCompatibility`, `DonationSlot`, `Booking`, `EligibilityDecision`, `Donation`, `BloodUnit`, `HospitalRequest`, `RequestStatusHistory`, `Allocation`, and `AuditEvent`. The 12 major tables requiring at least ten sample rows each are listed in `docs/database-design.md`. This map assigns implementation coordination by feature; it does not transfer operational feature ownership.

## Dependency-safe setup order

The final setup orchestrator must follow object dependencies, not assume that a filename alone proves an object is ready:

1. Create the local database with the approved MySQL settings. Apply reviewed schema migrations in the coordinated object-dependency order: Account/BloodGroup foundations; Donor/Hospital profiles; slots, bookings, and eligibility; Donation; BloodUnit; HospitalRequest and RequestStatusHistory; compatibility and Allocation; AuditEvent; then reporting objects. Migration numbering must reflect the agreed order; the current empty filenames are not proof that the order is executable.
2. Before seeds or operational changes, ensure all 14 entity tables—including `AuditEvent` and `RequestStatusHistory`—and all referenced base relations exist. Create triggers/procedures only after their dependent schema objects exist. A procedure, trigger, or event must not be invoked until every object it reads or writes is present.
3. Load reference rows first (all eight approved blood groups and all 64 directed compatibility pairs), then synthetic Account identities with exactly matching Donor/Hospital profiles, followed by dependent slots/bookings/eligibility, donations, units, requests/history, allocations, and audit fixtures in FK-safe order. Do not run seed operations that require audit/history before those relations exist.
4. Run the assembled setup and verification only after schema and seeds are ready. Create/enable or invoke the expiry event only after its tables/routine exist and named `Asia/Kolkata` support plus event privileges are confirmed. Define the test procedure/trigger behavior and verify it; merely defining objects is not proof of behavior.
5. Verify the complete fresh setup and documented migration rerun behavior in a disposable local database. Do not claim that partial owner modules satisfy the ten-row requirement for every major table; final counts apply to the assembled schema/fixtures.

The current migration names are placeholders and their contents are empty. If implementation reveals that audit/history tables or routine definitions need to be split or reordered for a valid dependency graph, owners must coordinate the migration numbering and update this plan before adding SQL. Do not make local-only ordering changes or infer object definitions from a filename.

## Existing seed placeholders

Tracked seed placeholders are `reference_data.sql`, `accounts.sql`, `donors.sql`, `hospitals.sql`, `donations.sql`, `inventory.sql`, and `requests.sql`. They are all empty at this checkpoint. File names do not establish which rows they will contain, and the current repository has no seed-completeness evidence. Add or split fixtures only through coordinated, reviewed changes that preserve the entity dependencies and the ten-row minimum for each of the twelve major tables.

## Ownership integration points

- Thulasi owns Account, Donor, slot/booking/eligibility, Donation, and BloodUnit features end-to-end.
- Lathikaa owns Hospital, HospitalRequest/RequestStatusHistory, compatibility/allocation, audit/operational tracking, and reports end-to-end.
- `BloodGroup`, setup assembly, migration numbering, shared audit/history conventions, and any object used by both domains require coordination. Lathikaa owns compatibility administration and FEFO allocation; shared reference availability does not change that ownership.
- Allocation, issue, request/allocation cancellation, discard, and expiry share one locking strategy. It must be implemented and verified with concurrent MySQL connections; no strategy is verified today.

## Current verification status

The user reported MySQL Workbench observations are summarized in [`docs/implementation-readiness.md`](../docs/implementation-readiness.md). They are environment evidence, not proof this repository's schema was loaded. Named time-zone support, event-creation privileges, concurrent transaction behavior, and Lathikaa's local environment remain to be checked. Do not install software, change server settings, or use credentials in documentation-only work.
