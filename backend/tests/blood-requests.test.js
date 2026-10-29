import assert from 'node:assert/strict';
import { test } from 'node:test';
import { HttpError } from '../src/utils/httpError.js';
import { createAuditWriter } from '../src/modules/audit/writer.js';
import { isRequestableBloodGroup, requestAuditActions } from '../src/modules/blood-requests/contracts.js';
import { serializeRequestTimestamp } from '../src/modules/blood-requests/timestamps.js';
import { createBloodRequestRepository } from '../src/modules/blood-requests/repository.js';
import { createBloodRequestService } from '../src/modules/blood-requests/service.js';
import { sessionAuthorization } from '../src/modules/accounts/sessionAuthorization.js';
import { safeBloodRequestError } from '../src/modules/blood-requests/errors.js';
import { assertHospitalCancellationBeforeIssue, assertRequestStatusTransition, canTransitionRequestStatus } from '../src/modules/blood-requests/lifecycle.js';
import { mapRequestRecord } from '../src/modules/blood-requests/response.js';
import { canonicalUnsignedId, validateCreateRequest, validateRequestId, validateRequestListQuery } from '../src/modules/blood-requests/validation.js';

const hospital = { accountId: '12', role: 'HOSPITAL', accountStatus: 'ACTIVE' };
const hospitalActor = { ...hospital, session: sessionAuthorization('test-hospital-session', hospital) };
const admin = { accountId: '31', role: 'ADMIN', accountStatus: 'ACTIVE' };
const validCreate = {
  recipientGroupId: '4', quantityRequested: 3, priority: 'URGENT',
  neededBy: '2035-10-25T12:30:00+05:30', note: '  Safe operational note  ',
};
const safeRecord = {
  requestId: '90', hospitalId: '12', recipientGroupId: '4', recipientBloodGroupCode: 'A+',
  recipientBloodGroupName: 'A Positive', quantityRequested: 3, priority: 'URGENT',
  neededBy: '2035-10-25 12:30:00', note: null, requestStatus: 'SUBMITTED',
  rejectionReasonCode: null, createdAt: '2026-10-24 08:00:00', updatedAt: '2026-10-24 08:00:00',
};

function errorCode(status, code) {
  return (error) => error instanceof HttpError && error.status === status && error.code === code;
}

function fakeServiceRepository({ accounts, hospitals, groups, record = safeRecord, failAt = null } = {}) {
  const calls = [];
  const counters = { begun: 0, committed: 0, rolledBack: 0, released: 0 };
  const connection = {
    transactionToken: Symbol('same transaction'),
    async beginTransaction() {},
    async commit() {},
    async rollback() {},
    async execute(sql, values) {
      calls.push(['connection-execute', sql.replace(/\s+/gu, ' ').trim(), values]);
      if (failAt === 'audit') throw new Error('private SQL detail');
      return [{ affectedRows: 1, insertId: '501' }];
    },
  };
  const repository = {
    async findAccountById(id, options) {
      calls.push(['account', id, options]);
      return (accounts ?? new Map([[hospital.accountId, hospital], [admin.accountId, admin]])).get(id) ?? null;
    },
    async authorizeSession(authorization, account) {
      calls.push(['authorize-session', authorization, account]);
      if (failAt === 'session') throw new HttpError(401, 'ACCOUNT_UNAVAILABLE', 'This account cannot use the current session.');
    },
    async findHospitalByAccountId(id, options) {
      calls.push(['hospital', id, options]);
      return (hospitals ?? new Set([hospital.accountId])).has(id) ? { hospitalId: id } : null;
    },
    async findBloodGroupById(id, options) {
      calls.push(['group', id, options]);
      return (groups ?? new Map([['4', { bloodGroupId: '4', code: 'A+', displayName: 'A Positive', isActive: 1 }]])).get(id) ?? null;
    },
    async insertRequest(input) {
      calls.push(['insert-request', input]);
      if (failAt === 'request') throw new Error('private SQL detail');
      return { requestId: '90' };
    },
    async insertInitialStatusHistory(input) {
      calls.push(['initial-history', input]);
      if (failAt === 'history') throw new Error('private SQL detail');
    },
    async listHospitalRequests(id, filters) {
      calls.push(['list-hospital', id, filters]);
      return { records: [record], pagination: { page: filters.page, pageSize: 20, total: 1 } };
    },
    async listAdminRequests(filters) {
      calls.push(['list-admin', filters]);
      return { records: [{ ...record, organizationName: 'Example Hospital' }], pagination: { page: filters.page, pageSize: 20, total: 1 } };
    },
    async findHospitalRequest(id, requestId) {
      calls.push(['find-hospital', id, requestId]);
      return id === '12' && requestId === '90' ? record : null;
    },
    async findAdminRequest(requestId) {
      calls.push(['find-admin', requestId]);
      return requestId === '90' ? { ...record, organizationName: 'Example Hospital' } : null;
    },
    async withTransaction(work) {
      counters.begun += 1;
      try {
        const result = await work(repository, connection);
        counters.committed += 1;
        counters.released += 1;
        return result;
      } catch (error) {
        counters.rolledBack += 1;
        counters.released += 1;
        throw safeBloodRequestError(error);
      }
    },
  };
  return { repository, calls, counters, connection };
}

