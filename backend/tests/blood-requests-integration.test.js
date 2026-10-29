import assert from 'node:assert/strict';
import { test } from 'node:test';
import express from 'express';
import { createApp } from '../src/app.js';
import { createAuthRuntime } from '../src/modules/auth/router.js';
import { createAuthService } from '../src/modules/auth/service.js';
import { createAuthRepository } from '../src/modules/auth/repository.js';
import { environment } from '../src/config/environment.js';
import { createBloodRequestRouter } from '../src/modules/blood-requests/router.js';
import { createBloodRequestRepository } from '../src/modules/blood-requests/repository.js';
import { createBloodRequestService } from '../src/modules/blood-requests/service.js';
import { createRequestContextAdapter } from '../src/modules/blood-requests/context.js';
import { serializeRequestTimestamp } from '../src/modules/blood-requests/timestamps.js';
import { createAuditWriter } from '../src/modules/audit/writer.js';
import { sessionAuthorization } from '../src/modules/accounts/sessionAuthorization.js';
import { HttpError } from '../src/utils/httpError.js';
import { hospitalDatabase, testPassword } from './helpers/hospital-database.mjs';

async function start(t, { readiness = { storageInstalled: true, readProjectionApproved: true, creationContractsApproved: true }, fail = false } = {}) {
  const database = hospitalDatabase();
  const calls = [];
  const service = {
    async listHospitalRequests(actor, query) { calls.push({ actor, query }); if (fail) throw new Error('PRIVATE SQL password_hash'); return { requests: [], pagination: { page: Number(query.page || 1), pageSize: 20, total: 0 } }; },
    async listAdminRequests(actor, query) { return this.listHospitalRequests(actor, query); },
    async getHospitalRequest(actor, id) { calls.push({ actor, id }); throw new HttpError(404, 'REQUEST_NOT_FOUND', 'The blood request was not found.'); },
    async getAdminRequestRecord(actor, id) { return this.getHospitalRequest(actor, id); },
    async createHospitalRequest(actor, body) { calls.push({ actor, body }); return { requestId: '91', requestStatus: 'SUBMITTED', outstandingQuantity: body.quantityRequested }; },
  };
  const router = createBloodRequestRouter({ service, readiness, frontendUrl: environment.frontendUrl,
    authService: createAuthService({ repository: createAuthRepository(database) }) });
  const server = createApp({ authRuntime: createAuthRuntime({ databasePool: database,
    env: { SESSION_SECRET: 'isolated-request-test-secret-at-least-32-bytes', SESSION_TTL_MINUTES: '5' } }), hospitalRouter: router, bloodRequestRouter: express.Router(),
    verifyDatabase: async () => { throw new Error('No live DB'); } }).listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); });
  const request = (path, { cookie, csrf, body, method = 'GET', origin = environment.frontendUrl } = {}) => fetch(`http://127.0.0.1:${server.address().port}/api${path}`, {
    method, headers: { Origin: origin, ...(cookie ? { Cookie: cookie } : {}), ...(csrf ? { 'X-CSRF-Token': csrf } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}),
  });
  async function token(cookie) {
    const res = await request('/auth/csrf', { cookie });
    return { cookie: res.headers.get('set-cookie')?.split(';')[0] || cookie, csrf: (await res.json()).csrfToken };
  }
  async function login(id = '9007199254740993') {
    const anonymous = await token();
    const res = await request('/auth/login', { ...anonymous, method: 'POST', body: { email: `${id}@example.test`, password: testPassword } });
    assert.equal(res.status, 200);
    return token(res.headers.get('set-cookie').split(';')[0]);
  }
  return { request, login, calls, database };
}
async function error(response, status, code) {
  assert.equal(response.status, status);
  if (code !== 'ORIGIN_NOT_ALLOWED') assert.equal(response.headers.get('cache-control'), 'no-store');
  const body = await response.json();
  assert.equal(body.error.code, code);
  assert.doesNotMatch(JSON.stringify(body), /PRIVATE|password_hash|stack|SELECT/u);
}
test('request adapters use real shared sessions, ACTIVE role guards and no-store', async (t) => {
  const { request, login, calls, database } = await start(t);
  await error(await request('/hospitals/me/requests', { cookie: 'bdcs.sid=forged' }), 401, 'AUTHENTICATION_REQUIRED');
  for (const id of ['12', '21', '31']) {
    const session = await login(id);
    await error(await request('/hospitals/me/requests', session), 403, id === '12' ? 'ACTIVE_ACCOUNT_REQUIRED' : 'FORBIDDEN');
  }
  const session = await login();
  const response = await request('/hospitals/me/requests?page=2&priority=URGENT', session);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual((await response.json()).pagination, { page: 2, pageSize: 20, total: 0 });
  assert.equal(calls.at(-1).actor.accountId, '9007199254740993');
  assert.equal(typeof calls.at(-1).actor.session.sessionId, 'string');
  database.accounts.get('9007199254740993').accountStatus = 'SUSPENDED';
  await error(await request('/hospitals/me/requests', session), 401, 'ACCOUNT_UNAVAILABLE');
  await error(await request('/hospitals/me/requests', session), 401, 'AUTHENTICATION_REQUIRED');
});
test('Admin adapters deny other roles and validate structured query/path data', async (t) => {
  const { request, login, calls } = await start(t);
  const hospital = await login();
  await error(await request('/admin/requests', hospital), 403, 'FORBIDDEN');
  const admin = await login('31');
  assert.equal((await request('/admin/requests?hospitalId=12', admin)).status, 200);
  for (const path of ['/admin/requests?q=x', '/admin/requests?page=0', '/admin/requests?priority=NORMAL&priority=URGENT', '/admin/requests?hospitalId=1%20OR%201=1', '/admin/requests/01', '/admin/requests/1?actorAccountId=12']) {
    await error(await request(path, admin), 400, 'VALIDATION_ERROR');
  }
  await error(await request('/hospitals/me/requests/90', hospital), 404, 'REQUEST_NOT_FOUND');
  assert.equal(calls.at(-1).actor.accountId, '9007199254740993');
});
test('create adapter validates exact body and Origin/CSRF before passing trusted principal', async (t) => {
  const { request, login, calls } = await start(t);
  const session = await login();
  const body = { recipientGroupId: '4', quantityRequested: 3, priority: 'NORMAL', neededBy: '2035-10-28T10:00:00+05:30' };
  await error(await request('/hospitals/me/requests', { cookie: session.cookie, method: 'POST', body }), 403, 'CSRF_TOKEN_INVALID');
  await error(await request('/hospitals/me/requests', { ...session, method: 'POST', body, origin: 'https://untrusted.invalid' }), 403, 'ORIGIN_NOT_ALLOWED');
  await error(await request('/hospitals/me/requests', { ...session, method: 'POST', body: { ...body, hospitalId: '12' } }), 400, 'VALIDATION_ERROR');
  const response = await request('/hospitals/me/requests', { ...session, method: 'POST', body });
  assert.equal(response.status, 201);
  assert.equal((await response.json()).requestStatus, 'SUBMITTED');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].actor.accountId, '9007199254740993');
});
test('driver errors are safe and default readiness leaves every request route unregistered', async (t) => {
  const broken = await start(t, { fail: true });
  await error(await broken.request('/hospitals/me/requests', await broken.login()), 503, 'DATABASE_UNAVAILABLE');
  const closed = await start(t, { readiness: {} });
  for (const path of ['/hospitals/me/requests', '/admin/requests', '/admin/requests/90']) assert.equal((await closed.request(path)).status, 404);
  assert.equal(createBloodRequestRouter().stack.length, 0);
  // Default application has no request router, even with authenticated sessions.
  const unmounted = await start(t, { readiness: { storageInstalled: true } });
  assert.equal((await unmounted.request('/hospitals/me/requests', await unmounted.login())).status, 404);
  for (const path of ['/hospitals/me/requests/90/cancellation', '/admin/requests/90/review', '/admin/requests/90/priority']) assert.equal((await unmounted.request(path, { method: 'POST', body: {} })).status, 404);
});

