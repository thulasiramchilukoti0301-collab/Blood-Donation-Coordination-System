import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createAuthService } from '../src/modules/auth/service.js';
import { validatePasswordChange } from '../src/modules/auth/passwordChange.js';
import { sessionAuthorization } from '../src/modules/accounts/sessionAuthorization.js';
import express from 'express';
import session from 'express-session';
import { createAuthRouter } from '../src/modules/auth/router.js';
import { errorHandler } from '../src/middleware/errorHandler.js';
import { environment } from '../src/config/environment.js';

const principal = { accountId: '41', role: 'DONOR', accountStatus: 'PENDING' };
const body = { currentPassword: 'previous7!', newPassword: 'replacement8!' };

function harness({ role = 'DONOR', status = 'PENDING', compare = true, failAudit = false,
  failRevocation = false, expireDuringCompare = false, revokeDuringCompare = false, updateResult = 1 } = {}) {
  const account = { ...principal, role, accountStatus: status, email: 'fixture@example.test', passwordHash: 'old-hash' };
  const sids = new Map([['sid-one', { session_data: JSON.stringify({ auth: account }), expires_at: Date.now() + 60000, revoked_at: null }],
    ['sid-two', { session_data: JSON.stringify({ auth: account }), expires_at: Date.now() + 60000, revoked_at: null }]]);
  const events = [];
  const repository = {
    async withLockedAccount(id, work) {
      events.push('account-lock'); assert.equal(id, '41');
      const oldHash = account.passwordHash; const oldSids = structuredClone([...sids]);
      const connection = { execute: async (_sql, params) => { events.push('sid-lock'); return [[sids.get(params[0]) ?? null]]; } };
      try { return await work(account, connection); }
      catch (error) { account.passwordHash = oldHash; sids.clear(); oldSids.forEach(([sid, row]) => sids.set(sid, row)); throw error; }
    },
    async updatePassword(_connection, id, oldHash, replacementHash) {
      events.push('password-update'); assert.equal(id, '41'); assert.equal(oldHash, account.passwordHash);
      if (updateResult !== 1) return updateResult;
      account.passwordHash = replacementHash; return 1;
    },
  };
  const passwordHasher = {
    async hash(value, cost) { assert.equal(value, body.newPassword); assert.equal(cost, 12); return 'replacement-hash'; },
    async compare(value, hash) { assert.equal(value, body.currentPassword); assert.equal(hash, 'old-hash');
      if (expireDuringCompare) sids.get('sid-one').expires_at = 0;
      if (revokeDuringCompare) { sids.get('sid-one').revoked_at = Date.now(); sids.get('sid-one').session_data = null; }
      return compare; },
  };
  const sessionStore = { async revokeAccountSessions(id, connection) {
    events.push('revoke'); assert.equal(id, '41'); assert.ok(connection.execute);
    if (failRevocation) throw new Error('private session driver failure');
    for (const row of sids.values()) { row.revoked_at = Date.now(); row.session_data = null; }
  } };
  const auditWriter = { async write(connection, event) { events.push('audit'); assert.ok(connection.execute);
    assert.equal(event.actionCode, 'ACCOUNT_PASSWORD_CHANGED'); assert.equal(event.reasonCode, 'SELF_SERVICE_PASSWORD_CHANGE');
    assert.equal(JSON.stringify(event).includes(body.currentPassword), false);
    assert.equal(JSON.stringify(event).includes(body.newPassword), false);
    if (failAudit) throw new Error('private audit driver failure'); } };
  const service = createAuthService({ repository, passwordHasher, sessionStore, auditWriter,
    operationId: () => '00000000-0000-4000-8000-000000000001' });
  return { service, account, sids, events, authorization: sessionAuthorization('sid-one', { ...account, accountStatus: status === 'SUSPENDED' ? 'ACTIVE' : status }) };
}

test('password input has exact fields and reuses registration policy without trimming', () => {
  assert.deepEqual(validatePasswordChange(body), body);
  for (const value of [{ ...body, role: 'ADMIN' }, { ...body, currentPassword: '' },
    { ...body, currentPassword: 'a'.repeat(73) }, { ...body, newPassword: 'short1!' },
    { ...body, newPassword: 'no-number!' }, { ...body, newPassword: 'missing7' }]) {
    assert.throws(() => validatePasswordChange(value));
  }
});

