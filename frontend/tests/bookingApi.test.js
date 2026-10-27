import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bookingMutation, bookingMutationMessage, createBookingApi } from '../src/services/bookingApi.js';

const token = 'a'.repeat(64);
function fixture() {
  const calls = [];
  const client = { async get(path, config) { calls.push({ method: 'GET', path, config });
    return { status: 200, data: path === '/auth/csrf' ? { success: true, csrfToken: token } : { success: true, slots: [], pagination: { page: 1, pageSize: 20, total: 0 } } }; },
  async request(config) { calls.push({ method: config.method, path: config.url, config });
    return { status: 201, data: { success: true, booking: { bookingId: '1', bookingStatus: 'BOOKED', slot: { slotId: '40' } } } }; } };
  return { calls, client };
}

test('slot booking obtains fresh CSRF, sends only fixed body and confirms exact response', async () => {
  const f = fixture();
  const result = await bookingMutation({ method: 'POST', path: '/donors/me/bookings', body: { slotId: '40' },
    isCurrent: () => true, expected: data => data.booking?.bookingId === '1' && data.booking.slot.slotId === '40' }, f.client);
  assert.equal(result.booking.bookingStatus, 'BOOKED');
  assert.deepEqual(f.calls.map(call => call.path), ['/auth/csrf', '/donors/me/bookings']);
  assert.deepEqual(f.calls[1].config.data, { slotId: '40' });
  assert.equal(f.calls[1].config.headers['X-CSRF-Token'], token);
  assert.equal(f.calls[1].config.signal, undefined, 'Mutation is not aborted after dispatch.');
});

test('logout, filter or selection change during delayed CSRF prevents dispatch', async () => {
  const f = fixture(); let release;
  f.client.get = async () => { await new Promise(resolve => { release = resolve; }); return { status: 200, data: { success: true, csrfToken: token } }; };
  let current = true;
  const pending = bookingMutation({ method: 'PATCH', path: '/admin/donation-slots/40', body: { capacity: 2 },
    isCurrent: () => current, expected: () => true }, f.client);
  await Promise.resolve(); current = false; release();
  await assert.rejects(pending, { code: 'OBSOLETE_CONFIRMATION' });
  assert.equal(f.calls.length, 0);
});

test('dispatched timeout and malformed success are uncertain; conflicts are read-only recovery', async () => {
  const f = fixture();
  f.client.request = async () => { throw Object.assign(new Error('PRIVATE'), { code: 'ECONNABORTED' }); };
  const input = { method: 'POST', path: '/donors/me/bookings', body: { slotId: '40' }, isCurrent: () => true,
    expected: data => data.booking?.bookingId === '2' };
  const timed = await bookingMutation(input, f.client).then(() => null, error => error);
  assert.equal(timed.mutationDispatched, true);
  assert.equal(bookingMutationMessage(timed).kind, 'uncertain');
  f.client.request = async () => ({ status: 201, data: { success: true, booking: { bookingId: 'wrong' } } });
  const malformed = await bookingMutation(input, f.client).then(() => null, error => error);
  assert.equal(bookingMutationMessage(malformed).kind, 'uncertain');
  assert.equal(bookingMutationMessage({ response: { status: 409 } }).kind, 'conflict');
  assert.doesNotMatch(JSON.stringify(bookingMutationMessage(timed)), /PRIVATE/u);
});

test('read methods use owner-scoped routes without owner parameters', async () => {
  const f = fixture(); const service = createBookingApi(f.client);
  await service.slots({ page: 1 }); await service.ownBookings({ page: 1 }); await service.adminBookings({ page: 1 });
  assert.deepEqual(f.calls.map(call => call.path), ['/donation-slots', '/donors/me/bookings', '/admin/bookings']);
});

test('known dispatched validation and access rejections stay definite and never retry', async () => {
  for (const status of [400, 401, 403, 404, 409, 422, 429]) {
    const f = fixture(); let mutations = 0;
    f.client.request = async () => { mutations++;
      throw Object.assign(new Error('Controlled rejection'), { response: { status,
        data: { success: false, error: { code: 'VALIDATION_ERROR', message: 'Check the entered values.' } } } });
    };
    const error = await bookingMutation({ method: 'POST', path: '/donors/me/bookings', body: { slotId: '40' },
      isCurrent: () => true, expected: () => true }, f.client).catch(value => value);
    assert.equal(error.mutationDispatched, true);
    assert.equal(bookingMutationMessage(error).kind, status === 409 ? 'conflict' : 'error');
    assert.equal(mutations, 1);
  }
});

test('explicit transaction uncertainty takes precedence over rejection status and preserves read-only recovery', () => {
  for (const code of ['TRANSACTION_OUTCOME_UNKNOWN', 'TRANSACTION_CLEANUP_FAILED']) {
    for (const status of [400, 503]) {
      const result = bookingMutationMessage({ mutationDispatched: true, response: { status, data: { error: { code } } } });
      assert.equal(result.kind, 'uncertain');
      assert.match(result.text, /Reload the list/u);
    }
  }
});
