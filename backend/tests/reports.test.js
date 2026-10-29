import assert from 'node:assert/strict';
import { test } from 'node:test';
import express from 'express';
import { validateReportQuery } from '../src/modules/reports/validation.js';
import { createReportsRepository } from '../src/modules/reports/repository.js';
import { createReportsRouter } from '../src/modules/reports/router.js';

test('report date filters validate real calendar dates, intervals, bounds and exact keys', () => {
  assert.deepEqual(validateReportQuery({ from: '2026-01-01', to: '2026-12-31', interval: 'MONTH' }), { from: '2026-01-01', to: '2026-12-31', interval: 'MONTH' });
  for (const query of [{ from: '2026-02-29' }, { from: '2026-10-02', to: '2026-10-01' }, { from: '2025-01-01', to: '2026-01-03' }, { interval: 'YEAR' }, { hospitalId: '1' }]) assert.throws(() => validateReportQuery(query));
  assert.deepEqual(validateReportQuery({}), { interval: 'DAY' });
});

test('reports use parameterized filters, whitelisted trend SQL, account scoped hospital queries and safe failures', async () => {
  const calls = [];
  const db = { async execute(sql, values = []) { calls.push({ sql, values }); return [[]]; } };
  const repo = createReportsRepository(db);
  await repo.donationReport(validateReportQuery({ from: '2026-10-01', to: '2026-10-31', interval: 'WEEK' }));
  assert.match(calls[0].sql, /DATE_FORMAT\(collected_at, '%x-W%v'\)/u);
  assert.deepEqual(calls[0].values, ['2026-10-01 00:00:00', '2026-10-31 00:00:00']);
  calls.length = 0;
  await repo.hospitalDashboard('739');
  assert.equal(calls.length, 3);
  assert.ok(calls.every((call) => call.values[0] === '739'));
  assert.ok(calls.filter((call) => call.sql.includes('HospitalRequest')).every((call) => /hospital_account_id = \?/u.test(call.sql)));
  assert.ok(calls.every((call) => !/password_hash|patient|email/u.test(call.sql)));
  const broken = createReportsRepository({ async execute() { throw new Error('missing optional/core table'); } });
  await assert.rejects(() => broken.inventoryReport(), { status: 503, code: 'REPORTS_UNAVAILABLE' });
});

test('dashboard APIs enforce stored role/status, no-store and reject client hospital selectors', async (t) => {
  const authService = { async authorizeSession(_sid, principal) { return { ...principal, accountId: principal.accountId }; } };
  const service = { async adminDashboard() { return { counts: {}, inventory: [], requests: [], donations: [], donationTrend: [] }; },
    async hospitalDashboard(accountId) { return { accountId, profile: null, requests: [], recent: [] }; },
    async inventoryReport() { return []; }, async donationReport() { return []; }, async requestReport() { return {}; } };
  const app = express();
  app.use((req, _res, next) => {
    const role = req.headers['x-test-role']; const status = req.headers['x-test-status'] || 'ACTIVE';
    req.sessionID = role ? 'sid' : ''; req.session = role ? { auth: { accountId: req.headers['x-test-account'] || '9', role, accountStatus: status }, destroy(callback) { callback(); } } : null;
    next();
  });
  app.use('/api', createReportsRouter({ authService, service }));
  app.use((error, _req, res, _next) => res.status(error.status || 500).json({ error: { code: error.code } }));
  const server = app.listen(0, '127.0.0.1'); t.after(() => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));
  await new Promise((resolve) => server.once('listening', resolve)); const base = `http://127.0.0.1:${server.address().port}/api`;
  assert.equal((await fetch(`${base}/admin/dashboard`)).status, 401);
  const admin = await fetch(`${base}/admin/dashboard`, { headers: { 'X-Test-Role': 'ADMIN' } });
  assert.equal(admin.status, 200); assert.equal(admin.headers.get('cache-control'), 'no-store');
  assert.equal((await fetch(`${base}/admin/dashboard`, { headers: { 'X-Test-Role': 'HOSPITAL' } })).status, 403);
  assert.equal((await fetch(`${base}/hospitals/me/dashboard`, { headers: { 'X-Test-Role': 'ADMIN' } })).status, 403);
  const pending = await fetch(`${base}/hospitals/me/dashboard`, { headers: { 'X-Test-Role': 'HOSPITAL', 'X-Test-Status': 'PENDING', 'X-Test-Account': '42' } });
  assert.equal(pending.status, 200); assert.equal((await pending.json()).accountId, '42');
  assert.equal((await fetch(`${base}/hospitals/me/dashboard?hospitalId=77`, { headers: { 'X-Test-Role': 'HOSPITAL', 'X-Test-Account': '42' } })).status, 400);
  assert.equal((await fetch(`${base}/admin/reports/inventory?format=csv`, { headers: { 'X-Test-Role': 'ADMIN' } })).status, 400);
});
