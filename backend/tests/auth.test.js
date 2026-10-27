import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import session from 'express-session';
import { createApp } from '../src/app.js';
import { environment, readSessionConfig } from '../src/config/environment.js';
import { createAuthRouter } from '../src/modules/auth/router.js';
import { createAuthRepository } from '../src/modules/auth/repository.js';
import { createAuthService } from '../src/modules/auth/service.js';
import { MysqlSessionStore } from '../src/config/database.js';
import { requireActiveAccount } from '../src/middleware/auth.js';
import { validateDonorRegistration, validateLogin, localDateInKolkata } from '../src/modules/auth/validation.js';
import { validatePassword } from '../src/modules/auth/passwordPolicy.js';
import { HttpError } from '../src/utils/httpError.js';
import { withAccountLocks } from '../src/modules/accounts/transaction.js';
import { authorizeMemorySessions } from './helpers/session-context.mjs';

const validPassword = 'donor pass7!';
const validRegistration = {
  fullName: 'Sample Donor', email: 'donor@example.test', password: validPassword,
  dateOfBirth: '1990-02-28', phone: '+91 90000 00000', address: '12 Example Road', area: 'Central',
};

test('password policy enforces code points, UTF-8 byte limit, number, symbol, and controls', () => {
  assert.equal(validatePassword('password7!').valid, true);
  assert.equal(validatePassword('éééééé1!').valid, true, 'no case mixture is required');
  assert.equal(validatePassword('😀abcde7!').valid, true, 'eight Unicode code points are accepted');
  assert.equal(validatePassword('        1!').valid, true, 'spaces may be preserved');
  assert.equal(validatePassword('password7').reason, 'SYMBOL_REQUIRED', 'spaces do not count as symbols');
  assert.equal(validatePassword('short1!').reason, 'MIN_LENGTH');
  assert.equal(validatePassword(`${'😀'.repeat(16)}a1!bcdef`).valid, true, '72 UTF-8 bytes are accepted');
  assert.equal(validatePassword(`${'😀'.repeat(16)}a1!bcdefg`).reason, 'MAX_BYTES');
  assert.equal(validatePassword('password7!\n').reason, 'CONTROL_CHARACTER');
});

test('login keeps the exact 72-byte password and rejects a suffix before authentication', async () => {
  const password = `${'😀'.repeat(16)}a1!bcdef`;
  assert.equal(Buffer.byteLength(password, 'utf8'), 72);
  assert.equal(validateLogin({ email: 'donor@example.test', password }).password, password);
  assert.equal(validateLogin({ email: 'donor@example.test', password: 'plain words' }).password, 'plain words',
    'login does not reapply registration composition rules');
  const service = fakeService();
  const compared = [];
  service.authenticate = async (email, candidate) => {
    compared.push(candidate);
    if (email === 'donor@example.test' && candidate === password) return service.accounts.get('101');
    throw new HttpError(401, 'INVALID_CREDENTIALS', 'Email or password is invalid.');
  };
  const base = await start(service);
  const first = await bootstrap(base);
  const valid = await request(base, '/auth/login', {
    method: 'POST', cookie: first.cookie, csrf: first.csrf,
    body: { email: 'donor@example.test', password },
  });
  assert.equal(valid.status, 200);
  assert.deepEqual(compared, [password]);
  const second = await bootstrap(base);
  const oversized = await request(base, '/auth/login', {
    method: 'POST', cookie: second.cookie, csrf: second.csrf,
    body: { email: 'donor@example.test', password: `${password}x` },
  });
  assert.equal(oversized.status, 422);
  assert.equal((await oversized.json()).error.message, 'Email or password is invalid.');
  assert.deepEqual(compared, [password], 'oversized input never reaches authentication');
});

