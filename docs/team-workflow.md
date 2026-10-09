# Team Workflow

## Branches and ownership

- Thulasi works on the continuing personal development branch `thulasiram`.
- Lathikaa works on the continuing personal development branch `lathikaa`.
- `main` contains reviewed, integrated work. Reviewed changes reach `main` through pull requests.
- Separate branches for each feature are not mandatory. Keep commits and pull requests focused on one reviewable task.
- Each owner handles the complete feature: database work, backend/API, frontend/UI, validation, testing, and feature documentation.

### Feature ownership

| Owner | Complete feature areas |
|---|---|
| Thulasi | Authentication & Role Access; Donor Management; Eligibility & Slot Booking; Donation Processing; Blood Inventory & Unit Lifecycle |
| Lathikaa | Hospital Management; Blood Request Management; Compatibility & FEFO Allocation; Audit & Operational Tracking; Dashboard & Reports |

Both developers review and understand each other's work. Other teammates support report preparation, test documentation, screenshots, and presentation. Shared foundations, shared files, and cross-domain changes are coordinated before editing.

## Database collaboration

Each developer uses a separate local MySQL database. Versioned SQL migrations in `database/migrations/` are the shared, reviewed schema source; local-only schema edits are not authoritative. Coordinate each migration number and shared object before editing or adding a migration. After a reviewed PR is merged and the developer synchronizes from `origin/main`, apply the newly integrated SQL to that developer's own local database using the reviewed setup instructions. Never point routine development or rebuild steps at a shared/live database.

The initial scaffold commit (`88fd043`, `chore: initialize project structure`) is present in `main` ancestry through merge commit `3335268`. That one-time repository setup is complete, while the tracked SQL/runtime placeholders remain empty and no application foundation or database schema has been implemented. It does not authorize later implementation phases.

The database owner/dependency map is maintained in [`database/README.md`](../database/README.md). The feature owner remains responsible for their domain's schema, API, UI, validation, tests, and feature documentation. Shared Account, reference data, audit/history, setup assembly, and cross-domain changes require explicit coordination; agreement on one file or dependency does not transfer another owner's feature.

## Synchronization

Before synchronizing, commit work in progress or deliberately stash it. Preserve unfinished work; never reset, overwrite, or force-push shared history. The daily sync sequence is:

```text
git fetch origin
git switch <own-branch>
git merge origin/main
```

Do not routinely pull the other person's unfinished branch. Dependent work normally becomes available through a reviewed pull request merged into `main`. Direct integration from another development branch is an explicitly coordinated exception.

## Review and integration

```text
review changes
run relevant checks
stage intended files
commit
push own branch
open pull request into main
teammate review
merge
both synchronize from origin/main
```

Prefer merge commits for pull requests from continuing personal branches so branch ancestry is preserved. Do not force-push or rewrite shared history.

## Dependency coordination

Shared foundations are completed and integrated before feature work proceeds in parallel. After the agreed API, database, authentication, and integration foundations are available on `main`, Thulasi and Lathikaa can implement their assigned complete feature areas independently. Coordinate changes to shared schema, API conventions, route/navigation foundations, and shared components before editing them.

The screen map records one dashboard ownership exception: Thulasi owns the Donor Dashboard and its donor-owned activity endpoint as part of the complete donor feature. Lathikaa owns the Hospital and Admin dashboards and cross-domain aggregate reports under Dashboard & Reports. This clarifies screen ownership without transferring donor profile, eligibility, booking, or donation features.
