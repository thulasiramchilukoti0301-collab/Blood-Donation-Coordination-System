import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import session from 'express-session';
import { createApp } from '../src/app.js';
import { environment } from '../src/config/environment.js';
import { createAuthRouter, createAuthRuntime } from '../src/modules/auth/router.js';
import { validateDonorProfilePatch } from '../src/modules/auth/validation.js';
import { createDonorRepository } from '../src/modules/donors/repository.js';
import { createDonorProfileService } from '../src/modules/donors/service.js';
import { HttpError } from '../src/utils/httpError.js';

const accountId = '18446744073709551615';
const saved = Object.freeze({
  accountId, email: 'donor@example.test', accountStatus: 'PENDING',
  fullName: 'Sample Donor', dateOfBirth: '1990-01-01', phone: '+91 90000 00000',
  address: '12 Example Road', area: 'Central',
  reportedBloodGroup: { id: '4', code: 'A+', displayName: 'A positive' },
  confirmedBloodGroup: null,
});

test('PATCH validates only supplied profile fields using registration conventions', () => {
  assert.deepEqual(validateDonorProfilePatch({
    fullName: '  A😀  ', phone: ' +91 123 ', address: ' Road ', area: '  ',
  }), { fullName: 'A😀', phone: '+91 123', address: 'Road', area: null });
  assert.deepEqual(validateDonorProfilePatch({ area: null }), { area: null });
  assert.deepEqual(validateDonorProfilePatch({ area: '  ' }), { area: null });
  assert.deepEqual(validateDonorProfilePatch({ reportedBloodGroupId: '4' }), { reportedBloodGroupId: '4' });
  assert.deepEqual(validateDonorProfilePatch({ reportedBloodGroupId: null }), { reportedBloodGroupId: null });
  assert.deepEqual(validateDonorProfilePatch({ reportedBloodGroupId: '' }), { reportedBloodGroupId: null });
  assert.deepEqual(validateDonorProfilePatch({ fullName: '😀'.repeat(120) }), { fullName: '😀'.repeat(120) });
  for (const body of [null, [], 'name', 7, {}, new Date(), { accountId }, { email: 'new@example.test' },
    { dateOfBirth: '2000-01-01' }, { confirmedBloodGroupId: '1' },
    { role: 'ADMIN' }, { accountStatus: 'ACTIVE' }, { password: 'secret' }, { updatedAt: 'today' }]) {
    assert.throws(() => validateDonorProfilePatch(body),
      (error) => error instanceof HttpError && error.code === 'VALIDATION_ERROR');
  }
  for (const field of ['fullName', 'phone', 'address']) {
    for (const value of ['', '  ', null, 9, '\nValue', 'A\u007fB', 'x'.repeat({ fullName: 121, phone: 31, address: 256 }[field])]) {
      assert.throws(() => validateDonorProfilePatch({ [field]: value }),
        (error) => error.code === 'VALIDATION_ERROR' && Boolean(error.fields[field]));
    }
  }
  assert.throws(() => validateDonorProfilePatch({ area: 'x'.repeat(101) }),
    (error) => error.code === 'VALIDATION_ERROR' && Boolean(error.fields.area));
  assert.throws(() => validateDonorProfilePatch({ area: 'bad\narea' }),
    (error) => error.code === 'VALIDATION_ERROR' && Boolean(error.fields.area));
  for (const id of ['-1', 'x', '0', '18446744073709551616', 1.5, {}, true]) {
    assert.throws(() => validateDonorProfilePatch({ reportedBloodGroupId: id }),
      (error) => error.code === 'VALIDATION_ERROR' && Boolean(error.fields.reportedBloodGroupId));
  }
});