function serviceWith(repository, overrides = {}) {
  const auditCalls = [];
  const service = createBloodRequestService({
    repository,
    requestableBloodGroup: async (group) => Boolean(group.isActive),
    requestCreatedActionCode: 'TEST_HOSPITAL_REQUEST_CREATED',
    auditWriter: { async write(connection, event) {
      auditCalls.push({ connection, event });
      if (overrides.failAudit) throw new Error('private SQL detail');
      return '501';
    } },
    operationId: () => '10d6bc60-23ed-4e16-a3b2-cbce1b44e5ac',
    ...overrides,
  });
  return { service, auditCalls };
}

test('canonical IDs preserve unsigned BIGINT strings and reject ambiguous or unsafe forms', () => {
  assert.equal(canonicalUnsignedId('18446744073709551615'), '18446744073709551615');
  assert.equal(canonicalUnsignedId(12), '12');
  for (const value of ['0', '01', '+1', '-1', '18446744073709551616', 9007199254740992, null, {}]) {
    assert.throws(() => canonicalUnsignedId(value), errorCode(400, 'VALIDATION_ERROR'));
  }
  assert.equal(validateRequestId('99'), '99');
});

test('creation validation enforces the approved fields, positive SMALLINT quantity, exact priority and safe note', () => {
  const result = validateCreateRequest(validCreate);
  assert.deepEqual(result, {
    recipientGroupId: '4', quantityRequested: 3, priority: 'URGENT',
    neededBy: '2035-10-25 12:30:00', note: 'Safe operational note',
  });
  assert.equal(validateCreateRequest({ ...validCreate, neededBy: '2035-10-25T07:00:00Z' }).neededBy, '2035-10-25 12:30:00');
  assert.equal(validateCreateRequest({ ...validCreate, quantityRequested: 65535 }).quantityRequested, 65535);
  assert.equal(validateCreateRequest({ ...validCreate, note: '   ' }).note, null);
  for (const body of [
    { ...validCreate, quantityRequested: 0 }, { ...validCreate, quantityRequested: 65536 },
    { ...validCreate, quantityRequested: 1.5 }, { ...validCreate, priority: 'urgent' },
    { ...validCreate, requestStatus: 'ACTIVE' }, { ...validCreate, hospitalId: '12' },
    { ...validCreate, neededBy: 'not-a-date' }, { ...validCreate, neededBy: '2026-02-30T12:00:00Z' },
    { ...validCreate, note: `x${'a'.repeat(500)}` }, { ...validCreate, note: 'safe\nunsafe' },
  ]) assert.throws(() => validateCreateRequest(body), errorCode(400, 'VALIDATION_ERROR'));
  assert.throws(() => validateCreateRequest(Object.defineProperty({}, 'priority', { get() { return 'NORMAL'; } })),
    errorCode(400, 'VALIDATION_ERROR'));
});