test('session configuration requires a private strong secret and bounded finite expiry', () => {
  assert.equal(readSessionConfig({}).options, null);
  assert.equal(readSessionConfig({ SESSION_SECRET: 'too-short' }).options, null);
  const configured = readSessionConfig({ SESSION_SECRET: 'private-test-only-secret-value-32bytes', SESSION_TTL_MINUTES: '30', NODE_ENV: 'production' });
  assert.equal(configured.issue, null);
  assert.equal(configured.options.ttlMilliseconds, 30 * 60_000);
  assert.equal(configured.options.cookieSecure, true);
  assert.equal(readSessionConfig({ SESSION_SECRET: 'x'.repeat(32), SESSION_TTL_MINUTES: '2' }).options, null);
});

test('registration validates schema fields, real dates, Kolkata future date, and rejects privilege fields', () => {
  const now = new Date('2026-01-01T20:00:00.000Z'); // 2026-01-02 in Asia/Kolkata.
  assert.equal(localDateInKolkata(now), '2026-01-02');
  assert.equal(validateDonorRegistration({ ...validRegistration, dateOfBirth: '2026-01-02' }, now).dateOfBirth, '2026-01-02');
  assert.throws(() => validateDonorRegistration({ ...validRegistration, dateOfBirth: '2026-02-29' }, now),
    (error) => error instanceof HttpError && Boolean(error.fields.dateOfBirth));
  assert.throws(() => validateDonorRegistration({ ...validRegistration, dateOfBirth: '2026-01-03' }, now),
    (error) => error instanceof HttpError && Boolean(error.fields.dateOfBirth));
  assert.throws(() => validateDonorRegistration({ ...validRegistration, role: 'ADMIN' }, now),
    (error) => error instanceof HttpError && Boolean(error.fields.form));
  assert.throws(() => validateDonorRegistration({ ...validRegistration, accountId: '1' }, now),
    (error) => error instanceof HttpError && Boolean(error.fields.form));
  const parsed = validateDonorRegistration({ ...validRegistration, area: '  ', reportedBloodGroupId: '18446744073709551615' }, now);
  assert.equal(parsed.area, null);
  assert.equal(parsed.reportedBloodGroupId, '18446744073709551615');
  assert.equal(parsed.password, validRegistration.password, 'the password is not trimmed or normalized');
});

test('pending profiles are separate from ACTIVE-only operational guards', () => {
  let pendingError;
  requireActiveAccount({ authAccount: { role: 'DONOR', accountStatus: 'PENDING' } }, {}, (error) => { pendingError = error; });
  assert.equal(pendingError.code, 'ACTIVE_ACCOUNT_REQUIRED');
  let activeError = 'not-called';
  requireActiveAccount({ authAccount: { role: 'DONOR', accountStatus: 'ACTIVE' } }, {}, (error) => { activeError = error; });
  assert.equal(activeError, undefined);
});

test('donor registration transaction rolls back a profile insertion failure and releases the connection', async () => {
  const calls = [];
  const connection = {
    beginTransaction: async () => calls.push('begin'),
    execute: async (sql) => {
      calls.push(sql.includes('INSERT INTO Account') ? 'account-insert' : 'donor-insert');
      if (sql.includes('INSERT INTO Account')) return [{ insertId: '9007199254740999' }];
      throw Object.assign(new Error('private driver detail'), { code: 'ER_BAD_NULL_ERROR' });
    },
    commit: async () => calls.push('commit'),
    rollback: async () => calls.push('rollback'),
    release: () => calls.push('release'),
  };
  const repository = createAuthRepository({ getConnection: async () => connection });
  await assert.rejects(repository.createDonorAccountProfile({
    email: 'x@example.test', passwordHash: 'hash-never-returned', fullName: 'X', dateOfBirth: '1990-01-01',
    phone: '1', address: 'Road', area: null, reportedBloodGroupId: null,
  }), (error) => error.code === 'ER_BAD_NULL_ERROR');
  assert.deepEqual(calls, ['begin', 'account-insert', 'donor-insert', 'rollback', 'release']);
});

