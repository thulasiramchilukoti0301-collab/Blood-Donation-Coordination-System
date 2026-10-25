import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHospitalRepository } from '../src/modules/hospitals/repository.js';
import { createHospitalService } from '../src/modules/hospitals/service.js';
import { accountId, validateContactPatch, validateHospitalDetails, validateHospitalQuery } from '../src/modules/hospitals/validation.js';
import { errorHandler } from '../src/middleware/errorHandler.js';

const principal = { accountId: '12' };
const profile = { hospitalId: '12', organizationName: 'Example Hospital', registrationNumber: null,
  contactName: 'Contact', phone: '+91 12345', address: 'Example address', accountStatus: 'ACTIVE' };
const errorCode = (status, code) => (error) => error.status === status && error.code === code;
function mockRepository(overrides = {}) {
  const calls = [];
  const repository = {
    async findAccountById(id, options) { calls.push(['account', id, options]); return { accountId: id, role: 'HOSPITAL', accountStatus: 'ACTIVE' }; },
    async findProfileByAccountId(id, options) { calls.push(['profile', id, options]); return { ...profile, hospitalId: id }; },
    async updateContactProfile(id, patch) { calls.push(['update', id, patch]); return { ...profile, ...patch }; },
    async listHospitals(query) { calls.push(['list', query]); return { hospitals: [profile], pagination: { page: 1, pageSize: 20, total: 1 } }; },
    async withTransaction(work) { calls.push(['transaction']); return work(repository); },
    ...overrides,
  };
  return { repository, calls, service: createHospitalService({ repository }) };
}

test('full detail validation trims all five fields and normalizes optional registration', () => {
  const input = { organizationName: ' Hospital ', contactName: ' Contact ', phone: ' +91 (123) 456-789 ', address: ' Address ' };
  assert.deepEqual(validateHospitalDetails(input), { organizationName: 'Hospital', registrationNumber: null,
    contactName: 'Contact', phone: '+91 (123) 456-789', address: 'Address' });
  assert.equal(validateHospitalDetails({ ...input, registrationNumber: ' REG-1 ' }).registrationNumber, 'REG-1');
  assert.equal(validateHospitalDetails({ ...input, registrationNumber: '  ' }).registrationNumber, null);
});

test('full detail validation enforces types, required values, controls and schema lengths', () => {
  const valid = { organizationName: 'Hospital', registrationNumber: 'REG-1', contactName: 'Contact', phone: '123', address: 'Address' };
  for (const [key, max] of Object.entries({ organizationName: 180, registrationNumber: 80, contactName: 120, phone: 30, address: 255 })) {
    const character = key === 'phone' ? '1' : 'X';
    assert.equal(validateHospitalDetails({ ...valid, [key]: character.repeat(max) })[key].length, max);
    for (const value of [character.repeat(max + 1), {}, [], 4, 'bad\u0000text']) {
      assert.throws(() => validateHospitalDetails({ ...valid, [key]: value }), errorCode(400, 'VALIDATION_ERROR'));
    }
    if (key !== 'registrationNumber') {
      for (const value of [null, '', '  ', undefined]) assert.throws(() => validateHospitalDetails({ ...valid, [key]: value }), errorCode(400, 'VALIDATION_ERROR'));
    }
  }
  assert.throws(() => validateHospitalDetails({ ...valid, phone: 'call-me' }), errorCode(400, 'VALIDATION_ERROR'));
  assert.throws(() => validateHospitalDetails({ ...valid, role: 'ADMIN' }), errorCode(400, 'VALIDATION_ERROR'));
  assert.equal(validateHospitalDetails({ ...valid, organizationName: '🏥'.repeat(180) }).organizationName.length, 360);
});

