import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { accountDatabase, approvalPassword } from './helpers/account-database.mjs';
import { testAuthorization, testSessionRow } from './helpers/session-context.mjs';
import { createAccountAdminRepository } from '../src/modules/accounts/repository.js';
import { createAccountAdminService } from '../src/modules/accounts/service.js';
import { validateAccountTransition } from '../src/modules/accounts/validation.js';
import { requireStoredSession } from '../src/modules/accounts/sessionAuthorization.js';
import { createAuthRepository } from '../src/modules/auth/repository.js';
import { createAuthService } from '../src/modules/auth/service.js';
import { createDonorRepository } from '../src/modules/donors/repository.js';
import { createDonorProfileService } from '../src/modules/donors/service.js';
import { createHospitalRepository } from '../src/modules/hospitals/repository.js';
import { createHospitalService } from '../src/modules/hospitals/service.js';
import { createHospitalRouter } from '../src/modules/hospitals/router.js';
import { createAuthRuntime } from '../src/modules/auth/router.js';
import { requireCurrentAccount } from '../src/middleware/auth.js';
import { MysqlSessionStore } from '../src/config/database.js';
import { createApp } from '../src/app.js';
import { environment } from '../src/config/environment.js';

const suspend = Object.freeze({ accountStatus: 'SUSPENDED', reason: 'ACCESS_RESTRICTED' });
const reactivate = Object.freeze({ accountStatus: 'ACTIVE', reason: 'ACCESS_RESTORED' });
const approve = Object.freeze({ accountStatus: 'ACTIVE', reason: 'REGISTRATION_REVIEWED' });
const callStore = (store, method, ...args) => new Promise((resolve, reject) =>
  store[method](...args, (error, value) => error ? reject(error) : resolve(value)));
function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }
function safe(code) { return error => {
  assert.equal(error.code, code);
  assert.doesNotMatch(JSON.stringify(error) + String(error), /PRIVATE|password_hash|fixture-session|disposable-sid/u);
  return true;
}; }
function fixture() {
  const database = accountDatabase();
  for (const id of ['10', '20']) database.accounts.get(id).accountStatus = 'ACTIVE';
  const store = new MysqlSessionStore(database, 60_000);
  const admin = testAuthorization('1', 'ADMIN', 'ACTIVE');
  database.sessions.set(admin.sessionId, testSessionRow(admin));
  const service = createAccountAdminService({ repository: createAccountAdminRepository(database), sessionStore: store, operationId: randomUUID });
  const auth = createAuthService({ repository: createAuthRepository(database), passwordHasher: { async compare() { return true; } } });
  let sid = 0;
  async function login(id) {
    const sessionId = `disposable-sid-${++sid}`;
    let value;
    const principal = await auth.establishSession(`${id}@example.test`, approvalPassword, async (account, connection) => {
      value = { auth: account, cookie: { expires: new Date(Date.now() + 60_000).toISOString() } };
      await store.withLoginTransaction(connection, account, () => callStore(store, 'set', sessionId, value));
    });
    return { sessionId, principal, value, authorization: { sessionId, principal } };
  }
  const change = (id, input, context = admin) => service.changeStatus(context.principal.accountId, id, input, context);
  const donor = createDonorProfileService({ repository: createDonorRepository(database) });
  const hospital = createHospitalService({ repository: createHospitalRepository(database) });
  return { database, store, service, auth, admin, login, change, donor, hospital };
}

test('exact state/reason pairs determine immutable transition mappings; malformed/extra inputs are rejected', () => {
  for (const [input, from, action] of [[approve, 'PENDING', 'ACCOUNT_APPROVED'], [suspend, 'ACTIVE', 'ACCOUNT_SUSPENDED'], [reactivate, 'SUSPENDED', 'ACCOUNT_REACTIVATED']]) {
    const result = validateAccountTransition(input);
    assert.equal(result.from, from); assert.equal(result.to, input.accountStatus); assert.equal(result.reason, input.reason);
    assert.equal(result.action, action); assert.equal(result.summary, `${from} -> ${input.accountStatus}`);
    assert.equal(Object.isFrozen(result), true);
  }
  for (const body of [null, [], {}, { ...suspend, actorAccountId: '30' }, { ...suspend, role: 'ADMIN' },
    { ...suspend, reason: 'free text' }, { ...suspend, reason: 'ACCESS_RESTORED' }, { ...reactivate, reason: 'ACCESS_RESTRICTED' },
    { ...suspend, accountStatus: 'suspended' }, { ...suspend, email: 'invalid' }, { ...reactivate, reason: '__proto__' }]) {
    assert.throws(() => validateAccountTransition(body), { code: 'VALIDATION_ERROR' });
  }
});

