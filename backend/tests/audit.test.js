import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createAuditWriter } from '../src/modules/audit/writer.js';
import { HttpError } from '../src/utils/httpError.js';
import { errorHandler } from '../src/middleware/errorHandler.js';

// Action names here are isolated test configuration, not production vocabulary.
const allowedActionCodes = ['test.changed', 'test.system'];
const event = { actorAccountId: '12', actionCode: 'test.changed', subjectType: 'Hospital', subjectId: '24' };
const invalid = (error) => error instanceof HttpError && error.status === 400 && error.code === 'VALIDATION_ERROR';

function connectionDouble({ execute } = {}) {
  const calls = [];
  const connection = {
    async execute(sql, values) {
      calls.push({ sql, values });
      return execute ? execute(sql, values) : [{ affectedRows: 1, insertId: '9007199254740993' }];
    },
    async beginTransaction() { assert.fail('Writer must not begin a transaction.'); },
    async commit() { assert.fail('Writer must not commit.'); },
    async rollback() { assert.fail('Writer must not roll back.'); },
    release() { assert.fail('Writer must not release the caller connection.'); },
    destroy() { assert.fail('Writer must not destroy the caller connection.'); },
  };
  return { connection, calls };
}

function publicError(error) {
  let body;
  let status;
  errorHandler(error, {}, { status(value) { status = value; return this; }, json(value) { body = value; } },
    () => assert.fail('Unexpected next'));
  return { status, body };
}

test('Audit writer requires an explicit trusted action registry and supplies no default vocabulary', () => {
  for (const options of [undefined, {}, { allowedActionCodes: [] }, { allowedActionCodes: Array(1) }, { allowedActionCodes: new Set(['test']) },
    { allowedActionCodes: ['test', 'test'] }, { allowedActionCodes: [''] }, { allowedActionCodes: [' '] },
    { allowedActionCodes: ['a'.repeat(49)] }, { allowedActionCodes: ['test\n'] }, { allowedActionCodes: ['tést'] },
    { allowedActionCodes: [123] }]) {
    assert.throws(() => createAuditWriter(options), (error) => error instanceof HttpError
      && error.status === 500 && error.code === 'AUDIT_CONFIGURATION_ERROR');
  }
  assert.deepEqual(Object.keys(createAuditWriter({ allowedActionCodes })).sort(), ['write', 'writeSystemEvent']);
});

test('Audit INSERT binds only approved scalar fields on the supplied connection and returns a precise string ID', async () => {
  const writer = createAuditWriter({ allowedActionCodes });
  const { connection, calls } = connectionDouble();
  const supplied = { ...event, reasonCode: 'reviewed', changeSummary: "A permitted value changed: ' ? --",
    operationId: '00000000-0000-0000-0000-000000000000' };
  assert.equal(await writer.write(connection, supplied), '9007199254740993');
  assert.equal(calls.length, 1);
  assert.match(calls[0].sql, /^INSERT INTO AuditEvent/u);
  assert.doesNotMatch(calls[0].sql, /audit_event_id|occurred_at|reviewed|permitted|BEGIN|COMMIT|ROLLBACK/iu);
  assert.equal((calls[0].sql.match(/\?/gu) ?? []).length, 7);
  assert.deepEqual(calls[0].values, ['12', 'test.changed', 'Hospital', '24', supplied.reasonCode,
    supplied.changeSummary, supplied.operationId]);
  assert.deepEqual(supplied, { ...event, reasonCode: 'reviewed', changeSummary: "A permitted value changed: ' ? --",
    operationId: '00000000-0000-0000-0000-000000000000' });
});

test('Optional audit fields are NULL when omitted/NULL and preserve nonblank scalar text without normalization', async () => {
  const writer = createAuditWriter({ allowedActionCodes });
  const { connection, calls } = connectionDouble();
  await writer.write(connection, event);
  await writer.write(connection, { ...event, reasonCode: null, changeSummary: null, operationId: null });
  await writer.write(connection, { ...event, reasonCode: ' safe reason ', changeSummary: ' Safe server summary ' });
  assert.deepEqual(calls[0].values.slice(4), [null, null, null]);
  assert.deepEqual(calls[1].values.slice(4), [null, null, null]);
  assert.deepEqual(calls[2].values.slice(4), [' safe reason ', ' Safe server summary ', null]);
});