test('PATCH allowlist rejects ownership, identity, organization, registration and timestamp overrides', () => {
  assert.deepEqual(validateContactPatch({ contactName: ' Updated ', phone: ' 123 ', address: ' Road ' }),
    { contactName: 'Updated', phone: '123', address: 'Road' });
  for (const input of [null, [], {}, 'text', { account_id: '99' }, { accountId: '99' }, { hospitalId: '99' },
    { role: 'ADMIN' }, { accountStatus: 'ACTIVE' }, { organizationName: 'New' }, { registrationNumber: 'New' },
    { updated_at: '2000-01-01' }, { updatedAt: '2000-01-01' }, JSON.parse('{"__proto__":{}}')]) {
    assert.throws(() => validateContactPatch(input), errorCode(400, 'VALIDATION_ERROR'));
  }
});

test('IDs preserve unsigned BIGINT precision and reject unsafe or injected identifiers', () => {
  assert.equal(accountId('18446744073709551615'), '18446744073709551615');
  assert.equal(accountId(12), '12');
  for (const id of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, '18446744073709551616', '01', '1 OR 1=1', null, {}, true]) {
    assert.throws(() => accountId(id), errorCode(400, 'VALIDATION_ERROR'));
  }
});

test('Admin list accepts only documented filters with bounded internal pagination', () => {
  assert.deepEqual(validateHospitalQuery({ search: ' Hospital ', accountStatus: 'PENDING', page: '2' }),
    { search: 'Hospital', accountStatus: 'PENDING', page: 2 });
  assert.deepEqual(validateHospitalQuery(), { search: '', accountStatus: undefined, page: 1 });
  for (const query of [{ page: 0 }, { page: '1.5' }, { page: '1e2' }, { page: 1e20 }, { page: true }, { search: [] },
    { search: 'X'.repeat(181) }, { accountStatus: 'active' }, { accountStatus: ['ACTIVE'] }, { pageSize: 999 }, { sort: 'DROP' }]) {
    assert.throws(() => validateHospitalQuery(query), errorCode(400, 'VALIDATION_ERROR'));
  }
});

test('own reads use the session-linked ID and permit current PENDING hospital accounts', async () => {
  const { service, calls } = mockRepository({ async findAccountById() { return { role: 'HOSPITAL', accountStatus: 'PENDING' }; } });
  assert.equal((await service.getOwnProfile(principal)).hospitalId, '12');
  assert.equal(calls.find(([name]) => name === 'profile')[1], '12');
});

test('missing identity never reaches the repository', async () => {
  const { service, calls } = mockRepository();
  for (const identity of [undefined, {}, { account_id: '12' }, { accountId: 'invalid' }]) {
    await assert.rejects(service.getOwnProfile(identity), errorCode(401, 'UNAUTHENTICATED'));
    await assert.rejects(service.updateOwnProfile(identity, { phone: '123' }), errorCode(401, 'UNAUTHENTICATED'));
  }
  assert.equal(calls.length, 0);
});

test('current database role/status overrides forged or stale principal claims', async () => {
  for (const current of [null, { role: 'DONOR', accountStatus: 'ACTIVE' }, { role: 'ADMIN', accountStatus: 'ACTIVE' },
    { role: 'HOSPITAL', accountStatus: 'SUSPENDED' }, { role: 'HOSPITAL', accountStatus: 'UNKNOWN' }]) {
    const { service, calls } = mockRepository({ async findAccountById() { return current; } });
    await assert.rejects(service.getOwnProfile({ ...principal, role: 'HOSPITAL', accountStatus: 'ACTIVE' }),
      errorCode(current ? 403 : 401, current ? 'FORBIDDEN' : 'UNAUTHENTICATED'));
    assert.equal(calls.length, 0);
  }
});

test('own update validates first, locks/rechecks Account and updates only allowed normalized fields', async () => {
  const { service, calls } = mockRepository();
  const result = await service.updateOwnProfile(principal, { contactName: ' Updated ', phone: '123' });
  assert.equal(result.contactName, 'Updated');
  assert.deepEqual(calls.map(([name]) => name), ['account', 'transaction', 'account', 'profile', 'update']);
  assert.deepEqual(calls[2], ['account', '12', { forUpdate: true }]);
  assert.deepEqual(calls[3], ['profile', '12', { forUpdate: true }]);
  assert.deepEqual(calls[4], ['update', '12', { contactName: 'Updated', phone: '123' }]);
  calls.length = 0;
  await assert.rejects(service.updateOwnProfile(principal, { phone: '123', accountId: '99' }), errorCode(400, 'VALIDATION_ERROR'));
  assert.deepEqual(calls.map(([name]) => name), ['account']);
});

