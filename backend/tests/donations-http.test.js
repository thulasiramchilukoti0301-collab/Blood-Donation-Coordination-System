import assert from 'node:assert/strict';
import { test } from 'node:test';
import express from 'express';
import { createDonationRouter } from '../src/modules/donations/router.js';
import { errorHandler } from '../src/middleware/errorHandler.js';
import { HttpError } from '../src/utils/httpError.js';

const token = 'a'.repeat(64);
async function fixture(principal, { recordError = null } = {}) {
  const calls = []; let destroyed = 0;
  const service = {
    async record(actor, body, session) { calls.push(['record', actor, body, session]); if (recordError) throw recordError;
      return { donationId: '8' }; },
    async list(query, scope) { calls.push(['list', query, scope]); return { donations: [], pagination: { page: 1, pageSize: 20, total: 0 } }; },
  };
  const app = express(); app.use(express.json());
  app.use((req, _res, next) => { req.sessionID = 'test-sid';
    req.session = { auth: principal, csrfToken: token, destroy(done) { destroyed++; done(); } }; next(); });
  app.use('/api', createDonationRouter({ authService: { async authorizeSession(_sid, claimed) { return claimed; } },
    donationService: service, frontendUrl: 'http://localhost:5173' }));
  app.use(errorHandler);
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  return { calls, get destroyed() { return destroyed; }, base: `http://127.0.0.1:${server.address().port}/api`,
    close: () => new Promise(resolve => server.close(resolve)) };
}

test('ACTIVE Admin POST and GET use session actor, exact route, CSRF and no-store', async () => {
  const f = await fixture({ accountId: '1', role: 'ADMIN', accountStatus: 'ACTIVE' });
  try {
    const body = { bookingId: '3', outcome: 'DEFERRED' };
    const post = await fetch(`${f.base}/admin/donations`, { method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:5173', 'X-CSRF-Token': token }, body: JSON.stringify(body) });
    assert.equal(post.status, 201); assert.equal(post.headers.get('cache-control'), 'no-store');
    assert.deepEqual(f.calls[0].slice(0, 3), ['record', '1', body]);
    assert.equal(f.calls[0][3].principal.accountId, '1');
    const list = await fetch(`${f.base}/admin/donations?outcome=COLLECTED&page=2`);
    assert.equal(list.status, 200);
    assert.deepEqual({ ...f.calls[1][1] }, { outcome: 'COLLECTED', page: '2' });
    assert.deepEqual(f.calls[1][2], { admin: true });
    for (const [path, headers, expected] of [
      ['/admin/donations', { 'Content-Type': 'application/json' }, 'CSRF_TOKEN_INVALID'],
      ['/admin/donations', { 'Content-Type': 'application/json', Origin: 'http://invalid.test', 'X-CSRF-Token': token }, 'ORIGIN_NOT_ALLOWED'],
      ['/admin/donations?actorAccountId=2', { 'Content-Type': 'application/json', 'X-CSRF-Token': token }, 'VALIDATION_ERROR'],
    ]) {
      const response = await fetch(`${f.base}${path}`, { method: 'POST', headers, body: JSON.stringify(body) });
      assert.equal((await response.json()).error.code, expected);
    }
    assert.equal(f.calls.length, 2);
  } finally { await f.close(); }
});

test('inactive target conflict does not revoke an authenticated Admin session', async () => {
  const f = await fixture({ accountId: '1', role: 'ADMIN', accountStatus: 'ACTIVE' },
    { recordError: new HttpError(409, 'DONOR_UNAVAILABLE', 'This Donor is not active for this action.') });
  try {
    const response = await fetch(`${f.base}/admin/donations`, { method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': token },
      body: JSON.stringify({ bookingId: '3', outcome: 'INCOMPLETE' }) });
    assert.equal(response.status, 409); assert.equal((await response.json()).error.code, 'DONOR_UNAVAILABLE');
    assert.equal(f.destroyed, 0);
    assert.equal((await fetch(`${f.base}/admin/donations`)).status, 200);
    assert.equal(f.destroyed, 0);
  } finally { await f.close(); }
});

test('own Donor history uses session owner; wrong-role and pending callers cannot use operational routes', async () => {
  const donor = await fixture({ accountId: '10', role: 'DONOR', accountStatus: 'ACTIVE' });
  try {
    const response = await fetch(`${donor.base}/donors/me/donations?from=2026-10-29`);
    assert.equal(response.status, 200);
    assert.deepEqual({ ...donor.calls[0][1] }, { from: '2026-10-29' });
    assert.deepEqual(donor.calls[0][2], { donorId: '10' });
    assert.equal((await fetch(`${donor.base}/admin/donations`)).status, 403);
    assert.equal(donor.calls.length, 1);
  } finally { await donor.close(); }
  for (const principal of [{ accountId: '11', role: 'HOSPITAL', accountStatus: 'ACTIVE' },
    { accountId: '10', role: 'DONOR', accountStatus: 'PENDING' }]) {
    const f = await fixture(principal);
    try { assert.equal((await fetch(`${f.base}/donors/me/donations`)).status, 403); assert.equal(f.calls.length, 0); }
    finally { await f.close(); }
  }
});
