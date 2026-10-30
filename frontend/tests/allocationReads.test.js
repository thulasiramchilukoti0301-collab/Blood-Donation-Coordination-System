import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createAllocationReadApi, readAllocationPreview, readCompatibilityResponse } from '../src/services/allocationReadApi.js';

const codes = ['O-', 'O+', 'A-', 'A+', 'B-', 'B+', 'AB-', 'AB+'];
const groups = codes.map((code, index) => ({ bloodGroupId: String(index + 1), code, displayName: `${code} group` }));
const compatible = new Set(['O->O-', 'O->O+', 'O->A-', 'O->A+', 'O->B-', 'O->B+', 'O->AB-', 'O->AB+',
  'O+>O+', 'O+>A+', 'O+>B+', 'O+>AB+', 'A->A-', 'A->A+', 'A->AB-', 'A->AB+', 'A+>A+', 'A+>AB+',
  'B->B-', 'B->B+', 'B->AB-', 'B->AB+', 'B+>B+', 'B+>AB+', 'AB->AB-', 'AB->AB+', 'AB+>AB+']);
const pairs = codes.flatMap((donorGroupCode) => codes.map((recipientGroupCode) => ({ donorGroupCode,
  recipientGroupCode, isCompatible: compatible.has(`${donorGroupCode}>${recipientGroupCode}`) })));
const matrix = { success: true, groups, pairs };
const preview = { success: true, preview: { isBinding: false, intendedIssueDate: '2026-11-01', eligibleForAllocation: true,
  request: { requestId: '42', recipientGroupId: '4', recipientGroupCode: 'A+', recipientGroupName: 'A Positive', hospitalName: 'Real Hospital', quantityRequested: 2, requestStatus: 'UNDER_REVIEW' },
  counts: { allocated: 0, issued: 0, outstanding: 2, availableCandidateCount: 3, allocatableCount: 2 },
  allocations: [],
  candidatePagination: { page: 1, pageSize: 25, total: 2, pageCount: 1 },
  candidates: [{ bloodUnitId: '19', donorGroupCode: 'O-', expiryDate: '2026-11-20', collectedAt: '2026-10-25 10:00:00' }] } };

test('compatibility response requires all 64 unique directed pairs and exactly 27 compatible mappings', () => {
  assert.equal(readCompatibilityResponse(matrix).pairs.length, 64);
  assert.throws(() => readCompatibilityResponse({ ...matrix, pairs: pairs.slice(1) }));
  assert.throws(() => readCompatibilityResponse({ ...matrix, pairs: pairs.map((pair, index) => index ? pair : pairs[1]) }));
  assert.throws(() => readCompatibilityResponse({ ...matrix, pairs: pairs.map((pair) => ({ ...pair, isCompatible: true })) }));
  assert.equal(readCompatibilityResponse(matrix).pairs.find((pair) => pair.donorGroupCode === 'O-' && pair.recipientGroupCode === 'AB+').isCompatible, true);
  assert.equal(readCompatibilityResponse(matrix).pairs.find((pair) => pair.donorGroupCode === 'AB+' && pair.recipientGroupCode === 'O-').isCompatible, false);
});

test('preview response validates real request totals, read-only state, direction and FEFO candidates', () => {
  assert.equal(readAllocationPreview(preview, '42').counts.allocatableCount, 2);
  assert.throws(() => readAllocationPreview({ ...preview, preview: { ...preview.preview, isBinding: true } }, '42'));
  assert.throws(() => readAllocationPreview({ ...preview, preview: { ...preview.preview, counts: { ...preview.preview.counts, outstanding: 4 } } }, '42'));
  assert.throws(() => readAllocationPreview({ ...preview, preview: { ...preview.preview, candidates: [{ ...preview.preview.candidates[0], donorGroupCode: 'AB+' }] } }, '42'));
  assert.throws(() => readAllocationPreview({ ...preview, preview: { ...preview.preview, candidates: [
    { bloodUnitId: '20', donorGroupCode: 'O-', expiryDate: '2026-11-21', collectedAt: '2026-10-24 10:00:00' },
    { bloodUnitId: '19', donorGroupCode: 'O-', expiryDate: '2026-11-20', collectedAt: '2026-10-25 10:00:00' },
  ] } }, '42'));
});

test('API client binds strict read-only paths, params and abort signals without mutation calls', async () => {
  const calls = []; const controller = new AbortController();
  const client = { async get(path, options) { calls.push({ path, options }); return { data: path.includes('compatibility') ? matrix : preview }; },
    async post() { assert.fail('read-only API must never mutate'); } };
  const api = createAllocationReadApi(client);
  await api.compatibility({ signal: controller.signal });
  await api.preview('42', { intendedIssueDate: '2026-11-01', candidatePage: 1, signal: controller.signal });
  assert.equal(calls[0].path, '/admin/blood-compatibility');
  assert.equal(calls[0].options.signal, controller.signal);
  assert.equal(calls[1].path, '/admin/requests/42/allocation-preview');
  assert.deepEqual(calls[1].options.params, { intendedIssueDate: '2026-11-01', candidatePage: 1 });
  await assert.rejects(api.preview('42', { intendedIssueDate: '2026-02-30' }));
  await assert.rejects(api.preview('42 OR 1=1', { intendedIssueDate: '2026-11-01' }));
  assert.equal(calls.length, 2);
});
