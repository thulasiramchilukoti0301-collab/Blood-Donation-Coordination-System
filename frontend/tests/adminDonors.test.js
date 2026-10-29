import assert from 'node:assert/strict';
import { test } from 'node:test';
import { reportedBloodGroupChoices } from '../src/features/donors/bloodGroups.js';
import { canManageDonors, DEFAULT_DONOR_FILTERS, readAdminDonor, readAdminDonorPage, validateAdminDonorFilters } from '../src/features/donors/adminDonors.js';
import { createAdminDonorApi } from '../src/services/adminDonors.js';
import { bookingMutationMessage } from '../src/services/bookingApi.js';

const donor = { donorId: '41', email: 'safe@example.test', accountStatus: 'ACTIVE', fullName: 'Fixture Donor', dateOfBirth: '1990-01-01',
  phone: '555-0141', address: 'Fixture address', area: null,
  reportedBloodGroup: { bloodGroupId: '2', code: 'O+', displayName: 'O positive' },
  confirmedBloodGroup: { bloodGroupId: '4', code: 'A+', displayName: 'A positive' },
  createdAt: '2026-10-28T04:30:00.000Z', updatedAt: '2026-10-28T05:00:00.000Z',
  context: { bookingCount: 2, donationCount: 1, latestBooking: { bookingStatus: 'COMPLETED', appointmentAt: '2026-10-27T10:00:00+05:30' },
    latestDonation: { outcome: 'COLLECTED', releaseStatus: 'APPROVED', collectedAt: '2026-10-27T11:00:00+05:30' } } };
const page = rows => ({ success: true, donors: rows, pagination: { page: 1, pageSize: 20, total: rows.length } });
const response = data => ({ status: 200, data });

test('Admin Donor page authorization and filter validation use exact bounded values', () => {
  assert.equal(canManageDonors({ accountId: '31', role: 'ADMIN', accountStatus: 'ACTIVE' }), true);
  for (const user of [{ accountId: '31', role: 'DONOR', accountStatus: 'ACTIVE' }, { accountId: '31', role: 'ADMIN', accountStatus: 'PENDING' },
    { accountId: '01', role: 'ADMIN', accountStatus: 'ACTIVE' }]) assert.equal(canManageDonors(user), false);
  assert.deepEqual(DEFAULT_DONOR_FILTERS, { search: '', accountStatus: 'ANY', bloodGroupId: '', groupMatch: 'EITHER' });
  assert.equal(validateAdminDonorFilters({ search: ' name ', accountStatus: 'SUSPENDED', bloodGroupId: '8', groupMatch: 'CONFIRMED' }).valid, true);
  for (const input of [{ search: 'x'.repeat(121) }, { search: 'bad\u0000' }, { accountStatus: 'active' },
    { bloodGroupId: '01' }, { groupMatch: 'BOTH' }]) assert.equal(validateAdminDonorFilters(input).valid, false);
});

test('canonical group mapping is shared and response projection preserves reported/confirmed distinction', () => {
  assert.deepEqual(reportedBloodGroupChoices.map(({ id, code }) => [id, code]),
    [['1', 'O-'], ['2', 'O+'], ['3', 'A-'], ['4', 'A+'], ['5', 'B-'], ['6', 'B+'], ['7', 'AB-'], ['8', 'AB+']]);
  const safe = readAdminDonor({ ...donor, passwordHash: 'SECRET', sessionData: 'SECRET', eligibilityAnswers: ['private'], latestDecision: 'PRIVATE' }, '41');
  assert.equal(safe.reportedBloodGroup.code, 'O+'); assert.equal(safe.confirmedBloodGroup.code, 'A+');
  assert.equal(Object.hasOwn(safe, 'passwordHash'), false); assert.equal(Object.hasOwn(safe, 'eligibilityAnswers'), false);
  assert.equal(Object.hasOwn(safe, 'latestDecision'), false);
  for (const invalid of [{ ...donor, donorId: '0' }, { ...donor, accountStatus: 'UNKNOWN' }, { ...donor, confirmedBloodGroup: { bloodGroupId: '2', code: 'bad' } },
    { ...donor, context: { bookingCount: -1, donationCount: 0 } }]) assert.equal(readAdminDonor(invalid), null);
  const read = readAdminDonorPage(page([{ donorId: '41', fullName: donor.fullName, phone: donor.phone, area: null, accountStatus: 'ACTIVE',
    reportedBloodGroup: { bloodGroupId: '2', code: 'O+' }, confirmedBloodGroup: { bloodGroupId: '4', code: 'A+' }, passwordHash: 'SECRET' }]), 1);
  assert.equal(read.donors[0].confirmedBloodGroup.code, 'A+'); assert.equal(Object.hasOwn(read.donors[0], 'passwordHash'), false);
});

test('list/detail use exact read routes and PATCH gets fresh CSRF, fixed body, and strict response matching', async () => {
  const calls = []; let mode = 'success';
  const client = {
    async get(path, config) { calls.push(['get', path, config]);
      if (path === '/auth/csrf') return response({ success: true, csrfToken: 'a'.repeat(64) });
      if (path === '/admin/donors') return response(page([{ donorId: '41', fullName: donor.fullName, phone: donor.phone, area: null,
        accountStatus: 'ACTIVE', reportedBloodGroup: { bloodGroupId: '2', code: 'O+' }, confirmedBloodGroup: { bloodGroupId: '4', code: 'A+' } }]));
      return response({ success: true, donor });
    },
    async request(config) { calls.push(['request', config]);
      const saved = { ...donor, area: config.data.area };
      return response({ success: true, donor: mode === 'success' ? saved : { ...saved, donorId: '42' } });
    },
  };
  const api = createAdminDonorApi(client);
  const listing = await api.list({ ...DEFAULT_DONOR_FILTERS, search: 'Fixture', bloodGroupId: '2', groupMatch: 'REPORTED' }, 1);
  assert.equal(listing.donors[0].reportedBloodGroup.code, 'O+');
  assert.deepEqual(calls[0][2].params, { page: 1, search: 'Fixture', bloodGroupId: '2', groupMatch: 'REPORTED' });
  assert.equal((await api.detail('41')).donorId, '41');
  const saved = await api.update({ donor, patch: { area: '' }, originalValues: { area: null }, reasonCode: 'STAFF_PROFILE_CORRECTION' }, { isCurrent: () => true });
  assert.equal(saved.area, null);
  const request = calls.find(([kind]) => kind === 'request')[1];
  assert.equal(request.url, '/admin/donors/41'); assert.deepEqual(request.data, { area: null, originalValues: { area: null }, reasonCode: 'STAFF_PROFILE_CORRECTION' });
  assert.equal(request.headers['X-CSRF-Token'], 'a'.repeat(64));
  mode = 'malformed';
  await assert.rejects(api.update({ donor, patch: { area: '' }, originalValues: { area: null }, reasonCode: 'STAFF_PROFILE_CORRECTION' }, { isCurrent: () => true }), error => error.code === 'MUTATION_OUTCOME_UNKNOWN');
  assert.equal(calls.filter(([kind]) => kind === 'request').length, 2, 'No automatic mutation retry is performed.');
});

test('dispatched validation rejection remains definite while transport failure is uncertain', () => {
  const validation = { mutationDispatched: true, response: { status: 422, data: { error: { message: 'Check the field.' } } } };
  assert.equal(bookingMutationMessage(validation).kind, 'error');
  assert.equal(bookingMutationMessage({ mutationDispatched: true, code: 'ECONNABORTED' }).kind, 'uncertain');
});
