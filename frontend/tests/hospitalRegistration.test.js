import assert from 'node:assert/strict';
import { test } from 'node:test';
import { emptyHospitalRegistration, hospitalRegistrationError, validateHospitalRegistration } from '../src/features/hospitals/registration.js';

const valid = { email: ' Hospital@Example.Test ', password: ' exact pass7! ', organizationName: ' Hospital ',
  registrationNumber: ' REG-1 ', contactName: ' Contact ', phone: ' +91 (44) 123-456 ', address: ' Address ' };

test('Hospital registration starts empty with only the approved input fields', () => {
  const values = emptyHospitalRegistration();
  assert.deepEqual(Object.keys(values).sort(), ['address', 'contactName', 'email', 'organizationName', 'password', 'phone', 'registrationNumber']);
  assert.ok(Object.values(values).every((value) => value === ''));
  values.email = 'changed';
  assert.equal(emptyHospitalRegistration().email, '');
});

test('registration validates required fields and explicitly permits an optional registration number', () => {
  const checked = validateHospitalRegistration(emptyHospitalRegistration());
  assert.equal(checked.valid, false);
  assert.deepEqual(Object.keys(checked.errors).sort(), ['address', 'contactName', 'email', 'organizationName', 'password', 'phone']);
  for (const registrationNumber of [undefined, null, '', '   ']) {
    const result = validateHospitalRegistration({ ...valid, registrationNumber });
    assert.equal(result.valid, true);
    assert.equal(result.values.registrationNumber, null);
  }
});

test('registration normalizes only the seven allowlisted values and preserves the exact password', () => {
  const checked = validateHospitalRegistration({ ...valid, accountId: '999', role: 'ADMIN', accountStatus: 'ACTIVE', createdAt: 'forged' });
  assert.equal(checked.valid, true);
  assert.deepEqual(checked.values, { email: 'hospital@example.test', password: valid.password, organizationName: 'Hospital',
    registrationNumber: 'REG-1', contactName: 'Contact', phone: '+91 (44) 123-456', address: 'Address' });
});

test('registration follows Unicode character limits and existing phone rules', () => {
  for (const [field, limit] of Object.entries({ organizationName: 180, registrationNumber: 80, contactName: 120, phone: 30, address: 255 })) {
    const character = field === 'phone' ? '1' : '🏥';
    assert.equal(validateHospitalRegistration({ ...valid, [field]: character.repeat(limit) }).valid, true);
    assert.ok(validateHospitalRegistration({ ...valid, [field]: character.repeat(limit + 1) }).errors[field]);
    assert.ok(validateHospitalRegistration({ ...valid, [field]: 'bad\u0000value' }).errors[field]);
    for (const value of [[], {}, 12]) assert.ok(validateHospitalRegistration({ ...valid, [field]: value }).errors[field]);
  }
  for (const phone of ['call me', '++ ()', 'phone7']) assert.ok(validateHospitalRegistration({ ...valid, phone }).errors.phone);
  assert.ok(validateHospitalRegistration({ ...valid, email: 'incorrect' }).errors.email);
  assert.ok(validateHospitalRegistration({ ...valid, email: `${'x'.repeat(250)}@e.test` }).errors.email);
});

test('registration password validation uses code points, UTF-8 bytes, number, symbol and control rules', () => {
  for (const password of ['short7!', 'no digits!', 'no symbols7', 'bad\u0000password7!', 'a'.repeat(71) + '7!', null]) {
    assert.ok(validateHospitalRegistration({ ...valid, password }).errors.password);
  }
  assert.equal(validateHospitalRegistration({ ...valid, password: 'a'.repeat(70) + '7!' }).valid, true);
  assert.equal(validateHospitalRegistration({ ...valid, password: '🏥'.repeat(17) + 'a7!' }).valid, true);
  assert.ok(validateHospitalRegistration({ ...valid, password: '🏥'.repeat(18) + '7!' }).errors.password);
});

test('duplicate email and registration conflicts map to the corresponding fields', () => {
  const conflict = (code) => ({ response: { status: 409, data: { error: { code, message: 'Safe conflict response.' } } } });
  assert.match(hospitalRegistrationError(conflict('EMAIL_CONFLICT')).fields.email, /already exists/);
  assert.match(hospitalRegistrationError(conflict('HOSPITAL_REGISTRATION_CONFLICT')).fields.registrationNumber, /already in use/);
});

test('safe backend field errors are retained while unknown response properties are ignored', () => {
  const detail = hospitalRegistrationError({ response: { data: { error: { message: 'Check your details.',
    fields: { email: 'Use a valid email.', phone: 'Use a valid phone.', accountId: 'not displayed', passwordHash: 'not displayed' } } } } });
  assert.deepEqual(detail, { message: 'Check your details.', fields: { email: 'Use a valid email.', phone: 'Use a valid phone.' } });
  assert.deepEqual(hospitalRegistrationError(new Error('raw internal failure')), {
    message: 'Registration is temporarily unavailable. Please try again.', fields: {},
  });
  assert.deepEqual(hospitalRegistrationError({ response: { data: { error: {
    message: 'Check the highlighted fields.', fields: { form: 'Enter valid Hospital organization and contact details.' },
  } } } }), { message: 'Enter valid Hospital organization and contact details.', fields: {} });
});
