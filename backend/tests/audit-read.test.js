import assert from 'node:assert/strict';
import { test } from 'node:test';
import express from 'express';
import { createAuditReadRepository } from '../src/modules/audit/readRepository.js';
import { createAuditReadService } from '../src/modules/audit/readService.js';
import { createAuditReadRouter } from '../src/modules/audit/readRouter.js';
import { validateAuditQuery } from '../src/modules/audit/readValidation.js';

const record = { eventId: '91', actorAccountId: '7', actionCode: 'ACCOUNT_APPROVED', subjectType: 'Account', subjectId: '80',
  occurredAt: '2026-10-28 14:25:00', reasonCode: 'REGISTRATION_REVIEWED', changeSummary: 'PENDING -> ACTIVE' };

test('audit query validates exact filters, canonical BIGINT IDs, inclusive dates and bounded pages', () => {
  assert.deepEqual(validateAuditQuery({ actorAccountId: '7', actionCode: 'ACCOUNT_APPROVED', subjectType: 'Account', subjectId: '80', from: '2026-10-01', to: '2026-10-31', page: '2', pageSize: '100' }),
    { actorAccountId: '7', subjectId: '80', actionCode: 'ACCOUNT_APPROVED', subjectType: 'Account', from: '2026-10-01', to: '2026-10-31', page: 2, pageSize: 100 });
  for (const query of [{ identity: '7' }, { actorAccountId: '01' }, { actorAccountId: '18446744073709551616' }, { actionCode: 'bad action' },
    { subjectType: 'account' }, { from: '2026-02-29' }, { from: '2026-10-02', to: '2026-10-01' }, { page: '0' }, { pageSize: '101' }]) {
    assert.throws(() => validateAuditQuery(query));
  }
  assert.deepEqual(validateAuditQuery({}), { page: 1, pageSize: 25 });
});

test('audit repository requires the existing table and indexes and performs parameterized deterministic paging', async () => {
  const calls = [];
  const db = { async execute(sql, values = []) {
    calls.push({ sql, values });
    if (sql.includes('information_schema.TABLES')) return [[{ name: 'AuditEvent' }]];
    if (sql.includes('information_schema.STATISTICS')) return [[{ name: 'PRIMARY' }, { name: 'ix_audit_event_actor' }, { name: 'ix_audit_event_subject' }]];
    if (sql.includes('COUNT(*)')) return [[{ total: 1 }]];
    return [[record]];
  } };
  const repository = createAuditReadRepository(db);
  await repository.assertStorageReady();
  const result = await repository.list(validateAuditQuery({ actorAccountId: '7', actionCode: 'ACCOUNT_APPROVED', subjectType: 'Account', subjectId: '80', from: '2026-10-01', to: '2026-10-31', page: '2', pageSize: '50' }));
  assert.equal(result.pagination.total, 1);
  const [count, rows] = calls.slice(-2);
  assert.deepEqual(count.values, ['7', 'ACCOUNT_APPROVED', 'Account', '80', '2026-10-01 00:00:00', '2026-10-31 00:00:00']);
  assert.match(rows.sql, /ORDER BY occurred_at DESC, audit_event_id DESC LIMIT \? OFFSET \?/u);
  assert.deepEqual(rows.values, [...count.values, 50, 50]);
  assert.match(rows.sql, /reason_code AS reasonCode, change_summary AS changeSummary/u);
  assert.doesNotMatch(rows.sql, /password|session|token|email/u);
});

test('service maps only safe AuditEvent columns, formats project time and handles empty results', async () => {
  let output = { rows: [{ ...record, passwordHash: 'SECRET', operationId: 'unneeded' }], pagination: { page: 1, pageSize: 25, total: 1 } };
  const service = createAuditReadService({ assertStorageReady: async () => {}, list: async () => output });
  const events = await service.list({});
  assert.deepEqual(events.events[0], { eventId: '91', actorAccountId: '7', actionCode: 'ACCOUNT_APPROVED', subjectType: 'Account', subjectId: '80',
    occurredAt: '2026-10-28T14:25:00+05:30', reasonCode: 'REGISTRATION_REVIEWED', changeSummary: 'PENDING -> ACTIVE' });
  output = { rows: [], pagination: { page: 1, pageSize: 25, total: 0 } };
  assert.deepEqual((await service.list({})).events, []);
  await assert.rejects(() => createAuditReadService({ assertStorageReady: async () => { throw new Error('driver'); } }).assertStorageReady(), { code: 'AUDIT_READ_UNAVAILABLE', status: 503 });
});

test('AuditEvent HTTP route is ACTIVE Admin only, validates before storage, returns no-store and fails closed', async (t) => {
  let unavailable = false;
  const service = { async assertStorageReady() { if (unavailable) throw Object.assign(new Error(), { status: 503, code: 'AUDIT_READ_UNAVAILABLE' }); },
    async list(query) { return { events: [], pagination: { page: query.page, pageSize: query.pageSize, total: 0 } }; } };
  const authService = { async authorizeSession(sid, principal) {
    if (sid === 'expired') throw Object.assign(new Error(), { status: 401, code: 'ACCOUNT_UNAVAILABLE' });
    return { accountId: principal.accountId, role: principal.role, accountStatus: principal.accountStatus };
  } };
  const app = express();
  app.use((req, _res, next) => {
    const role = req.headers['x-test-role'];
    req.sessionID = role ? (role === 'EXPIRED' ? 'expired' : 'sid') : '';
    req.session = role ? { auth: { accountId: '7', role: role === 'EXPIRED' ? 'ADMIN' : role, accountStatus: role === 'SUSPENDED' ? 'SUSPENDED' : 'ACTIVE' }, destroy(callback) { callback(); } } : null;
    next();
  });
  app.use('/api', createAuditReadRouter({ authService, service }));
  app.use((error, _req, res, _next) => res.status(error.status || 500).json({ error: { code: error.code } }));
  const server = app.listen(0, '127.0.0.1');
  t.after(() => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));
  await new Promise((resolve) => server.once('listening', resolve));
  const url = `http://127.0.0.1:${server.address().port}/api/admin/audit-events`;
  assert.equal((await fetch(url)).status, 401);
  for (const role of ['HOSPITAL', 'DONOR', 'SUSPENDED', 'EXPIRED']) assert.ok([401, 403].includes((await fetch(url, { headers: { 'X-Test-Role': role } })).status));
  const admin = await fetch(url, { headers: { 'X-Test-Role': 'ADMIN' } });
  assert.equal(admin.status, 200); assert.equal(admin.headers.get('cache-control'), 'no-store');
  const invalid = await fetch(`${url}?search=secret`, { headers: { 'X-Test-Role': 'ADMIN' } });
  assert.equal(invalid.status, 400);
  unavailable = true;
  const missing = await fetch(url, { headers: { 'X-Test-Role': 'ADMIN' } });
  assert.equal(missing.status, 503); assert.equal((await missing.json()).error.code, 'AUDIT_READ_UNAVAILABLE');
});
