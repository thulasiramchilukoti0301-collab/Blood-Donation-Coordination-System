import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createApp } from '../src/app.js';
import { environment } from '../src/config/environment.js';
import { createAuthRuntime } from '../src/modules/auth/router.js';
import { createHospitalRouter } from '../src/modules/hospitals/router.js';
import { adminHospitalDatabase } from './helpers/admin-hospital-database.mjs';
import { testPassword } from './helpers/hospital-database.mjs';

const paths = ['/admin/hospitals', '/admin/hospitals/12'];
const profileKeys = ['address', 'accountStatus', 'contactName', 'createdAt', 'hospitalId',
  'organizationName', 'phone', 'registrationNumber', 'updatedAt'].sort();

async function start(t, { hospitalDatabaseAvailable = true } = {}) {
  const database = adminHospitalDatabase();
  const authRuntime = createAuthRuntime({ databasePool: database,
    env: { SESSION_SECRET: 'isolated-admin-test-secret-at-least-32-bytes', SESSION_TTL_MINUTES: '5' } });
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
  async function request(path, { method = 'GET', cookie, csrf, body, headers = {} } = {}) {
    return fetch(`${base}${path}`, { method,
      headers: { Origin: environment.frontendUrl, ...(cookie ? { Cookie: cookie } : {}),
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
  async function login(id = '31') {
    const anonymous = await bootstrap();
    const response = await request('/auth/login', { ...anonymous, method: 'POST',
      body: { email: `${id}@example.test`, password: testPassword } });
    assert.equal(response.status, 200);
    return { cookie: response.headers.get('set-cookie').split(';', 1)[0] };
  }
  return { database, request, bootstrap, login };
}

async function expectError(response, status, code) {
  assert.equal(response.status, status);
  const body = await response.json();
  assert.deepEqual(Object.keys(body).sort(), ['error', 'success']);
  assert.equal(body.success, false);
  assert.equal(body.error.code, code);
  assert.equal(typeof body.error.message, 'string');
  assert.doesNotMatch(JSON.stringify(body), /private-driver-detail|password_hash|stack|SELECT |session_data/iu);
  return body;
}

function hospitalCalls(database, offset = 0) {
  return database.calls.slice(offset).filter(({ sql }) => sql.includes('FROM Hospital'));
}

function addProfile(database, id, overrides = {}, accountStatus = 'ACTIVE') {
  database.accounts.set(id, { accountId: id, role: 'HOSPITAL', accountStatus });
  database.profiles.set(id, { ...database.profiles.get('12'), hospitalId: id,
    organizationName: `Directory Hospital ${id}`, ...overrides });
}

test('Admin Hospital list/detail require authentication despite forged identity headers or cookies', async (t) => {
  const { request, database, bootstrap } = await start(t);
  for (const path of paths) {
    await expectError(await request(path, { cookie: 'bdcs.sid=forged',
      headers: { 'X-Account-Id': '31', 'X-Role': 'ADMIN', 'X-Account-Status': 'ACTIVE' } }),
    401, 'AUTHENTICATION_REQUIRED');
  }
  const anonymous = await bootstrap();
  for (const path of paths) {
    await expectError(await request(path, anonymous), 401, 'AUTHENTICATION_REQUIRED');
  }
  assert.equal(hospitalCalls(database).length, 0);
});

test('ACTIVE Admin receives approved no-store list/detail envelopes without secrets or fabricated summaries', async (t) => {
  const { request, database, login } = await start(t);
  const session = await login();
  const list = await request('/admin/hospitals', session);
  assert.equal(list.status, 200);
  assert.equal(list.headers.get('cache-control'), 'no-store');
  const body = await list.json();
  assert.deepEqual(Object.keys(body).sort(), ['hospitals', 'pagination', 'success']);
  assert.equal(body.success, true);
  assert.deepEqual(body.pagination, { page: 1, pageSize: 20, total: 2 });
  assert.deepEqual(body.hospitals.map(({ hospitalId }) => hospitalId), ['12', '9007199254740993']);
  for (const profile of body.hospitals) assert.deepEqual(Object.keys(profile).sort(), profileKeys);
  const detail = await request('/admin/hospitals/12', session);
  assert.equal(detail.status, 200);
  assert.equal(detail.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await detail.json(), { success: true, profile: body.hospitals[0] });
  assert.doesNotMatch(JSON.stringify(body), /password|email|session|csrf|requestSummary|requestCount/iu);
  for (const { sql } of hospitalCalls(database)) {
    assert.doesNotMatch(sql, /password|session_data|SELECT \*/iu);
  }
  assert.equal(database.transactions.begun, 0);
  assert.equal(database.calls.some(({ sql }) => /^(UPDATE Hospital|INSERT INTO (Account|Hospital))/u.test(sql)), false);
});

for (const [id, role] of [['21', 'DONOR'], ['12', 'PENDING HOSPITAL'], ['9007199254740993', 'ACTIVE HOSPITAL']]) {
  test(`${role} cannot read Admin Hospital routes or forge an Admin role`, async (t) => {
    const { request, database, login } = await start(t);
    const session = await login(id);
    const offset = database.calls.length;
    for (const path of paths) {
      await expectError(await request(path, { ...session,
        headers: { 'X-Account-Id': '31', 'X-Role': 'ADMIN', 'X-Account-Status': 'ACTIVE' } }), 403, 'FORBIDDEN');
    }
    assert.equal(hospitalCalls(database, offset).length, 0);
  });
}

for (const status of ['PENDING', 'SUSPENDED']) {
  test(`${status} Admin cannot log in or reuse a previously ACTIVE Admin session`, async (t) => {
    for (const path of paths) {
      const { request, database, bootstrap, login } = await start(t);
      const session = await login();
      database.accounts.get('31').accountStatus = status;
      const offset = database.calls.length;
      await expectError(await request(path, session), 401, 'ACCOUNT_UNAVAILABLE');
      await expectError(await request(path, session), 401, 'AUTHENTICATION_REQUIRED');
      const anonymous = await bootstrap();
      await expectError(await request('/auth/login', { ...anonymous, method: 'POST',
        body: { email: '31@example.test', password: testPassword } }), 401, 'INVALID_CREDENTIALS');
      assert.equal(hospitalCalls(database, offset).length, 0);
      assert.ok([...database.sessions.values()].some((row) => row.revoked_at !== null && row.session_data === null));
    }
  });
}

test('Admin account deletion or role change is reloaded and invalidates the old session', async (t) => {
  for (const change of [(database) => database.accounts.delete('31'),
    (database) => { database.accounts.get('31').role = 'HOSPITAL'; }]) {
    const { request, database, login } = await start(t);
    const session = await login();
    change(database);
    await expectError(await request('/admin/hospitals', session), 401, 'ACCOUNT_UNAVAILABLE');
    assert.equal(hospitalCalls(database).length, 0);
  }
});

test('Admin search covers approved Hospital fields with literal parameterized wildcards', async (t) => {
  const { request, database, login } = await start(t);
  const session = await login();
  addProfile(database, '101', { organizationName: '50%_! Care', registrationNumber: 'REG-ALPHA',
    contactName: 'Specific Liaison', phone: '+91 887766' });
  addProfile(database, '102', { organizationName: '50 Normal Care', registrationNumber: 'REG-BETA' });
  for (const search of ['50%_!', 'reg-alpha', 'Specific Liaison', '887766']) {
    const response = await request(`/admin/hospitals?search=${encodeURIComponent(` ${search} `)}`, session);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.deepEqual(body.hospitals.map(({ hospitalId }) => hospitalId), ['101']);
    assert.equal(body.pagination.total, 1);
  }
  const literalQueries = hospitalCalls(database).filter(({ values }) => values[0] === '%50!%!_!!%');
  assert.equal(literalQueries.length, 2);
  for (const { sql, values } of literalQueries) {
    assert.doesNotMatch(sql, /50|Care/u);
    assert.deepEqual(values.slice(0, 4), Array(4).fill('%50!%!_!!%'));
  }
  const hostile = "' OR 1=1 --";
  const response = await request(`/admin/hospitals?search=${encodeURIComponent(hostile)}`, session);
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).hospitals, []);
  const bound = hospitalCalls(database).at(-1);
  assert.equal(bound.sql.includes(hostile), false);
  assert.equal(bound.values[0], `%${hostile}%`);
});

test('Admin account-status filters combine with search and never include non-Hospital accounts', async (t) => {
  const { request, database, login } = await start(t);
  const session = await login();
  addProfile(database, '101', { organizationName: 'Filter Care Pending' }, 'PENDING');
  addProfile(database, '102', { organizationName: 'Filter Care Active' }, 'ACTIVE');
  addProfile(database, '103', { organizationName: 'Filter Care Suspended' }, 'SUSPENDED');
  addProfile(database, '104', { organizationName: 'Filter Care Wrong Role' });
  database.accounts.get('104').role = 'DONOR';
  for (const [status, id] of [['PENDING', '101'], ['ACTIVE', '102'], ['SUSPENDED', '103']]) {
    const response = await request(`/admin/hospitals?search=Filter%20Care&accountStatus=${status}`, session);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.deepEqual(body.hospitals.map(({ hospitalId }) => hospitalId), [id]);
    assert.equal(body.hospitals[0].accountStatus, status);
    assert.equal(body.pagination.total, 1);
    const detail = await request(`/admin/hospitals/${id}`, session);
    assert.equal(detail.status, 200);
    assert.equal((await detail.json()).profile.accountStatus, status);
  }
});

test('Admin pagination uses fixed twenty-row pages, stable shared-key ordering and accurate totals', async (t) => {
  const { request, database, login } = await start(t);
  const session = await login();
  for (let id = 101; id <= 124; id += 1) addProfile(database, String(id), { organizationName: 'Paged Care' });
  const first = await request('/admin/hospitals?search=Paged&page=1', session);
  const second = await request('/admin/hospitals?search=Paged&page=2', session);
  const empty = await request('/admin/hospitals?search=Paged&page=3', session);
  for (const response of [first, second, empty]) assert.equal(response.status, 200);
  const [one, two, three] = await Promise.all([first.json(), second.json(), empty.json()]);
  assert.deepEqual(one.pagination, { page: 1, pageSize: 20, total: 24 });
  assert.deepEqual(two.pagination, { page: 2, pageSize: 20, total: 24 });
  assert.deepEqual(three.pagination, { page: 3, pageSize: 20, total: 24 });
  assert.deepEqual(one.hospitals.map(({ hospitalId }) => hospitalId), Array.from({ length: 20 }, (_, i) => String(i + 101)));
  assert.deepEqual(two.hospitals.map(({ hospitalId }) => hospitalId), ['121', '122', '123', '124']);
  assert.deepEqual(three.hospitals, []);
  const listCalls = hospitalCalls(database).filter(({ sql }) => sql.includes('LIMIT ? OFFSET ?'));
  assert.deepEqual(listCalls.map(({ values }) => values.slice(-2)), [[20, 0], [20, 20], [20, 40]]);
});

test('Admin invalid filters, unknown identity fields and pagination are safe 400s before Hospital SQL', async (t) => {
  const { request, database, login } = await start(t);
  const session = await login();
  for (const query of ['page=0', 'page=-1', 'page=1.5', 'page=01', 'page=9007199254740992',
    'page=1&page=2', 'accountStatus=', 'accountStatus=active', 'accountStatus=ADMIN',
    'accountStatus=ACTIVE&accountStatus=PENDING', `search=${'a'.repeat(181)}`, 'search=%00',
    'accountId=12', 'role=ADMIN', 'sort=organizationName']) {
    await expectError(await request(`/admin/hospitals?${query}`, session), 400, 'VALIDATION_ERROR');
  }
  assert.equal(hospitalCalls(database).length, 0);
});

test('Admin detail preserves BIGINT IDs, validates identifiers and safely handles missing/wrong-role profiles', async (t) => {
  const { request, database, login } = await start(t);
  const session = await login();
  const large = await request('/admin/hospitals/9007199254740993', session);
  assert.equal(large.status, 200);
  const body = await large.json();
  assert.equal(body.profile.hospitalId, '9007199254740993');
  assert.deepEqual(Object.keys(body.profile).sort(), profileKeys);
  for (const id of ['0', '01', '-1', '1.5', 'abc', '18446744073709551616', '1%20OR%201=1']) {
    const offset = database.calls.length;
    await expectError(await request(`/admin/hospitals/${id}`, session), 400, 'VALIDATION_ERROR');
    assert.equal(hospitalCalls(database, offset).length, 0);
  }
  for (const id of ['14', '21', '31', '18446744073709551615']) {
    await expectError(await request(`/admin/hospitals/${id}`, session), 404, 'HOSPITAL_NOT_FOUND');
  }
});

test('Admin Hospital database failures are safe 503s without driver details or partial data', async (t) => {
  const { request, database, login } = await start(t);
  const session = await login();
  for (const failure of [(sql) => sql.startsWith('SELECT COUNT(*)'),
    (sql) => sql.includes('LIMIT ? OFFSET ?')]) {
    database.failSql = failure;
    await expectError(await request('/admin/hospitals', session), 503, 'DATABASE_UNAVAILABLE');
  }
  database.failSql = (sql) => sql.includes('FROM Hospital');
  await expectError(await request('/admin/hospitals/12', session), 503, 'DATABASE_UNAVAILABLE');
});

test('Admin reads fail closed when their Hospital database dependency is missing', async (t) => {
  const { request, login } = await start(t, { hospitalDatabaseAvailable: false });
  const session = await login();
  for (const path of paths) await expectError(await request(path, session), 503, 'DATABASE_NOT_CONFIGURED');
});

test('Admin list/detail authorization is rechecked by the Hospital service after the HTTP guard', async (t) => {
  for (const path of paths) {
    const { request, database, login } = await start(t);
    const session = await login();
    const execute = database.execute;
    database.execute = async (sql, values) => {
      const result = await execute(sql, values);
      if (sql.includes('FROM Account WHERE account_id = ?') && !sql.includes('AS accountId')) {
        database.accounts.get('31').accountStatus = 'SUSPENDED';
      }
      return result;
    };
    await expectError(await request(path, session), 403, 'FORBIDDEN');
    assert.equal(hospitalCalls(database).length, 0);
  }
});