for (const id of ['10', '20']) {
  test(`${id === '10' ? 'Donor' : 'Hospital'} suspension/reactivation are atomic, audited once and never restore old SIDs`, async () => {
    const f = fixture(); const first = await f.login(id); const second = await f.login(id);
    const count = f.database.calls.length;
    assert.deepEqual(await f.change(id, suspend), { accountId: id, accountStatus: 'SUSPENDED' });
    assert.equal(await callStore(f.store, 'get', first.sessionId), null);
    assert.equal(await callStore(f.store, 'get', second.sessionId), null);
    await assert.rejects(f.login(id), safe('INVALID_CREDENTIALS'));
    const revoked = structuredClone(f.database.sessions.get(first.sessionId));
    assert.deepEqual(await f.change(id, reactivate), { accountId: id, accountStatus: 'ACTIVE' });
    assert.deepEqual(f.database.sessions.get(first.sessionId), revoked, 'Reactivation does not clear a tombstone or restore data.');
    assert.equal(await callStore(f.store, 'get', first.sessionId), null);
    await callStore(f.store, 'set', first.sessionId, first.value);
    await callStore(f.store, 'touch', first.sessionId, first.value);
    await callStore(f.store, 'set', 'missing-old-sid', first.value);
    assert.equal(await callStore(f.store, 'get', first.sessionId), null);
    assert.equal(await callStore(f.store, 'get', 'missing-old-sid'), null);
    assert.equal((await f.login(id)).principal.accountStatus, 'ACTIVE');
    assert.equal(f.database.audits.length, 2);
    assert.deepEqual(f.database.audits.map(event => event.slice(0, 6)), [
      ['1', 'ACCOUNT_SUSPENDED', 'Account', id, 'ACCESS_RESTRICTED', 'ACTIVE -> SUSPENDED'],
      ['1', 'ACCOUNT_REACTIVATED', 'Account', id, 'ACCESS_RESTORED', 'SUSPENDED -> ACTIVE'],
    ]);
    assert.notEqual(f.database.audits[0][6], f.database.audits[1][6]);
    const writes = f.database.calls.slice(count).filter(call => call.sql.startsWith('UPDATE Account') || call.sql.startsWith('UPDATE app_session SET session_data = NULL') || call.sql.startsWith('INSERT INTO AuditEvent'));
    for (let index = 0; index < writes.length; index += 3) {
      assert.equal(new Set(writes.slice(index, index + 3).map(call => call.connection)).size, 1);
      assert.ok(writes[index].connection);
    }
  });
  test(`loaded ${id === '10' ? 'Donor' : 'Hospital'} session cannot authorize after a complete same-time status cycle`, async (t) => {
    t.mock.method(Date, 'now', () => Date.UTC(2026, 9, 26, 9));
    const f = fixture(); const old = await f.login(id);
    const loaded = await callStore(f.store, 'get', old.sessionId);
    await f.change(id, suspend); await f.change(id, reactivate);
    let destroyed = 0;
    const req = { sessionID: old.sessionId, session: { auth: loaded.auth, destroy(done) { destroyed++; done(); } } };
    const error = await new Promise(resolve => requireCurrentAccount(f.auth)(req, {}, resolve));
    assert.equal(error.code, 'ACCOUNT_UNAVAILABLE'); assert.equal(destroyed, 1);
    assert.equal(req.authAccount, undefined);
    await assert.rejects(f.auth.authorizeSession(old.sessionId, old.principal), safe('ACCOUNT_UNAVAILABLE'));
  });
  test(`delayed ${id === '10' ? 'Donor' : 'Hospital'} profile write across suspension/reactivation is refused at its transaction authorization point`, async () => {
    const f = fixture(); const old = await f.login(id);
    await f.auth.authorizeSession(old.sessionId, old.principal); // Earlier HTTP guard succeeded.
    const entered = deferred(); const release = deferred();
    f.database.hooks.beforeLock = async target => {
      if (target === id) { f.database.hooks.beforeLock = null; entered.resolve(); await release.promise; }
    };
    const before = structuredClone(id === '10' ? f.database.donors : f.database.hospitals);
    const writing = id === '10' ? f.donor.updateOwnProfile(id, { phone: '456' }, old.authorization)
      : f.hospital.updateOwnProfile({ accountId: id, session: old.authorization }, { phone: '456' });
    const rejected = assert.rejects(writing, safe('ACCOUNT_UNAVAILABLE'));
    try { await entered.promise; await f.change(id, suspend); await f.change(id, reactivate); }
    finally { release.resolve(); }
    await rejected;
    assert.deepEqual(id === '10' ? f.database.donors : f.database.hospitals, before);
    assert.ok(!f.database.calls.some(call => /^UPDATE (Donor|Hospital) SET/u.test(call.sql)));
    const fresh = await f.login(id);
    const result = id === '10' ? await f.donor.updateOwnProfile(id, { phone: '456' }, fresh.authorization)
      : await f.hospital.updateOwnProfile({ accountId: id, session: fresh.authorization }, { phone: '456' });
    assert.equal(result.phone, '456');
    const writes = f.database.calls.filter(call => /^UPDATE (Donor|Hospital) SET/u.test(call.sql));
    const calls = f.database.calls.filter(call => call.connection === writes[0].connection);
    assert.ok(calls.findIndex(call => call.sql.includes('FROM Account')) < calls.findIndex(call => call.sql.startsWith('SELECT session_data')));
    assert.ok(calls.findIndex(call => call.sql.startsWith('SELECT session_data')) < calls.findIndex(call => /^UPDATE (Donor|Hospital) SET/u.test(call.sql)));
  });
}