test('registration stores only selected reported group, and unknown group rolls back before inserts', async () => {
  for (const selectedId of ['4', null]) {
    const calls = [];
    let inserted;
    const connection = {
      beginTransaction: async () => calls.push('begin'),
      execute: async (sql, parameters) => {
        if (sql.includes('FROM BloodGroup')) {
          calls.push('lookup-group');
          assert.deepEqual(parameters, [selectedId]);
          return [[{ blood_group_id: selectedId }]];
        }
        if (sql.includes('INSERT INTO Account')) { calls.push('account-insert'); return [{ insertId: '201' }]; }
        if (sql.includes('INSERT INTO Donor')) { calls.push('donor-insert'); inserted = { sql, parameters }; return [{}]; }
        throw new Error('Unexpected injected SQL operation.');
      },
      commit: async () => calls.push('commit'),
      rollback: async () => calls.push('rollback'),
      release: () => calls.push('release'),
    };
    const validated = validateDonorRegistration({ ...validRegistration, reportedBloodGroupId: selectedId });
    await createAuthRepository({ getConnection: async () => connection }).createDonorAccountProfile({
      ...validated, passwordHash: 'test-hash',
    });
    assert.equal(inserted.parameters.at(-1), selectedId);
    assert.match(inserted.sql, /confirmed_blood_group_id\)\s+VALUES \(\?, \?, \?, \?, \?, \?, \?, NULL\)/u);
    assert.deepEqual(calls, selectedId ? ['begin', 'lookup-group', 'account-insert', 'donor-insert', 'commit', 'release']
      : ['begin', 'account-insert', 'donor-insert', 'commit', 'release']);
  }
  const calls = [];
  const missing = {
    beginTransaction: async () => calls.push('begin'),
    execute: async (sql) => {
      assert.match(sql, /FROM BloodGroup/u);
      calls.push('lookup-group');
      return [[]];
    },
    rollback: async () => calls.push('rollback'),
    release: () => calls.push('release'),
  };
  await assert.rejects(createAuthRepository({ getConnection: async () => missing }).createDonorAccountProfile({
    ...validateDonorRegistration({ ...validRegistration, reportedBloodGroupId: '999' }), passwordHash: 'test-hash',
  }), (error) => error.status === 422 && error.code === 'INVALID_BLOOD_GROUP');
  assert.deepEqual(calls, ['begin', 'lookup-group', 'rollback', 'release']);
});

test('a concurrent database email duplicate becomes a safe conflict response', async () => {
  const service = createAuthService({
    repository: { createDonorAccountProfile: async () => { throw Object.assign(new Error('private details'), { code: 'ER_DUP_ENTRY' }); } },
    passwordHasher: { hash: async () => 'not-returned' },
  });
  await assert.rejects(service.registerDonor({ ...validRegistration }),
    (error) => error.status === 409 && error.code === 'EMAIL_CONFLICT' && !error.message.includes('private'));
});

test('registration stores a bcrypt hash and authentication verifies it without returning hash material', async () => {
  let stored;
  const repository = {
    createDonorAccountProfile: async (donor) => { stored = donor; return { accountId: '201', donorId: '201', accountStatus: 'PENDING' }; },
    findAccountByEmail: async () => ({ accountId: '201', passwordHash: stored.passwordHash, role: 'DONOR', accountStatus: 'PENDING' }),
  };
  const service = createAuthService({ repository });
  await service.registerDonor({ ...validRegistration });
  assert.match(stored.passwordHash, /^\$2[aby]\$12\$/u);
  assert.equal(Object.hasOwn(stored, 'password'), false);
  assert.deepEqual(await service.authenticate(validRegistration.email, validRegistration.password), {
    accountId: '201', role: 'DONOR', accountStatus: 'PENDING',
  });
  await assert.rejects(service.authenticate(validRegistration.email, 'wrong password8!'),
    (error) => error.code === 'INVALID_CREDENTIALS');
});