function transactionFixture({ status = 'PENDING', role = 'DONOR', donorPresent = true, groupPresent = true, initialGroupId = '4',
  updateError, commitError, rollbackError } = {}) {
  const calls = [];
  const rows = { ...saved, accountStatus: status, reportedBloodGroupId: initialGroupId };
  const connection = {
    async beginTransaction() { calls.push('begin'); },
    async execute(sql, values) {
      if (sql.includes('FROM Account') && sql.includes('FOR UPDATE')) {
        calls.push('lock-account');
        assert.deepEqual(values, [accountId]);
        return [[{ account_id: accountId, role, account_status: status }]];
      }
      if (sql.includes('FROM Donor') && sql.includes('FOR UPDATE')) {
        calls.push('lock-donor');
        return [donorPresent ? [{ account_id: accountId }] : []];
      }
      if (sql.includes('FROM BloodGroup')) {
        calls.push('lookup-group');
        return [groupPresent ? [{ blood_group_id: values[0] }] : []];
      }
      if (sql.startsWith('UPDATE Donor')) {
        calls.push('update');
        assert.match(sql, /updated_at = CURRENT_TIMESTAMP/);
        assert.doesNotMatch(sql, /confirmed_blood_group_id|account_status|date_of_birth|email/);
        assert.equal(values.at(-1), accountId);
        if (updateError) throw updateError;
        const properties = { full_name: 'fullName', phone: 'phone', address: 'address', area: 'area', reported_blood_group_id: 'reportedBloodGroupId' };
        const columns = [...sql.matchAll(/(full_name|phone|address|area|reported_blood_group_id) = \?/gu)].map((match) => match[1]);
        columns.forEach((column, index) => { rows[properties[column]] = values[index]; });
        return [{ affectedRows: 0 }];
      }
      if (sql.includes('FROM Donor AS d')) {
        calls.push('read-profile');
        return [[{
          account_id: accountId, email: rows.email, account_status: status,
          full_name: rows.fullName, date_of_birth: rows.dateOfBirth,
          phone: rows.phone, address: rows.address, area: rows.area,
          reported_blood_group_id: rows.reportedBloodGroupId === undefined ? '4' : rows.reportedBloodGroupId,
          reported_blood_group_code: rows.reportedBloodGroupId === '2' ? 'O+' : 'A+',
          reported_blood_group_name: rows.reportedBloodGroupId === '2' ? 'O positive' : 'A positive',
          confirmed_blood_group_id: null,
        }]];
      }
      throw new Error('Unexpected query.');
    },
    async commit() { calls.push('commit'); if (commitError) throw commitError; },
    async rollback() { calls.push('rollback'); if (rollbackError) throw rollbackError; },
    release() { calls.push('release'); },
  };
  return { calls, rows, connection, repository: createDonorRepository({ async getConnection() { calls.push('connection'); return connection; } }) };
}

test('repository locks Account before Donor, uses fixed columns and same connection, commits unchanged updates', async () => {
  const fixture = transactionFixture();
  const service = createDonorProfileService({ repository: fixture.repository });
  const result = await service.updateOwnProfile(accountId, { fullName: ' Sample Donor ', area: null });
  assert.equal(result.accountId, accountId);
  assert.equal(result.area, null);
  assert.equal(result.email, saved.email);
  assert.equal(result.dateOfBirth, saved.dateOfBirth);
  assert.deepEqual(result.reportedBloodGroup, saved.reportedBloodGroup);
  assert.deepEqual(fixture.calls, ['connection', 'begin', 'lock-account', 'lock-donor', 'update', 'read-profile', 'commit', 'release']);
  const connection = fixture.connection;
  const originalExecute = connection.execute;
  connection.execute = async (sql, values) => {
    if (sql.startsWith('UPDATE Donor')) {
      assert.match(sql, /full_name = \?, area = \?/);
      assert.doesNotMatch(sql, /email|date_of_birth|blood_group|account_status|password/);
      assert.deepEqual(values, ['Sample Donor', null, accountId]);
    }
    return originalExecute(sql, values);
  };
  await service.updateOwnProfile(accountId, { fullName: ' Sample Donor ', area: null });
  const active = transactionFixture({ status: 'ACTIVE' });
  const activeProfile = await createDonorProfileService({ repository: active.repository })
    .updateOwnProfile(accountId, { phone: ' 456 ' });
  assert.equal(activeProfile.phone, '456');
  assert.equal(activeProfile.accountStatus, 'ACTIVE');
});