test('request list filters accept only the approved structured fields and fixed pagination', () => {
  const hospitalFilters = validateRequestListQuery({
    requestStatus: 'UNDER_REVIEW', priority: 'EMERGENCY', recipientGroupId: '4',
    submittedFrom: '2026-10-01', submittedTo: '2035-10-25', neededByFrom: '2035-10-25', page: '2',
  });
  assert.deepEqual(hospitalFilters, {
    requestStatus: 'UNDER_REVIEW', priority: 'EMERGENCY', recipientGroupId: '4',
    submittedFrom: '2026-10-01', submittedTo: '2035-10-25', neededByFrom: '2035-10-25',
    neededByTo: undefined, page: 2,
  });
  assert.deepEqual(validateRequestListQuery({ hospitalId: '12', page: '1' }, { admin: true }), {
    requestStatus: undefined, priority: undefined, recipientGroupId: undefined,
    submittedFrom: undefined, submittedTo: undefined, neededByFrom: undefined,
    neededByTo: undefined, page: 1, hospitalId: '12',
  });
  for (const query of [
    { q: 'A+' }, { search: 'A+' }, { sort: 'neededBy' }, { status: 'SUBMITTED' },
    { requestStatus: "SUBMITTED' OR 1=1" }, { priority: 'URGENT; DROP TABLE HospitalRequest' },
    { submittedFrom: '2026-02-30' }, { submittedFrom: '2035-10-25', submittedTo: '2026-10-01' },
    { page: '0' }, { page: '9007199254740991' }, { hospitalId: '12' },
  ]) assert.throws(() => validateRequestListQuery(query), errorCode(400, 'VALIDATION_ERROR'));
  assert.equal(validateRequestListQuery({ hospitalId: '12' }, { admin: true }).hospitalId, '12');
});

test('lifecycle helper preserves the approved graph and terminal states', () => {
  assert.equal(canTransitionRequestStatus('SUBMITTED', 'UNDER_REVIEW'), true);
  assert.equal(canTransitionRequestStatus('PARTIALLY_FULFILLED', 'AWAITING_INVENTORY'), true);
  assert.equal(canTransitionRequestStatus('FULFILLED', 'UNDER_REVIEW'), false);
  assert.equal(canTransitionRequestStatus('REJECTED', 'CANCELLED'), false);
  assert.throws(() => assertRequestStatusTransition('SUBMITTED', 'FULFILLED'), errorCode(409, 'INVALID_REQUEST_TRANSITION'));
  assert.throws(() => assertRequestStatusTransition('NOT_A_STATUS', 'CANCELLED'), errorCode(400, 'VALIDATION_ERROR'));
});

test('Hospital cancellation stays blocked without authoritative issued quantity and after any issue', () => {
  assert.throws(() => assertHospitalCancellationBeforeIssue(undefined), errorCode(503, 'REQUEST_FEATURE_NOT_READY'));
  assert.throws(() => assertHospitalCancellationBeforeIssue(1), errorCode(409, 'CANCELLATION_NOT_PERMITTED'));
  assert.equal(assertHospitalCancellationBeforeIssue(0), true);
});