test('Action registry matching is exact, case-sensitive and unaffected by later registry mutations', async () => {
  const registry = ['test.changed'];
  const writer = createAuditWriter({ allowedActionCodes: registry });
  registry.push('test.later');
  registry[0] = 'test.replaced';
  const { connection, calls } = connectionDouble();
  await writer.write(connection, event);
  for (const actionCode of ['test.later', 'test.replaced', 'TEST.CHANGED', ' test.changed', null, {}, undefined]) {
    await assert.rejects(writer.write(connection, { ...event, actionCode }), invalid);
  }
  assert.equal(calls.length, 1);
});

test('Audit writer rejects pools and incomplete connection dependencies without acquiring a connection', async () => {
  const writer = createAuditWriter({ allowedActionCodes });
  const { connection, calls } = connectionDouble();
  for (const dependency of [undefined, null, {}, { execute: connection.execute },
    { ...connection, getConnection() { assert.fail('No pool acquisition is allowed.'); } },
    ...['execute', 'beginTransaction', 'commit', 'rollback'].map((method) => ({ ...connection, [method]: undefined }))]) {
    await assert.rejects(writer.write(dependency, event), (error) => error instanceof HttpError
      && error.status === 500 && error.code === 'AUDIT_CONNECTION_REQUIRED');
  }
  assert.equal(calls.length, 0);
});

test('Actor IDs are required for normal writes; system writes explicitly reject all supplied actor fields', async () => {
  const writer = createAuditWriter({ allowedActionCodes });
  const { connection, calls } = connectionDouble();
  const { actorAccountId, ...withoutActor } = event;
  void actorAccountId;
  await assert.rejects(writer.write(connection, withoutActor), invalid);
  await assert.rejects(writer.write(connection, { ...event, actorAccountId: null }), invalid);
  for (const actor of ['12', null, undefined]) {
    await assert.rejects(writer.writeSystemEvent(connection, { ...withoutActor, actorAccountId: actor }), invalid);
  }
  await writer.writeSystemEvent(connection, { ...withoutActor, actionCode: 'test.system', subjectType: 'SYSTEM_TASK', subjectId: null });
  await writer.writeSystemEvent(connection, { ...withoutActor, actionCode: 'test.system', subjectType: 'BloodUnit', subjectId: '24' });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].values[0], null);
  assert.equal(calls[0].values[3], null);
  assert.equal(calls[1].values[0], null);
  assert.equal(calls[1].values[3], '24');
});

test('All documented entity types require a positive subject ID and only SYSTEM_TASK requires NULL', async () => {
  const writer = createAuditWriter({ allowedActionCodes });
  const { connection, calls } = connectionDouble();
  const subjects = ['Account', 'Donor', 'Hospital', 'BloodGroup', 'BloodCompatibility', 'DonationSlot', 'Booking',
    'EligibilityDecision', 'Donation', 'BloodUnit', 'HospitalRequest', 'RequestStatusHistory', 'Allocation', 'AuditEvent'];
  for (const subjectType of subjects) {
    await writer.write(connection, { ...event, subjectType });
    await assert.rejects(writer.write(connection, { ...event, subjectType, subjectId: null }), invalid);
  }
  await writer.write(connection, { ...event, subjectType: 'SYSTEM_TASK', subjectId: null });
  for (const subjectType of ['hospital', 'HOSPITAL', 'system_task', 'Hospital; DROP TABLE Account', '', null, {}]) {
    await assert.rejects(writer.write(connection, { ...event, subjectType }), invalid);
  }
  await assert.rejects(writer.write(connection, { ...event, subjectType: 'SYSTEM_TASK' }), invalid);
  const { subjectId, ...missingId } = event;
  void subjectId;
  await assert.rejects(writer.write(connection, missingId), invalid);
  assert.equal(calls.length, subjects.length + 1);
});

test('Audit IDs preserve unsigned BIGINT precision and reject unsafe, noncanonical or injected values', async () => {
  const writer = createAuditWriter({ allowedActionCodes });
  const { connection, calls } = connectionDouble();
  await writer.write(connection, { ...event, actorAccountId: '18446744073709551615', subjectId: '9007199254740993' });
  await writer.write(connection, { ...event, actorAccountId: 12, subjectId: Number.MAX_SAFE_INTEGER });
  assert.deepEqual(calls[0].values.slice(0, 4), ['18446744073709551615', 'test.changed', 'Hospital', '9007199254740993']);
  assert.equal(calls[1].values[0], '12');
  assert.equal(calls[1].values[3], String(Number.MAX_SAFE_INTEGER));
  for (const field of ['actorAccountId', 'subjectId']) {
    for (const value of ['', '0', '01', '-1', '1.2', '1 OR 1=1', '12\n', '12\u2028', '18446744073709551616', Number.MAX_SAFE_INTEGER + 1,
      -1, 0, 1.5, 1n, null, undefined, {}, []]) {
      await assert.rejects(writer.write(connection, { ...event, [field]: value }), invalid);
    }
  }
  assert.equal(calls.length, 2);
});

