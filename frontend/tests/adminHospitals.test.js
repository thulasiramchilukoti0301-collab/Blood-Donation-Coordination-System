import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  adminHospitalError, adminHospitalPageSummary, canManageHospitals, HOSPITAL_ACCOUNT_STATUSES,
  isHospitalIdentifier, readAdminHospitalPage, readAdminHospitalProfile, validateAdminHospitalFilters,
} from '../src/features/hospitals/adminHospitals.js';

// Isolated response fixtures only: these tests never open a database connection.
const hospital = { hospitalId: '9007199254740993', organizationName: 'Isolated Hospital',
  registrationNumber: null, contactName: 'Contact', phone: '+91 44 1234', address: 'Address',
  accountStatus: 'PENDING', createdAt: '2026-10-25T04:30:00.000Z', updatedAt: '2026-10-25T05:00:00.000Z' };
const page = (changes = {}) => ({ hospitals: [hospital], pagination: { page: 1, pageSize: 20, total: 1 }, ...changes });

test('Admin Hospital management requires an ACTIVE ADMIN with an exact valid Account identity', () => {
  const account = { accountId: '12', role: 'ADMIN', accountStatus: 'ACTIVE' };
  assert.equal(canManageHospitals(account), true);
  for (const user of [null, {}, { ...account, role: 'HOSPITAL' }, { ...account, role: 'DONOR' },
    { ...account, accountStatus: 'PENDING' }, { ...account, accountStatus: 'SUSPENDED' },
    { ...account, accountId: 12 }, { ...account, accountId: '0' }]) assert.equal(canManageHospitals(user), false);
});

test('Hospital IDs preserve unsigned BIGINT strings and reject malformed or lossy identities', () => {
  for (const id of ['1', '9007199254740993', '18446744073709551615']) assert.equal(isHospitalIdentifier(id), true);
  for (const id of [undefined, null, 1, 9007199254740992, '', '0', '01', '-1', '1.0', '1e2',
    ' 1', '18446744073709551616', '999999999999999999999', '1/../../accounts']) assert.equal(isHospitalIdentifier(id), false);
});

test('Hospital filters normalize approved search and status only using backend Unicode limits', () => {
  assert.deepEqual(validateAdminHospitalFilters({ search: '  Ward !_%  ', accountStatus: 'ACTIVE', role: 'ADMIN' }), {
    values: { search: 'Ward !_%', accountStatus: 'ACTIVE' }, errors: {}, valid: true,
  });
  assert.deepEqual(validateAdminHospitalFilters().values, { search: '', accountStatus: '' });
  for (const status of HOSPITAL_ACCOUNT_STATUSES) assert.equal(validateAdminHospitalFilters({ accountStatus: status }).valid, true);
  assert.equal(validateAdminHospitalFilters({ search: '🏥'.repeat(180) }).valid, true);
  for (const search of ['🏥'.repeat(181), 'bad\u0000input', 4, {}, []]) assert.equal(validateAdminHospitalFilters({ search }).valid, false);
  for (const accountStatus of ['active', 'ALL', null, {}, []]) assert.equal(validateAdminHospitalFilters({ accountStatus }).valid, false);
});

test('Admin may read Hospital profiles of every real account status without matching the Admin ID', () => {
  for (const accountStatus of HOSPITAL_ACCOUNT_STATUSES) {
    assert.deepEqual(readAdminHospitalProfile({ ...hospital, accountStatus }, hospital.hospitalId), { ...hospital, accountStatus });
  }
  assert.equal(readAdminHospitalProfile(hospital, '12'), null);
  assert.deepEqual(readAdminHospitalProfile({ ...hospital, registrationNumber: 'REG-1' }).registrationNumber, 'REG-1');
});