test('service requires a current ACTIVE role and Hospital profile; cross-Hospital reads return the same not-found', async () => {
  const scenarios = [
    [null, errorCode(401, 'AUTHENTICATION_REQUIRED')],
    [{ ...hospital, accountStatus: 'PENDING' }, errorCode(403, 'ACTIVE_ACCOUNT_REQUIRED')],
    [{ ...hospital, accountStatus: 'SUSPENDED' }, errorCode(403, 'ACTIVE_ACCOUNT_REQUIRED')],
    [{ accountId: '12', role: 'DONOR', accountStatus: 'ACTIVE' }, errorCode(403, 'FORBIDDEN')],
    [{ accountId: '12', role: 'ADMIN', accountStatus: 'ACTIVE' }, errorCode(403, 'FORBIDDEN')],
  ];
  for (const [principal, expected] of scenarios) {
    const accounts = principal ? new Map([[principal.accountId, principal]]) : undefined;
    const { repository } = fakeServiceRepository({ accounts });
    const { service } = serviceWith(repository);
    await assert.rejects(service.listHospitalRequests(principal, {}), expected);
  }
  const { repository } = fakeServiceRepository({ hospitals: new Set() });
  const { service } = serviceWith(repository);
  await assert.rejects(service.listHospitalRequests(hospital, {}), errorCode(404, 'HOSPITAL_PROFILE_NOT_FOUND'));
  const otherHospital = { accountId: '14', role: 'HOSPITAL', accountStatus: 'ACTIVE' };
  const crossOwner = fakeServiceRepository({
    accounts: new Map([[hospital.accountId, hospital], [otherHospital.accountId, otherHospital]]),
    hospitals: new Set([hospital.accountId, otherHospital.accountId]),
  });
  await assert.rejects(serviceWith(crossOwner.repository).service.getHospitalRequest(otherHospital, '90'),
    errorCode(404, 'REQUEST_NOT_FOUND'));
});

test('service rejects unauthenticated and inactive/non-Admin actors for Admin list and detail', async () => {
  const { repository } = fakeServiceRepository();
  const { service } = serviceWith(repository);
  await assert.rejects(service.listAdminRequests(null, {}), errorCode(401, 'AUTHENTICATION_REQUIRED'));
  await assert.rejects(service.listAdminRequests(hospital, {}), errorCode(403, 'FORBIDDEN'));
  const accounts = new Map([[admin.accountId, { ...admin, accountStatus: 'PENDING' }]]);
  const pending = serviceWith(fakeServiceRepository({ accounts }).repository).service;
  await assert.rejects(pending.getAdminRequestRecord(admin, '90'), errorCode(403, 'ACTIVE_ACCOUNT_REQUIRED'));
  assert.equal((await service.getAdminRequestRecord(admin, '90')).hospital.hospitalId, '12');
});

test('creation refuses unresolved production dependencies before opening a transaction', async () => {
  const { repository, counters } = fakeServiceRepository();
  const service = createBloodRequestService({ repository });
  await assert.rejects(service.createHospitalRequest(hospital, validCreate), errorCode(503, 'REQUEST_FEATURE_NOT_READY'));
  assert.deepEqual(counters, { begun: 0, committed: 0, rolledBack: 0, released: 0 });
});