test('stale approval never reactivates; repeat/unsupported state transitions conflict without extra events', async () => {
  const f = fixture(); await f.change('10', suspend);
  for (const [input, code] of [[approve, 'ACCOUNT_APPROVAL_CONFLICT'], [suspend, 'ACCOUNT_STATUS_CONFLICT']]) await assert.rejects(f.change('10', input), safe(code));
  assert.equal(f.database.accounts.get('10').accountStatus, 'SUSPENDED');
  assert.equal(f.database.audits.length, 1);
  await f.change('10', reactivate);
  await assert.rejects(f.change('10', reactivate), safe('ACCOUNT_STATUS_CONFLICT'));
  f.database.accounts.get('20').accountStatus = 'PENDING';
  for (const input of [suspend, reactivate]) await assert.rejects(f.change('20', input), safe('ACCOUNT_STATUS_CONFLICT'));
  assert.equal(f.database.audits.length, 2);
});
for (const input of [suspend, reactivate]) for (const stage of ['mutation', 'revoke', 'audit', 'commit']) {
  test(`${input.reason}: ${stage} failure rolls back status, sessions and audit together`, async () => {
    const f = fixture(); const old = await f.login('10');
    if (input === reactivate) f.database.accounts.get('10').accountStatus = 'SUSPENDED';
    const before = structuredClone({ accounts: f.database.accounts, sessions: f.database.sessions });
    f.database.failures.add(stage);
    await assert.rejects(f.change('10', input), safe(stage === 'commit' ? 'TRANSACTION_OUTCOME_UNKNOWN' : stage === 'revoke' ? 'SESSION_STORAGE_UNAVAILABLE' : 'DATABASE_UNAVAILABLE'));
    assert.deepEqual(f.database.accounts, before.accounts); assert.deepEqual(f.database.sessions, before.sessions);
    assert.equal(f.database.audits.length, 0); assert.ok(f.database.sessions.has(old.sessionId));
    assert.ok(f.database.connections.every(connection => connection.released || connection.destroyed));
  });
}
test('status transitions preserve uncertain-commit/failed-cleanup safety', async () => {
  for (const input of [suspend, reactivate]) for (const stages of [['audit', 'rollback'], ['audit', 'rollback', 'destroy'], ['release'], ['commit-after']]) {
    const f = fixture(); if (input === reactivate) f.database.accounts.get('10').accountStatus = 'SUSPENDED';
    stages.forEach(stage => f.database.failures.add(stage));
    await assert.rejects(f.change('10', input), safe(stages.includes('rollback') ? 'TRANSACTION_CLEANUP_FAILED' : 'TRANSACTION_OUTCOME_UNKNOWN'));
    if (stages.includes('rollback') || stages.includes('release')) assert.equal(f.database.connections.at(-1).destroyed, true);
    assert.equal(f.database.audits.length, stages.includes('commit-after') || stages.includes('release') ? 1 : 0);
  }
});
test('revoked actor SID and missing internal authorization fail closed before any Account mutation', async () => {
  const f = fixture(); await callStore(f.store, 'destroy', f.admin.sessionId);
  await assert.rejects(f.change('10', suspend), safe('ACCOUNT_UNAVAILABLE'));
  await assert.rejects(f.service.changeStatus('1', '10', suspend), safe('ACCOUNT_UNAVAILABLE'));
  assert.equal(f.database.audits.length, 0); assert.equal(f.database.accounts.get('10').accountStatus, 'ACTIVE');
});
test('authoritative authorization checks post-session-lock time, missing/expired/revoked/changed principals and safe storage failures', async () => {
  const context = testAuthorization('10', 'DONOR', 'ACTIVE'); const account = context.principal;
  for (const row of [null, { ...testSessionRow(context), expires_at: 0 }, { ...testSessionRow(context), revoked_at: 1 },
    { ...testSessionRow(context), session_data: null }, { ...testSessionRow(context), session_data: '{' },
    { ...testSessionRow(context), session_data: JSON.stringify({ auth: { ...account, accountId: '20' } }) },
    { ...testSessionRow(context), session_data: JSON.stringify({ auth: { ...account, role: 'ADMIN' } }) },
    { ...testSessionRow(context), session_data: JSON.stringify({ auth: { ...account, accountStatus: 'PENDING' } }) }]) {
    await assert.rejects(requireStoredSession({ execute: async () => [row ? [row] : []] }, context, account), safe('ACCOUNT_UNAVAILABLE'));
  }
  const f = fixture(); const old = await f.login('10'); const entered = deferred(); const release = deferred();
  f.database.hooks.authorizeSession = async () => { entered.resolve(); await release.promise; };
  const auth = f.auth.authorizeSession(old.sessionId, old.principal);
  const rejection = assert.rejects(auth, safe('ACCOUNT_UNAVAILABLE'));
  await entered.promise; f.database.sessions.get(old.sessionId).expires_at = Date.now() - 1; release.resolve(); await rejection;
  f.database.hooks.authorizeSession = null; f.database.failures.add('session-authorize');
  await assert.rejects(f.auth.authorizeSession(old.sessionId, old.principal), safe('DATABASE_UNAVAILABLE'));
});
test('login durable before suspension is revoked; initially suspended login fails until reactivation commits', async () => {
  const f = fixture(); const entered = deferred(); const release = deferred();
  f.database.hooks.sessionInsert = async () => { entered.resolve(); await release.promise; };
  const login = f.login('10'); await entered.promise;
  const suspension = f.change('10', suspend); release.resolve();
  const old = await login; await suspension;
  assert.equal(await callStore(f.store, 'get', old.sessionId), null);
  f.database.hooks.sessionInsert = null;
  const reactivationEntered = deferred(); const finish = deferred();
  f.database.hooks.commit = async connection => { if (connection.auditWrites.some(row => row[1] === 'ACCOUNT_REACTIVATED')) { reactivationEntered.resolve(); await finish.promise; } };
  const reactivation = f.change('10', reactivate); await reactivationEntered.promise;
  // The initial read is still SUSPENDED, so a new login must fail rather than
  // reuse the old SID; after reactivation, a fresh credential request succeeds.
  await assert.rejects(f.login('10'), safe('INVALID_CREDENTIALS')); finish.resolve(); await reactivation;
  assert.equal((await f.login('10')).principal.accountStatus, 'ACTIVE');
});

