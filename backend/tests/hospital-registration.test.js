import assert from 'node:assert/strict';
import { test } from 'node:test';
import bcrypt from 'bcrypt';
import { createApp } from '../src/app.js';
import { environment } from '../src/config/environment.js';
import { createAuthRuntime } from '../src/modules/auth/router.js';
import { createAuthRepository } from '../src/modules/auth/repository.js';
import { createAuthService } from '../src/modules/auth/service.js';
import { validateHospitalRegistration } from '../src/modules/auth/validation.js';
import { createHospitalRouter } from '../src/modules/hospitals/router.js';
import { hospitalRegistrationDatabase } from './helpers/hospital-registration-database.mjs';

const valid = { email: ' Hospital@Example.Test ', password: 'hospital pass7!', organizationName: ' Hospital name ',
  registrationNumber: ' REG-1 ', contactName: ' Contact name ', phone: ' +91 (44) 1234-5678 ', address: ' Hospital address ' };
const normalized = { ...valid, email: 'hospital@example.test', organizationName: 'Hospital name', registrationNumber: 'REG-1',
  contactName: 'Contact name', phone: '+91 (44) 1234-5678', address: 'Hospital address' };
const rejected = (error) => error.status === 422 && error.code === 'VALIDATION_ERROR';

function fastService(database) {
  return createAuthService({ repository: createAuthRepository(database), passwordHasher: { hash: async () => 'isolated-test-hash' } });
}

test('Hospital registration normalizes the seven approved fields and preserves the exact password', () => {
  assert.deepEqual(validateHospitalRegistration(valid), normalized);
  for (const registrationNumber of [undefined, null, '', '   ']) {
    assert.equal(validateHospitalRegistration({ ...valid, registrationNumber }).registrationNumber, null);
  }
  assert.equal(validateHospitalRegistration({ ...valid, password: ' exact password7! ' }).password, ' exact password7! ');
});

test('Hospital registration rejects privilege, ownership, credential and timestamp overrides', () => {
  for (const field of ['accountId', 'account_id', 'hospitalId', 'role', 'accountStatus', 'account_status', 'passwordHash',
    'createdAt', 'updatedAt', 'created_at', 'updated_at', 'confirmedBloodGroupId', '__proto__']) {
    const body = { ...valid, [field]: 'forged' };
    assert.throws(() => validateHospitalRegistration(body), rejected);
  }
});

test('Hospital registration validates required values, lengths, phone formatting, email and password policy', () => {
  for (const [field, limit] of Object.entries({ organizationName: 180, registrationNumber: 80, contactName: 120, phone: 30, address: 255 })) {
    const character = field === 'phone' ? '1' : '🏥';
    assert.equal([...validateHospitalRegistration({ ...valid, [field]: character.repeat(limit) })[field]].length, limit);
    for (const value of [character.repeat(limit + 1), {}, [], 123, 'bad\u0000value']) {
      assert.throws(() => validateHospitalRegistration({ ...valid, [field]: value }), rejected);
    }
    if (field !== 'registrationNumber') {
      for (const value of [undefined, null, '', ' ']) {
        assert.throws(() => validateHospitalRegistration({ ...valid, [field]: value }), rejected);
      }
    }
  }
  for (const body of [undefined, null, [], 'text', { ...valid, email: 'invalid' }, { ...valid, email: 'x'.repeat(255) },
    { ...valid, phone: 'call me' }, { ...valid, phone: '++ ()' }]) assert.throws(() => validateHospitalRegistration(body), rejected);
  for (const password of ['short7!', 'no digits!', 'no symbols7', 'a'.repeat(71) + '7!','hospital\u0000 pass7!', null]) {
    assert.throws(() => validateHospitalRegistration({ ...valid, password }), rejected);
  }
  assert.equal(validateHospitalRegistration({ ...valid, password: 'a'.repeat(70) + '7!' }).password.length, 72);
});

