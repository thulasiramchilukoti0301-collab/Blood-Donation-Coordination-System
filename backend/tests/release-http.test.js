import assert from 'node:assert/strict';
import { test } from 'node:test';
import express from 'express';
import { createReleaseRouter } from '../src/modules/release/router.js';
import { errorHandler } from '../src/middleware/errorHandler.js';

const token = 'a'.repeat(64);
async function fixture(principal) {
  const calls = [];
  const service = {
    async decide(...args) { calls.push(['decide', ...args]); return { donationId: '8', decision: 'REJECTED' }; },
    async list(query) { calls.push(['list', query]); return { units: [], pagination: { page: 1, pageSize: 20, total: 0 } }; },
    async detail(id) { calls.push(['detail', id]); return { bloodUnitId: id }; },
    async reconcileExpiry(...args) { calls.push(['expiry', ...args]); return { runDate: '2026-10-29', checkedCount: 1, expiredCount: 1, runAt: '2026-10-29T10:00:00+05:30', operationId: '00000000-0000-4000-8000-000000000001' }; },
    async discardUnit(...args) { calls.push(['discard', ...args]); return { bloodUnitId: '17', unitStatus: 'DISCARDED', discardedAt: '2026-10-29T10:00:00+05:30', reasonCode: 'DAMAGED' }; },
  };
  const app = express(); app.use(express.json());
  app.use((req, _res, next) => { req.sessionID = 'test-sid'; req.session = { auth: principal, csrfToken: token,
    destroy(done) { done(); } }; next(); });
  app.use('/api', createReleaseRouter({ authService: { authorizeSession: async (_sid, claimed) => claimed },
    releaseService: service, frontendUrl: 'http://localhost:5173' }));
  app.use(errorHandler);
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  return { calls, base: `http://127.0.0.1:${server.address().port}/api`,
    close: () => new Promise(resolve => server.close(resolve)) };
}

test('ACTIVE Admin routes use stored principal, CSRF, scoped inventory and no-store', async () => {
  const f = await fixture({ accountId: '1', role: 'ADMIN', accountStatus: 'ACTIVE' });
  try {
    const body = { decision: 'REJECTED', reasonCode: 'TESTING_NOT_APPROVED' };
    const post = await fetch(`${f.base}/admin/donations/8/testing-decision`, { method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:5173', 'X-CSRF-Token': token },
      body: JSON.stringify(body) });
    assert.equal(post.status, 200); assert.equal(post.headers.get('cache-control'), 'no-store');
    assert.deepEqual(f.calls[0].slice(0, 4), ['decide', '8', '1', body]);
    assert.equal(f.calls[0][4].principal.accountId, '1');
    assert.equal((await fetch(`${f.base}/inventory?page=2`)).status, 200);
    assert.equal(f.calls[1][1].page, '2');
    assert.equal((await fetch(`${f.base}/admin/inventory/17`)).status, 200);
    assert.deepEqual(f.calls[2], ['detail', '17']);
    const expiry = await fetch(`${f.base}/admin/inventory/expiry/run`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:5173', 'X-CSRF-Token': token }, body: '{}' });
    assert.equal(expiry.status, 200); assert.equal(f.calls[3][0], 'expiry');
    const discard = await fetch(`${f.base}/admin/inventory/17/discard`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:5173', 'X-CSRF-Token': token }, body: JSON.stringify({ reasonCode: 'DAMAGED' }) });
    assert.equal(discard.status, 200); assert.deepEqual(f.calls[4].slice(0, 3), ['discard', '1', '17']);
    const missingCsrf = await fetch(`${f.base}/admin/inventory/expiry/run`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:5173' }, body: '{}' });
    assert.equal(missingCsrf.status, 403); assert.equal(f.calls.length, 5);
    const invalid = await fetch(`${f.base}/admin/donations/8/testing-decision`, { method: 'POST',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    assert.equal(invalid.status, 403); assert.equal(f.calls.length, 5);
  } finally { await f.close(); }
});

test('Donor, Hospital and PENDING callers cannot read inventory or decide release', async () => {
  for (const principal of [{ accountId: '2', role: 'DONOR', accountStatus: 'ACTIVE' },
    { accountId: '3', role: 'HOSPITAL', accountStatus: 'ACTIVE' },
    { accountId: '4', role: 'ADMIN', accountStatus: 'PENDING' }]) {
    const f = await fixture(principal);
    try {
      const expected = principal.accountStatus === 'PENDING' ? 401 : 403;
      assert.equal((await fetch(`${f.base}/inventory`)).status, expected);
      assert.equal((await fetch(`${f.base}/admin/inventory/17`)).status, expected);
      assert.equal((await fetch(`${f.base}/admin/donations/8/testing-decision`, { method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': token },
        body: JSON.stringify({ decision: 'APPROVED', confirmedBloodGroupId: '3' }) })).status, expected);
      assert.equal((await fetch(`${f.base}/admin/inventory/expiry/run`, { method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': token }, body: '{}' })).status, expected);
      assert.equal((await fetch(`${f.base}/admin/inventory/17/discard`, { method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': token }, body: JSON.stringify({ reasonCode: 'DAMAGED' }) })).status, expected);
      assert.equal(f.calls.length, 0);
    } finally { await f.close(); }
  }
});
