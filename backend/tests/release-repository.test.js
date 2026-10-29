import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createReleaseRepository } from '../src/modules/release/repository.js';

test('inventory list binds filters, uses stable page order and omits donor identity', async () => {
  const calls = [];
  const row = { bloodUnitId: '17', donationId: '8', bloodGroupId: '3', bloodGroupCode: 'A-',
    unitStatus: 'AVAILABLE', expiryDate: '2026-12-09', collectedAt: '2026-10-28 09:00:00', releaseStatus: 'APPROVED' };
  const repo = createReleaseRepository({ async execute(sql, values) { calls.push([sql, values]);
    return [sql.includes('COUNT(*)') ? [{ total: '1' }] : [row]]; } });
  const result = await repo.list({ bloodGroupId: '3', availableOnly: true, collectedFrom: '2026-10-01', page: 2 }, '2026-10-29');
  assert.equal(result.units[0].collectedAt, '2026-10-28T09:00:00+05:30');
  assert.equal(Object.hasOwn(result.units[0], 'donorName'), false);
  assert.deepEqual(calls[0][1], ['3', '2026-10-29', '2026-10-01']);
  assert.deepEqual(calls[1][1].slice(-2), [20, 20]);
  assert.match(calls[1][0], /ORDER BY u\.expiry_date ASC, u\.blood_unit_id ASC LIMIT \? OFFSET \?/u);
  assert.doesNotMatch(calls[1][0], /JOIN Donor/u);
});

test('unit detail traces approved Donation without fabricated allocations or personal data', async () => {
  const row = { bloodUnitId: '17', donationId: '8', bloodGroupId: '3', bloodGroupCode: 'A-',
    unitStatus: 'AVAILABLE', expiryDate: '2026-12-09', collectedAt: '2026-10-28 09:00:00',
    expiredAt: null, discardedAt: null, discardReasonCode: null,
    releaseDecidedAt: '2026-10-29 10:00:00', createdAt: '2026-10-29 10:00:00',
    outcome: 'COLLECTED', releaseStatus: 'APPROVED' };
  const repo = createReleaseRepository({ execute: async sql => { assert.doesNotMatch(sql, /JOIN Donor|is_active/u); return [[row]]; } });
  const detail = await repo.detail('17');
  assert.equal(detail.allocations, null);
  assert.equal(detail.expiredAt, null); assert.equal(detail.discardedAt, null);
  assert.equal(detail.releaseDecidedAt, '2026-10-29T10:00:00+05:30');
  assert.equal(Object.hasOwn(detail, 'collectionReference'), false);
});

test('conditional update, unit creation and duplicate backstop use one connection', async () => {
  const calls = []; const connection = { async execute(sql, values) { calls.push([sql, values]);
    return [{ affectedRows: 1, insertId: '17' }]; } };
  const repo = createReleaseRepository({});
  assert.equal(await repo.decide(connection, '8', '1', { decision: 'APPROVED', reasonCode: 'STAFF_RELEASE_APPROVED' },
    '2026-10-29 10:00:00'), 1);
  assert.equal(await repo.insertUnit(connection, '8', '3', '2026-12-09', 'AVAILABLE', '2026-10-29 10:00:00'), '17');
  assert.match(calls[0][0], /release_status = 'PENDING'/u);
  assert.deepEqual(calls[1][1], ['8', '3', '2026-12-09', 'AVAILABLE', null]);
});

test('lifecycle repository locks eligible inventory rows and uses status/date conditional updates', async () => {
  const calls = []; const repo = createReleaseRepository({});
  const connection = { async execute(sql, values) { calls.push([sql, values]);
    if (sql.startsWith('SELECT')) return [[{ bloodUnitId: '17', unitStatus: 'AVAILABLE', expiryDate: '2026-10-29' }]];
    return [{ affectedRows: 1 }]; } };
  const rows = await repo.lockDueUnits(connection);
  assert.equal(rows[0].bloodUnitId, '17'); assert.match(calls[0][0], /ORDER BY expiry_date ASC, blood_unit_id ASC FOR UPDATE/u);
  assert.equal(await repo.expireUnit(connection, '17', '2026-10-29', '2026-10-29 10:00:00'), 1);
  assert.match(calls[1][0], /unit_status = 'AVAILABLE' AND expiry_date <= \?/u);
  assert.deepEqual(calls[1][1], ['2026-10-29 10:00:00', '17', '2026-10-29']);
  assert.equal(await repo.discardUnit(connection, '17', 'DAMAGED', '2026-10-29 10:00:00', '2026-10-29'), 1);
  assert.match(calls[2][0], /unit_status = 'AVAILABLE' AND expiry_date > \?/u);
});