test('Audit scalar lengths count Unicode characters and reject blanks, controls, objects or malformed UUIDs', async () => {
  const writer = createAuditWriter({ allowedActionCodes: ['x'.repeat(48)] });
  const { connection, calls } = connectionDouble();
  const maximum = { ...event, actionCode: 'x'.repeat(48), reasonCode: 'é'.repeat(40), changeSummary: '🏥'.repeat(1000),
    operationId: 'ABCDEF01-2345-6789-abcd-EF0123456789' };
  await writer.write(connection, maximum);
  assert.equal(calls.length, 1);
  for (const [field, length] of [['reasonCode', 40], ['changeSummary', 1000]]) {
    for (const value of ['x'.repeat(length + 1), '', '   ', 'bad\nvalue', 'bad\u0085value', 123, {}, [], undefined]) {
      await assert.rejects(writer.write(connection, { ...maximum, [field]: value }), invalid);
    }
  }
  for (const operationId of ['', ' ', 'not-a-uuid', '00000000000000000000000000000000',
    '00000000-0000-0000-0000-00000000000G', '00000000-0000-0000-0000-000000000000x',
    '00000000-0000-0000-0000-000000000000\n', {}, undefined]) {
    await assert.rejects(writer.write(connection, { ...maximum, operationId }), invalid);
  }
  assert.equal(calls.length, 1);
});

test('Audit payloads reject unknown credential/medical fields, nested values, inherited values and accessors', async () => {
  const writer = createAuditWriter({ allowedActionCodes });
  const { connection, calls } = connectionDouble();
  for (const key of ['password', 'passwordHash', 'password_hash', 'session', 'sessionId', 'csrfToken', 'token',
    'secret', 'medicalAnswers', 'beforeData', 'afterData', 'auditEventId', 'occurredAt', '__proto__']) {
    await assert.rejects(writer.write(connection, { ...event, [key]: 'never-expose-private-test-value' }), invalid);
  }
  for (const value of [undefined, null, [], 'text', Object.create(event),
    { ...event, changeSummary: { password: 'never-expose-private-test-value' } }]) {
    await assert.rejects(writer.write(connection, value), invalid);
  }
  const accessor = { ...event };
  Object.defineProperty(accessor, 'changeSummary', { get() { assert.fail('Accessors must not run.'); } });
  await assert.rejects(writer.write(connection, accessor), invalid);
  const hidden = { ...event };
  Object.defineProperty(hidden, 'password', { value: 'never-expose-private-test-value' });
  await assert.rejects(writer.write(connection, hidden), invalid);
  await assert.rejects(writer.write(connection, { ...event, [Symbol('private')]: 'hidden' }), invalid);
  assert.equal(calls.length, 0);
});

test('Audit validation errors do not echo rejected secret-bearing payload values', async () => {
  const writer = createAuditWriter({ allowedActionCodes });
  const { connection } = connectionDouble();
  let failure;
  await assert.rejects(writer.write(connection, { ...event, password: 'never-expose-private-test-value' }),
    (error) => { failure = error; return invalid(error); });
  const { status, body } = publicError(failure);
  assert.equal(status, 400);
  assert.deepEqual(body, { success: false, error: { code: 'VALIDATION_ERROR', message: 'Audit event input is invalid.' } });
  assert.doesNotMatch(JSON.stringify(body), /never-expose|password|stack|sqlMessage/iu);
});

test('Audit INSERT errors are sanitized while already-safe domain errors are preserved for caller handling', async () => {
  const writer = createAuditWriter({ allowedActionCodes });
  const domain = new HttpError(409, 'SAFE_CONFLICT', 'The operation conflicts with an existing record.');
  for (const original of [Object.assign(new Error('private-driver-password=secret'), {
    code: 'ER_NO_REFERENCED_ROW_2', sqlMessage: 'SELECT secret FROM private_table', sql: 'private SQL',
  }), domain]) {
    const { connection, calls } = connectionDouble({ execute: async () => { throw original; } });
    let failure;
    await assert.rejects(writer.write(connection, event), (error) => {
      failure = error;
      if (original === domain) assert.strictEqual(error, domain);
      else assert.ok(error instanceof HttpError && error.status === 503 && error.code === 'DATABASE_UNAVAILABLE');
      return true;
    });
    assert.equal(calls.length, 1);
    const { body } = publicError(failure);
    assert.doesNotMatch(JSON.stringify(body), /private-driver|password=|SELECT|sqlMessage|private SQL|stack|cause/u);
  }
});

