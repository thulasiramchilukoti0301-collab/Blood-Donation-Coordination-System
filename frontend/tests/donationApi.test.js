import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createDonationApi, donationMutation, matchesDonation } from '../src/services/donationContracts.js';
import { bookingMutationMessage } from '../src/services/bookingApi.js';

const token = 'a'.repeat(64);
const captured = { bookingId: '3', donorAccountId: '10', outcome: 'COLLECTED',
  collectedAt: '2026-10-29T10:05:12+05:30', collectionReference: 'REF-1' };
const result = { success: true, donation: { donationId: '8', bookingId: '3', donorAccountId: '10',
  bookingStatus: 'COMPLETED', outcome: 'COLLECTED', releaseStatus: 'PENDING',
  collectedAt: captured.collectedAt, collectionReference: captured.collectionReference,
  createdAt: '2026-10-29T10:07:00+05:30' } };

test('Admin and Donor reads use their distinct scoped routes and preserve filters/signals', async () => {
  const calls = []; const signal = new AbortController().signal;
  const client = { async get(path, options) { calls.push({ path, options }); return { data: { success: true } }; } };
  const service = createDonationApi(client);
  await service.adminHistory({ outcome: 'COLLECTED', from: '2026-10-29' }, signal);
  await service.ownHistory({ from: '2026-10-29', page: 2 }, signal);
  assert.deepEqual(calls.map(value => value.path), ['/admin/donations', '/donors/me/donations']);
  assert.equal(calls[0].options.signal, signal); assert.equal(calls[1].options.signal, signal);
  assert.deepEqual(calls[1].options.params, { from: '2026-10-29', page: 2 });
});

test('recording obtains fresh CSRF and sends only the captured fields', async () => {
  const calls = []; const client = {
    async get(path) { calls.push(['get', path]); return { status: 200, data: { success: true, csrfToken: token } }; },
    async request(config) { calls.push(['request', config]); return { status: 201, data: result }; },
  };
  assert.deepEqual(await donationMutation(captured, () => true, undefined, client), result);
  assert.deepEqual(calls.map(value => value[0]), ['get', 'request']);
  assert.equal(calls[1][1].url, '/admin/donations');
  assert.deepEqual(calls[1][1].data, { bookingId: '3', outcome: 'COLLECTED', collectedAt: captured.collectedAt,
    collectionReference: captured.collectionReference });
  assert.equal(calls[1][1].headers['X-CSRF-Token'], token);
  calls.length = 0;
  await donationMutation({ bookingId: '3', donorAccountId: '10', outcome: 'INCOMPLETE' }, () => true, undefined,
    { ...client, async request(config) { calls.push(['request', config]); return { status: 201,
      data: { success: true, donation: { ...result.donation, outcome: 'INCOMPLETE', releaseStatus: 'NOT_REQUIRED',
        collectedAt: null, collectionReference: null } } }; } });
  assert.deepEqual(calls[1][1].data, { bookingId: '3', outcome: 'INCOMPLETE' });
});

test('complete response validation rejects wrong identity, date, reference, release or identifier', () => {
  assert.equal(matchesDonation(result, captured), true);
  for (const change of [{ donationId: '0' }, { bookingId: '4' }, { donorAccountId: '11' },
    { bookingStatus: 'CHECKED_IN' }, { outcome: 'INCOMPLETE' }, { releaseStatus: 'APPROVED' },
    { collectedAt: null }, { collectionReference: 'OTHER' }, { createdAt: 'invalid' }]) {
    assert.equal(matchesDonation({ success: true, donation: { ...result.donation, ...change } }, captured), false);
  }
});

test('delayed CSRF cancellation blocks dispatch; malformed success stays uncertain, definite conflict does not retry', async () => {
  let release; let dispatched = 0; let current = true;
  const client = { get: async () => new Promise(resolve => { release = () => resolve({ status: 200,
    data: { success: true, csrfToken: token } }); }), request: async () => { dispatched++; return { status: 201, data: result }; } };
  const pending = donationMutation(captured, () => current, undefined, client);
  await new Promise(resolve => setImmediate(resolve)); current = false; release();
  await assert.rejects(pending, error => error.code === 'OBSOLETE_CONFIRMATION');
  assert.equal(dispatched, 0);
  const malformed = await donationMutation(captured, () => true, undefined,
    { get: async () => ({ status: 200, data: { success: true, csrfToken: token } }),
      request: async () => ({ status: 201, data: { success: true, donation: { ...result.donation, donationId: '0' } } }) })
    .then(() => null, error => error);
  assert.equal(bookingMutationMessage(malformed).kind, 'uncertain');
  const conflict = { response: { status: 409, data: { error: { code: 'DONATION_CONFLICT' } } }, mutationDispatched: true };
  assert.equal(bookingMutationMessage(conflict).kind, 'conflict');
});
