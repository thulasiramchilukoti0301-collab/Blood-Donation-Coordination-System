import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createAccountAdminRepository } from '../src/modules/accounts/repository.js';
import { createAccountAdminService } from '../src/modules/accounts/service.js';
import { accountIdentifier, validateAccountQueue, validateApproval } from '../src/modules/accounts/validation.js';
import { createAuthService } from '../src/modules/auth/service.js';
import { createAuthRepository } from '../src/modules/auth/repository.js';
import { MysqlSessionStore } from '../src/config/database.js';
import { createAuthRuntime } from '../src/modules/auth/router.js';
import { createApp } from '../src/app.js';
import { environment } from '../src/config/environment.js';
import { requireCurrentAccount } from '../src/middleware/auth.js';
import { accountDatabase, approvalPassword } from './helpers/account-database.mjs';

const body = { accountStatus: 'ACTIVE', reason: 'REGISTRATION_REVIEWED' };
const uuid = '11111111-2222-4333-8444-555555555555';
const callStore = (store, method, ...args) => new Promise((resolve, reject) =>
  store[method](...args, (error, value) => error ? reject(error) : resolve(value)));
function fixture() {
  const database = accountDatabase();
  const store = new MysqlSessionStore(database, 60_000);
  const service = createAccountAdminService({ repository: createAccountAdminRepository(database), sessionStore: store, operationId: () => uuid });
  const auth = createAuthService({ repository: createAuthRepository(database), passwordHasher: { async compare() { return true; } } });
  let nextSession = 0;
  const login = (id, beforePersist = async () => {}) => auth.establishSession(`${id}@example.test`, approvalPassword,
    async (account, connection) => {
      await beforePersist(account, connection);
      const sessionId = `isolated-session-${++nextSession}`;
      const value = { auth: account, cookie: { expires: new Date(Date.now() + 60_000).toISOString() } };
      await store.withLoginTransaction(connection, account, () => callStore(store, 'set', sessionId, value));
    });
  return { database, store, service, auth, login };
}
function safe(error, code) {
  assert.equal(error.code, code);
  assert.doesNotMatch(JSON.stringify(error) + String(error), /PRIVATE|password_hash|connection password/u);
  return true;
}
function deferred() { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; }

test('approval validation accepts only the exact bounded body, canonical IDs and queue fields/defaults', () => {
  assert.deepEqual(validateApproval(body), body);
  assert.deepEqual(validateAccountQueue(), { role: undefined, accountStatus: 'PENDING', search: '', page: 1 });
  assert.equal(accountIdentifier('18446744073709551615'), '18446744073709551615');
  for (const value of ['0', '01', '-1', '1\n', '18446744073709551616', 1, null, {}, '1 OR 1=1']) assert.throws(() => accountIdentifier(value));
  for (const value of [null, [], {}, { ...body, actorAccountId: '1' }, { ...body, role: 'ADMIN' },
    { ...body, reason: 'free text' }, { ...body, accountStatus: 'SUSPENDED' }, { ...body, reason: undefined },
    Object.defineProperty({}, 'accountStatus', { get() { assert.fail('Must not invoke an accessor.'); } })]) assert.throws(() => validateApproval(value));
  for (const query of [{ role: 'ADMIN' }, { role: ['DONOR'] }, { accountStatus: null }, { accountStatus: 'ALL' },
    { search: {} }, { search: 'a\n' }, { search: 'x'.repeat(255) }, { page: '01' }, { page: '1\n' },
    { page: '0' }, { page: 2 }, { page: null }, { actorId: '1' }]) assert.throws(() => validateAccountQueue(query));
});

