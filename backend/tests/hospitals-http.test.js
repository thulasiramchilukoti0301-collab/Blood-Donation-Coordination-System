import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createApp } from '../src/app.js';
import { environment } from '../src/config/environment.js';
import { createAuthRuntime } from '../src/modules/auth/router.js';
import { createHospitalRouter } from '../src/modules/hospitals/router.js';
import { hospitalDatabase, testPassword } from './helpers/hospital-database.mjs';

async function start(t, { hospitalDatabaseAvailable = true } = {}) {
  const database = hospitalDatabase();
  // Exercise production login, guards, repositories and MySQL session-store
  // code. Only mysql2's dependency is replaced; no identity route is invented.
  const authRuntime = createAuthRuntime({ databasePool: database,
    env: { SESSION_SECRET: 'isolated-test-secret-at-least-32-bytes', SESSION_TTL_MINUTES: '5' } });
  const server = createApp({
    verifyDatabase: async () => { throw new Error('Live database access is forbidden in this test.'); },
    authRuntime,
    hospitalRouter: createHospitalRouter({ databasePool: hospitalDatabaseAvailable ? database : null }),
  }).listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  });
  const base = `http://127.0.0.1:${server.address().port}/api`;
  async function request(path, { method = 'GET', cookie, csrf, body, headers = {}, origin = environment.frontendUrl } = {}) {
    return fetch(`${base}${path}`, {
      method,
      headers: { Origin: origin, ...(cookie ? { Cookie: cookie } : {}),
        ...(csrf ? { 'X-CSRF-Token': csrf } : {}),
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  }
  async function bootstrap(cookie) {
    const response = await request('/auth/csrf', { cookie });
    assert.equal(response.status, 200);
    return { cookie: response.headers.get('set-cookie')?.split(';', 1)[0] ?? cookie,
      csrf: (await response.json()).csrfToken };
  }
  async function login(id = '12') {
    const anonymous = await bootstrap();
    const response = await request('/auth/login', { ...anonymous, method: 'POST',
      body: { email: `${id}@example.test`, password: testPassword } });
    assert.equal(response.status, 200);
    const cookie = response.headers.get('set-cookie').split(';', 1)[0];
    const session = await bootstrap(cookie);
    return { ...session, previousCsrf: anonymous.csrf };
  }
  return { database, request, bootstrap, login };
}

async function expectError(response, status, code) {
  assert.equal(response.status, status);
  const body = await response.json();
  assert.equal(body.success, false);
  assert.equal(body.error.code, code);
  assert.equal(typeof body.error.message, 'string');
  assert.deepEqual(Object.keys(body).sort(), ['error', 'success']);
  assert.doesNotMatch(JSON.stringify(body), /private-driver-detail|password_hash|stack|SELECT /u);
  return body;
}

function updates(database) {
  return database.calls.filter(({ sql }) => sql.startsWith('UPDATE Hospital'));
}

test('GET and PATCH require a verified session despite forged cookies and identity headers', async (t) => {
  const { request, database } = await start(t);
  for (const method of ['GET', 'PATCH']) {
    await expectError(await request('/hospitals/me?accountId=12&role=HOSPITAL', {
      method, cookie: 'bdcs.sid=forged', headers: { 'X-Account-Id': '12', 'X-Role': 'HOSPITAL' },
      ...(method === 'PATCH' ? { body: { phone: '123' } } : {}),
    }), 401, 'AUTHENTICATION_REQUIRED');
  }
  assert.equal(database.calls.length, 0);
});

test('a CSRF-bearing anonymous session still cannot PATCH a Hospital profile', async (t) => {
  const { request, database, bootstrap } = await start(t);
  const anonymous = await bootstrap();
  await expectError(await request('/hospitals/me', { ...anonymous, method: 'PATCH', body: { phone: '123' } }),
    401, 'AUTHENTICATION_REQUIRED');
  assert.equal(updates(database).length, 0);
});

for (const [id, status] of [['12', 'PENDING'], ['9007199254740993', 'ACTIVE']]) {
  test(`${status} Hospital reads and updates its own allowed fields using the approved envelope`, async (t) => {
    const { request, database, login } = await start(t);
    const session = await login(id);
    const original = structuredClone(database.profiles.get(id));
    const read = await request('/hospitals/me', session);
    assert.equal(read.status, 200);
    assert.equal(read.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await read.json(), { success: true, profile: {
      ...original, accountStatus: status, createdAt: original.createdAt.toISOString(), updatedAt: original.updatedAt.toISOString(),
    } });
    const changed = await request('/hospitals/me', { ...session, method: 'PATCH',
      body: { contactName: ' Updated contact ', phone: ' +91 (987) 654-321 ', address: ' Updated address ' } });
    assert.equal(changed.status, 200);
    assert.equal(changed.headers.get('cache-control'), 'no-store');
    const body = await changed.json();
    assert.deepEqual(body, { success: true, profile: {
      ...original, contactName: 'Updated contact', phone: '+91 (987) 654-321', address: 'Updated address',
      accountStatus: status, createdAt: original.createdAt.toISOString(), updatedAt: '2026-10-25T04:30:00.000Z',
    } });
    assert.doesNotMatch(JSON.stringify(body), /password|email|session|csrf/iu);
    assert.equal(body.profile.hospitalId, id);
    assert.deepEqual(database.transactions, { begun: 1, committed: 1, rolledBack: 0, released: 1 });
    const reread = await request('/hospitals/me', session);
    assert.deepEqual(await reread.json(), body);
    const partial = await request('/hospitals/me', { ...session, method: 'PATCH', body: { phone: '123' } });
    assert.equal(partial.status, 200);
    assert.equal((await partial.json()).profile.contactName, 'Updated contact');
  });
}

for (const [id, role] of [['21', 'DONOR'], ['31', 'ADMIN']]) {
  test(`${role} cannot GET or PATCH the Hospital self-profile`, async (t) => {
    const { request, database, login } = await start(t);
    const session = await login(id);
    const offset = database.calls.length;
    for (const method of ['GET', 'PATCH']) {
      await expectError(await request('/hospitals/me', { ...session, method,
        headers: { 'X-Role': 'HOSPITAL', 'X-Account-Id': '12' },
        ...(method === 'PATCH' ? { body: { phone: '123' } } : {}),
      }), 403, 'FORBIDDEN');
    }
    assert.equal(database.calls.slice(offset).some(({ sql }) => sql.includes('FROM Hospital')), false);
    assert.equal(updates(database).length, 0);
  });
}

test('suspension denies GET/PATCH, revokes the existing session and prevents cookie replay', async (t) => {
  for (const method of ['GET', 'PATCH']) {
    const { request, database, login } = await start(t);
    const session = await login();
    database.accounts.get('12').accountStatus = 'SUSPENDED';
    await expectError(await request('/hospitals/me', { ...session, method,
      ...(method === 'PATCH' ? { body: { phone: '123' } } : {}),
    }), 401, 'ACCOUNT_UNAVAILABLE');
    await expectError(await request('/hospitals/me', session), 401, 'AUTHENTICATION_REQUIRED');
    assert.ok([...database.sessions.values()].some((row) => row.revoked_at !== null && row.session_data === null));
    assert.equal(updates(database).length, 0);
  }
});

test('an already suspended Hospital cannot establish an authenticated session', async (t) => {
  const { request, database, bootstrap } = await start(t);
  database.accounts.get('12').accountStatus = 'SUSPENDED';
  const anonymous = await bootstrap();
  await expectError(await request('/auth/login', { ...anonymous, method: 'POST',
    body: { email: '12@example.test', password: testPassword } }), 401, 'INVALID_CREDENTIALS');
  await expectError(await request('/hospitals/me', anonymous), 401, 'AUTHENTICATION_REQUIRED');
});

test('deleted Accounts and changed roles invalidate the old Hospital session', async (t) => {
  for (const change of [(database) => database.accounts.delete('12'),
    (database) => { database.accounts.get('12').role = 'DONOR'; }]) {
    const { request, database, login } = await start(t);
    const session = await login();
    change(database);
    await expectError(await request('/hospitals/me', session), 401, 'ACCOUNT_UNAVAILABLE');
    assert.equal(updates(database).length, 0);
  }
});

test('query and header identity claims cannot select or update another Hospital', async (t) => {
  const { request, database, login } = await start(t);
  const session = await login();
  const other = structuredClone(database.profiles.get('9007199254740993'));
  const path = '/hospitals/me?accountId=9007199254740993&hospitalId=9007199254740993&role=ADMIN&accountStatus=ACTIVE';
  const headers = { 'X-Account-Id': '9007199254740993', 'X-Role': 'ADMIN' };
  const read = await request(path, { ...session, headers });
  assert.equal(read.status, 200);
  assert.equal((await read.json()).profile.hospitalId, '12');
  const patched = await request(path, { ...session, headers, method: 'PATCH', body: { phone: '123' } });
  assert.equal(patched.status, 200);
  const body = await patched.json();
  assert.equal(body.profile.hospitalId, '12');
  assert.equal(body.profile.accountStatus, 'PENDING');
  assert.equal(updates(database)[0].values.at(-1), '12');
  assert.deepEqual(database.profiles.get('9007199254740993'), other);
});

test('PATCH rejects read-only, ownership, role, status and malformed fields without writing', async (t) => {
  const { request, database, login } = await start(t);
  const session = await login();
  const original = structuredClone(database.profiles.get('12'));
  const forbidden = { organizationName: 'Changed', registrationNumber: 'Changed', accountId: '9007199254740993',
    account_id: '9007199254740993', hospitalId: '9007199254740993', role: 'ADMIN', accountStatus: 'ACTIVE',
    password: 'changed', updatedAt: '2000-01-01', createdAt: '2000-01-01' };
  for (const [field, value] of Object.entries(forbidden)) {
    await expectError(await request('/hospitals/me', { ...session, method: 'PATCH', body: { phone: '123', [field]: value } }),
      400, 'VALIDATION_ERROR');
  }
  for (const body of [{}, [], { phone: '' }, { phone: 'call me' },
    { contactName: ' ' }, { address: 'X'.repeat(256) }, { address: 'bad\u0000value' }, JSON.parse('{"__proto__":{}}')]) {
    await expectError(await request('/hospitals/me', { ...session, method: 'PATCH', body }), 400, 'VALIDATION_ERROR');
  }
  for (const body of [null, 'text']) {
    await expectError(await request('/hospitals/me', { ...session, method: 'PATCH', body }), 400, 'INVALID_JSON');
  }
  assert.equal(updates(database).length, 0);
  assert.deepEqual(database.profiles.get('12'), original);
});

test('PATCH rejects missing, incorrect, stale and other-session CSRF tokens', async (t) => {
  const { request, database, login } = await start(t);
  const session = await login();
  const otherSession = await login('9007199254740993');
  for (const csrf of [undefined, 'invalid', '0'.repeat(64), session.previousCsrf, otherSession.csrf]) {
    await expectError(await request('/hospitals/me', { cookie: session.cookie, csrf, method: 'PATCH', body: { phone: '123' } }),
      403, 'CSRF_TOKEN_INVALID');
  }
  assert.equal(updates(database).length, 0);
});

test('missing Hospital profiles return safe 404 responses and PATCH rolls back', async (t) => {
  const { request, database, login } = await start(t);
  const session = await login('14');
  for (const method of ['GET', 'PATCH']) {
    assert.deepEqual(await expectError(await request('/hospitals/me', { ...session, method,
      ...(method === 'PATCH' ? { body: { phone: '123' } } : {}),
    }), 404, 'HOSPITAL_NOT_FOUND'), {
      success: false, error: { code: 'HOSPITAL_NOT_FOUND', message: 'Hospital profile was not found.' },
    });
  }
  assert.equal(updates(database).length, 0);
  assert.deepEqual(database.transactions, { begun: 1, committed: 0, rolledBack: 1, released: 1 });
});

test('Hospital database failures return sanitized 503 responses and release failed transactions', async (t) => {
  const { request, database, login } = await start(t);
  const session = await login();
  database.failSql = (sql) => sql.includes('FROM Hospital');
  await expectError(await request('/hospitals/me', session), 503, 'DATABASE_UNAVAILABLE');
  database.failSql = (sql) => sql.startsWith('UPDATE Hospital');
  await expectError(await request('/hospitals/me', { ...session, method: 'PATCH', body: { phone: '123' } }),
    503, 'DATABASE_UNAVAILABLE');
  assert.equal(database.profiles.get('12').phone, '+91 12345');
  assert.deepEqual(database.transactions, { begun: 1, committed: 0, rolledBack: 1, released: 1 });
});

test('suspension after the HTTP guard is rechecked inside the Hospital update transaction', async (t) => {
  const { request, database, login } = await start(t);
  const session = await login();
  database.beforeTransaction = () => { database.accounts.get('12').accountStatus = 'SUSPENDED'; };
  await expectError(await request('/hospitals/me', { ...session, method: 'PATCH', body: { phone: '123' } }), 403, 'FORBIDDEN');
  assert.equal(updates(database).length, 0);
  assert.deepEqual(database.transactions, { begun: 1, committed: 0, rolledBack: 1, released: 1 });
  await expectError(await request('/hospitals/me', session), 401, 'ACCOUNT_UNAVAILABLE');
});

test('credentialed CORS permits PATCH and CSRF headers only for the configured frontend origin', async (t) => {
  const { request, database, login } = await start(t);
  const preflight = { method: 'OPTIONS', headers: { 'Access-Control-Request-Method': 'PATCH',
    'Access-Control-Request-Headers': 'content-type,x-csrf-token' } };
  const allowed = await request('/hospitals/me', preflight);
  assert.equal(allowed.status, 204);
  assert.equal(allowed.headers.get('access-control-allow-origin'), environment.frontendUrl);
  assert.equal(allowed.headers.get('access-control-allow-credentials'), 'true');
  assert.match(allowed.headers.get('access-control-allow-methods'), /\bPATCH\b/u);
  assert.doesNotMatch(allowed.headers.get('access-control-allow-methods'), /PUT|DELETE/u);
  assert.match(allowed.headers.get('access-control-allow-headers'), /x-csrf-token/iu);
  assert.equal(allowed.headers.get('set-cookie'), null);
  const denied = await request('/hospitals/me', { ...preflight, origin: 'https://untrusted.invalid' });
  await expectError(denied, 403, 'ORIGIN_NOT_ALLOWED');
  assert.equal(denied.headers.get('access-control-allow-origin'), null);
  const session = await login();
  await expectError(await request('/hospitals/me', { ...session, method: 'PATCH', origin: 'https://untrusted.invalid',
    body: { phone: '123' } }), 403, 'ORIGIN_NOT_ALLOWED');
  assert.equal(updates(database).length, 0);
});

test('logout invalidates the Hospital session for both GET and PATCH', async (t) => {
  const { request, login } = await start(t);
  const session = await login();
  const logout = await request('/auth/logout', { ...session, method: 'POST', body: {} });
  assert.equal(logout.status, 200);
  for (const method of ['GET', 'PATCH']) {
    await expectError(await request('/hospitals/me', { ...session, method,
      ...(method === 'PATCH' ? { body: { phone: '123' } } : {}),
    }), 401, 'AUTHENTICATION_REQUIRED');
  }
});

test('Admin donor PATCH is forbidden while unrelated Admin/Hospital mutations, requests and reports remain unmounted', async (t) => {
  const { request, database, login } = await start(t);
  const session = await login('31');
  await expectError(await request('/donors/me', {
    ...session, method: 'PATCH', body: { phone: '123' },
  }), 403, 'FORBIDDEN');
  for (const [method, path] of [
    ['POST', '/auth/register/admins'],
    ['PATCH', '/admin/hospitals/12'],
    ['GET', '/hospitals/me/requests'], ['POST', '/hospitals/me/requests'],
    ['GET', '/hospitals/me/reports/requests'],
    ['POST', '/hospitals/me'], ['DELETE', '/hospitals/me'],
  ]) {
    await expectError(await request(path, { ...session, method,
      ...(!['GET', 'DELETE'].includes(method) ? { body: { phone: '123' } } : {}),
    }), 404, 'NOT_FOUND');
  }
  assert.equal(updates(database).length, 0);
});

test('a missing Hospital database dependency fails closed without exposing profile data', async (t) => {
  const { request, login } = await start(t, { hospitalDatabaseAvailable: false });
  const session = await login();
  for (const method of ['GET', 'PATCH']) {
    await expectError(await request('/hospitals/me', { ...session, method,
      ...(method === 'PATCH' ? { body: { phone: '123' } } : {}),
    }), 503, 'DATABASE_NOT_CONFIGURED');
  }
});