test('Account and Hospital creation use one connection, server-assigned values and a safe profile before commit', async () => {
  const database = hospitalRegistrationDatabase();
  database.nextId = 9007199254740993n;
  const result = await fastService(database).registerHospital(validateHospitalRegistration(valid));
  assert.deepEqual(database.events, ['acquire', 'begin', 'account', 'hospital', 'profile', 'commit', 'release']);
  assert.equal(result.accountId, '9007199254740993');
  assert.equal(result.hospitalId, result.accountId);
  assert.equal(result.accountStatus, 'PENDING');
  assert.equal(result.profile.hospitalId, result.accountId);
  const stored = database.accounts.get(result.accountId);
  assert.equal(stored.role, 'HOSPITAL');
  assert.equal(stored.accountStatus, 'PENDING');
  assert.equal(stored.email, normalized.email);
  assert.equal(database.donors.size, 0);
  assert.equal(database.profiles.size, 1);
  assert.doesNotMatch(JSON.stringify(result), /password|email|hash|session|csrf/iu);
});

for (const stage of ['acquire', 'begin', 'account', 'hospital', 'profile', 'commit']) {
  test(`${stage} failure never returns success or leaves a committed Account/Hospital pair`, async () => {
    const database = hospitalRegistrationDatabase();
    database.failStages.add(stage);
    await assert.rejects(fastService(database).registerHospital(normalized), (error) =>
      error.status === 503 && error.code === 'DATABASE_UNAVAILABLE' && !/private|SELECT/u.test(error.message));
    assert.equal(database.accounts.size, 0);
    assert.equal(database.profiles.size, 0);
    assert.equal(database.transactions.committed, 0);
    assert.equal(database.transactions.released, stage === 'acquire' ? 0 : 1);
    assert.equal(database.transactions.rolledBack, ['acquire', 'begin'].includes(stage) ? 0 : 1);
  });
}

test('rollback failure destroys the connection instead of returning an uncertain transaction to the pool', async () => {
  const database = hospitalRegistrationDatabase();
  database.failStages.add('hospital');
  database.failStages.add('rollback');
  await assert.rejects(fastService(database).registerHospital(normalized), (error) => error.status === 503 && error.code === 'DATABASE_UNAVAILABLE');
  assert.equal(database.destroyed, 1);
  assert.equal(database.transactions.released, 0);
  assert.deepEqual(database.events.slice(-2), ['rollback', 'destroy']);
  assert.equal(database.accounts.size, 0);
});

test('unsafe generated numeric IDs and missing inserted profiles roll back the new Account', async () => {
  for (const configure of [(database) => { database.insertIdOverride = Number.MAX_SAFE_INTEGER + 1; },
    (database) => { database.missingInsertedProfile = true; }]) {
    const database = hospitalRegistrationDatabase();
    configure(database);
    await assert.rejects(fastService(database).registerHospital(normalized), (error) => error.status === 503);
    assert.equal(database.accounts.size, 0);
    assert.equal(database.profiles.size, 0);
    assert.equal(database.transactions.rolledBack, 1);
    assert.equal(database.transactions.released, 1);
  }
});

test('bcrypt failure and missing database configuration return safe service errors', async () => {
  const database = hospitalRegistrationDatabase();
  const service = createAuthService({ repository: createAuthRepository(database),
    passwordHasher: { hash: async () => { throw new Error('private hash detail'); } } });
  await assert.rejects(service.registerHospital(normalized), (error) => error.status === 503 && error.code === 'AUTHENTICATION_UNAVAILABLE');
  assert.equal(database.events.length, 0);
  await assert.rejects(fastService(null).registerHospital(normalized), (error) => error.status === 503 && error.code === 'DATABASE_NOT_CONFIGURED');
});

