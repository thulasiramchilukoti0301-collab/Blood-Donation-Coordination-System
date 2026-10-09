# Database preparation

Phase 1 implements connectivity only. `setup.sql`, all eleven migration files,
and all seven seed files are empty placeholders. They have not been changed or
executed. A successful `SELECT 1` verifies connectivity, not schema initialization.

## Source of truth

Use `../docs/database-design.md`, `../docs/relational-schema.md`,
`../docs/normalization.md`, and `../docs/er-design.md` when schema implementation
is separately authorized. The approved design uses MySQL, InnoDB transactions,
foreign keys, and enforced constraints; no ORM is planned.

## Migrations

Migrations will contain reviewed, versioned SQL changes to reproduce the schema.
The intended filename sequence is:

1. `001_foundation.sql`
2. `002_auth.sql`
3. `003_donors.sql`
4. `004_hospitals.sql`
5. `005_eligibility_booking.sql`
6. `006_donations.sql`
7. `007_inventory.sql`
8. `008_blood_requests.sql`
9. `009_compatibility_allocation.sql`
10. `010_audit.sql`
11. `011_reports.sql`

These filenames reserve areas of work; they are not validated executable
migrations. Before implementation, check foreign-key and routine dependencies
against the approved design, including audit records needed by routines/triggers.
Reconcile ordering or defer dependent routines until all referenced tables exist.
Do not assume the reserved order alone proves the scripts can run. No migration
runner or migration tracking table is implemented in Phase 1.

## Seeds

Seed files will provide reviewed reference values and coherent academic test
data after migrations exist. `reference_data.sql` precedes dependent sample
records; accounts precede donor/hospital profiles, which precede their workflows.
The seven existing filenames do not yet cover every entity in the approved
design. The complete dependency order and missing seed coverage must be resolved
in the authorized schema phase, including bookings, eligibility decisions,
allocation/history/audit records and the minimum ten rows per major table.
Do not execute empty seeds or claim that sample data is installed.

## Local MySQL configuration

- The logical design requires MySQL 8.0.16+ for enforced CHECK constraints.
- Configure an existing local database and password-protected application user;
  see the root README for optional manual empty-database provisioning.
- Put host, port, user, password, and database name in `backend/.env` only.
- Use `npm.cmd run check:db` from `backend/` to run `SELECT 1`. Exit code 0 means
  connectivity verified; exit code 1 means unconfigured or unavailable.
- Backend pooled connections set session timezone to `+05:30` (Asia/Kolkata).
  Future migration/event sessions must use that same timezone. Schema tables
  must use InnoDB. No tables, constraints, events, or transactions are created by
  this connectivity check.
- Event Scheduler privileges, generated-column behavior, CHECK enforcement,
  actual server version, and transaction/trigger behavior remain to be verified
  during schema implementation. Do not enable scheduling in Phase 1.

Keep local exports in ignored `database/dumps/` or `database/backups/` folders,
never in migrations or seeds. Do not commit credentials or sensitive dumps.
