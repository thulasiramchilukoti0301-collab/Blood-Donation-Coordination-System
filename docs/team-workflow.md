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
