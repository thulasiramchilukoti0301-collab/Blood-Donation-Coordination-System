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

The one-time scaffold commit (`88fd043`) is integrated. Lathikaa's application foundation commit (`39e6a3c`) is also integrated and maps from her personal Phase 1 to the relevant official Phase 4 foundation/connectivity work. Phase 3 database modules are coordinated in the dependency order documented in `database/README.md`; the bounded DonationSlot/Booking/EligibilityDecision and Donation modules belong to Thulasi. Personal phase labels do not renumber official project phases, and none of this transfers feature ownership or authorizes later work.

The database owner/dependency map is maintained in [`database/README.md`](../database/README.md). The feature owner remains responsible for their domain's schema, API, UI, validation, tests, and feature documentation. Shared Account, reference data, audit/history, setup assembly, and cross-domain changes require explicit coordination; agreement on one file or dependency does not transfer another owner's feature. The first bounded Authentication & Donor web feature is implemented on Thulasi's branch; user-run local setup and the basic registration/login/profile/logout flow were reported on 2026-10-25. Deeper live failure/concurrency checks and the rest of Authentication & Role Access remain pending.

### Authored audit dependency-plan amendment

The authorized minimal audit foundation keeps `010_audit.sql` numbered 010 but authors **AuditEvent only**, because its only FK parent is Account. The proposed reviewed assembly may therefore use 001 → 002 → 010 before HospitalRequest (008), unblocking the schema dependency for Thulasi's future shared Account approval/status workflow without implementing requests. The amendment is integrated at `15ac4cf`; separate [USER-RUN evidence dated 2026-10-25](audit-foundation.md#user-run-local-auditevent-setup-2026-10-25) records Thulasi's local 010 installation/structure and application-account read access. This local application does not transfer ownership or authorize the later history migration. Foundation setup remains unchanged, and the source merge itself applies no SQL.

Lathikaa retains Audit & Operational Tracking/request-history ownership; Thulasi retains Account authentication/approval/status ownership. RequestStatusHistory and its selected AFTER UPDATE trigger require a separate future coordinated migration, number/filename **UNASSIGNED**, after HospitalRequest and before request operations. They are not moved into 008 and will not be appended to 010 later. No existing migration is renumbered. Before approval integration, coordinate production action codes, Account reason mapping and transaction/audit/revocation failure behavior. The writer's explicit action registry does not itself approve vocabulary or perform Account authorization. See [audit foundation](audit-foundation.md).

## Synchronization

Before synchronizing, commit work in progress or deliberately stash it. Preserve unfinished work; never reset, overwrite, or force-push shared history. The daily sync sequence is:

```text
git fetch origin
git switch <own-branch>
git merge origin/main
```

Do not routinely pull the other person's unfinished branch. Dependent work normally becomes available through a reviewed pull request merged into `main`. Direct integration from another development branch is an explicitly coordinated exception. The developers have explicitly agreed to exchange selected pushed branch checkpoints and defer the next `main` merge until a larger milestone:

1. Preserve local work first by committing it or deliberately stashing it.
2. Run `git fetch origin`, inspect the exact agreed pushed commit (`git show --stat <commit>` and review its diff), and confirm it is the checkpoint both developers intend to exchange.
3. Merge that pushed commit into the receiving developer's own continuing branch, resolving conflicts without discarding local work. Do not reset, overwrite, or force-push. Only pushed commits are available for this exchange; unpushed work is not shared.
4. Continue feature work on the existing personal branches. PR #5 remains cumulative and open; later reviewed/pushed checkpoints, including the user-verified grouped read-only inventory view and donor/inventory SQL demonstrations, become part of its cumulative branch diff. Review the full PR diff against its base, not only the latest checkpoint. The query demonstrations verify only canonical read-only SQL and disposable fixture assertions. Verified Donation storage, BloodUnit storage, the view, and query demonstrations do not complete donation/inventory workflows or the remaining Phase 3 work. Git synchronization does not apply SQL; developers apply reviewed migrations, views, and query files separately to their own local databases as applicable.
5. At the larger integration milestone, reconcile both branches, review and verify the combined changes, then deliver the combined result to `main` through a reviewed PR.

This checkpoint exchange integrates Git history only. Git merges do not apply migrations or otherwise change either developer's private local MySQL database; each developer applies reviewed SQL separately, in dependency order, to their own database after Git synchronization. Migration ownership and each developer's local-database separation remain unchanged.

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