test('current-account database failures are sanitized and account revocation uses the server session principal', async () => {
  const service = createAuthService({
    repository: { findAccountById: async () => { throw new Error('password=private; SQL SELECT'); } },
  });
  await assert.rejects(service.currentAccount('101'),
    (error) => error.status === 503 && error.code === 'DATABASE_UNAVAILABLE'
      && !error.message.includes('private') && !error.message.includes('SELECT'));

  let executed;
  const store = new MysqlSessionStore({
    execute: async (sql, parameters) => { executed = { sql, parameters }; return [{ affectedRows: 1 }]; },
  }, 60_000);
  await store.revokeAccountSessions('18446744073709551615');
  assert.match(executed.sql, /^UPDATE app_session SET session_data = NULL, revoked_at = \?/);
  assert.match(executed.sql, /JSON_EXTRACT\(session_data, '\$\.auth\.accountId'\)/);
  assert.equal(executed.parameters[1], '18446744073709551615');
});

function storeCall(store, operation, ...argumentsBeforeCallback) {
  return new Promise((resolve, reject) => store[operation](...argumentsBeforeCallback,
    (error, result) => error ? reject(error) : resolve(result)));
}

function injectedSessionDatabase() {
  const rows = new Map();
  const database = {
    rows,
    async getConnection() {
      return { execute: database.execute, async beginTransaction() {}, async commit() {}, async rollback() {}, release() {}, destroy() {} };
    },
    async execute(sql, parameters) {
      if (sql.includes('FROM Account WHERE account_id = ? FOR UPDATE')) {
        return [[{ accountId: parameters[0], role: 'DONOR', accountStatus: 'PENDING' }]];
      }
      if (sql.startsWith('UPDATE app_session SET session_data = ?')) {
        const [data, expiry, id, now, accountId, role, status] = parameters;
        const row = rows.get(id);
        const auth = row?.session_data ? JSON.parse(row.session_data).auth : null;
        if (row?.revoked_at === null && row.expires_at > now && auth?.accountId === accountId && auth.role === role && auth.accountStatus === status) {
          row.session_data = data; row.expires_at = expiry;
        }
        return [{ affectedRows: 1 }];
      }
      if (sql.startsWith('SELECT session_data') || sql.startsWith('SELECT expires_at FROM app_session')) {
        const row = rows.get(parameters[0]);
        return [row ? [{ ...row }] : []];
      }
      if (sql.startsWith('INSERT') && sql.includes('VALUES (?, ?, ?, NULL)')) {
        if (sql.includes('ON DUPLICATE KEY')) assert.match(sql, /session_data = IF\(revoked_at IS NULL AND expires_at > \?/);
        if (sql.includes('ON DUPLICATE KEY')) assert.match(sql, /expires_at = IF\(revoked_at IS NULL AND expires_at > \?/);
        const [id, expiresAt, data, checkedAt] = parameters;
        const existing = rows.get(id);
        if (!existing) rows.set(id, { expires_at: expiresAt, session_data: data, revoked_at: null });
        else if (existing.revoked_at === null && existing.expires_at > checkedAt) {
          existing.session_data = data;
          existing.expires_at = expiresAt;
        }
        return [{ affectedRows: 1 }];
      }
      if (sql.startsWith('INSERT') && sql.includes('VALUES (?, ?, NULL, ?)')) {
        const [id, expiresAt, revokedAt] = parameters;
        const existing = rows.get(id);
        if (existing) {
          existing.session_data = null;
          existing.revoked_at ??= revokedAt;
        } else rows.set(id, { expires_at: expiresAt, session_data: null, revoked_at: revokedAt });
        return [{ affectedRows: 1 }];
      }
      if (sql.includes('JSON_UNQUOTE(JSON_EXTRACT')) {
        const [revokedAt, accountId] = parameters;
        let count = 0;
        for (const row of rows.values()) {
          if (row.revoked_at === null && JSON.parse(row.session_data)?.auth?.accountId === accountId) {
            row.session_data = null;
            row.revoked_at = revokedAt;
            count += 1;
          }
        }
        return [{ affectedRows: count }];
      }
      if (sql.startsWith('UPDATE app_session SET expires_at')) {
        assert.match(sql, /revoked_at IS NULL AND expires_at > \?/);
        const [expiresAt, id, checkedAt] = parameters;
        const row = rows.get(id);
        if (row?.revoked_at === null && row.expires_at > checkedAt) row.expires_at = expiresAt;
        return [{ affectedRows: row?.revoked_at === null ? 1 : 0 }];
      }
      throw new Error('Unexpected injected SQL operation.');
    },
  };
  return database;
}

async function persistNewSession(store, database, id, value) {
  return withAccountLocks(database, [value.auth.accountId], (connection) =>
    store.withLoginTransaction(connection, value.auth, () => storeCall(store, 'set', id, value)));
}

test('production store keeps logout and account revocation tombstones against stale saves', async () => {
  const database = injectedSessionDatabase();
  const store = new MysqlSessionStore(database, 60_000);
  const first = { auth: { accountId: '101', role: 'DONOR', accountStatus: 'PENDING' }, cookie: { expires: new Date(Date.now() + 60_000).toISOString() } };
  const second = { auth: { accountId: '101', role: 'DONOR', accountStatus: 'PENDING' }, cookie: first.cookie };
  const other = { auth: { accountId: '102', role: 'DONOR', accountStatus: 'PENDING' }, cookie: first.cookie };
  await persistNewSession(store, database, 'logout-session', first);
  assert.deepEqual(await storeCall(store, 'get', 'logout-session'), first);
  await storeCall(store, 'destroy', 'logout-session');
  await storeCall(store, 'set', 'logout-session', first);
  await storeCall(store, 'touch', 'logout-session', first);
  assert.equal(await storeCall(store, 'get', 'logout-session'), null);
  assert.equal(database.rows.get('logout-session').session_data, null);

  await persistNewSession(store, database, 'account-session-a', first);
  await persistNewSession(store, database, 'account-session-b', second);
  await persistNewSession(store, database, 'other-account', other);
  const loadedBeforeRevocation = await storeCall(store, 'get', 'account-session-a');
  assert.deepEqual(loadedBeforeRevocation, first);
  assert.equal((await store.revokeAccountSessions('101'))[0].affectedRows, 2);
  await storeCall(store, 'set', 'account-session-a', loadedBeforeRevocation);
  assert.equal(await storeCall(store, 'get', 'account-session-a'), null);
  assert.equal(await storeCall(store, 'get', 'account-session-b'), null);
  assert.deepEqual(await storeCall(store, 'get', 'other-account'), other);
});

test('production store tombstones expired sessions and sanitizes storage failures', async () => {
  const database = injectedSessionDatabase();
  const store = new MysqlSessionStore(database, 60_000);
  const value = { auth: { accountId: '101', role: 'DONOR', accountStatus: 'PENDING' }, cookie: { expires: new Date(Date.now() + 60_000).toISOString() } };
  const beforeSet = Date.now();
  await persistNewSession(store, database, 'expired-session', value);
  assert.ok(database.rows.get('expired-session').expires_at > beforeSet);
  assert.ok(database.rows.get('expired-session').expires_at <= beforeSet + 60_000);
  database.rows.get('expired-session').expires_at = Date.now() - 1;
  assert.equal(await storeCall(store, 'get', 'expired-session'), null);
  await storeCall(store, 'set', 'expired-session', value);
  assert.equal(await storeCall(store, 'get', 'expired-session'), null);
  assert.notEqual(database.rows.get('expired-session').revoked_at, null);

  const broken = new MysqlSessionStore({ execute: async () => {
    throw new Error('private connection detail');
  } }, 60_000);
  const safeFailure = (error) => error instanceof HttpError && error.status === 503
    && error.code === 'SESSION_STORAGE_UNAVAILABLE' && !error.message.includes('private');
  await assert.rejects(storeCall(broken, 'get', 'x'), safeFailure);
  await assert.rejects(storeCall(broken, 'set', 'x', value), safeFailure);
  await assert.rejects(storeCall(broken, 'touch', 'x', value), safeFailure);
  await assert.rejects(storeCall(broken, 'destroy', 'x'), safeFailure);
  await assert.rejects(broken.revokeAccountSessions('101'), safeFailure);
});

function fakeService() {
  const accounts = new Map([
    ['101', { accountId: '101', role: 'DONOR', accountStatus: 'PENDING' }],
    ['102', { accountId: '102', role: 'ADMIN', accountStatus: 'ACTIVE' }],
    ['103', { accountId: '103', role: 'HOSPITAL', accountStatus: 'PENDING' }],
  ]);
  return {
    accounts,
    authenticate: async (email, password) => {
      if (email === 'donor@example.test' && password === validPassword) return { ...accounts.get('101') };
      if (email === 'admin@example.test' && password === validPassword) return { ...accounts.get('102') };
      if (email === 'hospital@example.test' && password === validPassword) return { ...accounts.get('103') };
      throw new HttpError(401, 'INVALID_CREDENTIALS', 'Email or password is invalid.');
    },
    currentAccount: async (accountId) => accounts.has(accountId) ? { ...accounts.get(accountId) } : null,
    registerDonor: async () => ({ accountId: '200', donorId: '200', accountStatus: 'PENDING' }),
    donorProfile: async (accountId) => ({ accountId, fullName: 'Sample Donor', accountStatus: accounts.get(accountId)?.accountStatus }),
  };
}

function makeTestRuntime(authService, store = new session.MemoryStore()) {
  authorizeMemorySessions(authService, store);
  // Explicit test-only adapter: HTTP guards use in-memory identity/session doubles.
  // Production coordination is exercised separately with MysqlSessionStore.
  authService.establishSession = async (email, password, persist) => {
    const account = await authService.authenticate(email, password);
    await persist(account, {});
    return account;
  };
  store.withLoginTransaction = async (_connection, _account, work) => work();
  return {
    middleware: session({
      name: 'bdcs.sid', secret: 'test-only-secret-with-at-least-32-bytes', store,
      resave: false, saveUninitialized: false,
      cookie: { httpOnly: true, secure: false, sameSite: 'lax', path: '/', maxAge: 60_000 },
    }),
    router: createAuthRouter({ authService, sessionStore: store, frontendUrl: environment.frontendUrl }),
  };
}

let servers = [];
async function start(authService) {
  const server = createApp({ verifyDatabase: async () => true, authRuntime: makeTestRuntime(authService) }).listen(0, '127.0.0.1');
  servers.push(server);
  await new Promise((resolve) => server.once('listening', resolve));
  return `http://127.0.0.1:${server.address().port}`;
}

after(async () => {
  await Promise.all(servers.map((server) => new Promise((resolve) => server.close(resolve))));
});

async function request(base, path, { method = 'GET', cookie, csrf, body, origin = environment.frontendUrl } = {}) {
  const headers = { Origin: origin };
  if (cookie) headers.Cookie = cookie;
  if (csrf) headers['X-CSRF-Token'] = csrf;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  return fetch(`${base}/api${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
}

function cookieOf(response) {
  return response.headers.get('set-cookie')?.split(';', 1)[0];
}

async function bootstrap(base) {
  const response = await request(base, '/auth/csrf');
  assert.equal(response.status, 200);
  const data = await response.json();
  return { cookie: cookieOf(response), csrf: data.csrfToken };
}

test('pending Donor and Hospital sessions can read current account state; Admin roles are preserved without profile dependencies', async () => {
  const service = fakeService();
  const base = await start(service);
  for (const [email, expectedRole, accountId] of [
    ['donor@example.test', 'DONOR', '101'], ['hospital@example.test', 'HOSPITAL', '103'], ['admin@example.test', 'ADMIN', '102'],
  ]) {
    const boot = await bootstrap(base);
    const login = await request(base, '/auth/login', {
      method: 'POST', cookie: boot.cookie, csrf: boot.csrf, body: { email, password: validPassword },
    });
    assert.equal(login.status, 200);
    const loginBody = await login.json();
    assert.equal(loginBody.user.accountId, accountId);
    assert.equal(loginBody.user.role, expectedRole);
    assert.equal(loginBody.user.accountStatus, expectedRole === 'ADMIN' ? 'ACTIVE' : 'PENDING');
    assert.doesNotMatch(JSON.stringify(loginBody), /passwordHash|password|sessionId|csrfToken/);
    const activeCookie = cookieOf(login);
    const me = await request(base, '/auth/me', { cookie: activeCookie });
    assert.equal(me.status, 200);
    assert.deepEqual((await me.json()).user, { accountId, role: expectedRole, accountStatus: expectedRole === 'ADMIN' ? 'ACTIVE' : 'PENDING' });
  }
});

test('session ID rotates at login, Donor profile is session-owned, and logout invalidates cookie replay', async () => {
  const service = fakeService();
  let profileAccountId;
  const donorProfile = service.donorProfile;
  service.donorProfile = async (accountId) => { profileAccountId = accountId; return donorProfile(accountId); };
  const base = await start(service);
  const boot = await bootstrap(base);
  const login = await request(base, '/auth/login', {
    method: 'POST', cookie: boot.cookie, csrf: boot.csrf, body: { email: 'donor@example.test', password: validPassword },
  });
  const loginCookie = cookieOf(login);
  assert.notEqual(loginCookie, boot.cookie);
  const profile = await request(base, '/donors/me?accountId=102', { cookie: loginCookie });
  assert.equal(profile.status, 200);
  assert.equal(profileAccountId, '101');
  assert.doesNotMatch(await profile.text(), /passwordHash|sessionId/);

  const csrf = await request(base, '/auth/csrf', { cookie: loginCookie });
  const token = (await csrf.json()).csrfToken;
  const logout = await request(base, '/auth/logout', { method: 'POST', cookie: loginCookie, csrf: token, body: {} });
  assert.equal(logout.status, 200);
  const replay = await request(base, '/auth/me', { cookie: loginCookie });
  assert.equal(replay.status, 401);
});

test('suspended accounts are rejected on the next protected request and session is destroyed', async () => {
  const service = fakeService();
  const base = await start(service);
  const boot = await bootstrap(base);
  const login = await request(base, '/auth/login', {
    method: 'POST', cookie: boot.cookie, csrf: boot.csrf, body: { email: 'donor@example.test', password: validPassword },
  });
  const cookie = cookieOf(login);
  service.accounts.set('101', { accountId: '101', role: 'DONOR', accountStatus: 'SUSPENDED' });
  assert.equal((await request(base, '/auth/me', { cookie })).status, 401);
  assert.equal((await request(base, '/auth/me', { cookie })).status, 401);
});

test('CSRF, trusted origins, wrong roles, and generic invalid-login responses are enforced', async () => {
  const base = await start(fakeService());
  const boot = await bootstrap(base);
  const noCsrf = await request(base, '/auth/login', { method: 'POST', cookie: boot.cookie, body: { email: 'donor@example.test', password: validPassword } });
  assert.equal(noCsrf.status, 403);
  assert.equal((await noCsrf.json()).error.code, 'CSRF_TOKEN_INVALID');
  const wrongOrigin = await request(base, '/auth/csrf', { origin: 'https://untrusted.example' });
  assert.equal(wrongOrigin.status, 403);

  const login = await request(base, '/auth/login', {
    method: 'POST', cookie: boot.cookie, csrf: boot.csrf, body: { email: 'admin@example.test', password: validPassword },
  });
  const adminCookie = cookieOf(login);
  const wrongRole = await request(base, '/donors/me', { cookie: adminCookie });
  assert.equal(wrongRole.status, 403);
  const freshCsrf = await request(base, '/auth/csrf', { cookie: adminCookie });
  const invalid = await request(base, '/auth/login', {
    method: 'POST', cookie: adminCookie, csrf: (await freshCsrf.json()).csrfToken,
    body: { email: 'missing@example.test', password: validPassword },
  });
  assert.equal(invalid.status, 401);
  assert.deepEqual((await invalid.json()).error, { code: 'INVALID_CREDENTIALS', message: 'Email or password is invalid.' });
});

test('credentialed CORS preflight explicitly permits CSRF headers for unsafe methods', async () => {
  const base = await start(fakeService());
  const response = await fetch(`${base}/api/auth/login`, {
    method: 'OPTIONS',
    headers: {
      Origin: environment.frontendUrl,
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'content-type,x-csrf-token',
    },
  });
  assert.equal(response.status, 204);
  assert.equal(response.headers.get('access-control-allow-origin'), environment.frontendUrl);
  assert.match(response.headers.get('access-control-allow-methods'), /POST/);
  assert.match(response.headers.get('access-control-allow-headers'), /x-csrf-token/i);
});

test('registration rejects forged privilege fields with safe validation details', async () => {
  const base = await start(fakeService());
  const boot = await bootstrap(base);
  const response = await request(base, '/auth/register/donors', {
    method: 'POST', cookie: boot.cookie, csrf: boot.csrf,
    body: { ...validRegistration, role: 'ADMIN', accountId: '7', passwordHash: 'private-hash' },
  });
  assert.equal(response.status, 422);
  const body = await response.text();
  assert.match(body, /VALIDATION_ERROR/);
  assert.doesNotMatch(body, /private-hash|donor pass7|INSERT|stack/);
});

test('successful registration creates a pending account but does not sign it in', async () => {
  const base = await start(fakeService());
  const boot = await bootstrap(base);
  const response = await request(base, '/auth/register/donors', {
    method: 'POST', cookie: boot.cookie, csrf: boot.csrf, body: validRegistration,
  });
  assert.equal(response.status, 201);
  assert.deepEqual(await response.json(), { success: true, accountId: '200', donorId: '200', accountStatus: 'PENDING' });
  const me = await request(base, '/auth/me', { cookie: boot.cookie });
  assert.equal(me.status, 401);
});

test('auth rate limits are bounded and return a safe response', async () => {
  const base = await start(fakeService());
  const boot = await bootstrap(base);
  let final;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    final = await request(base, '/auth/login', {
      method: 'POST', cookie: boot.cookie, csrf: boot.csrf,
      body: { email: 'missing@example.test', password: validPassword },
    });
  }
  assert.equal(final.status, 429);
  assert.equal((await final.json()).error.code, 'RATE_LIMITED');
  assert.ok(Number(final.headers.get('retry-after')) > 0);
});

test('health endpoints remain available without auth configuration and auth fails closed', async () => {
  const base = await start(fakeService());
  const health = await request(base, '/health', { origin: 'http://localhost:5173' });
  assert.equal(health.status, 200);
  const unavailable = createApp({ verifyDatabase: async () => true, authRuntime: { middleware: null, router: (await import('../src/modules/auth/router.js')).createAuthRuntime({ databasePool: null, env: {} }).router } }).listen(0, '127.0.0.1');
  servers.push(unavailable);
  await new Promise((resolve) => unavailable.once('listening', resolve));
  const response = await fetch(`http://127.0.0.1:${unavailable.address().port}/api/auth/csrf`);
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error.code, 'AUTHENTICATION_NOT_CONFIGURED');
});