for (const id of ['10', '20']) test(`approval of ${id === '10' ? 'Donor' : 'Hospital'} is atomic, audited once and revokes pending sessions`, async () => {
  const f = fixture(); await f.login(id);
  assert.deepEqual(await f.service.approve('30', id, body), { accountId: id, accountStatus: 'ACTIVE' });
  assert.equal(f.database.accounts.get(id).accountStatus, 'ACTIVE');
  assert.equal(f.database.audits.length, 1);
  assert.deepEqual(f.database.audits[0], ['30', 'ACCOUNT_APPROVED', 'Account', id, 'REGISTRATION_REVIEWED', 'PENDING -> ACTIVE', uuid]);
  assert.equal(await callStore(f.store, 'get', 'isolated-session-1'), null);
  const transactionCalls = f.database.calls.filter((c) => c.sql.startsWith('UPDATE Account') || c.sql.startsWith('UPDATE app_session SET session_data = NULL') || c.sql.startsWith('INSERT INTO AuditEvent'));
  assert.equal(new Set(transactionCalls.map((c) => c.connection)).size, 1);
  assert.ok(transactionCalls.every((c) => c.connection !== null));
  const locks = f.database.calls.filter((c) => c.connection === transactionCalls[0].connection && c.sql.includes('FOR UPDATE'));
  assert.deepEqual(locks.map((c) => c.values[0]), [id, '30']);
  await assert.rejects(f.service.approve('30', id, body), (e) => safe(e, 'ACCOUNT_APPROVAL_CONFLICT'));
  assert.equal(f.database.audits.length, 1);
});

test('Admin/self/missing/active/suspended targets and non-Admin or inactive actors are refused', async () => {
  const f = fixture();
  for (const [actor, target, code] of [['1', '1', 'ACCOUNT_TARGET_FORBIDDEN'], ['1', '30', 'ACCOUNT_TARGET_FORBIDDEN'],
    ['1', '404', 'ACCOUNT_NOT_FOUND'], ['1', '11', 'ACCOUNT_APPROVAL_CONFLICT'], ['1', '12', 'ACCOUNT_APPROVAL_CONFLICT'],
    ['11', '10', 'FORBIDDEN'], ['12', '10', 'ACCOUNT_UNAVAILABLE'], ['404', '10', 'ACCOUNT_UNAVAILABLE']]) {
    await assert.rejects(f.service.approve(actor, target, body), (e) => safe(e, code));
  }
  assert.equal(f.database.audits.length, 0);
  assert.equal(f.database.accounts.get('10').accountStatus, 'PENDING');
});

for (const stage of ['approve', 'revoke', 'audit', 'commit']) test(`${stage} failure rolls back status, tombstones and audit`, async () => {
  const f = fixture(); await f.login('10');
  const before = structuredClone(f.database.sessions);
  f.database.failures.add(stage);
  await assert.rejects(f.service.approve('1', '10', body), (e) => safe(e, stage === 'commit' ? 'TRANSACTION_OUTCOME_UNKNOWN' : stage === 'revoke' ? 'SESSION_STORAGE_UNAVAILABLE' : 'DATABASE_UNAVAILABLE'));
  assert.equal(f.database.accounts.get('10').accountStatus, 'PENDING');
  assert.deepEqual(f.database.sessions, before);
  assert.equal(f.database.audits.length, 0);
  assert.ok(f.database.connections.every((c) => c.released || c.destroyed));
});

test('uncertain rollback/release/commit-after handling never confirms success or reuses dirty transactions', async () => {
  for (const stages of [['audit', 'rollback'], ['audit', 'rollback', 'destroy'], ['release'], ['commit-after']]) {
    const f = fixture(); stages.forEach((s) => f.database.failures.add(s));
    await assert.rejects(f.service.approve('1', '10', body), (e) => safe(e,
      stages.includes('rollback') ? 'TRANSACTION_CLEANUP_FAILED' : 'TRANSACTION_OUTCOME_UNKNOWN'));
    if (stages.includes('rollback') || stages.includes('release')) assert.equal(f.database.connections[0].destroyed, true);
    if (stages.includes('commit-after')) {
      assert.equal(f.database.accounts.get('10').accountStatus, 'ACTIVE');
      assert.equal(f.database.audits.length, 1);
    }
  }
});