test('suspension between initial read and transaction blocks the update', async () => {
  let accountReads = 0;
  const { service, calls } = mockRepository({ async findAccountById() {
    return { role: 'HOSPITAL', accountStatus: ++accountReads === 1 ? 'ACTIVE' : 'SUSPENDED' };
  } });
  await assert.rejects(service.updateOwnProfile(principal, { phone: '123' }), errorCode(403, 'FORBIDDEN'));
  assert.ok(!calls.some(([name]) => name === 'update'));
});

test('missing own/Admin profile returns safe not-found and missing update never writes', async () => {
  const { service, calls, repository } = mockRepository({ async findProfileByAccountId() { return null; } });
  await assert.rejects(service.getOwnProfile(principal), errorCode(404, 'HOSPITAL_NOT_FOUND'));
  await assert.rejects(service.updateOwnProfile(principal, { phone: '123' }), errorCode(404, 'HOSPITAL_NOT_FOUND'));
  assert.ok(!calls.some(([name]) => name === 'update'));
  repository.findAccountById = async () => ({ role: 'ADMIN', accountStatus: 'ACTIVE' });
  await assert.rejects(service.getHospitalProfileForAdmin(principal, '99'), errorCode(404, 'HOSPITAL_NOT_FOUND'));
});

test('only current ACTIVE Admin can list or read a selected Hospital profile', async () => {
  for (const current of [{ role: 'HOSPITAL', accountStatus: 'ACTIVE' }, { role: 'ADMIN', accountStatus: 'PENDING' }, { role: 'ADMIN', accountStatus: 'SUSPENDED' }]) {
    const { service, calls } = mockRepository({ async findAccountById() { return current; } });
    await assert.rejects(service.listHospitals(principal, {}), errorCode(403, 'FORBIDDEN'));
    await assert.rejects(service.getHospitalProfileForAdmin(principal, '99'), errorCode(403, 'FORBIDDEN'));
    assert.equal(calls.length, 0);
  }
  const { service, calls } = mockRepository({ async findAccountById() { return { role: 'ADMIN', accountStatus: 'ACTIVE' }; } });
  assert.equal((await service.getHospitalProfileForAdmin(principal, '99')).hospitalId, '99');
  await service.listHospitals(principal, { search: ' Name ', page: '2' });
  assert.deepEqual(calls.find(([name]) => name === 'list')[1], { search: 'Name', accountStatus: undefined, page: 2 });
});

test('repository binds identifiers, registration and contact values without projecting secrets', async () => {
  const calls = [];
  const repository = createHospitalRepository({ async execute(sql, values) { calls.push([sql, values]); return [[profile]]; } });
  await repository.findProfileByAccountId('18446744073709551615');
  await repository.findAccountIdByRegistrationNumber("REG' OR 1=1 --");
  await repository.updateContactProfile('12', { contactName: "O'Neil", address: 'Road ?' });
  assert.deepEqual(calls[0][1], ['18446744073709551615']);
  assert.deepEqual(calls[1][1], ["REG' OR 1=1 --"]);
  assert.deepEqual(calls[2][1], ["O'Neil", 'Road ?', '12']);
  assert.match(calls[2][0], /updated_at = CURRENT_TIMESTAMP WHERE account_id = \?/);
  for (const [sql] of calls) {
    assert.doesNotMatch(sql, /O'Neil|REG'|password_hash|\bemail\b|SELECT \*/);
  }
  await assert.rejects(repository.updateContactProfile('12', { 'address = NULL; DROP TABLE Account': 'bad' }));
  assert.equal(calls.length, 4);
});