test('reported group selection, change, clearing, and omission preserve confirmation', async () => {
  const fixture = transactionFixture();
  const service = createDonorProfileService({ repository: fixture.repository });
  const changed = await service.updateOwnProfile(accountId, { reportedBloodGroupId: '2' });
  assert.deepEqual(changed.reportedBloodGroup, { id: '2', code: 'O+', displayName: 'O positive' });
  assert.equal(changed.confirmedBloodGroup, null);
  assert.deepEqual(fixture.calls, ['connection', 'begin', 'lock-account', 'lock-donor', 'lookup-group', 'update', 'read-profile', 'commit', 'release']);
  const preserved = await service.updateOwnProfile(accountId, { phone: '456' });
  assert.equal(preserved.reportedBloodGroup.id, '2');
  assert.equal(preserved.phone, '456');
  const cleared = await service.updateOwnProfile(accountId, { reportedBloodGroupId: null });
  assert.equal(cleared.reportedBloodGroup, null);
  assert.equal(cleared.confirmedBloodGroup, null);
  const blank = transactionFixture({ initialGroupId: null });
  const selected = await createDonorProfileService({ repository: blank.repository })
    .updateOwnProfile(accountId, { reportedBloodGroupId: '2' });
  assert.equal(selected.reportedBloodGroup.id, '2');
});

test('missing reported group and FK race roll back without partial profile updates', async () => {
  for (const options of [
    { groupPresent: false, code: 'VALIDATION_ERROR', expectedCalls: ['lookup-group', 'rollback'] },
    { updateError: { code: 'ER_NO_REFERENCED_ROW_2' }, code: 'VALIDATION_ERROR', expectedCalls: ['update', 'rollback'] },
  ]) {
    const { code, expectedCalls, ...fixtureOptions } = options;
    const fixture = transactionFixture(fixtureOptions);
    const service = createDonorProfileService({ repository: fixture.repository });
    await assert.rejects(service.updateOwnProfile(accountId, { fullName: 'Changed', reportedBloodGroupId: '999' }),
      (error) => error instanceof HttpError && error.status === 422 && error.code === code
        && Boolean(error.fields.reportedBloodGroupId));
    for (const call of expectedCalls) assert.ok(fixture.calls.includes(call));
    assert.ok(!fixture.calls.includes('commit'));
    assert.equal(fixture.calls.at(-1), 'release');
    assert.equal(fixture.rows.fullName, saved.fullName);
  }
});

test('transaction rechecks role/status, missing Donor, rollback and release safely', async () => {
  for (const options of [
    { role: 'ADMIN', code: 'ACCOUNT_UNAVAILABLE' },
    { status: 'SUSPENDED', code: 'ACCOUNT_UNAVAILABLE' },
    { donorPresent: false, code: 'DONOR_PROFILE_UNAVAILABLE' },
    { updateError: new Error('private SQL password detail'), code: 'DATABASE_UNAVAILABLE' },
    { commitError: new Error('private commit detail'), code: 'DATABASE_UNAVAILABLE' },
    { rollbackError: new Error('private rollback detail'), updateError: new Error('private SQL'), code: 'DATABASE_UNAVAILABLE' },
  ]) {
    const { code, ...fixtureOptions } = options;
    const fixture = transactionFixture(fixtureOptions);
    const service = createDonorProfileService({ repository: fixture.repository });
    await assert.rejects(service.updateOwnProfile(accountId, { phone: '123' }),
      (error) => error instanceof HttpError && error.code === code && !/private|SQL|password/.test(error.message));
    assert.equal(fixture.calls.at(-1), 'release');
    assert.ok(fixture.calls.includes('rollback'));
    assert.ok(!fixture.calls.includes('commit') || options.commitError);
    if (code === 'ACCOUNT_UNAVAILABLE') assert.ok(!fixture.calls.includes('update'));
  }
});

const servers = [];
after(async () => {
  await Promise.all(servers.map((server) => new Promise((resolve) => server.close(resolve))));
});

