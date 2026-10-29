import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createAdminDonorRepository } from '../src/modules/adminDonors/repository.js';

test('Admin Donor repository binds combined filters, escapes LIKE metacharacters and uses stable 20-row pagination', async () => {
  const calls = [];
  const database = { async execute(sql, values) {
    calls.push({ sql: sql.replace(/\s+/gu, ' ').trim(), values });
    return calls.length === 1 ? [[{ total: '21' }]] : [[{ donorId: '10', fullName: 'A Donor', phone: '100', area: null,
      accountStatus: 'ACTIVE', reportedBloodGroupId: '2', reportedBloodGroupCode: 'O+', confirmedBloodGroupId: '4', confirmedBloodGroupCode: 'A+' }]];
  } };
  const repository = createAdminDonorRepository(database);
  const page = await repository.list({ search: '50%_!', accountStatus: 'ACTIVE', bloodGroupId: '2', groupMatch: 'EITHER', page: 2 });
  assert.deepEqual(page.pagination, { page: 2, pageSize: 20, total: 21 });
  assert.deepEqual(page.donors[0].reportedBloodGroup, { bloodGroupId: '2', code: 'O+' });
  assert.deepEqual(page.donors[0].confirmedBloodGroup, { bloodGroupId: '4', code: 'A+' });
  assert.equal(calls[0].values[0], 'ACTIVE');
  assert.deepEqual(calls[0].values.slice(1, 5), Array(4).fill('%50!%!_!!%'));
  assert.deepEqual(calls[0].values.slice(-2), ['2', '2']);
  assert.match(calls[1].sql, /ORDER BY d\.full_name ASC, d\.account_id ASC LIMIT \? OFFSET \?$/u);
  assert.deepEqual(calls[1].values.slice(-2), [20, 20]);
  for (const call of calls) assert.doesNotMatch(call.sql, /SELECT \*|password_hash|session_data|eligibility|medical/iu);
});

test('Admin Donor detail uses a safe fixed projection and high-level booking/donation context only', async () => {
  const calls = [];
  const database = { async execute(sql, values) {
    calls.push(sql.replace(/\s+/gu, ' ').trim());
    if (sql.includes('FROM Donor d JOIN Account a') && sql.includes('WHERE d.account_id')) return [[{
      donorId: '41', email: 'safe@example.test', accountStatus: 'PENDING', fullName: 'Fixture', dateOfBirth: '1990-01-01',
      phone: '100', address: 'Address', area: null, reportedBloodGroupId: '2', reportedBloodGroupCode: 'O+', reportedBloodGroupName: 'O positive',
      confirmedBloodGroupId: null, confirmedBloodGroupCode: null, confirmedBloodGroupName: null, createdAt: '2026-10-01 10:00:00', updatedAt: '2026-10-01 10:00:00' }]];
    return [[{ bookingCount: '2', donationCount: '1', latestBookingStatus: 'COMPLETED', latestAppointmentAt: '2026-10-02 10:00:00',
      latestDonationOutcome: 'COLLECTED', latestReleaseStatus: 'APPROVED', latestCollectedAt: '2026-10-02 11:00:00' }]];
  } };
  const donor = await createAdminDonorRepository(database).detail(null, '41');
  assert.equal(donor.reportedBloodGroup.code, 'O+'); assert.equal(donor.confirmedBloodGroup, null);
  assert.match(calls[0], /JOIN Account a ON a\.account_id = d\.account_id AND a\.role = 'DONOR'/u);
  assert.deepEqual(donor.context, { bookingCount: 2, donationCount: 1,
    latestBooking: { bookingStatus: 'COMPLETED', appointmentAt: '2026-10-02 10:00:00' },
    latestDonation: { outcome: 'COLLECTED', releaseStatus: 'APPROVED', collectedAt: '2026-10-02T11:00:00+05:30' } });
  assert.equal(calls.every(sql => !/SELECT \*|password_hash|session_data|EligibilityDecision|collection_reference|staff_note/iu.test(sql)), true);
  assert.equal((calls[1].match(/ORDER BY b\.status_changed_at DESC, b\.booking_id DESC LIMIT 1/gu) ?? []).length, 2,
    'Latest booking status and appointment time use the same row ordering.');
});