test('Admin search parameters escape LIKE wildcards and share filters with the count query', async () => {
  const calls = [];
  const repository = createHospitalRepository({ async execute(sql, values) {
    calls.push([sql, values]); return sql.includes('COUNT(*)') ? [[{ total: 7 }]] : [[profile]];
  } });
  const result = await repository.listHospitals({ search: "50%_! O'Neil", accountStatus: 'ACTIVE', page: 2 });
  assert.deepEqual(result.pagination, { page: 2, pageSize: 20, total: 7 });
  assert.deepEqual(calls[0][1], [...Array(4).fill("%50!%!_!! O'Neil%"), 'ACTIVE']);
  assert.deepEqual(calls[1][1], [...calls[0][1], 20, 20]);
  assert.match(calls[1][0], /LIMIT \? OFFSET \?/);
  assert.doesNotMatch(calls[1][0], /O'Neil|password_hash/);
});

test('unchanged-value update does not confuse affectedRows=0 with missing profile', async () => {
  const repository = createHospitalRepository({ async execute(sql) {
    return sql.startsWith('UPDATE') ? [{ affectedRows: 0 }] : [[profile]];
  } });
  assert.deepEqual(await repository.updateContactProfile('12', { phone: '123' }), profile);
});

test('duplicate registration and raw driver failures produce safe structured HTTP errors', async () => {
  for (const [driver, expectedStatus, expectedCode] of [
    [{ code: 'ER_DUP_ENTRY', sqlMessage: "synthetic-sensitive-value uq_hospital_registration_number" }, 409, 'HOSPITAL_REGISTRATION_CONFLICT'],
    [{ code: 'ER_DUP_ENTRY', sqlMessage: 'synthetic-sensitive-value PRIMARY' }, 409, 'HOSPITAL_CONFLICT'],
    [new Error('synthetic-sensitive-value SELECT internal'), 503, 'DATABASE_UNAVAILABLE'],
  ]) {
    const repository = createHospitalRepository({ async execute() { throw driver; } });
    let failure;
    try { await repository.findProfileByAccountId('12'); } catch (error) { failure = error; }
    assert.ok(errorCode(expectedStatus, expectedCode)(failure));
    let status;
    let body;
    const response = { status(value) { status = value; return this; }, json(value) { body = value; } };
    errorHandler(failure, {}, response, () => assert.fail('Unexpected next'));
    assert.equal(status, expectedStatus);
    assert.equal(body.error.code, expectedCode);
    assert.doesNotMatch(JSON.stringify(body), /synthetic-sensitive-value|SELECT|sqlMessage|stack/);
  }
  const { service } = mockRepository({ async findAccountById() { throw new Error('synthetic-sensitive-value'); } });
  await assert.rejects(service.getOwnProfile(principal), errorCode(503, 'DATABASE_UNAVAILABLE'));
});

test('repository transaction commits on success and always releases', async () => {
  const events = [];
  const connection = { execute: async () => [[profile]], beginTransaction: async () => events.push('begin'),
    commit: async () => events.push('commit'), rollback: async () => events.push('rollback'), release: () => events.push('release') };
  const repository = createHospitalRepository({ execute: async () => [], getConnection: async () => connection });
  assert.deepEqual(await repository.withTransaction((transaction) => transaction.findProfileByAccountId('12')), profile);
  assert.deepEqual(events, ['begin', 'commit', 'release']);
});

test('transaction failure, commit failure and rollback failure never expose driver details or leak connections', async () => {
  for (const scenario of ['work', 'commit', 'rollback', 'begin']) {
    const events = [];
    const fail = () => { throw new Error('synthetic-sensitive-value'); };
    const connection = { execute: async () => [], beginTransaction: async () => { events.push('begin'); if (scenario === 'begin') fail(); },
      commit: async () => { events.push('commit'); if (scenario === 'commit') fail(); },
      rollback: async () => { events.push('rollback'); if (scenario === 'rollback') fail(); }, release: () => events.push('release') };
    const repository = createHospitalRepository({ execute: async () => [], getConnection: async () => connection });
    await assert.rejects(repository.withTransaction(async () => { if (scenario === 'work' || scenario === 'rollback') fail(); }),
      errorCode(503, 'DATABASE_UNAVAILABLE'));
    assert.equal(events.at(-1), 'release');
    assert.equal(events.includes('rollback'), scenario !== 'begin');
  }
});
