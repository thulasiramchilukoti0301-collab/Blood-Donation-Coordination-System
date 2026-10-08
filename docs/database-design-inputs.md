# Database Design Inputs — Decisions Resolved

Phase 1 candidate entities and open questions have been resolved into the Phase 2 logical design in `database-design.md`, `relational-schema.md`, `normalization.md`, and `er-design.md`. These are design documents only; executable SQL and schema deployment remain for a later authorized phase.

## Resolved choices

| Topic | Decision | Design reference |
|---|---|---|
| Authentication | One Account identity with role discriminator; bcrypt password hash; server-side sessions are infrastructure, not a domain entity | `database-design.md` |
| Role profiles | Donor and Hospital are one-to-one shared-key profiles; Admin has no subtype profile | `relational-schema.md`, `er-design.md` |
| Timezone | Store and interpret application `DATETIME` values in `Asia/Kolkata`; configure MySQL/application consistently | `database-design.md` |
| Donor interval | Configurable 56 calendar days after last successful collection; computed next-eligible date, staff decision history stored separately | `domain-rules.md`, `database-design.md` |
| Shelf life | Configurable 42 calendar days from collection; expiry date stored on unit as assigned snapshot | `domain-rules.md`, `database-design.md` |
| Eligibility decisions | Separate history entity; no detailed medical questionnaire data | `database-design.md` |
| Testing/release | One final release decision is stored on Donation; repeated test history is outside current scope | `database-design.md` |
| Request status history | Separate FK-backed history entity; request-creation transaction records initial status, one database trigger records later changes | `database-design.md` |
| Expiry run tracking | No separate run entity; a run-level `SYSTEM_TASK` AuditEvent (even for zero changes) and per-expired-unit events share an operation ID | `database-design.md` |
| Audit target reference | AuditEvent has Account actor FK plus whitelisted `subject_type`/`subject_id`; no polymorphic target FK. Operational records are retained and application validates subject existence | `database-design.md` |
| Compatibility | Eight ABO/Rh groups; full directed 8x8 table of 64 pairs, with `is_compatible`; RBC educational model only | `database-design.md`, `er-design.md` |
| Donation to unit | One collected and approved donation creates at most one BloodUnit; Donation must refer to a Booking | `database-design.md` |
| Fulfillment | Request is `FULFILLED` only when all requested units are `ISSUED`; `ALLOCATED` and `ISSUED` are distinct; partial fulfillment uses per-unit Allocation rows | `database-design.md`, `relational-schema.md` |
| Allocation | One row per unit; unique generated active-unit key permits at most one active allocation; cancellation retains history and permits later reallocation | `database-design.md` |
| Major tables | Account, Donor, Hospital, DonationSlot, Booking, EligibilityDecision, Donation, BloodUnit, HospitalRequest, RequestStatusHistory, Allocation, AuditEvent. Each will have at least ten sample rows. | `database-design.md` |
| Index candidates | Indexes are tied to search paths and FEFO allocation; exact plans will be checked with `EXPLAIN` after implementation | `database-design.md` |
| DBMS features | Inventory view, transactional allocation procedure, request-status-history trigger, daily MySQL Event Scheduler expiry job | `database-design.md` |

## Remaining environment decisions

- The user reported MySQL Workbench observations on 2026-10-08: connected server `8.0.46`, Event Scheduler `ON`, global/session time zones `SYSTEM`, and system time zone `India Standard Time`. This version satisfies the design's minimum of MySQL 8.0.16 for enforced CHECK constraints, but named `Asia/Kolkata` time-zone support and event creation privileges remain to be checked in the actual target setup.
- These observations describe one local environment and do not establish Lathikaa's MySQL version, time-zone tables, Event Scheduler configuration, or privileges. Compare and document both developers' local environments before relying on the scheduled expiry path; retain the single documented application-scheduler fallback if the target cannot support the event.
- Choose session-store implementation and local frontend/API CSRF/CORS configuration during application foundation; neither changes domain relations.
- Confirm exact DDL details for generated unique active-allocation key, connection-scoped trigger actor context, and routine/event transaction behavior against the selected MySQL release.

### User-provided connection evidence

- **2026-10-08, MySQL Workbench:** connected server version `8.0.46`; Event Scheduler `ON`; global and session time zones `SYSTEM`; system time zone `India Standard Time`. These were reported by the user and were not queried by this documentation task.
- **Historical interactive MySQL CLI (observation date unavailable in the recovered excerpt):** the user provided `SELECT VERSION()` = `8.0.46`; `SHOW VARIABLES LIKE 'event_scheduler'` = `ON`; and `SELECT @@sql_mode` = `ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION`. This is user-provided historical output, not queried by this task; do not infer an observation date or treat it as evidence for another developer's environment.
- **Earlier non-interactive CLI attempt:** the readiness review records an access-denied result for its default local account; no credential was requested or displayed. That failed attempt does not contradict the separately reported interactive Workbench/CLI observations.

No item above proves that schema migrations, event definitions, or application code have been run. Named time-zone support, event-creation privileges, and the other developer's environment remain open.

These are environment/implementation checks, not unresolved domain modeling choices. The physical schema and SQL syntax remain to be authored in the later database implementation phase.
