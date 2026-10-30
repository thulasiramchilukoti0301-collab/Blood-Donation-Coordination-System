import assert from 'node:assert/strict';
import test from 'node:test';
import { createAllocationMutationService } from '../src/modules/allocations/mutationService.js';

const actor = { accountId: '1', role: 'ADMIN', accountStatus: 'ACTIVE' };
const authorization = { sessionId: 'disposable-admin-session', principal: actor };
const date = (day) => Date.UTC(2026, 9, day, 12);

function fixture(clockValues) {
  let clockIndex = 0;
  let writes = 0;
  const auditEvents = [];
  const connection = { async execute() {
    return [[{ session_data: JSON.stringify({ auth: actor }), expires_at: Date.now() + 60_000, revoked_at: null }]];
  } };
  const repository = {
    async transaction(_actorId, work) { return work(connection, new Map([['1', actor]])); },
    async lockRequest() { return { requestId: '7', recipientGroupId: '2', quantityRequested: 1,
      requestStatus: 'UNDER_REVIEW', neededBy: '2026-12-31 00:00:00' }; },
    async lockBloodGroups() { return [{ bloodGroupId: '2', isActive: true }]; },
    async compatibleGroups() { return ['1']; },
    async candidateSnapshot() { return [{ bloodUnitId: '11', donationId: '12', bloodGroupId: '1',
      expiryDate: '2026-12-31', collectedAt: '2026-10-01 10:00:00', hasActiveAllocation: 0 }]; },
    async activeRequestUnits() { return []; },
    async lockUnit() { return { bloodUnitId: '11', donationId: '12', bloodGroupId: '1',
      unitStatus: 'AVAILABLE', expiryDate: '2026-12-31' }; },
    async lockAllocations() { return []; },
    async reserveBloodUnit() { writes++; return 1; },
    async createAllocation() { writes++; return '99'; },
    async setRequestStatusContext() {},
    async updateRequestStatus() { writes++; return 1; },
    async setStatusContextClear() {},
  };
  const service = createAllocationMutationService({ repository,
    clock: () => clockValues[Math.min(clockIndex++, clockValues.length - 1)],
    operationId: () => '00000000-0000-4000-8000-000000000001',
    auditWriter: { async write(_connection, event) { auditEvents.push(event); } },
  });
  return { service, get writes() { return writes; }, auditEvents };
}

test('allocation rechecks intended issue date after domain locks before any writes', async () => {
  const state = fixture([date(30), date(31)]);
  await assert.rejects(state.service.allocate('7', '1', {
    bloodUnitIds: ['11'], intendedIssueDate: '2026-10-30',
  }, authorization), (error) => error.status === 409 && error.code === 'ALLOCATION_PREVIEW_STALE');
  assert.equal(state.writes, 0);
  assert.deepEqual(state.auditEvents, []);
});

test('allocation still succeeds when intended issue date remains current after locks', async () => {
  const state = fixture([date(30), date(30)]);
  const result = await state.service.allocate('7', '1', {
    bloodUnitIds: ['11'], intendedIssueDate: '2026-10-30',
  }, authorization);
  assert.equal(result.requestStatus, 'PARTIALLY_FULFILLED');
  assert.equal(result.allocations[0].bloodUnitId, '11');
  assert.equal(state.writes, 3);
  assert.deepEqual(state.auditEvents.map((event) => event.actionCode), [
    'ALLOCATION_CREATED', 'HOSPITAL_REQUEST_STATUS_CHANGED',
  ]);
});