test('creation locks and rechecks Hospital ownership, uses authoritative group lookup, and writes request/history/audit atomically', async () => {
  const { repository, calls, connection, counters } = fakeServiceRepository();
  const { service, auditCalls } = serviceWith(repository, {
    auditWriter: createAuditWriter({ allowedActionCodes: ['TEST_HOSPITAL_REQUEST_CREATED'] }),
  });
  const result = await service.createHospitalRequest(hospitalActor, validCreate);
  assert.deepEqual(result, { requestId: '90', requestStatus: 'SUBMITTED', outstandingQuantity: 3 });
  assert.deepEqual(calls.map(([name]) => name).filter((name) => ['account', 'authorize-session', 'hospital', 'group'].includes(name)),
    ['account', 'account', 'authorize-session', 'hospital', 'group']);
  assert.deepEqual(calls.filter(([name]) => name === 'account').map(([, , options]) => options),
    [{ forUpdate: false }, { forUpdate: true }]);
  const sessionCheck = calls.find(([name]) => name === 'authorize-session');
  assert.deepEqual(sessionCheck[1], hospitalActor.session);
  assert.equal(sessionCheck[2].accountId, hospital.accountId);
  const inserted = calls.find(([name]) => name === 'insert-request')[1];
  assert.deepEqual(inserted, {
    hospitalAccountId: '12', recipientGroupId: '4', quantityRequested: 3, priority: 'URGENT',
    neededBy: '2035-10-25 12:30:00', note: 'Safe operational note',
  });
  assert.deepEqual(calls.find(([name]) => name === 'initial-history')[1], { requestId: '90', actorAccountId: '12' });
  assert.equal(auditCalls.length, 0);
  const auditWrite = calls.find(([name]) => name === 'connection-execute');
  assert.match(auditWrite[1], /^INSERT INTO AuditEvent/u);
  assert.deepEqual(auditWrite[2], [
    '12', 'TEST_HOSPITAL_REQUEST_CREATED', 'HospitalRequest', '90', null,
    'Hospital request created', '10d6bc60-23ed-4e16-a3b2-cbce1b44e5ac',
  ]);
  assert.deepEqual(counters, { begun: 1, committed: 1, rolledBack: 0, released: 1 });
});

test('creation rolls back if request, initial history, or audit write fails', async () => {
  for (const failAt of ['request', 'history', 'audit']) {
    const { repository, counters } = fakeServiceRepository({ failAt });
    const { service } = serviceWith(repository, { failAudit: failAt === 'audit' });
    await assert.rejects(service.createHospitalRequest(hospitalActor, validCreate), errorCode(503, 'DATABASE_UNAVAILABLE'));
    assert.equal(counters.begun, 1);
    assert.equal(counters.committed, 0);
    assert.equal(counters.rolledBack, 1);
    assert.equal(counters.released, 1);
  }
});

test('creation stops before request, history or audit writes when the locked stored session is invalid', async () => {
  const { repository, calls, counters } = fakeServiceRepository({ failAt: 'session' });
  const { service, auditCalls } = serviceWith(repository);
  await assert.rejects(service.createHospitalRequest(hospitalActor, validCreate), errorCode(401, 'ACCOUNT_UNAVAILABLE'));
  assert.equal(calls.some(([name]) => ['insert-request', 'initial-history'].includes(name)), false);
  assert.equal(auditCalls.length, 0);
  assert.deepEqual(counters, { begun: 1, committed: 0, rolledBack: 1, released: 1 });
});

test('creation rejects missing or policy-disallowed BloodGroups without writing request/history/audit', async () => {
  const { repository, calls } = fakeServiceRepository({ groups: new Map() });
  const { service, auditCalls } = serviceWith(repository);
  await assert.rejects(service.createHospitalRequest(hospital, validCreate), errorCode(400, 'VALIDATION_ERROR'));
  assert.equal(calls.some(([name]) => name === 'insert-request' || name === 'initial-history'), false);
  assert.equal(auditCalls.length, 0);

  const inactive = fakeServiceRepository({ groups: new Map([['4', { bloodGroupId: '4', isActive: 0 }]]) });
  const denied = serviceWith(inactive.repository, { requestableBloodGroup: async () => false }).service;
  await assert.rejects(denied.createHospitalRequest(hospital, validCreate), errorCode(400, 'VALIDATION_ERROR'));
  assert.equal(inactive.calls.some(([name]) => name === 'insert-request'), false);
});

