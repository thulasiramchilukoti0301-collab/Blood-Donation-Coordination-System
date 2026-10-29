import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createReleaseApi, inventoryMutation, matchesDiscard, matchesExpiry, matchesRelease, releaseMutation } from '../src/services/releaseContracts.js';

const capture = { donationId: '8', bookingId: '3', decision: 'APPROVED', reasonCode: 'STAFF_RELEASE_APPROVED',
  confirmedBloodGroupId: '3', collectedAt: '2026-10-28T09:00:00+05:30' };
const response = { success: true, release: { donationId: '8', decision: 'APPROVED', reasonCode: 'STAFF_RELEASE_APPROVED',
  releaseDecidedAt: '2026-10-29T10:00:00+05:30', replayed: false,
  unit: { bloodUnitId: '17', donationId: '8', bloodGroupId: '3', bloodGroupCode: 'A-',
    expiryDate: '2026-12-09', unitStatus: 'AVAILABLE' } } };
const token = 'a'.repeat(64);

test('release response checks captured identity, decision, group, expiry and unit', () => {
  assert.equal(matchesRelease(response, capture), true);
  assert.equal(matchesRelease({ success: true, release: { ...response.release, replayed: true,
    unit: { ...response.release.unit, unitStatus: 'ISSUED' } } }, capture), true);
  for (const change of [{ donationId: '9' }, { decision: 'REJECTED' }, { reasonCode: 'x' },
    { releaseDecidedAt: 'invalid' }, { unit: null }, { unit: { ...response.release.unit, bloodUnitId: '0' } },
    { unit: { ...response.release.unit, bloodGroupId: '4' } },
    { unit: { ...response.release.unit, expiryDate: '2026-12-10' } }]) {
    assert.equal(matchesRelease({ success: true, release: { ...response.release, ...change } }, capture), false);
  }
  assert.equal(matchesRelease({ success: true, release: { ...response.release, decision: 'REJECTED',
    reasonCode: 'TESTING_NOT_APPROVED', unit: null } }, { ...capture, decision: 'REJECTED',
    reasonCode: 'TESTING_NOT_APPROVED' }), true);
});

test('fresh CSRF, exact POST body and delayed preflight cancellation', async () => {
  const calls = []; const client = {
    async get(path) { calls.push(['get', path]); return { status: 200, data: { success: true, csrfToken: token } }; },
    async request(config) { calls.push(['post', config]); return { status: 200, data: response }; },
  };
  await releaseMutation(capture, () => true, undefined, client);
  assert.deepEqual(calls.map(item => item[0]), ['get', 'post']);
  assert.equal(calls[1][1].url, '/admin/donations/8/testing-decision');
  assert.deepEqual(calls[1][1].data, { decision: 'APPROVED', confirmedBloodGroupId: '3' });
  assert.equal(calls[1][1].headers['X-CSRF-Token'], token);
  let resolve; let dispatched = false; let current = true;
  const pending = releaseMutation(capture, () => current, undefined, {
    get: () => new Promise(done => { resolve = done; }),
    request: async () => { dispatched = true; return { status: 200, data: response }; },
  });
  await new Promise(done => setImmediate(done)); current = false;
  resolve({ status: 200, data: { success: true, csrfToken: token } });
  await assert.rejects(pending, error => error.code === 'OBSOLETE_CONFIRMATION');
  assert.equal(dispatched, false);
});

test('read routes remain Admin-scoped paths with parameters and signals', async () => {
  const calls = []; const signal = new AbortController().signal;
  const api = createReleaseApi({ get: async (path, options) => { calls.push([path, options]); return { data: { success: true } }; } });
  await api.pending({ releaseStatus: 'PENDING' }, signal);
  await api.inventory({ page: 2 }, signal);
  await api.detail('17', signal);
  assert.deepEqual(calls.map(call => call[0]), ['/admin/donations', '/inventory', '/admin/inventory/17']);
  assert.equal(calls[2][1].signal, signal);
});

test('inventory mutation contracts validate complete response and exact paths/bodies', async () => {
  const discardCapture = { bloodUnitId: '17', reasonCode: 'DAMAGED' };
  const discardResponse = { success: true, discard: { bloodUnitId: '17', unitStatus: 'DISCARDED', reasonCode: 'DAMAGED', discardedAt: '2026-10-29T10:00:00+05:30' } };
  assert.equal(matchesDiscard(discardResponse, discardCapture), true);
  assert.equal(matchesDiscard({ success: true, discard: { ...discardResponse.discard, bloodUnitId: '18' } }, discardCapture), false);
  assert.equal(matchesDiscard({ ...discardResponse, discard: { ...discardResponse.discard, privateNote: 'unexpected' } }, discardCapture), false);
  const expiryResponse = { success: true, result: { runDate: '2026-10-29', runAt: '2026-10-29T10:00:00+05:30', checkedCount: 4, expiredCount: 2, operationId: '00000000-0000-4000-8000-000000000001' } };
  assert.equal(matchesExpiry(expiryResponse, {}), true);
  assert.equal(matchesExpiry({ ...expiryResponse, result: { ...expiryResponse.result, expiredCount: 5 } }, {}), false);
  assert.equal(matchesExpiry({ ...expiryResponse, result: { ...expiryResponse.result, runDate: '2026-99-99' } }, {}), false);
  for (const [kind, captured, response, path, body] of [
    ['discard', discardCapture, discardResponse, '/admin/inventory/17/discard', { reasonCode: 'DAMAGED' }],
    ['expiry', {}, expiryResponse, '/admin/inventory/expiry/run', {}],
  ]) {
    const calls = []; const client = { get: async () => ({ status: 200, data: { success: true, csrfToken: token } }),
      request: async config => { calls.push(config); return { status: 200, data: response }; } };
    await inventoryMutation(kind, captured, () => true, undefined, client);
    assert.equal(calls[0].url, path); assert.deepEqual(calls[0].data, body);
  }
});