for (const completeCycle of [false, true]) test(`credential verification delayed across ${completeCycle ? 'a complete cycle' : 'suspension'} rechecks locked state before inserting a new SID`, async () => {
  const f = fixture(); const entered = deferred(); const release = deferred();
  const auth = createAuthService({ repository: createAuthRepository(f.database), passwordHasher: {
    async compare() { entered.resolve(); await release.promise; return true; },
  } });
  let persisted = false;
  const login = auth.establishSession('10@example.test', approvalPassword, async (principal, connection) => {
    assert.equal(principal.accountStatus, 'ACTIVE'); persisted = true;
    await f.store.withLoginTransaction(connection, principal, () => callStore(f.store, 'set', 'fresh-after-proof', {
      auth: principal, cookie: { expires: new Date(Date.now() + 60_000).toISOString() },
    }));
  });
  const result = completeCycle ? login : assert.rejects(login, safe('INVALID_CREDENTIALS'));
  try { await entered.promise; await f.change('10', suspend); if (completeCycle) await f.change('10', reactivate); }
  finally { release.resolve(); }
  await result;
  assert.equal(persisted, completeCycle);
  assert.equal(Boolean(await callStore(f.store, 'get', 'fresh-after-proof')), completeCycle);
});

for (const id of ['10', '20']) test(`already authorized ${id === '10' ? 'Donor' : 'Hospital'} profile transaction commits before waiting suspension`, async () => {
  const f = fixture(); const old = await f.login(id); const entered = deferred(); const release = deferred();
  f.database.hooks.commit = async connection => {
    if (connection.profileWrites.size) { entered.resolve(); await release.promise; }
  };
  const writing = id === '10' ? f.donor.updateOwnProfile(id, { phone: '456' }, old.authorization)
    : f.hospital.updateOwnProfile({ accountId: id, session: old.authorization }, { phone: '456' });
  await entered.promise;
  let suspended = false;
  const suspension = f.change(id, suspend).then(() => { suspended = true; });
  try { await new Promise(resolve => setImmediate(resolve)); assert.equal(suspended, false); }
  finally { release.resolve(); }
  assert.equal((await writing).phone, '456'); await suspension;
  assert.equal((id === '10' ? f.database.donors : f.database.hospitals).get(id).phone, '456');
  assert.equal(f.database.accounts.get(id).accountStatus, 'SUSPENDED');
  assert.equal(await callStore(f.store, 'get', old.sessionId), null);
});

