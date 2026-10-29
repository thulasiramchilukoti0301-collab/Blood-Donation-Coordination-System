import assert from 'node:assert/strict';
import express from 'express';
import session from 'express-session';
import { test } from 'node:test';
import { createDonorActivityRepository } from '../src/modules/donorDashboard/repository.js';
import { activityQuery, createDonorActivityService } from '../src/modules/donorDashboard/service.js';
import { createDonorActivityRouter } from '../src/modules/donorDashboard/router.js';
import { errorHandler } from '../src/middleware/errorHandler.js';

test('activity validates exact optional dates and repository scopes both aggregates to the Donor', async () => {
  assert.deepEqual(activityQuery({ from: '2026-10-01', to: '2026-10-29' }), { from: '2026-10-01', to: '2026-10-29' });
  for (const query of [{ from: '2026-02-30' }, { from: '2026-11-01', to: '2026-10-01' }, { donorId: '42' }, { page: '1' }]) {
    assert.throws(() => activityQuery(query));
  }
  const calls = [];
  const database = { async execute(sql, params) { calls.push([sql, params]);
    return [[calls.length === 1 ? { bookingStatus: 'BOOKED', count: '2' } : { outcome: 'COLLECTED', count: '1' }]]; } };
  const result = await createDonorActivityRepository(database).activity('41', { from: '2026-10-01', to: '2026-10-29' });
  assert.equal(result.bookingCounts.find(row => row.bookingStatus === 'BOOKED').count, 2);
  assert.equal(result.donationCounts.find(row => row.outcome === 'COLLECTED').count, 1);
  for (const [sql, params] of calls) { assert.match(sql, /donor_account_id = \?/u); assert.equal(params[0], '41'); assert.equal(params.length, 3); }
  assert.equal(JSON.stringify(result).includes('42'), false);
});

test('owner-only activity route refuses other roles and inactive accounts', async t => {
  const calls = [];
  const authService = { async authorizeSession(_sid, principal) { return principal; } };
  const activityService = createDonorActivityService({ repository: { async activity(id, query) { calls.push([id, query]); return {
    from: null, to: null, bookingCounts: [], donationCounts: [],
  }; } } });
  const app = express(); app.use(session({ secret: 'fixture-session-secret-value-long-enough', resave: false, saveUninitialized: true }));
  app.post('/fixture-login', (req, res) => { req.session.auth = { accountId: req.query.id || '41',
    role: req.query.role || 'DONOR', accountStatus: req.query.status || 'ACTIVE' }; res.json({ success: true }); });
  app.use('/api', createDonorActivityRouter({ authService, activityService })); app.use(errorHandler);
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const login = async query => (await fetch(`${base}/fixture-login?${query}`, { method: 'POST' })).headers.get('set-cookie').split(';', 1)[0];
  const get = async cookie => fetch(`${base}/api/donors/me/reports/activity`, { headers: cookie ? { Cookie: cookie } : {} });
  assert.equal((await get()).status, 401);
  assert.equal((await get(await login('role=ADMIN'))).status, 403);
  assert.equal((await get(await login('status=PENDING'))).status, 403);
  const valid = await get(await login('id=41'));
  assert.equal(valid.status, 200); assert.equal(valid.headers.get('cache-control'), 'no-store');
  assert.deepEqual(calls, [['41', { from: null, to: null }]]);
});
