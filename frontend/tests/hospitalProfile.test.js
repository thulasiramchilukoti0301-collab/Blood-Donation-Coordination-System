import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  createHospitalContactPatch, formatHospitalTimestamp, hospitalContactValues,
  hospitalProfileError, isHospitalProfile, validateHospitalContact,
} from '../src/features/hospitals/profile.js';

const saved = { hospitalId: '9007199254740993', organizationName: 'Isolated test Hospital', registrationNumber: null,
  contactName: 'Contact', phone: '+91 44 1234', address: 'Address', accountStatus: 'PENDING',
  createdAt: '2026-10-25T04:30:00.000Z', updatedAt: '2026-10-25T04:30:00.000Z' };

test('Hospital contact validation trims only contact fields using backend limits and phone rules', () => {
  const validation = validateHospitalContact({ contactName: ' Contact ', phone: ' +91 (44) 123-456 ', address: ' Address ' });
  assert.equal(validation.valid, true);
  assert.deepEqual(validation.values, { contactName: 'Contact', phone: '+91 (44) 123-456', address: 'Address' });
  for (const [field, max] of Object.entries({ contactName: 120, phone: 30, address: 255 })) {
    const value = field === 'phone' ? '1' : '🏥';
    assert.equal(validateHospitalContact({ ...saved, [field]: value.repeat(max) }).valid, true);
    for (const invalid of [undefined, null, '', '  ', value.repeat(max + 1), 'bad\u0000value', {}, []]) {
      assert.ok(validateHospitalContact({ ...saved, [field]: invalid }).errors[field]);
    }
  }
  for (const phone of ['call me', '+ ()', '123\n456']) assert.ok(validateHospitalContact({ ...saved, phone }).errors.phone);
});

test('Hospital PATCH includes only changed normalized allowlisted contact fields', () => {
  assert.deepEqual(createHospitalContactPatch({ ...saved, contactName: ' Contact ', phone: ' 123 ',
    accountId: '31', hospitalId: '31', role: 'ADMIN', organizationName: 'Changed', registrationNumber: 'Changed' }, saved), { phone: '123' });
  assert.deepEqual(createHospitalContactPatch(saved, saved), {});
  assert.deepEqual(Object.keys(hospitalContactValues(saved)).sort(), ['address', 'contactName', 'phone']);
  assert.deepEqual(hospitalContactValues(null), { contactName: '', phone: '', address: '' });
});

test('Hospital profile accepts PENDING/ACTIVE only and preserves exact owner BIGINT string identity', () => {
  assert.equal(isHospitalProfile(saved, saved.hospitalId), true);
  assert.equal(isHospitalProfile({ ...saved, accountStatus: 'ACTIVE' }, saved.hospitalId), true);
  for (const profile of [null, {}, { ...saved, hospitalId: '9007199254740992' }, { ...saved, hospitalId: 12 },
    { ...saved, accountStatus: 'SUSPENDED' }, { ...saved, contactName: '' }, { ...saved, registrationNumber: {} },
    { ...saved, createdAt: 'invalid date' }]) assert.equal(isHospitalProfile(profile, saved.hospitalId), false);
});

test('Hospital timestamps use explicit India timezone and never fabricate missing values', () => {
  assert.match(formatHospitalTimestamp('2026-10-25T04:30:00.000Z'), /25 Oct 2026.*10:00/iu);
  for (const timestamp of [null, undefined, '', 'not-a-date', 0]) assert.equal(formatHospitalTimestamp(timestamp), 'Not available');
});

test('Hospital API error handling exposes only relevant field errors and distinguishes missing/access failures', () => {
  const missing = hospitalProfileError({ response: { status: 404, data: { error: { code: 'HOSPITAL_NOT_FOUND', message: 'Profile not found.' } } } });
  assert.equal(missing.missing, true);
  assert.equal(missing.message, 'Profile not found.');
  const validation = hospitalProfileError({ response: { status: 400, data: { error: { message: 'Invalid input.',
    fields: { phone: 'Enter a phone.', accountId: 'Do not expose.', address: {} } } } } });
  assert.deepEqual(validation.fields, { phone: 'Enter a phone.' });
  for (const status of [401, 403]) assert.equal(hospitalProfileError({ response: { status } }).accessDenied, true);
  for (const code of ['CSRF_TOKEN_INVALID', 'ORIGIN_NOT_ALLOWED']) {
    assert.equal(hospitalProfileError({ response: { status: 403, data: { error: { code } } } }).accessDenied, false);
  }
  assert.equal(hospitalProfileError({ response: { status: 503 } }).accessDenied, false);
  assert.equal(hospitalProfileError(new Error('private detail')).message.includes('private detail'), false);
});