test('Audit writer rejects unsafe INSERT result IDs and unexpected affected-row counts as safe storage failures', async () => {
  const writer = createAuditWriter({ allowedActionCodes });
  for (const packet of [{ affectedRows: 0, insertId: '1' }, { affectedRows: 2, insertId: '1' },
    { affectedRows: 1, insertId: Number.MAX_SAFE_INTEGER + 1 }, { affectedRows: 1, insertId: '0' },
    { affectedRows: 1, insertId: '18446744073709551616' }, { affectedRows: 1 }, null]) {
    const { connection } = connectionDouble({ execute: async () => [packet] });
    await assert.rejects(writer.write(connection, event), (error) => error instanceof HttpError
      && error.status === 503 && error.code === 'DATABASE_UNAVAILABLE');
  }
  const { connection } = connectionDouble({ execute: async () => [{ affectedRows: 1, insertId: '18446744073709551615' }] });
  assert.equal(await writer.write(connection, event), '18446744073709551615');
});

function callerOwnedDatabase({ failAudit = false } = {}) {
  const rows = { business: [], audit: [] };
  const controls = [];
  let active = false;
  let snapshot;
  const connection = {
    async beginTransaction() { controls.push('begin'); snapshot = structuredClone(rows); active = true; },
    async execute(sql, values) {
      assert.equal(active, true, 'Test caller must begin the transaction first.');
      if (sql === 'INSERT INTO isolated_business VALUES (?)') { rows.business.push(values[0]); return [{ affectedRows: 1 }]; }
      assert.match(sql, /^INSERT INTO AuditEvent/u);
      if (failAudit) throw new Error('private-driver failure');
      rows.audit.push([...values]);
      return [{ affectedRows: 1, insertId: String(rows.audit.length) }];
    },
    async commit() { controls.push('commit'); active = false; },
    async rollback() { controls.push('rollback'); rows.business = snapshot.business; rows.audit = snapshot.audit; active = false; },
    release() { controls.push('release'); },
    destroy() { assert.fail('Writer must not destroy the caller transaction.'); },
  };
  return { rows, controls, connection };
}

test('Caller rollback removes both a business mutation and its audit INSERT without independent writer controls', async () => {
  const writer = createAuditWriter({ allowedActionCodes });
  const { rows, controls, connection } = callerOwnedDatabase();
  await connection.beginTransaction();
  await connection.execute('INSERT INTO isolated_business VALUES (?)', ['business change']);
  assert.equal(await writer.write(connection, event), '1');
  assert.equal(rows.business.length, 1);
  assert.equal(rows.audit.length, 1);
  assert.deepEqual(controls, ['begin']);
  await connection.rollback();
  connection.release();
  assert.deepEqual(rows, { business: [], audit: [] });
  assert.deepEqual(controls, ['begin', 'rollback', 'release']);
});

test('Audit failure propagates so the caller can roll back its business mutation and own all cleanup', async () => {
  const writer = createAuditWriter({ allowedActionCodes });
  const { rows, controls, connection } = callerOwnedDatabase({ failAudit: true });
  await connection.beginTransaction();
  await connection.execute('INSERT INTO isolated_business VALUES (?)', ['business change']);
  await assert.rejects(writer.write(connection, event), (error) => error.status === 503 && error.code === 'DATABASE_UNAVAILABLE');
  assert.deepEqual(controls, ['begin']);
  assert.equal(rows.business.length, 1);
  await connection.rollback();
  connection.release();
  assert.deepEqual(rows, { business: [], audit: [] });
  assert.deepEqual(controls, ['begin', 'rollback', 'release']);
});

test('Only the caller commits a successful business/audit transaction', async () => {
  const writer = createAuditWriter({ allowedActionCodes });
  const { rows, controls, connection } = callerOwnedDatabase();
  await connection.beginTransaction();
  await connection.execute('INSERT INTO isolated_business VALUES (?)', ['business change']);
  await writer.write(connection, event);
  assert.deepEqual(controls, ['begin']);
  await connection.commit();
  connection.release();
  assert.equal(rows.business.length, 1);
  assert.equal(rows.audit.length, 1);
  assert.deepEqual(controls, ['begin', 'commit', 'release']);
});
