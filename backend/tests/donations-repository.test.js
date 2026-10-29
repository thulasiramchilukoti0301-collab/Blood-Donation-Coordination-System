import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createDonationRepository } from '../src/modules/donations/repository.js';

const stored = { donationId: '8', bookingId: '3', donorAccountId: '10', donorName: 'Fixture Donor',
  slotId: '4', bookingStatus: 'COMPLETED', outcome: 'COLLECTED', releaseStatus: 'PENDING',
  collectedAt: '2026-10-29 09:20:12', createdAt: '2026-10-29 09:30:00', startsAt: '2026-10-29 09:00:00' };
test('Admin recording-date filters and stable pagination bind only values; Donor projection omits identity and reference', async () => {
  const calls = [];
  const database = { async execute(sql, values) { calls.push({ sql, values }); return [sql.includes('COUNT(*)') ? [{ total: '1' }] : [stored]]; } };
  const repository = createDonationRepository(database);
  const query = { donorAccountId: '10', outcome: 'COLLECTED', releaseStatus: 'PENDING', from: '2026-10-29', to: '2026-10-29', page: 2 };
  const admin = await repository.list(query);
  assert.equal(admin.pagination.pageSize, 20); assert.equal(admin.donations[0].donorName, 'Fixture Donor');
  assert.deepEqual(calls[0].values, ['10', 'COLLECTED', 'PENDING', '2026-10-29 00:00:00', '2026-10-29 23:59:59']);
  assert.match(calls[1].sql, /ORDER BY d\.created_at DESC, d\.donation_id DESC LIMIT \? OFFSET \?/u);
  assert.match(calls[1].sql, /d\.created_at >= \?/u); assert.match(calls[1].sql, /d\.created_at <= \?/u);
  assert.deepEqual(calls[1].values.slice(-2), [20, 20]);
  calls.length = 0;
  const own = await repository.list({ from: '2026-10-29', page: 1 }, '10');
  assert.equal(Object.hasOwn(own.donations[0], 'donorAccountId'), false);
  assert.equal(Object.hasOwn(own.donations[0], 'donorName'), false);
  assert.equal(Object.hasOwn(own.donations[0], 'collectionReference'), false);
  assert.equal(calls[0].values[0], '10');
  assert.doesNotMatch(calls[1].sql, /JOIN Donor donor/u);
});

test('Donation insert and conditional Booking completion check affected rows', async () => {
  const calls = [];
  const connection = { async execute(sql, values) { calls.push({ sql, values });
    return [{ affectedRows: 1, insertId: '8' }]; } };
  const repository = createDonationRepository({ execute() { throw new Error('No pool read expected'); } });
  const input = { bookingId: '3', outcome: 'COLLECTED', releaseStatus: 'PENDING',
    collectedAt: { local: '2026-10-29 09:20:12' }, collectionReference: 'REF-1' };
  assert.equal(await repository.insertDonation(connection, '1', input), '8');
  assert.match(calls[0].sql, /INSERT INTO Donation/u);
  assert.deepEqual(calls[0].values, ['3', '1', 'COLLECTED', '2026-10-29 09:20:12', 'REF-1', 'PENDING']);
  assert.equal(await repository.completeBooking(connection, '3'), 1);
  assert.match(calls[1].sql, /WHERE booking_id = \? AND booking_status = 'CHECKED_IN'/u);
  assert.deepEqual(calls[1].values, ['3']);
});
