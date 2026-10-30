import assert from 'node:assert/strict';
import test from 'node:test';
import { allocationMutationMessage, createAllocationMutationApi } from '../src/services/allocationMutationApi.js';

const token = 'a'.repeat(64);
const operationId = '47c79c40-0f00-4bb0-a709-a0d3a93cb258';

test('allocation confirmation uses fresh same-session CSRF and submits only the exact FEFO IDs once', async () => {
  const calls = [];
  const client = {
    async get(path) { calls.push(['get', path]); return { status: 200, data: { success: true, csrfToken: token } }; },
    async post(path, body, options) {
      calls.push(['post', path, body, options]);
      return { status: 201, data: { success: true, allocation: { requestId: '42', allocations: [{ allocationId: '71', bloodUnitId: '19' }],
        allocated: 1, issued: 0, outstanding: 1, requestStatus: 'PARTIALLY_FULFILLED', operationId } } };
    },
  };
  const result = await createAllocationMutationApi(client).confirm('42', {
    bloodUnitIds: ['19'], intendedIssueDate: '2026-10-30', isCurrent: () => true,
  });
  assert.deepEqual(calls.map(call => call[0]), ['get', 'post']);
  assert.equal(calls[1][1], '/admin/requests/42/allocations');
  assert.deepEqual(calls[1][2], { bloodUnitIds: ['19'], intendedIssueDate: '2026-10-30' });
  assert.equal(calls[1][3].headers['X-CSRF-Token'], token);
  assert.deepEqual(result.allocations, [{ allocationId: '71', bloodUnitId: '19' }]);
});

test('issuing validates the approved handoff contract and never retries a dispatched request', async () => {
  const calls = [];
  const client = {
    async get(path) { calls.push(['get', path]); return { status: 200, data: { success: true, csrfToken: token } }; },
    async post(path, body, options) {
      calls.push(['post', path, body, options]);
      return { status: 200, data: { success: true, issue: { allocationId: '71', requestId: '42', bloodUnitId: '19',
        allocationStatus: 'ISSUED', unitStatus: 'ISSUED', requestStatus: 'FULFILLED', issued: 1, allocated: 0,
        outstanding: 0, handoffReference: 'HANDOFF-42' } } };
    },
  };
  const result = await createAllocationMutationApi(client).issue('71', { handoffReference: ' HANDOFF-42 ', isCurrent: () => true });
  assert.equal(calls[1][1], '/admin/allocations/71/issue');
  assert.deepEqual(calls[1][2], { handoffReference: 'HANDOFF-42' });
  assert.equal(calls[1][3].headers['X-CSRF-Token'], token);
  assert.equal(result.unitStatus, 'ISSUED');
  await assert.rejects(() => createAllocationMutationApi(client).issue('71', { handoffReference: `${' '.repeat(41)}${'x'.repeat(40)}`, isCurrent: () => true }));
  assert.equal(calls.length, 2, 'Invalid raw length never dispatches a handoff.');
});

test('obsolete confirmations do not dispatch and uncertain outcomes require reconciliation', async () => {
  let posts = 0;
  const client = { async get() { return { status: 200, data: { success: true, csrfToken: token } }; }, async post() { posts++; } };
  await assert.rejects(() => createAllocationMutationApi(client).confirm('42', {
    bloodUnitIds: ['19'], intendedIssueDate: '2026-10-30', isCurrent: () => false,
  }), { code: 'OBSOLETE_CONFIRMATION' });
  assert.equal(posts, 0);
  assert.equal(allocationMutationMessage({ response: { data: { error: { code: 'TRANSACTION_OUTCOME_UNKNOWN' } } } }).kind, 'uncertain');
});