async function start({ role = 'DONOR', status = 'PENDING', donorService } = {}) {
  let currentStatus = status;
  const authService = {
    currentAccount: async (id) => ({ accountId: id, role, accountStatus: currentStatus }),
    donorProfile: async () => saved,
    authenticate: async () => ({ accountId, role, accountStatus: currentStatus }),
  };
  const store = new session.MemoryStore();
  const runtime = {
    middleware: session({
      name: 'bdcs.sid', secret: 'test-only-secret-with-at-least-32-bytes', store,
      resave: false, saveUninitialized: false,
      cookie: { httpOnly: true, secure: false, sameSite: 'lax', path: '/', maxAge: 60_000 },
    }),
    router: createAuthRouter({ authService, donorService, sessionStore: store, frontendUrl: environment.frontendUrl }),
  };
  const server = createApp({ verifyDatabase: async () => true, authRuntime: runtime }).listen(0, '127.0.0.1');
  servers.push(server);
  await new Promise((resolve) => server.once('listening', resolve));
  return { base: `http://127.0.0.1:${server.address().port}`, setStatus(value) { currentStatus = value; } };
}

async function request(base, path, { method = 'GET', cookie, csrf, body, origin = environment.frontendUrl } = {}) {
  const headers = { Origin: origin };
  if (cookie) headers.Cookie = cookie;
  if (csrf) headers['X-CSRF-Token'] = csrf;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  return fetch(`${base}/api${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
}

async function signedIn(base) {
  const bootstrap = await request(base, '/auth/csrf');
  const csrf = (await bootstrap.json()).csrfToken;
  const originalCookie = bootstrap.headers.get('set-cookie')?.split(';', 1)[0];
  const login = await request(base, '/auth/login', {
    method: 'POST', cookie: originalCookie, csrf,
    body: { email: 'donor@example.test', password: 'test password7!' },
  });
  assert.equal(login.status, 200);
  const cookie = login.headers.get('set-cookie')?.split(';', 1)[0];
  const tokenResponse = await request(base, '/auth/csrf', { cookie });
  assert.equal(tokenResponse.status, 200);
  return { cookie, csrf: (await tokenResponse.json()).csrfToken };
}

test('HTTP PATCH uses authenticated session ID, safe response, pending/active access and no-store', async () => {
  for (const status of ['PENDING', 'ACTIVE']) {
    let selectedId;
    let selectedBody;
    const { base } = await start({
      status,
      donorService: { updateOwnProfile: async (id, body) => {
        selectedId = id;
        selectedBody = body;
        return { ...saved, accountStatus: status, phone: '456' };
      } },
    });
    const boot = await signedIn(base);
    const result = await request(base, '/donors/me', {
      method: 'PATCH', cookie: boot.cookie, csrf: boot.csrf, body: { phone: '456' },
    });
    assert.equal(result.status, 200);
    assert.equal(result.headers.get('cache-control'), 'no-store');
    assert.equal(selectedId, accountId);
    assert.deepEqual(selectedBody, { phone: '456' });
    const responseBody = await result.json();
    assert.equal(responseBody.profile.phone, '456');
    assert.doesNotMatch(JSON.stringify(responseBody), /password|session_data|hash/iu);
  }
});

test('HTTP PATCH denies unauthenticated, wrong-role, suspended, missing CSRF and rejected origin', async () => {
  for (const [role, status, expected] of [
    ['DONOR', 'PENDING', 200], ['ADMIN', 'ACTIVE', 403], ['HOSPITAL', 'PENDING', 403], ['DONOR', 'SUSPENDED', 401],
  ]) {
    let mutations = 0;
    const { base, setStatus } = await start({
      role, status,
      donorService: { updateOwnProfile: async () => { mutations += 1; return saved; } },
    });
    const unauthenticated = await request(base, '/donors/me', { method: 'PATCH', body: { phone: '456' } });
    assert.equal(unauthenticated.status, 401);
    if (status === 'SUSPENDED') setStatus('PENDING');
    const boot = await signedIn(base);
    if (status === 'SUSPENDED') setStatus('SUSPENDED');
    const valid = await request(base, '/donors/me', {
      method: 'PATCH', cookie: boot.cookie, csrf: boot.csrf, body: { phone: '456' },
    });
    assert.equal(valid.status, expected);
    if (status === 'SUSPENDED') {
      assert.equal((await valid.json()).error.code, 'ACCOUNT_UNAVAILABLE');
      assert.equal(mutations, 0);
      continue;
    }
    if (role !== 'DONOR') {
      assert.equal(mutations, 0);
      continue;
    }
    for (const csrf of [undefined, '0'.repeat(64)]) {
      const denied = await request(base, '/donors/me', {
        method: 'PATCH', cookie: boot.cookie, csrf, body: { phone: '456' },
      });
      assert.equal(denied.status, 403);
      assert.equal((await denied.json()).error.code, 'CSRF_TOKEN_INVALID');
    }
    const badOrigin = await request(base, '/donors/me', {
      method: 'PATCH', cookie: boot.cookie, csrf: boot.csrf, body: { phone: '456' },
      origin: 'https://other.example.test',
    });
    assert.equal(badOrigin.status, 403);
    assert.equal(mutations, 1);
  }
});

test('HTTP PATCH advertises credentialed CORS and sanitizes service failures', async () => {
  const { base } = await start({
    donorService: { updateOwnProfile: async () => { throw new Error('private SQL connection detail'); } },
  });
  const preflight = await fetch(`${base}/api/donors/me`, {
    method: 'OPTIONS',
    headers: {
      Origin: environment.frontendUrl,
      'Access-Control-Request-Method': 'PATCH',
      'Access-Control-Request-Headers': 'Content-Type,X-CSRF-Token',
    },
  });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('access-control-allow-credentials'), 'true');
  assert.match(preflight.headers.get('access-control-allow-methods'), /PATCH/);
  const boot = await signedIn(base);
  const response = await request(base, '/donors/me', {
    method: 'PATCH', cookie: boot.cookie, csrf: boot.csrf, body: { area: null },
  });
  assert.equal(response.status, 500);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.doesNotMatch(JSON.stringify(await response.json()), /private|SQL|connection/iu);
});

test('HTTP PATCH rejects protected/invalid payloads and reports safe missing-profile errors', async () => {
  let mutations = 0;
  let donorPresent = true;
  const donorService = createDonorProfileService({
    repository: { withTransaction: async (work) => work({
      findAccountForUpdate: async () => ({ role: 'DONOR', account_status: 'PENDING' }),
      findDonorForUpdate: async () => donorPresent ? { account_id: accountId } : null,
      updateProfile: async () => { mutations += 1; },
      findProfile: async () => saved,
    }) },
  });
  const { base } = await start({ donorService });
  const boot = await signedIn(base);
  for (const body of [
    {}, [], { fullName: '' }, { phone: null }, { address: 'x'.repeat(256) },
    { area: 'bad\narea' }, { accountId: '1' }, { email: 'other@example.test' },
    { dateOfBirth: '2001-01-01' }, { confirmedBloodGroupId: '1' },
    { reportedBloodGroupId: '2', confirmedBloodGroupId: '2' },
  ]) {
    const response = await request(base, '/donors/me', {
      method: 'PATCH', cookie: boot.cookie, csrf: boot.csrf, body,
    });
    assert.equal(response.status, 422);
    assert.equal((await response.json()).error.code, 'VALIDATION_ERROR');
  }
  assert.equal(mutations, 0);
  donorPresent = false;
  const missing = await request(base, '/donors/me', {
    method: 'PATCH', cookie: boot.cookie, csrf: boot.csrf, body: { area: null },
  });
  assert.equal(missing.status, 503);
  assert.equal((await missing.json()).error.code, 'DONOR_PROFILE_UNAVAILABLE');
  assert.equal(mutations, 0);
});

test('PATCH fails closed when authentication has no configured persistent session', async () => {
  const server = createApp({
    verifyDatabase: async () => true,
    authRuntime: createAuthRuntime({ env: {}, databasePool: null }),
  }).listen(0, '127.0.0.1');
  servers.push(server);
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const response = await request(base, '/donors/me', {
    method: 'PATCH', body: { phone: '123' },
  });
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error.code, 'AUTHENTICATION_NOT_CONFIGURED');
});