test('queue defaults to PENDING, excludes Admin, escapes literal search, and orders stable 20-row pages with safe projections', async () => {
  const f = fixture();
  for (let n = 100; n < 125; n++) f.database.accounts.set(String(n), { ...f.database.accounts.get('10'), accountId: String(n), email: `person${n}@example.test` });
  const first = await f.service.list('1', {});
  const second = await f.service.list('1', { page: '2' });
  assert.deepEqual(first.pagination, { page: 1, pageSize: 20, total: 27 });
  assert.equal(second.accounts.length, 7);
  assert.deepEqual((await f.service.list('1', { page: '999' })).accounts, []);
  assert.deepEqual(first.accounts.map((a) => a.accountId), ['10', '20', ...Array.from({ length: 18 }, (_, i) => String(100 + i))]);
  assert.deepEqual(Object.keys(first.accounts[0]).sort(), ['accountId', 'accountStatus', 'createdAt', 'email', 'role']);
  assert.equal((await f.service.list('1', { role: 'HOSPITAL' })).accounts.length, 1);
  assert.equal((await f.service.list('1', { accountStatus: 'ACTIVE' })).accounts[0].accountId, '11');
  assert.deepEqual((await f.service.list('1', { search: '%_!' })).accounts, []);
  const searches = f.database.calls.filter((c) => c.sql.includes('LIKE ?'));
  assert.ok(searches.every((c) => c.values[1] === '%!%!_!!%'));
  await assert.rejects(f.service.list('11', {}), (e) => safe(e, 'FORBIDDEN'));
});

test('login before approval is durable under the Account lock, then its pending SID is revoked and cannot be upgraded or recreated', async () => {
  const f = fixture();
  const entered = deferred(); const release = deferred();
  const pendingLogin = f.login('10', async () => { entered.resolve(); await release.promise; });
  await entered.promise;
  const approval = f.service.approve('1', '10', body);
  assert.equal(f.database.sessions.size, 0, 'Uncommitted login storage is not durable yet.');
  assert.equal(f.database.accounts.get('10').accountStatus, 'PENDING');
  release.resolve();
  assert.equal((await pendingLogin).accountStatus, 'PENDING');
  await approval;
  const stale = { auth: { accountId: '10', role: 'DONOR', accountStatus: 'PENDING' }, cookie: { expires: new Date(Date.now() + 60_000).toISOString() } };
  await callStore(f.store, 'set', 'isolated-session-1', stale);
  await callStore(f.store, 'touch', 'isolated-session-1', stale);
  await callStore(f.store, 'set', 'never-created', { ...stale, auth: { ...stale.auth, accountStatus: 'ACTIVE' } });
  assert.equal(await callStore(f.store, 'get', 'isolated-session-1'), null);
  assert.equal(await callStore(f.store, 'get', 'never-created'), null);
  assert.equal((await f.login('10')).accountStatus, 'ACTIVE');
  assert.equal((await callStore(f.store, 'get', 'isolated-session-2')).auth.accountStatus, 'ACTIVE');
});

test('verification before approval is rechecked after locking: fresh post-approval session allowed, changed credentials/role denied', async () => {
  for (const change of ['approve', 'hash', 'email', 'role', 'suspend']) {
    const f = fixture();
    const verified = deferred(); const continueLogin = deferred();
    const auth = createAuthService({ repository: createAuthRepository(f.database), passwordHasher: {
      async compare() { verified.resolve(); await continueLogin.promise; return true; },
    } });
    const login = auth.establishSession('10@example.test', approvalPassword, async (account, connection) => {
      await f.store.withLoginTransaction(connection, account, () => callStore(f.store, 'set', 'fresh', { auth: account }));
    });
    await verified.promise;
    if (change === 'approve') await f.service.approve('1', '10', body);
    else Object.assign(f.database.accounts.get('10'), change === 'hash' ? { passwordHash: 'changed' }
      : change === 'email' ? { email: 'other@example.test' } : change === 'role' ? { role: 'HOSPITAL' } : { accountStatus: 'SUSPENDED' });
    continueLogin.resolve();
    if (change === 'approve') assert.equal((await login).accountStatus, 'ACTIVE');
    else { await assert.rejects(login, (e) => safe(e, 'INVALID_CREDENTIALS')); assert.equal(f.database.sessions.size, 0); }
  }
});

