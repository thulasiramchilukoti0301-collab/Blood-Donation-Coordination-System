# First-Admin bootstrap

## Scope and status

Thulasi owns this bounded Authentication & Role Access utility. `backend/src/cli/bootstrap-first-admin.js` is an explicitly invoked, local out-of-band provisioning command. It creates one new **ADMIN / ACTIVE Account**, using the existing Account schema and configured mysql2 pool. It creates no Donor/Hospital profile or session, mounts no HTTP route, and never runs at server startup.

The utility and injected database-free tests are authored. Separate **USER-RUN evidence, with browser confirmation reported on 2026-10-26**, records successful first-Admin creation through hidden prompts and the basic authenticated Admin Hospital read flow; see [the evidence below](#user-run-evidence-browser-confirmation-reported-2026-10-26). This documentation update did not execute the utility or inspect the database. This remains distinct from the separate [shared Account approval backend](account-approval-backend.md), now implemented only for PENDING -> ACTIVE with historical database-free coverage and separate USER-RUN Console approval/audit/fresh-login evidence dated 2026-10-26; further live checks, frontend controls and suspension/reactivation remain pending. It inserts no AuditEvent: there is no existing authenticated actor to attribute to the first Admin, and production action/reason mappings remain OPEN. No audit actor or approval event is invented. Lathikaa retains Audit/Hospital ownership. The continuing branches, reviewed pushed-checkpoint exchange, cumulative open PR #5 and deferred main integration in [team workflow](team-workflow.md) are unchanged.

## Prerequisites

- Use your separate, private **local development database**, with the canonical `Account` table from 002 already installed as InnoDB. This command performs no DDL, migration, seed, grant or schema repair. AuditEvent, Hospital and application session storage are not prerequisites for this Account-only insert; normal web login has its own session/configuration prerequisites.
- Existing backend dependencies must already be installed. The command uses the existing bcrypt and mysql2 packages, not an additional dependency.
- Configure database access privately through the existing backend configuration (`backend/.env` or process environment). Set **DB_HOST explicitly to `127.0.0.1` or `::1`**, **DB_PORT explicitly to the intended local port**, and DB_NAME/DB_USER/DB_PASSWORD explicitly. There is no implicit port/host/database/credential fallback for this utility; `localhost`, remote addresses and system schemas are refused. Do not paste credentials into a command line or documentation.
- `NODE_ENV` must be explicitly `development`. `FIRST_ADMIN_BOOTSTRAP_DATABASE` must exactly equal DB_NAME. This is a deliberate target acknowledgment, not a new database or a replacement for the configured connection. The connection's selected database is checked before any writes; Account must be visible as an InnoDB base table.
- Use an already authorized configured database account with Account SELECT/INSERT access, permission for the locking read, and Account metadata visibility. No administrative/global grants or permission broadening are requested. Named-lock acquisition must work on this local server; errors or a busy lock fail safely.
- Use a private interactive terminal with input/output attached to a TTY. Do not pipe input, redirect output or supply any arguments. The utility refuses those modes before loading private configuration. Do not record the terminal session or save credential entry in a script/file.

## Exact invocation and private entry

From the repository root, after privately confirming the prerequisites above, use this PowerShell example for the existing development database. It saves/restores only the temporary non-secret bootstrap acknowledgment and environment selector. Database connection settings remain in their existing private configuration; this example contains no account or database password.

```powershell
$firstAdminVariableNames = @('NODE_ENV', 'FIRST_ADMIN_BOOTSTRAP_DATABASE')
$firstAdminPreviousValues = @{}
foreach ($name in $firstAdminVariableNames) {
  $firstAdminPreviousValues[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
}
try {
  $env:NODE_ENV = 'development'
  $env:FIRST_ADMIN_BOOTSTRAP_DATABASE = 'blood_donation_coordination'
  npm.cmd --prefix backend run bootstrap:admin
  if ($LASTEXITCODE -ne 0) {
    throw 'Bootstrap did not report success. Review the safe result before retrying.'
  }
} finally {
  foreach ($name in $firstAdminVariableNames) {
    [Environment]::SetEnvironmentVariable($name, $firstAdminPreviousValues[$name], 'Process')
  }
  $firstAdminPreviousValues.Clear()
}
```

The npm script invokes `node src/cli/bootstrap-first-admin.js` from `backend/`. Enter the new Admin email, password and matching password confirmation **only when prompted**. All input, including email, is hidden to prevent password typeahead/paste from being echoed while changing prompts. Enter each answer separately. Passwords are not accepted from flags, environment variables or files, and are never printed or included in diagnostics. The existing backend private configuration supplies the **database** credential only, not the new Admin credential.

Email uses the same trimmed/lowercase, 254-character validation as Donor/Hospital registration. Password uses the existing policy: at least eight Unicode code points; at most 72 UTF-8 bytes; at least one Unicode number and one punctuation/symbol; no control characters. Spaces are permitted but do not count as symbols. There is no uppercase/lowercase requirement. The exact password is passed to bcrypt at **cost 12**, without trimming, normalization or truncation; only its hash is inserted.

On success, output is a confirmation with only `accountId` (decimal string), normalized `email`, `role` and `accountStatus`. There is no password/hash, session, token, configuration or raw MySQL error output. A separate normal login is required; this command does not sign anyone in or approve any applicant.

## Serialization, refusal and cleanup

The command checks the selected schema and InnoDB Account metadata, then obtains `GET_LOCK(?, 5)` with a fixed namespace plus a hash of the lowercased database name. Concurrent copies targeting the same schema on the same local MySQL server use the same lock. Only after acquiring it does the command begin its transaction and query **any ADMIN**, without an account-status filter. The loser starts after the winner's commit and refuses, including when the existing Admin is PENDING or SUSPENDED. A five-second lock wait that times out returns a safe busy result.

The sole mutation is a parameterized Account INSERT with ADMIN/ACTIVE values. An existing email in any role is a safe conflict. There is no UPDATE, upsert, promotion, reset, reactivation, overwrite or deletion path. The guarantee serializes cooperating bootstrap invocations; arbitrary external SQL writers are outside this lock protocol and must not run concurrently with provisioning.

The named lock is held through commit or rollback and then explicitly released on that same connection; [MySQL named locks are connection-scoped and are not released by transaction completion](https://dev.mysql.com/doc/refman/8.0/en/locking-functions.html). Rollback failure or uncertain lock ownership/release destroys the connection instead of returning it to the pool. The CLI closes its pool and removes its signal handlers before reporting success. It does not silently retry.

Ctrl+C, end-of-input or SIGTERM cancels credential entry and restores the terminal. During hashing/SQL, cancellation is checked between awaited steps: before commit, pending work is rolled back and the lock/connection cleaned up. Once COMMIT has been sent, cancellation cannot undo it; the command finishes cleanup and reports success or `BOOTSTRAP_OUTCOME_UNKNOWN`. Commit/cleanup failures must be inspected before retrying because creation may have committed. Do not delete/reset an Account to make the bootstrap run again. Normal refusal/failure exits 1; confirmed pre-commit cancellation exits 130; success exits 0.

## USER-RUN evidence (browser confirmation reported 2026-10-26)

The user supplied these local results; browser confirmation was reported on **2026-10-26**. This is separate from the earlier 192 automated backend tests and both developers' historical environment evidence. No exact CLI execution date/time is inferred, and no personal Account or Hospital information is recorded.

- The bootstrap CLI successfully created **one ADMIN / ACTIVE Account**.
- Email, password and matching confirmation were entered through **hidden prompts**.
- Normal Admin sign-in opened **`/admin/hospitals` with Mint Gauge styling**.
- The registered Hospital appeared in the list.
- Search and **View details** displayed its saved information.
- Refresh preserved the authenticated session.
- After logout, revisiting `/admin/hospitals` required sign-in.

This verifies the reported positive provisioning/login/read/session/logout flow only. It remains manual/out-of-band provisioning, distinct from audited Account approval; no applicant approval or audit event is claimed. The invocation above remains a reference for separately authorized first-time setup, not a request to rerun bootstrap against the now-provisioned database.

Remaining pending boundaries:

- Real MySQL concurrency, failure/rollback and cancellation behavior.
- Live existing-Admin/duplicate-email refusal and API tampering tests.
- At this bootstrap evidence checkpoint, Account approval/suspension/reactivation, production mappings and transactional session revocation remained pending. Later bounded approval evidence is recorded separately in the [Account approval guide](account-approval-backend.md#user-run-account-approval-evidence-2026-10-26); it is not a bootstrap result.
- Audit search/UI and other operational workflows.

Thulasi retains Authentication & Role Access ownership; Lathikaa retains Hospital/Audit ownership. The continuing personal branches, reviewed pushed-checkpoint exchange and deferred main integration remain unchanged.

## Database-free verification and remaining live boundaries

Injected tests in `backend/tests/first-admin.test.js` exercise validation, exact password preservation, real bcrypt cost 12, any-status Admin refusal, duplicate email, parameter binding, two serialized callers, schema/engine guards, lock timeout/unknown ownership, database/hash/commit/rollback/disposal failures, cancellation and pool cleanup. Simulated terminals exercise the actual hidden prompt, Unicode/spaces, typeahead, Ctrl+C/EOF and raw-mode restoration. These are controlled doubles, not live MySQL or real-terminal evidence.

Run the complete backend suite from `backend/` without private configuration loading; only the whitelisted OS settings reach the child, with DB settings and NODE_OPTIONS excluded:

```powershell
@'
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
const env = { SystemRoot: process.env.SystemRoot, PATH: process.env.PATH,
  TEMP: process.env.TEMP, TMP: process.env.TMP, NODE_ENV: 'test' };
const loader = new URL('./tests/helpers/no-private-env-loader.mjs', pathToFileURL(process.cwd() + '/')).href;
const result = spawnSync(process.execPath, ['--experimental-loader', loader, '--test'],
  { env, stdio: 'inherit', timeout: 60000 });
if (result.error) { console.error('Test process failed:', result.error.code); process.exitCode = 1; }
else process.exitCode = result.status ?? 1;
'@ | node --input-type=module
if ($LASTEXITCODE -ne 0) { throw 'Backend tests failed.' }
```

The actual automated results for this milestone are recorded in [implementation readiness](implementation-readiness.md#first-admin-bootstrap-database-free-checks-2026-10-25), separately from earlier USER-RUN AuditEvent installation and other historical evidence. The later USER-RUN evidence above covers hidden credential entry, one Account creation and the stated Admin browser flow. Real MySQL named-lock concurrency, failure/rollback/cancellation, live existing-Admin/duplicate-email refusal and API tampering remain unverified. This documentation update does not rerun bootstrap, read private configuration or connect to MySQL. The separate shared approval backend now implements controlled approval/audit/revocation and coordinated login persistence. Separate USER-RUN Console approval/audit/fresh-login evidence dated 2026-10-26 is recorded in the Account approval guide. Further live concurrency/failure/security and multi-device verification, frontend controls, suspension/reactivation, password change, other mappings, audit APIs/UI and the rest of authentication remain pending. Earlier USER-RUN bootstrap/browser results do not verify this later backend milestone.
