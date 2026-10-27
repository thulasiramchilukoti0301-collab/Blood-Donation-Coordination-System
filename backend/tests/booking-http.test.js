import assert from 'node:assert/strict';
import { test } from 'node:test';
import express from 'express';
import { createBookingRouter } from '../src/modules/booking/router.js';
import { errorHandler } from '../src/middleware/errorHandler.js';

const token = 'a'.repeat(64);
async function fixture(principal) {
  const calls = [];
  const service = {
    async preview(id) { calls.push(['preview', id]); return { result: 'ELIGIBLE' }; },
    async slots(query, context) { calls.push(['slots', query, context]); return { slots: [], pagination: { page: 1, pageSize: 20, total: 0 } }; },
    async bookings(query, context) { calls.push(['bookings', query, context]); return { bookings: [], pagination: { page: 1, pageSize: 20, total: 0 } }; },
    async createBooking(id, body, session) { calls.push(['createBooking', id, body, session]); return { bookingId: '2', bookingStatus: 'BOOKED' }; },
    async createSlot(id, body, session) { calls.push(['createSlot', id, body, session]); return { slotId: '3' }; },
    async updateSlot(id, slotId, body, session) { calls.push(['updateSlot', id, slotId, body, session]); return { slotId }; },
    async cancelBooking(id, bookingId, body, session) { calls.push(['cancelBooking', id, bookingId, body, session]); return { bookingId }; },
  };
  const app = express(); app.use(express.json());
  app.use((req, _res, next) => { req.sessionID = 'test-sid'; req.session = { auth: principal, csrfToken: token, destroy(done) { done(); } }; next(); });
  app.use('/api', createBookingRouter({ authService: { async authorizeSession(_sid, claimed) { return claimed; } },
    bookingService: service, frontendUrl: 'http://localhost:5173' }));
  app.use(errorHandler);
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  return { calls, base: `http://127.0.0.1:${server.address().port}/api`, close: () => new Promise(resolve => server.close(resolve)) };
}
test('Donor operations use session identity, ACTIVE gate, trusted Origin and CSRF', async () => {
  const f = await fixture({ accountId: '10', role: 'DONOR', accountStatus: 'ACTIVE' });
  try {
    const response = await fetch(`${f.base}/donors/me/bookings`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:5173', 'X-CSRF-Token': token },
      body: JSON.stringify({ slotId: '40' }) });
    assert.equal(response.status, 201); assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(f.calls[0][1], '10'); assert.deepEqual(f.calls[0][2], { slotId: '40' });
    assert.equal(f.calls[0][3].principal.accountId, '10');
    const badCsrf = await fetch(`${f.base}/donors/me/bookings`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    assert.equal(badCsrf.status, 403); assert.equal((await badCsrf.json()).error.code, 'CSRF_TOKEN_INVALID');
    const badOrigin = await fetch(`${f.base}/donors/me/bookings`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'http://invalid.test', 'X-CSRF-Token': token }, body: '{}' });
    assert.equal(badOrigin.status, 403); assert.equal((await badOrigin.json()).error.code, 'ORIGIN_NOT_ALLOWED');
    assert.equal(f.calls.length, 1);
  } finally { await f.close(); }
});
test('PENDING Donor and wrong role cannot use operational routes', async () => {
  for (const [role, status, expected] of [['DONOR', 'PENDING', 403], ['HOSPITAL', 'ACTIVE', 403]]) {
    const f = await fixture({ accountId: '20', role, accountStatus: status });
    try {
      const response = await fetch(`${f.base}/donors/me/eligibility`);
      assert.equal(response.status, expected); assert.equal(f.calls.length, 0);
    } finally { await f.close(); }
  }
});
test('Admin list and slot mutation remain role-scoped and reject unexpected query fields', async () => {
  const f = await fixture({ accountId: '1', role: 'ADMIN', accountStatus: 'ACTIVE' });
  try {
    const list = await fetch(`${f.base}/admin/bookings`);
    assert.equal(list.status, 200); assert.deepEqual(f.calls[0][2], { admin: true });
    const extra = await fetch(`${f.base}/admin/donation-slots?actorAccountId=2`, { method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': token }, body: JSON.stringify({ startsAt: '2026-11-01T10:00:00+05:30', endsAt: '2026-11-01T11:00:00+05:30', capacity: 1 }) });
    assert.equal(extra.status, 400); assert.equal(f.calls.length, 1);
  } finally { await f.close(); }
});