test('competing identical status operations serialize and produce one transition/event', async () => {
  for (const input of [suspend, reactivate]) {
    const f = fixture(); if (input === reactivate) f.database.accounts.get('10').accountStatus = 'SUSPENDED';
    const other = testAuthorization('30', 'ADMIN', 'ACTIVE'); f.database.sessions.set(other.sessionId, testSessionRow(other));
    const results = await Promise.allSettled([f.change('10', input), f.change('10', input, other)]);
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
    assert.equal(results.find(result => result.status === 'rejected').reason.code, 'ACCOUNT_STATUS_CONFLICT');
    assert.equal(f.database.audits.length, 1); assert.equal(f.database.accounts.get('10').accountStatus, input.accountStatus);
  }
});

async function http(t) {
  const f = fixture();
  const runtime = createAuthRuntime({ databasePool: f.database, env: { SESSION_SECRET: 'isolated-status-session-secret-at-least-32-bytes' } });
  const app = createApp({ authRuntime: runtime, hospitalRouter: createHospitalRouter({ databasePool: f.database }), verifyDatabase: async () => true });
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const request = (path, { cookie, csrf, method = 'GET', body, origin = environment.frontendUrl, headers = {} } = {}) => fetch(base + path, {
    method, headers: { Origin: origin, ...(cookie ? { Cookie: cookie } : {}), ...(csrf ? { 'X-CSRF-Token': csrf } : {}), ...headers,
      ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}),
  });
  async function login(id) {
    const initial = await request('/auth/csrf'); const initialCsrf = (await initial.json()).csrfToken;
    const response = await request('/auth/login', { method: 'POST', cookie: initial.headers.get('set-cookie').split(';')[0], csrf: initialCsrf,
      body: { email: `${id}@example.test`, password: approvalPassword } });
    if (response.status !== 200) return { response };
    const cookie = response.headers.get('set-cookie').split(';')[0];
    const csrf = (await (await request('/auth/csrf', { cookie })).json()).csrfToken;
    return { response, cookie, csrf };
  }
  return { ...f, runtime, request, login };
}
for (const id of ['10', '20']) test(`HTTP ${id === '10' ? 'Donor' : 'Hospital'} status cycle rejects old cookies, preserves legacy approval conflicts and allows fresh login`, async t => {
  const h = await http(t); const admin = await h.login('1');
    const old = await h.login(id);
    const suspended = await h.request('/admin/accounts/' + id, { ...admin, method: 'PATCH', body: suspend, headers: { 'X-Actor-Id': '30' } });
    assert.equal(suspended.status, 200); assert.equal((await suspended.json()).accountStatus, 'SUSPENDED');
    assert.equal((await h.request('/auth/me', old)).status, 401);
    assert.equal((await h.login(id)).response.status, 401);
    const stale = await h.request('/admin/accounts/' + id, { ...admin, method: 'PATCH', body: approve });
    assert.equal(stale.status, 409); assert.equal((await stale.json()).error.code, 'ACCOUNT_APPROVAL_CONFLICT');
    assert.equal((await h.request('/admin/accounts/' + id, { ...admin, method: 'PATCH', body: reactivate })).status, 200);
    assert.equal((await h.request('/auth/me', old)).status, 401);
    const fresh = await h.login(id); assert.equal((await h.request('/auth/me', fresh)).status, 200);
  assert.equal(h.database.audits.length, 2); assert.ok(h.database.audits.every(event => event[0] === '1'));
});
test('HTTP transition guards reject forged actors, CSRF/origin errors, invalid bodies/IDs/queries and forbidden targets', async t => {
  const h = await http(t); const admin = await h.login('1'); const donor = await h.login('10');
  for (const input of [suspend, reactivate]) {
    assert.equal((await h.request('/admin/accounts/20', { method: 'PATCH', body: input })).status, 401);
    assert.equal((await h.request('/admin/accounts/20', { ...donor, method: 'PATCH', body: input })).status, 403);
    assert.equal((await h.request('/admin/accounts/20', { ...admin, csrf: 'bad', method: 'PATCH', body: input })).status, 403);
    assert.equal((await h.request('/admin/accounts/20', { ...admin, origin: 'https://invalid.example', method: 'PATCH', body: input })).status, 403);
    for (const body of [{ ...input, actorAccountId: '30' }, { ...input, confirmedBloodGroupId: '1' }, { ...input, reason: 'free text' }, { ...input, accountStatus: 'PENDING' }]) {
      assert.equal((await h.request('/admin/accounts/20', { ...admin, method: 'PATCH', body })).status, 400);
    }
    assert.equal((await h.request('/admin/accounts/01', { ...admin, method: 'PATCH', body: input })).status, 400);
    assert.equal((await h.request('/admin/accounts/20?role=ADMIN', { ...admin, method: 'PATCH', body: input })).status, 400);
    assert.equal((await h.request('/admin/accounts/1', { ...admin, method: 'PATCH', body: input })).status, 403);
    assert.equal((await h.request('/admin/accounts/30', { ...admin, method: 'PATCH', body: input })).status, 403);
    assert.equal((await h.request('/admin/accounts/404', { ...admin, method: 'PATCH', body: input })).status, 404);
  }
  assert.equal(h.database.audits.length, 0);
  h.database.accounts.get('1').accountStatus = 'SUSPENDED';
  assert.equal((await h.request('/admin/accounts/20', { ...admin, method: 'PATCH', body: suspend })).status, 401);
});