test('repository binds scoped filters and fixed ordering; no client text or arbitrary sort enters SQL', async () => {
  const calls = [];
  const database = { async execute(sql, values = []) {
    calls.push({ sql: sql.replace(/\s+/gu, ' ').trim(), values });
    if (sql.includes('COUNT(*)')) return [[{ total: '1' }]];
    if (sql.includes('SELECT CAST(r.request_id AS CHAR)')) return [[safeRecord]];
    return [[], []];
  } };
  const repository = createBloodRequestRepository(database);
  const filters = validateRequestListQuery({ requestStatus: 'SUBMITTED', submittedFrom: '2026-10-01', submittedTo: '2035-10-25', page: '2' });
  const result = await repository.listHospitalRequests('12', filters);
  assert.equal(result.pagination.total, 1);
  assert.deepEqual(calls[0].values, ['12', 'SUBMITTED', '2026-10-01 00:00:00', '2035-10-25 00:00:00']);
  assert.deepEqual(calls[1].values, [...calls[0].values, 20, 20]);
  assert.match(calls[1].sql, /r\.hospital_account_id = \?/u);
  assert.match(calls[1].sql, /ORDER BY r\.created_at DESC, r\.request_id DESC/u);
  assert.doesNotMatch(calls[1].sql, /password_hash|session_data|donor_account_id|\bSELECT \*/iu);

  calls.length = 0;
  await repository.listAdminRequests(validateRequestListQuery({ hospitalId: '12', priority: 'EMERGENCY' }, { admin: true }));
  assert.deepEqual(calls[0].values, ['12', 'EMERGENCY']);
  assert.match(calls[1].sql, /CASE r\.priority WHEN 'EMERGENCY' THEN 1 WHEN 'URGENT' THEN 2/u);
  assert.match(calls[1].sql, /r\.needed_by ASC, r\.created_at ASC, r\.request_id ASC/u);
});

test('Hospital request detail query scopes ownership in SQL and maps only safe fields', async () => {
  const calls = [];
  const database = { async execute(sql, values) { calls.push({ sql, values }); return [[safeRecord]]; } };
  const repository = createBloodRequestRepository(database);
  const row = await repository.findHospitalRequest('12', '90');
  assert.deepEqual(calls[0].values, ['12', '90']);
  assert.match(calls[0].sql, /WHERE r\.hospital_account_id = \? AND r\.request_id = \?/u);
  const safe = mapRequestRecord({ ...row, passwordHash: 'hidden', sessionData: 'hidden', donorAccountId: '999' });
  assert.deepEqual(safe, {
    requestId: '90', recipientGroupId: '4', recipientBloodGroupCode: 'A+', recipientBloodGroupName: 'A Positive',
    quantityRequested: 3, priority: 'URGENT', neededBy: '2035-10-25 12:30:00', note: null,
    requestStatus: 'SUBMITTED', rejectionReasonCode: null, createdAt: '2026-10-24 08:00:00', updatedAt: '2026-10-24 08:00:00',
  });
});