function transactionFixture(fail = '') {
  const calls = []; let resets = 0;
  const connection = {
    async execute(sql, values) {
      calls.push({ sql, values });
      if (sql.startsWith('SET') && !values) { resets++; if (fail === `reset${resets}` || (fail === 'work-reset' && resets === 2)) throw new Error('PRIVATE'); }
      if (sql.includes('FROM Account')) return [[{ accountId: '31', role: 'ADMIN', accountStatus: 'ACTIVE' }]];
      if (sql.includes('FROM app_session')) return [[{ session_data: JSON.stringify({ auth: { accountId: '31', role: 'ADMIN', accountStatus: 'ACTIVE' } }), revoked_at: null, expires_at: Date.now() + 60000 }]];
      if (sql.includes('FROM HospitalRequest')) return [[{ requestId: '90', requestStatus: 'UNDER_REVIEW' }]];
      if (sql.startsWith('UPDATE') && fail === 'update') throw new Error('PRIVATE');
      if (sql.startsWith('INSERT INTO AuditEvent') && fail === 'audit') throw new Error('PRIVATE');
      return [{ affectedRows: 1, insertId: '501' }];
    },
    async beginTransaction() { calls.push({ sql: 'begin' }); },
    async commit() { calls.push({ sql: 'commit' }); if (fail === 'commit') throw new Error('PRIVATE'); },
    async rollback() { calls.push({ sql: 'rollback' }); if (fail === 'rollback') throw new Error('PRIVATE'); },
    release() { calls.push({ sql: 'release' }); }, destroy() { calls.push({ sql: 'destroy' }); },
  };
  const repository = createBloodRequestRepository({ execute: async () => { throw new Error('Escaped connection'); }, getConnection: async () => connection },
    { contextAdapter: createRequestContextAdapter({ enabled: true, reasonCodes: ['TEST_REASON'] }) });
  return { repository, calls, connection };
}
test('candidate context is opt-in, parameterized and has no system-actor bypass', async () => {
  const calls = []; const connection = { execute: async (...args) => calls.push(args) };
  await assert.rejects(createRequestContextAdapter().clear(connection), { code: 'REQUEST_FEATURE_NOT_READY' });
  const adapter = createRequestContextAdapter({ enabled: true, reasonCodes: ['TEST_REASON'] });
  await adapter.clear(connection);
  await adapter.set(connection, { actorAccountId: '9007199254740993', reasonCode: 'TEST_REASON' });
  assert.deepEqual(calls[1][1], ['9007199254740993', 'TEST_REASON']);
  assert.match(calls[1][0], /@request_system_operation_id = NULL/u);
  for (const context of [{ actorAccountId: null }, { actorAccountId: '01' }, { actorAccountId: '31', reasonCode: 'patient free text' }]) await assert.rejects(adapter.set(connection, context));
});
test('context is reset on checkout and after commit/rollback; uncertain connections are destroyed', async () => {
  for (const fail of ['', 'work', 'reset1', 'reset2', 'rollback', 'commit', 'work-reset']) {
    const { repository, calls } = transactionFixture(fail);
    const task = repository.withTransaction(async () => { if (['work', 'rollback', 'work-reset'].includes(fail)) throw new HttpError(409, 'TEST_CONFLICT', 'Safe'); return 'ok'; });
    if (!fail) assert.equal(await task, 'ok'); else await assert.rejects(task, ['work', 'work-reset', 'rollback'].includes(fail) ? { code: 'TEST_CONFLICT' } : undefined);
    const sql = calls.map((call) => call.sql);
    assert.match(sql[0], /^SET/u);
    if (['reset1', 'reset2', 'rollback', 'commit', 'work-reset'].includes(fail)) { assert.equal(sql.at(-1), 'destroy'); assert.ok(!sql.includes('release')); }
    else { assert.equal(sql.at(-1), 'release'); assert.match(sql.at(-2), /^SET/u); }
    if (fail === 'work') assert.ok(sql.indexOf('rollback') < sql.findLastIndex((value) => value.startsWith('SET')));
  }
});
test('internal review locks Account/session/request then uses trigger context and the same connection for audit', async () => {
  const actor = { accountId: '31', role: 'ADMIN', accountStatus: 'ACTIVE' };
  const principal = { accountId: '31', session: sessionAuthorization('test-session', actor) };
  for (const fail of ['', 'update', 'audit']) {
    const { repository, calls } = transactionFixture(fail);
    const service = createBloodRequestService({ repository,
      auditWriter: createAuditWriter({ allowedActionCodes: ['TEST_REQUEST_STATUS'] }),
      statusIntegration: { enabled: true, actionCode: 'TEST_REQUEST_STATUS', reasonCodes: ['TEST_REASON'], authorizeTransition: async () => true } });
    const task = service.reviewRequest(principal, '90', { decision: 'REJECTED', reasonCode: 'TEST_REASON' });
    if (!fail) assert.deepEqual(await task, { requestId: '90', requestStatus: 'REJECTED' }); else await assert.rejects(task, { code: 'DATABASE_UNAVAILABLE' });
    const statements = calls.map(({ sql }) => sql);
    assert.ok(statements.findIndex((sql) => sql.includes('FROM Account')) < statements.findIndex((sql) => sql.includes('FROM app_session')));
    assert.ok(statements.findIndex((sql) => sql.includes('FROM app_session')) < statements.findIndex((sql) => sql.includes('FROM HospitalRequest')));
    assert.equal(statements.filter((sql) => sql.startsWith('UPDATE HospitalRequest')).length, 1);
    assert.equal(statements.some((sql) => /INSERT INTO RequestStatusHistory/u.test(sql)), false);
    assert.ok(statements.includes(fail ? 'rollback' : 'commit'));
    assert.deepEqual(calls.find(({ sql }) => sql.startsWith('UPDATE')).values, ['REJECTED', 'TEST_REASON', '90', 'UNDER_REVIEW']);
    if (fail !== 'update') assert.equal(calls.find(({ sql }) => sql.startsWith('INSERT INTO AuditEvent')).values[1], 'TEST_REQUEST_STATUS');
  }
  await assert.rejects(createBloodRequestService({ repository: transactionFixture().repository }).reviewRequest(principal, '90', { decision: 'REJECTED' }), { code: 'REQUEST_FEATURE_NOT_READY' });
});
test('candidate timestamp serializer preserves instants and rejects ambiguous or impossible dates', () => {
  assert.equal(serializeRequestTimestamp('2035-10-28 10:00:00'), '2035-10-28T10:00:00+05:30');
  assert.equal(serializeRequestTimestamp(new Date('2035-10-28T04:30:00Z')), '2035-10-28T10:00:00+05:30');
  assert.equal(serializeRequestTimestamp(null), null);
  for (const value of ['2026-02-30 12:00:00', '2035-10-28', new Date('invalid')]) assert.throws(() => serializeRequestTimestamp(value));
});