test('Admin response projection rejects malformed profiles and excludes credentials and unrelated fields', () => {
  const safe = readAdminHospitalProfile({ ...hospital, passwordHash: 'private', email: 'private',
    session: { id: 'private' }, requestSummary: { fabricated: 1 }, role: 'ADMIN', unrelatedHospital: hospital });
  assert.deepEqual(safe, hospital);
  assert.equal(JSON.stringify(safe).includes('private'), false);
  for (const invalid of [null, [], {}, { ...hospital, hospitalId: '01' }, { ...hospital, accountStatus: 'UNKNOWN' },
    { ...hospital, organizationName: '' }, { ...hospital, organizationName: 'x'.repeat(181) },
    { ...hospital, contactName: '\u0000' }, { ...hospital, phone: null }, { ...hospital, address: {} },
    { ...hospital, registrationNumber: '' }, { ...hospital, registrationNumber: 'x'.repeat(81) },
    { ...hospital, createdAt: 0 }, { ...hospital, updatedAt: 'not-a-date' }]) assert.equal(readAdminHospitalProfile(invalid), null);
});

test('Hospital result pages preserve server pagination and allow empty/out-of-range pages without inventing records', () => {
  assert.deepEqual(readAdminHospitalPage(page(), 1), page());
  assert.deepEqual(readAdminHospitalPage(page({ hospitals: [], pagination: { page: 4, pageSize: 20, total: 21 } }), 4), {
    hospitals: [], pagination: { page: 4, pageSize: 20, total: 21 },
  });
  const response = page({ hospitals: [{ ...hospital, passwordHash: 'secret' }], unrelated: 'secret' });
  assert.deepEqual(readAdminHospitalPage(response, 1), page());
  for (const response of [null, {}, page({ hospitals: null }), page({ hospitals: Array(21).fill(hospital) }),
    page({ hospitals: [hospital, hospital] }), page({ hospitals: [{ ...hospital, hospitalId: '0' }] }),
    page({ pagination: { page: 2, pageSize: 20, total: 1 } }), page({ pagination: { page: 1, pageSize: 10, total: 1 } }),
    page({ pagination: { page: 1, pageSize: 20, total: -1 } }),
    page({ pagination: { page: 1, pageSize: 20, total: '1' } }),
    page({ pagination: { page: 1, pageSize: 20, total: Number.MAX_SAFE_INTEGER + 1 } })]) {
    assert.equal(readAdminHospitalPage(response, 1), null);
  }
});

test('Hospital page controls use the real total and do not create a next-page loop for empty results', () => {
  assert.deepEqual(adminHospitalPageSummary({ page: 1, pageSize: 20, total: 0 }, 0),
    { pages: 1, first: 0, last: 0, previous: false, next: false });
  assert.deepEqual(adminHospitalPageSummary({ page: 2, pageSize: 20, total: 21 }, 1),
    { pages: 2, first: 21, last: 21, previous: true, next: false });
  assert.deepEqual(adminHospitalPageSummary({ page: 1, pageSize: 20, total: 21 }, 20),
    { pages: 2, first: 1, last: 20, previous: false, next: true });
  assert.deepEqual(adminHospitalPageSummary({ page: 4, pageSize: 20, total: 21 }, 0),
    { pages: 2, first: 0, last: 0, previous: true, next: false });
});

test('Admin list/detail failures use safe messages without exposing driver errors or secrets', () => {
  for (const status of [401, 403]) assert.equal(adminHospitalError({ response: { status } }).accessDenied, true);
  const missing = adminHospitalError({ response: { status: 404, data: { error: { code: 'HOSPITAL_NOT_FOUND' } } } }, 'detail');
  assert.equal(missing.missing, true);
  assert.match(missing.message, /no longer available/iu);
  assert.equal(adminHospitalError({ response: { status: 404 } }).missing, false);
  for (const status of [400, 500, 503]) {
    const error = { response: { status, data: { error: { message: 'SELECT password_hash private', fields: { secret: 'private' } } } } };
    assert.equal(adminHospitalError(error).message.includes('private'), false);
    assert.equal(adminHospitalError(error).message.includes('password_hash'), false);
    assert.equal(Object.hasOwn(adminHospitalError(error), 'fields'), false);
  }
  assert.match(adminHospitalError(new Error('private'), 'detail').message, /Hospital details/iu);
});