test('approval before an awaiting login blocks persistence until committed, then stores post-approval identity', async () => {
  const f = fixture(); const entered = deferred(); const release = deferred();
  f.database.hooks.commit = async (connection) => { if (connection.auditWrites.length) { entered.resolve(); await release.promise; } };
  const approval = f.service.approve('1', '10', body); await entered.promise;
  const login = f.login('10'); release.resolve();
  await approval; assert.equal((await login).accountStatus, 'ACTIVE');
});

test('two approvals produce exactly one event and one conflict', async () => {
  const f = fixture();
  const results = await Promise.allSettled([f.service.approve('1', '10', body), f.service.approve('30', '10', body)]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(results.find((r) => r.status === 'rejected').reason.code, 'ACCOUNT_APPROVAL_CONFLICT');
  assert.equal(f.database.audits.length, 1);
});

test('a pending snapshot cannot be promoted by stale saves even if the payload claims ACTIVE', async () => {
  const f = fixture(); await f.login('10');
  f.database.accounts.get('10').accountStatus = 'ACTIVE';
  const stale = await callStore(f.store, 'get', 'isolated-session-1');
  stale.auth.accountStatus = 'ACTIVE';
  await callStore(f.store, 'set', 'isolated-session-1', stale);
  await callStore(f.store, 'touch', 'isolated-session-1', stale);
  assert.equal((await callStore(f.store, 'get', 'isolated-session-1')).auth.accountStatus, 'PENDING');
});

for (const method of ['set', 'touch']) {
  for (const [hook, lockName] of [['lock', 'Account'], ['sessionLock', 'session-row']]) {
    for (const expiresDuringWait of [true, false]) {
      test(`authenticated ${method} ${expiresDuringWait ? 'cannot revive expiry' : 'succeeds unexpired'} after a ${lockName} lock wait`, async (t) => {
        let now = Date.UTC(2026, 9, 26, 9);
        t.mock.method(Date, 'now', () => now);
        const f = fixture(); await f.login('10');
        const sid = 'isolated-session-1';
        const value = await callStore(f.store, 'get', sid);
        const before = structuredClone(f.database.sessions.get(sid));
        now = before.expires_at - 1_000;
        // Express may refresh cookie expiry before its response-time write.
        // This would revive the row if the predicate used the pre-wait time.
        value.cookie.expires = new Date(now + 120_000).toISOString();
        value.csrfToken = 'disposable-updated-csrf';
        const entered = deferred(); const resume = deferred();
        f.database.hooks[hook] = async (id, connection) => {
          assert.equal(id, hook === 'lock' ? '10' : sid);
          assert.ok(connection.held.has('10'));
          entered.resolve(); await resume.promise;
        };
        const start = f.database.calls.length;
        const writing = callStore(f.store, method, sid, value);
        try {
          await Promise.race([entered.promise, writing.then(() => assert.fail('Write did not await the required lock.'))]);
          assert.deepEqual(f.database.sessions.get(sid), before);
          now = before.expires_at + (expiresDuringWait ? 1 : -500);
        } finally {
          resume.resolve(); await writing;
        }
        const calls = f.database.calls.slice(start);
        const accountLock = calls.findIndex((c) => c.sql.includes('FROM Account') && c.sql.endsWith('FOR UPDATE'));
        const sessionLock = calls.findIndex((c) => c.sql.startsWith('SELECT expires_at FROM app_session'));
        assert.ok(accountLock >= 0 && sessionLock > accountLock);
        assert.equal(calls[accountLock].connection, calls[sessionLock].connection);
        const updates = calls.filter((c) => c.sql.startsWith('UPDATE app_session'));
        if (expiresDuringWait) {
          assert.equal(updates.length, 0);
          assert.deepEqual(f.database.sessions.get(sid), before, 'Expired row must not be extended or rewritten.');
          assert.equal(await callStore(f.store, 'get', sid), null);
          const expired = f.database.sessions.get(sid);
          assert.equal(expired.expires_at, before.expires_at);
          assert.equal(expired.revoked_at, now);
          assert.equal(expired.session_data, null);
        } else {
          assert.equal(updates.length, 1);
          const offset = method === 'touch' ? 0 : 1;
          assert.equal(updates[0].values[offset], now + 60_000, 'TTL must use the post-lock clock.');
          assert.equal(updates[0].values[offset + 2], now, 'Expiry predicate must use the post-lock clock.');
          assert.equal(updates[0].connection, calls[sessionLock].connection);
          const saved = f.database.sessions.get(sid);
          assert.equal(saved.expires_at, now + 60_000);
          assert.equal(saved.revoked_at, null);
          const expected = method === 'set' ? value : JSON.parse(before.session_data);
          assert.deepEqual(await callStore(f.store, 'get', sid), expected);
        }
        assert.ok(f.database.connections.every((c) => c.released && !c.active));
      });
    }
  }
}

test('an in-flight pending or legacy session loaded before approval is denied by the current-account guard', async () => {
  for (const accountStatus of ['PENDING', undefined]) {
    const f = fixture(); await f.service.approve('1', '10', body);
    let destroyed = 0;
    const req = { session: { auth: { accountId: '10', role: 'DONOR', accountStatus }, destroy(callback) { destroyed++; callback(); } } };
    const error = await new Promise((resolve) => requireCurrentAccount(f.auth)(req, {}, resolve));
    assert.equal(error.code, 'ACCOUNT_UNAVAILABLE'); assert.equal(destroyed, 1);
    assert.equal(req.authAccount, undefined);
  }
  const f = fixture();
  f.database.sessions.set('legacy-format', { expires_at: Date.now() + 60_000, revoked_at: null,
    session_data: JSON.stringify({ auth: { accountId: '10', role: 'DONOR' } }) });
  assert.equal(await callStore(f.store, 'get', 'legacy-format'), null);
  assert.notEqual(f.database.sessions.get('legacy-format').revoked_at, null);
});

test('session insertion failure rolls login back, while ordinary set can never establish authentication', async () => {
  const f = fixture(); f.database.failures.add('session-insert');
  await assert.rejects(f.login('10'), (e) => safe(e, 'SESSION_STORAGE_UNAVAILABLE'));
  assert.equal(f.database.sessions.size, 0);
  f.database.failures.clear();
  await callStore(f.store, 'set', 'not-a-login', { auth: { accountId: '10', role: 'DONOR', accountStatus: 'PENDING' } });
  assert.equal(f.database.sessions.size, 0);
  assert.equal(f.database.audits.length, 0);
});

test('acquisition/begin/lock failures cannot approve, and response-time storage failures stay sanitized', async () => {
  for (const stage of ['acquire', 'begin', 'lock']) {
    const f = fixture(); f.database.failures.add(stage);
    await assert.rejects(f.service.approve('1', '10', body), (e) => safe(e, 'DATABASE_UNAVAILABLE'));
    assert.equal(f.database.audits.length, 0);
    assert.equal(f.database.accounts.get('10').accountStatus, 'PENDING');
    assert.ok(f.database.connections.every((c) => c.released || c.destroyed));
  }
  const f = fixture(); await f.login('10');
  const value = await callStore(f.store, 'get', 'isolated-session-1');
  f.database.failures.add('session-update');
  await assert.rejects(callStore(f.store, 'set', 'isolated-session-1', value), (e) => safe(e, 'SESSION_STORAGE_UNAVAILABLE'));
  await assert.rejects(callStore(f.store, 'touch', 'isolated-session-1', value), (e) => safe(e, 'SESSION_STORAGE_UNAVAILABLE'));
});

async function http(t) {
  const database = accountDatabase();
  const runtime = createAuthRuntime({ databasePool: database, env: { SESSION_SECRET: 'isolated-account-approval-secret-at-least-32-bytes' } });
  const app = createApp({ authRuntime: runtime, verifyDatabase: async () => true });
  const server = app.listen(0, '127.0.0.1'); await new Promise((resolve) => server.once('listening', resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); });
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const request = (path, { method = 'GET', cookie, csrf, body: input, origin = environment.frontendUrl, headers = {} } = {}) => fetch(base + path, {
    method, headers: { Origin: origin, ...(cookie ? { Cookie: cookie } : {}), ...(csrf ? { 'X-CSRF-Token': csrf } : {}),
      ...(input === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers }, ...(input === undefined ? {} : { body: JSON.stringify(input) }),
  });
  async function login(id) {
    const csrfResponse = await request('/auth/csrf'); const csrf = (await csrfResponse.json()).csrfToken;
    const result = await request('/auth/login', { method: 'POST', cookie: csrfResponse.headers.get('set-cookie').split(';')[0], csrf,
      body: { email: `${id}@example.test`, password: approvalPassword } });
    assert.equal(result.status, 200);
    const cookie = result.headers.get('set-cookie').split(';')[0];
    const token = await request('/auth/csrf', { cookie });
    return { cookie, csrf: (await token.json()).csrfToken };
  }
  return { database, request, login, runtime };
}

test('HTTP approval and queue use verified Admin identity, CSRF/no-store, safe envelopes and force target re-login', async (t) => {
  const h = await http(t); const target = await h.login('10'); const admin = await h.login('1');
  const queue = await h.request('/admin/accounts', admin);
  assert.equal(queue.status, 200); assert.equal(queue.headers.get('cache-control'), 'no-store');
  const data = await queue.json(); assert.equal(data.accounts.length, 2);
  assert.doesNotMatch(JSON.stringify(data), /password|session|privateProfile|PRIVATE/u);
  const approved = await h.request('/admin/accounts/10', { ...admin, method: 'PATCH', body, headers: { 'X-Actor-Id': '30' } });
  assert.equal(approved.status, 200);
  assert.deepEqual(await approved.json(), { success: true, accountId: '10', accountStatus: 'ACTIVE' });
  assert.equal(h.database.audits[0][0], '1');
  assert.equal((await h.request('/auth/me', target)).status, 401);
  const again = await h.login('10');
  assert.equal((await (await h.request('/auth/me', again)).json()).user.accountStatus, 'ACTIVE');
  // Express response-time persistence may UPDATE, but cannot independently INSERT auth.
  assert.ok(h.database.calls.filter((c) => c.sql.startsWith('INSERT INTO app_session') && !c.sql.includes('ON DUPLICATE KEY')).every((c) => c.connection !== null));
  assert.ok(h.database.calls.filter((c) => c.sql.includes('VALUES (?, ?, NULL, ?)')).every((c) => c.connection !== null),
    'Successful login rotation tombstones the old SID on the locked transaction connection too.');
});

test('HTTP guards reject anonymous/non-Admin/stale-status, CSRF/origin tampering and malformed inputs without mutation', async (t) => {
  const h = await http(t);
  assert.equal((await h.request('/admin/accounts', { headers: { 'X-Actor-Id': '1' } })).status, 401);
  for (const id of ['10', '20', '11']) {
    const user = await h.login(id);
    assert.equal((await h.request('/admin/accounts', user)).status, 403);
    assert.equal((await h.request('/admin/accounts/10', { ...user, method: 'PATCH', body })).status, 403);
  }
  const admin = await h.login('1');
  for (const change of [{ csrf: undefined }, { csrf: 'wrong' }, { origin: 'https://untrusted.example' }]) {
    assert.equal((await h.request('/admin/accounts/10', { ...admin, ...change, method: 'PATCH', body })).status, 403);
  }
  for (const path of ['/admin/accounts?role=ADMIN', '/admin/accounts?page=01', '/admin/accounts?search[x]=a',
    '/admin/accounts?role=DONOR&role=HOSPITAL', '/admin/accounts?actorId=30']) assert.equal((await h.request(path, admin)).status, 400);
  for (const path of ['/admin/accounts/0', '/admin/accounts/01', '/admin/accounts/18446744073709551616', '/admin/accounts/10?actorId=30']) {
    assert.equal((await h.request(path, { ...admin, method: 'PATCH', body })).status, 400);
  }
  for (const invalid of [{ ...body, actorAccountId: '30' }, { ...body, accountStatus: 'SUSPENDED' }, { ...body, reason: 'personal text' }]) {
    assert.equal((await h.request('/admin/accounts/10', { ...admin, method: 'PATCH', body: invalid })).status, 400);
  }
  h.database.accounts.get('1').accountStatus = 'SUSPENDED';
  assert.equal((await h.request('/admin/accounts', admin)).status, 401);
  assert.equal(h.database.audits.length, 0);
});

test('HTTP failed login persistence/commit cannot be authenticated by an automatic response save', async (t) => {
  const h = await http(t);
  const response = await h.request('/auth/csrf'); const csrf = (await response.json()).csrfToken;
  h.database.failures.add('commit');
  const result = await h.request('/auth/login', { method: 'POST', cookie: response.headers.get('set-cookie').split(';')[0], csrf,
    body: { email: '10@example.test', password: approvalPassword } });
  assert.equal(result.status, 503);
  assert.doesNotMatch(JSON.stringify(await result.json()), /PRIVATE|password_hash/u);
  assert.equal([...h.database.sessions.values()].filter((row) => row.revoked_at === null && JSON.parse(row.session_data)?.auth).length, 0);
});

test('HTTP approval failure is safe and preserves the pending user session; retry succeeds once', async (t) => {
  const h = await http(t); const target = await h.login('20'); const admin = await h.login('1');
  h.database.failures.add('audit');
  const failed = await h.request('/admin/accounts/20', { ...admin, method: 'PATCH', body });
  assert.equal(failed.status, 503); assert.doesNotMatch(JSON.stringify(await failed.json()), /PRIVATE|password_hash/u);
  assert.equal((await (await h.request('/auth/me', target)).json()).user.accountStatus, 'PENDING');
  h.database.failures.clear();
  assert.equal((await h.request('/admin/accounts/20', { ...admin, method: 'PATCH', body })).status, 200);
  assert.equal((await h.request('/admin/accounts/20', { ...admin, method: 'PATCH', body })).status, 409);
  assert.equal(h.database.audits.length, 1);
});

test('HTTP ambiguous committed login is tombstoned and unconfigured account routes fail closed', async (t) => {
  const h = await http(t);
  const response = await h.request('/auth/csrf'); const csrf = (await response.json()).csrfToken;
  h.database.failures.add('commit-after');
  const result = await h.request('/auth/login', { method: 'POST', cookie: response.headers.get('set-cookie').split(';')[0], csrf,
    body: { email: '10@example.test', password: approvalPassword } });
  assert.equal(result.status, 503);
  assert.equal([...h.database.sessions.values()].filter((row) => row.revoked_at === null && JSON.parse(row.session_data)?.auth).length, 0);
  const unavailable = createAuthRuntime({ databasePool: null, env: {} });
  for (const [method, path] of [['GET', '/admin/accounts'], ['PATCH', '/admin/accounts/10']]) {
    const error = await new Promise((resolve) => unavailable.router.handle({ method, url: path, path, headers: {} }, {}, resolve));
    assert.equal(error.code, 'AUTHENTICATION_NOT_CONFIGURED');
  }
});