async function start(t) {
  const database = hospitalRegistrationDatabase();
  const authRuntime = createAuthRuntime({ databasePool: database,
    env: { SESSION_SECRET: 'hospital-registration-isolated-secret-at-least-32-bytes' } });
  const server = createApp({ authRuntime, hospitalRouter: createHospitalRouter({ databasePool: database }),
    verifyDatabase: async () => { throw new Error('Live database access is forbidden.'); } }).listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  });
  async function request(path, { method = 'GET', cookie, csrf, body, origin = environment.frontendUrl } = {}) {
    return fetch(`http://127.0.0.1:${server.address().port}/api${path}`, { method,
      headers: { Origin: origin, ...(cookie ? { Cookie: cookie } : {}), ...(csrf ? { 'X-CSRF-Token': csrf } : {}),
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  }
  const boot = await request('/auth/csrf');
  assert.equal(boot.status, 200);
  const session = { cookie: boot.headers.get('set-cookie').split(';', 1)[0], csrf: (await boot.json()).csrfToken };
  const register = (body = valid, options = {}) => request('/auth/register/hospitals', { ...session, method: 'POST', body, ...options });
  return { database, request, session, register };
}

async function expectError(response, status, code) {
  assert.equal(response.status, status);
  const body = await response.json();
  assert.equal(body.success, false);
  assert.equal(body.error.code, code);
  assert.doesNotMatch(JSON.stringify(body), /private-registration|password_hash|\$2[aby]\$|SELECT |stack/u);
  assert.ok(!JSON.stringify(body).includes(valid.password));
  return body;
}

test('HTTP registration hashes with bcrypt cost 12, returns the safe contract and requires explicit login', async (t) => {
  const { database, request, session, register } = await start(t);
  const response = await register();
  assert.equal(response.status, 201);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const body = await response.json();
  assert.deepEqual(body, { success: true, accountId: '1000', hospitalId: '1000', accountStatus: 'PENDING', profile: {
    hospitalId: '1000', organizationName: normalized.organizationName, registrationNumber: 'REG-1', contactName: normalized.contactName,
    phone: normalized.phone, address: normalized.address, createdAt: '2026-10-25T04:30:00.000Z',
    updatedAt: '2026-10-25T04:30:00.000Z', accountStatus: 'PENDING',
  } });
  const account = database.accounts.get('1000');
  assert.match(account.passwordHash, /^\$2[aby]\$12\$/u);
  assert.equal(await bcrypt.compare(valid.password, account.passwordHash), true);
  assert.equal(account.email, normalized.email);
  assert.equal(account.role, 'HOSPITAL');
  assert.equal(account.accountStatus, 'PENDING');
  assert.doesNotMatch(JSON.stringify(body), /password|email|hash|session|csrf/iu);
  await expectError(await request('/auth/me', session), 401, 'AUTHENTICATION_REQUIRED');
  await expectError(await request('/hospitals/me', session), 401, 'AUTHENTICATION_REQUIRED');
  assert.ok([...database.sessions.values()].every((row) => !row.session_data || !JSON.parse(row.session_data).auth));
  const login = await request('/auth/login', { ...session, method: 'POST', body: { email: normalized.email, password: valid.password } });
  assert.equal(login.status, 200);
  const cookie = login.headers.get('set-cookie').split(';', 1)[0];
  const profile = await request('/hospitals/me', { cookie });
  assert.equal(profile.status, 200);
  assert.deepEqual((await profile.json()).profile, body.profile);
});

test('duplicate normalized email conflicts across roles without creating another Hospital', async (t) => {
  const { database, register } = await start(t);
  database.accounts.set('21', { accountId: '21', email: normalized.email, role: 'DONOR', accountStatus: 'ACTIVE', passwordHash: 'never returned' });
  await expectError(await register(), 409, 'EMAIL_CONFLICT');
  assert.equal(database.accounts.size, 1);
  assert.equal(database.profiles.size, 0);
  assert.equal(database.transactions.rolledBack, 1);
});

test('duplicate registration numbers conflict safely and roll back the second Account', async (t) => {
  const { database, register } = await start(t);
  assert.equal((await register()).status, 201);
  await expectError(await register({ ...valid, email: 'second@example.test', registrationNumber: 'reg-1' }),
    409, 'HOSPITAL_REGISTRATION_CONFLICT');
  assert.equal(database.accounts.size, 1);
  assert.equal(database.profiles.size, 1);
  assert.equal(database.transactions.committed, 1);
  assert.equal(database.transactions.rolledBack, 1);
});

test('omitted, null and blank registration numbers allow separate Hospital registrations', async (t) => {
  const { database, register } = await start(t);
  for (const [index, registrationNumber] of [undefined, null, '', '  '].entries()) {
    const response = await register({ ...valid, email: `optional${index}@example.test`, registrationNumber });
    assert.equal(response.status, 201);
    assert.equal((await response.json()).profile.registrationNumber, null);
  }
  assert.equal(database.accounts.size, 4);
  assert.equal(database.profiles.size, 4);
});

test('HTTP validation rejects forged privileges and bad details without reaching a transaction', async (t) => {
  const { database, register } = await start(t);
  for (const body of [{ ...valid, role: 'ADMIN', accountStatus: 'ACTIVE', accountId: '31' },
    { ...valid, organizationName: '' }, { ...valid, password: 'short' }, { ...valid, registrationNumber: 'X'.repeat(81) }]) {
    await expectError(await register(body), 422, 'VALIDATION_ERROR');
  }
  assert.equal(database.events.length, 0);
  assert.equal(database.accounts.size, 0);
});

test('registration requires same-session CSRF and the configured supplied Origin', async (t) => {
  const { database, request, register } = await start(t);
  const other = await request('/auth/csrf');
  const otherCsrf = (await other.json()).csrfToken;
  for (const csrf of [undefined, 'invalid', otherCsrf]) await expectError(await register(valid, { csrf }), 403, 'CSRF_TOKEN_INVALID');
  await expectError(await register(valid, { origin: 'https://untrusted.invalid' }), 403, 'ORIGIN_NOT_ALLOWED');
  assert.equal(database.events.length, 0);
  assert.equal(database.accounts.size, 0);
});

test('Hospital rate limiting preserves independent Donor registration and login behavior', async (t) => {
  const { database, request, session, register } = await start(t);
  for (let attempt = 0; attempt < 5; attempt += 1) await expectError(await register({}), 422, 'VALIDATION_ERROR');
  const limited = await register();
  await expectError(limited, 429, 'RATE_LIMITED');
  assert.ok(Number(limited.headers.get('retry-after')) > 0);
  assert.equal(database.accounts.size, 0);
  const donor = await request('/auth/register/donors', { ...session, method: 'POST', body: {
    fullName: 'Isolated donor', email: 'donor@example.test', password: valid.password, dateOfBirth: '1990-01-01', phone: '123', address: 'Address',
  } });
  assert.equal(donor.status, 201);
  assert.deepEqual(await donor.json(), { success: true, accountId: '1000', donorId: '1000', accountStatus: 'PENDING' });
  assert.equal(database.accounts.get('1000').role, 'DONOR');
  assert.equal(database.donors.size, 1);
  assert.equal(database.profiles.size, 0);
  await expectError(await request('/auth/me', session), 401, 'AUTHENTICATION_REQUIRED');
  const login = await request('/auth/login', { ...session, method: 'POST', body: { email: 'donor@example.test', password: valid.password } });
  assert.equal(login.status, 200);
  assert.equal((await login.json()).user.role, 'DONOR');
});

test('HTTP transaction failures hide driver details and leave no orphaned records', async (t) => {
  const { database, register } = await start(t);
  database.failStages.add('hospital');
  await expectError(await register(), 503, 'DATABASE_UNAVAILABLE');
  assert.equal(database.accounts.size, 0);
  assert.equal(database.profiles.size, 0);
  assert.equal(database.transactions.rolledBack, 1);
  assert.equal(database.transactions.released, 1);
});

test('public Admin registration and unrelated administrative routes remain unmounted', async (t) => {
  const { database, request, session } = await start(t);
  for (const path of ['/auth/register/admins', '/auth/register/admin', '/admin/hospitals', '/admin/accounts']) {
    await expectError(await request(path, { ...session, method: 'POST', body: { ...valid, role: 'ADMIN' } }), 404, 'NOT_FOUND');
  }
  assert.equal(database.accounts.size, 0);
});
