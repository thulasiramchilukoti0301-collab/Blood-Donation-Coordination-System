import test from 'node:test';
import assert from 'node:assert/strict';
import { allocationCapacity, selectFefoUnits } from '../src/modules/allocations/fefo.js';
import { readAllocationPreview } from '../src/modules/allocations/repository.js';

const request = { requestStatus: 'UNDER_REVIEW', quantityRequested: 4 };
const unit = (bloodUnitId, expiryDate, extra = {}) => ({ bloodUnitId, expiryDate,
  collectedAt: '2026-10-01 10:00:00', unitStatus: 'AVAILABLE', releaseStatus: 'APPROVED',
  donationOutcome: 'COLLECTED', isCompatible: 1, hasActiveAllocation: 0, ...extra });

test('FEFO uses expiry, collection time, then numeric unit ID and reports partial stock', () => {
  const result = selectFefoUnits({ request, allocations: [{ allocationStatus: 'ISSUED' }],
    units: [unit('10', '2026-12-20'), unit('3', '2026-12-10'), unit('2', '2026-12-10'),
      unit('4', '2026-12-10', { collectedAt: '2026-09-30 12:00:00' })],
    intendedIssueDate: '2026-11-01' });
  assert.deepEqual(result.units.map((row) => row.bloodUnitId), ['4', '2', '3']);
  assert.equal(result.outstanding, 3);
  assert.equal(result.guaranteed, false);
});

test('FEFO excludes expired, untested, unapproved, incompatible, issued and reserved units', () => {
  const variants = [unit('1', '2026-11-01'), unit('2', '2026-12-01', { releaseStatus: 'PENDING' }),
    unit('3', '2026-12-01', { donationOutcome: 'INCOMPLETE' }),
    unit('4', '2026-12-01', { isCompatible: 0 }),
    unit('5', '2026-12-01', { unitStatus: 'ISSUED' }),
    unit('6', '2026-12-01', { hasActiveAllocation: 1 }), unit('7', '2026-12-01')];
  const result = selectFefoUnits({ request, allocations: [], units: variants, intendedIssueDate: '2026-11-01' });
  assert.deepEqual(result.units.map((row) => row.bloodUnitId), ['7']);
  assert.equal(result.shortfall, 3);
});

test('capacity rejects terminal requests and over-allocation', () => {
  assert.throws(() => allocationCapacity({ ...request, requestStatus: 'FULFILLED' }, []));
  assert.throws(() => allocationCapacity({ ...request, quantityRequested: 1 },
    [{ allocationStatus: 'ISSUED' }, { allocationStatus: 'ALLOCATED' }]));
  assert.throws(() => selectFefoUnits({ request, allocations: [], units: [],
    intendedIssueDate: '2026-11-01', quantity: 5 }));
});

test('internal SQL preview uses request recipient group and parameterized eligibility', async () => {
  const calls = [];
  const connection = { async execute(sql, params) {
    calls.push({ sql, params });
    return [[calls.length === 1 ? { ...request, recipientGroupId: '7' } : []].flat()];
  } };
  await readAllocationPreview(connection, '12', '2026-11-01');
  assert.deepEqual(calls.map((call) => call.params), [['12'], ['12'], ['7', '2026-11-01']]);
  assert.match(calls[2].sql, /c\.recipient_group_id = \?/);
  assert.match(calls[2].sql, /c\.donor_group_id = u\.blood_group_id/);
  assert.match(calls[2].sql, /c\.is_compatible = 1/);
  assert.match(calls[2].sql, /d\.release_status = 'APPROVED'/);
});