test('optional history reads stay ownership-scoped and serialize only allowlisted recorded values', async () => {
  const calls = [];
  const repository = createBloodRequestRepository({ execute: async (sql, values) => {
    calls.push({ sql, values });
    return [[{ oldStatus: null, newStatus: 'SUBMITTED', changedAt: '2026-10-27 10:00:00', actorAccountId: '12', reasonCode: null }]];
  } });
  await repository.findStatusHistory('90', { hospitalAccountId: '12' });
  assert.deepEqual(calls[0].values, ['90', '12']);
  assert.match(calls[0].sql, /r\.hospital_account_id = \?/u);
  assert.match(calls[0].sql, /ORDER BY s\.changed_at ASC, s\.request_status_history_id ASC/u);
  assert.match(calls[0].sql, /s\.reason_code AS reasonCode/u);
  assert.match(calls[0].sql, /CAST\(s\.changed_by_account_id AS CHAR\) AS actorAccountId/u);
  assert.doesNotMatch(calls[0].sql, /safe_note|password|session/u);
  const actor = { accountId: '12', role: 'HOSPITAL', accountStatus: 'ACTIVE' };
  const fake = {
    findAccountById: async () => actor, findHospitalByAccountId: async () => ({ hospitalId: '12' }),
    findHospitalRequest: async () => ({ requestId: '90', recipientGroupId: '4', recipientBloodGroupCode: 'A+', recipientBloodGroupName: 'A Positive', quantityRequested: 3,
      neededBy: '2035-10-28 12:00:00', createdAt: '2026-10-27 10:00:00', updatedAt: '2026-10-27 10:00:00', priority: 'NORMAL', requestStatus: 'SUBMITTED' }),
    findStatusHistory: async (id, scope) => { assert.deepEqual([id, scope], ['90', { hospitalAccountId: '12' }]); return [{ oldStatus: null, newStatus: 'SUBMITTED', changedAt: '2026-10-27 10:00:00', safeNote: 'PRIVATE' }]; },
  };
  const service = createBloodRequestService({ repository: fake, historyEnabled: true, timestampSerializer: serializeRequestTimestamp });
  const detail = await service.getHospitalRequest(actor, '90');
  assert.equal(detail.neededBy, '2035-10-28T12:00:00+05:30');
  assert.deepEqual(detail.requestStatusHistory, [{ oldStatus: null, newStatus: 'SUBMITTED', changedAt: '2026-10-27T10:00:00+05:30' }]);
  assert.equal(detail.allocatedQuantity, undefined);

  const adminService = createBloodRequestService({ repository: { ...fake, findAccountById: async () => ({ accountId: '31', role: 'ADMIN', accountStatus: 'ACTIVE' }), findAdminRequest: async () => ({ requestId: '90', recipientGroupId: '4', recipientBloodGroupCode: 'A+', recipientBloodGroupName: 'A Positive', quantityRequested: 3, neededBy: '2035-10-28 12:00:00', createdAt: '2026-10-27 10:00:00', updatedAt: '2026-10-27 10:00:00', priority: 'NORMAL', requestStatus: 'SUBMITTED', hospitalId: '12', organizationName: 'Example Hospital' }),
    findStatusHistory: async () => [{ oldStatus: null, newStatus: 'SUBMITTED', changedAt: '2026-10-27 10:00:00', actorAccountId: '12', reasonCode: null }] },
    historyEnabled: true, timestampSerializer: serializeRequestTimestamp });
  const adminDetail = await adminService.getAdminRequestRecord({ accountId: '31' }, '90');
  assert.deepEqual(adminDetail.requestStatusHistory, [{ oldStatus: null, newStatus: 'SUBMITTED', changedAt: '2026-10-27T10:00:00+05:30', actorAccountId: '12', reasonCode: null }]);
});