test('repository binds request and initial-history writes and preserves generated BIGINT IDs', async () => {
  const calls = [];
  const database = { async execute(sql, values = []) {
    calls.push({ sql: sql.replace(/\s+/gu, ' ').trim(), values });
    if (sql.startsWith('INSERT INTO HospitalRequest')) return [{ affectedRows: 1, insertId: Number.MAX_SAFE_INTEGER + 1 }];
    if (sql.includes('LAST_INSERT_ID')) return [[{ requestId: '9007199254740993' }]];
    return [{ affectedRows: 1 }];
  } };
  const repository = createBloodRequestRepository(database);
  const requestId = await repository.insertRequest({
    hospitalAccountId: '12', recipientGroupId: '4', quantityRequested: 2,
    priority: 'NORMAL', neededBy: '2035-10-25 12:30:00', note: "O'Neil request",
  });
  assert.deepEqual(requestId, { requestId: '9007199254740993' });
  await repository.insertInitialStatusHistory({ requestId: requestId.requestId, actorAccountId: '12' });
  assert.deepEqual(calls[0].values, ['12', '4', 2, 'NORMAL', '2035-10-25 12:30:00', "O'Neil request"]);
  assert.match(calls[0].sql, /VALUES \(\?, \?, \?, \?, \?, \?, 'SUBMITTED'\)/u);
  assert.deepEqual(calls[2].values, ['9007199254740993', '12']);
  assert.match(calls[2].sql, /VALUES \(\?, NULL, 'SUBMITTED', \?\)/u);
  for (const { sql } of calls) assert.doesNotMatch(sql, /O'Neil request|9007199254740993/u);
});

test('transaction repository validates the stored SID on its own connection and rejects invalid session rows', async () => {
  const account = { accountId: '12', role: 'HOSPITAL', accountStatus: 'ACTIVE' };
  const authorization = sessionAuthorization('stored-session', account);
  async function check(row, shouldPass) {
    const calls = [];
    const events = [];
    const connection = {
      async execute(sql, values) {
        calls.push({ sql: sql.replace(/\s+/gu, ' ').trim(), values });
        return [[row]];
      },
      async beginTransaction() { events.push('begin'); },
      async commit() { events.push('commit'); },
      async rollback() { events.push('rollback'); },
      release() { events.push('release'); },
      destroy() { events.push('destroy'); },
    };
    const pool = {
      async execute() { throw new Error('SID check escaped the transaction connection.'); },
      async getConnection() { return connection; },
    };
    const repository = createBloodRequestRepository(pool);
    let result;
    let thrown;
    try {
      result = await repository.withTransaction((transaction) => transaction.authorizeSession(authorization, account));
    } catch (error) { thrown = error; }
    assert.match(calls[0].sql, /FROM app_session WHERE session_id = \? FOR UPDATE/u);
    assert.deepEqual(calls[0].values, ['stored-session']);
    if (shouldPass) {
      assert.deepEqual(result, account);
      assert.deepEqual(events, ['begin', 'commit', 'release']);
    } else {
      assert.equal(thrown?.code, 'ACCOUNT_UNAVAILABLE');
      assert.deepEqual(events, ['begin', 'rollback', 'release']);
    }
  }

  await check({ session_data: JSON.stringify({ auth: account }), expires_at: Date.now() + 60_000, revoked_at: null }, true);
  await check({ session_data: JSON.stringify({ auth: account }), expires_at: Date.now() + 60_000, revoked_at: new Date() }, false);
  await check({ session_data: JSON.stringify({ auth: account }), expires_at: Date.now() - 1, revoked_at: null }, false);
  await check({ session_data: null, expires_at: Date.now() + 60_000, revoked_at: null }, false);
  await check({ session_data: JSON.stringify({ auth: { ...account, accountStatus: 'SUSPENDED' } }),
    expires_at: Date.now() + 60_000, revoked_at: null }, false);
});

function transactionalPool({ fail = null } = {}) {
  const events = [];
  const connection = {
    async execute() { return [[], []]; },
    async beginTransaction() { events.push('begin'); if (fail === 'begin') throw new Error('private'); },
    async commit() { events.push('commit'); if (fail === 'commit') throw new Error('private'); },
    async rollback() { events.push('rollback'); if (fail === 'rollback') throw new Error('private'); },
    release() { events.push('release'); if (fail === 'release') throw new Error('private'); },
    destroy() { events.push('destroy'); if (fail === 'destroy') throw new Error('private'); },
  };
  return { events, connection, pool: { async execute() { return [[], []]; }, async getConnection() { events.push('acquire'); return connection; } } };
}

test('transaction commits/releases on success and rolls back/releases once preserving the original safe error', async () => {
  const success = transactionalPool();
  const successRepository = createBloodRequestRepository(success.pool);
  assert.equal(await successRepository.withTransaction(async (transaction, connection) => {
    assert.notEqual(transaction, successRepository);
    assert.equal(connection, success.connection);
    return 'ok';
  }), 'ok');
  assert.deepEqual(success.events, ['acquire', 'begin', 'commit', 'release']);

  const failure = transactionalPool();
  const failureRepository = createBloodRequestRepository(failure.pool);
  const expected = new HttpError(400, 'EXPECTED_SAFE_FAILURE', 'Safe message.');
  await assert.rejects(failureRepository.withTransaction(async () => { throw expected; }), (error) => error === expected);
  assert.deepEqual(failure.events, ['acquire', 'begin', 'rollback', 'release']);
});

test('transaction destroys once after rollback failure and never releases the uncertain connection', async () => {
  const state = transactionalPool({ fail: 'rollback' });
  const repository = createBloodRequestRepository(state.pool);
  const expected = new HttpError(400, 'EXPECTED_SAFE_FAILURE', 'Safe message.');
  await assert.rejects(repository.withTransaction(async () => { throw expected; }), (error) => error === expected);
  assert.deepEqual(state.events, ['acquire', 'begin', 'rollback', 'destroy']);
});

test('ambiguous commit and failed release are reported safely and do not reuse connections', async () => {
  const commitFailure = transactionalPool({ fail: 'commit' });
  await assert.rejects(createBloodRequestRepository(commitFailure.pool).withTransaction(async () => 'ok'),
    errorCode(503, 'TRANSACTION_OUTCOME_UNKNOWN'));
  assert.deepEqual(commitFailure.events, ['acquire', 'begin', 'commit', 'rollback', 'destroy']);

  const releaseFailure = transactionalPool({ fail: 'release' });
  await assert.rejects(createBloodRequestRepository(releaseFailure.pool).withTransaction(async () => 'ok'),
    errorCode(503, 'TRANSACTION_OUTCOME_UNKNOWN'));
  assert.deepEqual(releaseFailure.events, ['acquire', 'begin', 'commit', 'release', 'destroy']);
});

test('approved active-group policy is strict and unsupported priority actions are not registered', () => {
  for (const isActive of [1, true]) assert.equal(isRequestableBloodGroup({ isActive }), true);
  for (const isActive of [0, false, '1', null, undefined]) assert.equal(isRequestableBloodGroup({ isActive }), false);
  assert.deepEqual(requestAuditActions, ['HOSPITAL_REQUEST_CREATED', 'HOSPITAL_REQUEST_STATUS_CHANGED', 'HOSPITAL_REQUEST_CANCELLED']);
});

test('future deadlines use instants, explicit offsets, second precision and consistent IST round trips', () => {
  const now = Date.parse('2035-10-25T00:00:00Z');
  for (const [neededBy, expected] of [
    ['2035-10-25T12:30:00Z', '2035-10-25T18:00:00+05:30'],
    ['2035-10-25T12:30:00-04:00', '2035-10-25T22:00:00+05:30'],
    ['2035-10-26T00:00:00+14:00', '2035-10-25T15:30:00+05:30'],
  ]) {
    const parsed = validateCreateRequest({ ...validCreate, neededBy }, { now });
    const serialized = serializeRequestTimestamp(parsed.neededBy);
    assert.equal(serialized, expected);
    assert.equal(Date.parse(serialized), Date.parse(neededBy));
  }
  for (const neededBy of ['2035-10-25T00:00:00Z', '2035-10-24T23:59:59Z', '2035-10-25T12:30:00',
    '2035-02-29T12:30:00Z', '2035-10-25T12:30:00.123Z', '2035-10-25T12:30:00+14:01']) {
    assert.throws(() => validateCreateRequest({ ...validCreate, neededBy }, { now }), errorCode(400, 'VALIDATION_ERROR'));
  }
});

test('deadline expiry during Account/group lock waits rolls back before any operational write', async () => {
  const { repository, calls, counters } = fakeServiceRepository();
  let samples = 0;
  const deadline = Date.parse(validCreate.neededBy);
  const { service } = serviceWith(repository, { now: () => samples++ ? deadline : deadline - 1000 });
  await assert.rejects(service.createHospitalRequest(hospitalActor, validCreate), errorCode(400, 'VALIDATION_ERROR'));
  assert.equal(calls.some(([name]) => name === 'insert-request'), false);
  assert.equal(counters.rolledBack, 1);
});