test('PENDING Donor changes password, revokes both SIDs and writes one safe audit in the transaction', async () => {
  const f = harness();
  assert.deepEqual(await f.service.changePassword('41', body, f.authorization), { success: true, loginRequired: true });
  assert.equal(f.account.passwordHash, 'replacement-hash');
  assert.deepEqual(f.events, ['account-lock', 'sid-lock', 'sid-lock', 'password-update', 'revoke', 'audit']);
  for (const row of f.sids.values()) { assert.equal(row.session_data, null); assert.ok(row.revoked_at); }
});

test('wrong current password and post-bcrypt expired/revoked SID refuse updates and audit', async () => {
  for (const options of [{ compare: false }, { expireDuringCompare: true }, { revokeDuringCompare: true }]) {
    const f = harness(options);
    await assert.rejects(f.service.changePassword('41', body, f.authorization), error =>
      error.code === (options.compare === false ? 'INVALID_CURRENT_PASSWORD' : 'ACCOUNT_UNAVAILABLE'));
    assert.equal(f.account.passwordHash, 'old-hash'); assert.equal(f.events.includes('password-update'), false);
    assert.equal(f.events.includes('audit'), false);
  }
});

test('ACTIVE Admin/Hospital may change own password; conditional hash conflict never audits', async () => {
  for (const role of ['ADMIN', 'HOSPITAL']) {
    const f = harness({ role, status: 'ACTIVE' });
    assert.equal((await f.service.changePassword('41', body, f.authorization)).loginRequired, true);
  }
  const conflict = harness({ updateResult: 0 });
  await assert.rejects(conflict.service.changePassword('41', body, conflict.authorization), error => error.code === 'PASSWORD_CHANGE_CONFLICT');
  assert.equal(conflict.events.includes('audit'), false);
});

test('suspended account is refused; revocation or audit failure rolls back password and all SIDs', async () => {
  const suspended = harness({ status: 'SUSPENDED' });
  await assert.rejects(suspended.service.changePassword('41', body, suspended.authorization), error => error.code === 'ACCOUNT_UNAVAILABLE');
  for (const options of [{ failRevocation: true }, { failAudit: true }]) {
    const f = harness(options);
    await assert.rejects(f.service.changePassword('41', body, f.authorization), error => error.code === 'DATABASE_UNAVAILABLE');
    assert.equal(f.account.passwordHash, 'old-hash');
    for (const row of f.sids.values()) { assert.notEqual(row.session_data, null); assert.equal(row.revoked_at, null); }
  }
});

test('password HTTP route requires authentication, Origin and CSRF, then clears the current cookie', async t => {
  const changes = [];
  const authService = {
    async authorizeSession(_sid, claimed) { return claimed; },
    async changePassword(id, input, authorization) { changes.push([id, input, authorization.principal]);
      return { success: true, loginRequired: true }; },
  };
  const app = express(); app.use(express.json());
  app.use(session({ secret: 'fixture-session-secret-value-long-enough', resave: false, saveUninitialized: true }));
  app.post('/fixture-login', (req, res) => { req.session.auth = { accountId: '41', role: 'DONOR', accountStatus: 'PENDING' };
    req.session.csrfToken = 'a'.repeat(64); res.json({ success: true }); });
  app.use('/api', createAuthRouter({ authService, frontendUrl: environment.frontendUrl, cookieSecure: false }));
  app.use(errorHandler);
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const cookie = (await fetch(`${base}/fixture-login`, { method: 'POST' })).headers.get('set-cookie').split(';', 1)[0];
  const request = (headers = {}, sent = body) => fetch(`${base}/api/auth/password`, { method: 'POST',
    headers: { Cookie: cookie, 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(sent) });
  assert.equal((await fetch(`${base}/api/auth/password`, { method: 'POST' })).status, 401);
  assert.equal((await request({ Origin: environment.frontendUrl })).status, 403);
  assert.equal((await request({ Origin: 'http://untrusted.example.test', 'X-CSRF-Token': 'a'.repeat(64) })).status, 403);
  assert.equal(changes.length, 0);
  const changed = await request({ Origin: environment.frontendUrl, 'X-CSRF-Token': 'a'.repeat(64) });
  assert.equal(changed.status, 200); assert.deepEqual(await changed.json(), { success: true, loginRequired: true });
  assert.match(changed.headers.get('set-cookie'), /bdcs\.sid=;/u);
  assert.equal(changes[0][0], '41'); assert.deepEqual(changes[0][1], body);
});
