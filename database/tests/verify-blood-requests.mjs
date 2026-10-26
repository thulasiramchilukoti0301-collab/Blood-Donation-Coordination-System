import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { auditCheckExpression } from './helpers/audit-metadata.mjs';
import { createAuditWriter } from '../../backend/src/modules/audit/writer.js';

// No application config/.env imports, DDL, grants or credential changes.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const database = process.env.PHASE3_REQUEST_TEST_DATABASE;
const host = process.env.DB_HOST;
const portText = process.env.DB_PORT;
const port = Number(portText);
const directory = process.env.PHASE3_REQUEST_TEST_DATA_DIRECTORY;
const failConfiguration = () => { console.error('Configuration failed: explicit disposable request schema, workspace server and test login are required.'); process.exit(2); };
if (!/^bddc_phase3_test_requests_[a-z0-9_]+$/u.test(database ?? '') || database.length > 64
  || process.env.PHASE3_REQUEST_TEST_EMPTY_DATABASE !== 'YES'
  || !['127.0.0.1', 'localhost', '::1'].includes(host)
  || !/^[1-9][0-9]{0,4}$/u.test(portText ?? '') || port > 65535 || port === 3306
  || typeof directory !== 'string' || !isAbsolute(directory)
  || !process.env.PHASE3_TEST_DB_USER?.trim() || typeof process.env.PHASE3_TEST_DB_PASSWORD !== 'string') failConfiguration();
const parts = relative(resolve(root, '.tmp'), resolve(directory)).split(sep);
if (parts.length !== 2 || !/^(?:audit|requests)-mysql-[a-z0-9_-]+$/u.test(parts[0]) || parts[1] !== 'data') failConfiguration();
const mysql = createRequire(resolve(root, 'backend/package.json'))('mysql2/promise');
const statuses = ['SUBMITTED', 'UNDER_REVIEW', 'AWAITING_INVENTORY', 'PARTIALLY_FULFILLED', 'FULFILLED', 'REJECTED', 'CANCELLED'];
const expected = {
  HospitalRequest: [
    ['request_id', 'bigint unsigned', 'NO', null, 'auto_increment', null],
    ['hospital_account_id', 'bigint unsigned', 'NO', null, '', null],
    ['recipient_group_id', 'bigint unsigned', 'NO', null, '', null],
    ['quantity_requested', 'smallint unsigned', 'NO', null, '', null],
    ['priority', 'varchar(10)', 'NO', 'NORMAL', '', 'ascii_bin'],
    ['needed_by', 'datetime', 'NO', null, '', null],
    ['request_note', 'varchar(500)', 'YES', null, '', 'utf8mb4_0900_ai_ci'],
    ['request_status', 'varchar(20)', 'NO', 'SUBMITTED', '', 'ascii_bin'],
    ['rejection_reason_code', 'varchar(40)', 'YES', null, '', 'utf8mb4_0900_ai_ci'],
    ['created_at', 'datetime', 'NO', 'CURRENT_TIMESTAMP', 'DEFAULT_GENERATED', null],
    ['updated_at', 'datetime', 'NO', 'CURRENT_TIMESTAMP', 'DEFAULT_GENERATED', null],
  ],
  RequestStatusHistory: [
    ['request_status_history_id', 'bigint unsigned', 'NO', null, 'auto_increment', null],
    ['request_id', 'bigint unsigned', 'NO', null, '', null],
    ['old_status', 'varchar(20)', 'YES', null, '', 'ascii_bin'],
    ['new_status', 'varchar(20)', 'NO', null, '', 'ascii_bin'],
    ['changed_by_account_id', 'bigint unsigned', 'YES', null, '', null],
    ['reason_code', 'varchar(40)', 'YES', null, '', 'utf8mb4_0900_ai_ci'],
    ['changed_at', 'datetime', 'NO', 'CURRENT_TIMESTAMP', 'DEFAULT_GENERATED', null],
  ],
};
const expectedIndexes = {
  HospitalRequest: { PRIMARY: [0, 'request_id'], ix_request_status_priority_needed_created: [1, 'request_status', 'priority', 'needed_by', 'created_at'],
    ix_request_hospital_created: [1, 'hospital_account_id', 'created_at'], ix_request_recipient_group: [1, 'recipient_group_id'] },
  RequestStatusHistory: { PRIMARY: [0, 'request_status_history_id'], ix_request_history_request_changed: [1, 'request_id', 'changed_at'],
    ix_request_history_actor: [1, 'changed_by_account_id'] },
};
const insertRequest = `INSERT INTO HospitalRequest
  (hospital_account_id, recipient_group_id, quantity_requested, priority, needed_by, request_note, request_status, rejection_reason_code)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;
const insertHistory = `INSERT INTO RequestStatusHistory
  (request_id, old_status, new_status, changed_by_account_id, reason_code) VALUES (?, ?, ?, ?, ?)`;
const tableNames = ['Account', 'Hospital', 'HospitalRequest', 'RequestStatusHistory', 'AuditEvent'];
const canonical = (path) => process.platform === 'win32' ? resolve(path).toLowerCase() : resolve(path);
const safeCode = (error) => typeof error?.code === 'string' && /^(?:ER_[A-Z0-9_]+|ECONN[A-Z0-9_]*|ETIMEDOUT|PROTOCOL_[A-Z0-9_]+)$/u.test(error.code) ? error.code : 'ASSERTION_FAILED';
let connection;
let begun = false;
let rolledBack = false;
let closed = false;
let destroyed = false;
let stage = 'connection';
let failure;
let cleanupFailure;
const negatives = [];
let requestCount = 0;
let historyCount = 0;
function destroy() { destroyed = true; try { connection?.destroy(); } catch {} }
class NegativeCheckFailure extends Error {
  constructor(label, expectedCode, actualCode) { super(); Object.assign(this, { label, expectedCode, actualCode }); }
}
async function reject(label, code, sql, values = []) {
  try { await connection.execute(sql, values); }
  catch (error) {
    if (safeCode(error) !== code) throw new NegativeCheckFailure(label, code, safeCode(error));
    negatives.push(label); return;
  }
  throw new NegativeCheckFailure(label, code, 'NO_ERROR');
}
const clearContext = () => connection.query('SET @request_actor_account_id = NULL, @request_reason_code = NULL, @request_system_operation_id = NULL');
const context = (actor, reason = null, system = null) => connection.execute(
  'SET @request_actor_account_id = ?, @request_reason_code = ?, @request_system_operation_id = ?', [actor, reason, system]);

try {
  connection = await mysql.createConnection({ host, port, database, user: process.env.PHASE3_TEST_DB_USER,
    password: process.env.PHASE3_TEST_DB_PASSWORD, multipleStatements: false, connectTimeout: 5000,
    timezone: '+05:30', supportBigNumbers: true, bigNumberStrings: true });
  const [[server]] = await connection.query('SELECT DATABASE() AS db, @@datadir AS directory, @@port AS port, VERSION() AS version');
  assert.equal(server.db, database); assert.equal(Number(server.port), port); assert.equal(canonical(server.directory), canonical(directory));
  await connection.query("SET time_zone = '+05:30'");
  const [[settings]] = await connection.query('SELECT @@SESSION.sql_mode AS mode, @@SESSION.foreign_key_checks AS fk, @@SESSION.unique_checks AS uq');
  assert.ok(settings.mode.split(',').some((mode) => ['STRICT_TRANS_TABLES', 'STRICT_ALL_TABLES'].includes(mode)));
  assert.equal(Number(settings.fk), 1); assert.equal(Number(settings.uq), 1);
  stage = 'fresh-exact-schema';
  const [tables] = await connection.query('SELECT TABLE_NAME AS name, TABLE_TYPE AS type, ENGINE AS engine, TABLE_COLLATION AS collation FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()');
  assert.deepEqual(tables.map((row) => row.name.toLowerCase()).sort(), ['account', 'auditevent', 'bloodgroup', 'hospital', 'hospitalrequest', 'requeststatushistory']);
  assert.ok(tables.every((row) => row.type === 'BASE TABLE' && row.engine === 'InnoDB' && row.collation === 'utf8mb4_0900_ai_ci'));
  for (const table of tableNames) {
    const [[count]] = await connection.query(`SELECT COUNT(*) AS n FROM ${table}`); assert.equal(Number(count.n), 0);
  }
  const [groups] = await connection.query('SELECT blood_group_id, code FROM BloodGroup ORDER BY blood_group_id');
  assert.deepEqual(groups.map((row) => [Number(row.blood_group_id), row.code]), [[1, 'O-'], [2, 'O+'], [3, 'A-'], [4, 'A+'], [5, 'B-'], [6, 'B+'], [7, 'AB-'], [8, 'AB+']]);
  for (const [catalogue, schema] of [['ROUTINES', 'ROUTINE_SCHEMA'], ['EVENTS', 'EVENT_SCHEMA']]) {
    const [[count]] = await connection.query(`SELECT COUNT(*) AS n FROM information_schema.${catalogue} WHERE ${schema} = DATABASE()`); assert.equal(Number(count.n), 0);
  }
  for (const [table, definitions] of Object.entries(expected)) {
    stage = 'metadata-' + table;
    const [columns] = await connection.execute(`SELECT COLUMN_NAME AS name, COLUMN_TYPE AS type, IS_NULLABLE AS nullable,
      COLUMN_DEFAULT AS default_value, EXTRA AS extra, COLLATION_NAME AS collation, GENERATION_EXPRESSION AS generation_text
      FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND LOWER(TABLE_NAME) = LOWER(?) ORDER BY ORDINAL_POSITION`, [table]);
    assert.equal(columns.length, definitions.length);
    for (const [index, definition] of definitions.entries()) {
      stage = 'metadata-' + table + '-' + definition[0];
      const actual = columns[index]; let defaultValue = actual.default_value;
      if (definition[3] === 'CURRENT_TIMESTAMP') defaultValue = String(defaultValue).toUpperCase().replace(/\(\)$/u, '');
      assert.deepEqual([actual.name, actual.type, actual.nullable, defaultValue, actual.extra, actual.collation], definition, table + '.' + definition[0]);
      assert.equal(actual.generation_text, '');
    }
    stage = 'metadata-' + table + '-indexes';
    const [indexes] = await connection.execute(`SELECT INDEX_NAME AS name, NON_UNIQUE AS non_unique, COLUMN_NAME AS column_name,
      SEQ_IN_INDEX AS ordinal, SUB_PART AS prefix_length FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE() AND LOWER(TABLE_NAME) = LOWER(?) ORDER BY INDEX_NAME, SEQ_IN_INDEX`, [table]);
    const actualIndexes = {};
    for (const row of indexes) {
      assert.equal(row.prefix_length, null);
      if (!actualIndexes[row.name]) actualIndexes[row.name] = [Number(row.non_unique)];
      actualIndexes[row.name].push(row.column_name);
    }
    assert.deepEqual(actualIndexes, expectedIndexes[table]);
    stage = 'metadata-' + table + '-checks';
    const [checks] = await connection.execute(`SELECT tc.CONSTRAINT_NAME AS name, tc.ENFORCED AS enforced, cc.CHECK_CLAUSE AS clause
      FROM information_schema.TABLE_CONSTRAINTS tc JOIN information_schema.CHECK_CONSTRAINTS cc
      ON cc.CONSTRAINT_SCHEMA = tc.CONSTRAINT_SCHEMA AND cc.CONSTRAINT_NAME = tc.CONSTRAINT_NAME
      WHERE tc.TABLE_SCHEMA = DATABASE() AND LOWER(tc.TABLE_NAME) = LOWER(?)`, [table]);
    const expectedCheckNames = table === 'HospitalRequest' ? ['ck_request_quantity', 'ck_request_priority', 'ck_request_status', 'ck_request_rejection_reason']
      : ['ck_request_history_old_status', 'ck_request_history_new_status', 'ck_request_history_initial'];
    assert.deepEqual(checks.map((row) => row.name).sort(), expectedCheckNames.sort());
    assert.ok(checks.every((row) => row.enforced === 'YES'));
    for (const [name, values] of table === 'HospitalRequest' ? [['ck_request_priority', ['EMERGENCY', 'URGENT', 'NORMAL']], ['ck_request_status', statuses]]
      : [['ck_request_history_old_status', statuses], ['ck_request_history_new_status', statuses]]) {
      const clause = auditCheckExpression(checks.find((row) => row.name === name).clause);
      assert.deepEqual([...clause.matchAll(/'([^']+)'/gu)].map((match) => match[1]).sort(), [...values].sort());
    }
  }
  stage = 'metadata-foreign-keys';
  const [fks] = await connection.query(`SELECT k.TABLE_NAME AS table_name, k.CONSTRAINT_NAME AS name, k.COLUMN_NAME AS column_name,
    k.REFERENCED_TABLE_SCHEMA AS parent_schema, k.REFERENCED_TABLE_NAME AS parent_table, k.REFERENCED_COLUMN_NAME AS parent_column,
    r.UPDATE_RULE AS update_rule, r.DELETE_RULE AS delete_rule FROM information_schema.KEY_COLUMN_USAGE k
    JOIN information_schema.REFERENTIAL_CONSTRAINTS r ON r.CONSTRAINT_SCHEMA = k.CONSTRAINT_SCHEMA AND r.TABLE_NAME = k.TABLE_NAME AND r.CONSTRAINT_NAME = k.CONSTRAINT_NAME
    WHERE k.TABLE_SCHEMA = DATABASE() AND LOWER(k.TABLE_NAME) IN ('hospitalrequest','requeststatushistory')`);
  assert.equal(fks.length, 4);
  assert.deepEqual(fks.map((row) => [row.table_name.toLowerCase(), row.name, row.column_name, row.parent_table.toLowerCase(), row.parent_column].join(':')).sort(), [
    'hospitalrequest:fk_request_hospital:hospital_account_id:hospital:account_id',
    'hospitalrequest:fk_request_recipient_group:recipient_group_id:bloodgroup:blood_group_id',
    'requeststatushistory:fk_request_history_request:request_id:hospitalrequest:request_id',
    'requeststatushistory:fk_request_history_actor:changed_by_account_id:account:account_id',
  ].sort());
  assert.ok(fks.every((row) => row.parent_schema === database && row.update_rule === 'RESTRICT' && row.delete_rule === 'RESTRICT'));
  const [triggers] = await connection.query(`SELECT TRIGGER_NAME AS name, ACTION_TIMING AS timing, EVENT_MANIPULATION AS event,
    EVENT_OBJECT_TABLE AS table_name FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA = DATABASE()`);
  assert.deepEqual(triggers.map((row) => [row.name, row.timing, row.event, row.table_name.toLowerCase()].join(':')).sort(), [
    'trg_request_initial_status:BEFORE:INSERT:hospitalrequest', 'trg_request_update_guard:BEFORE:UPDATE:hospitalrequest',
    'trg_request_status_history_update:AFTER:UPDATE:hospitalrequest',
  ].sort());

  stage = 'transactional-fixtures';
  await connection.beginTransaction(); begun = true;
  const token = randomUUID();
  async function account(role, status = 'ACTIVE', withHospital = role === 'HOSPITAL') {
    const [row] = await connection.execute('INSERT INTO Account (email,password_hash,role,account_status) VALUES (?,?,?,?)',
      [`request-fixture-${randomUUID()}@example.invalid`, 'DISPOSABLE_NOT_A_LOGIN_HASH', role, status]);
    const id = String(row.insertId);
    if (withHospital) await connection.execute(`INSERT INTO Hospital (account_id,organization_name,contact_name,phone,address) VALUES (?,?,?,?,?)`,
      [id, 'Disposable verification hospital ' + id, 'Test contact', '123', 'Non-production fixture']);
    return id;
  }
  const admin = await account('ADMIN');
  const hospital = await account('HOSPITAL');
  const otherHospital = await account('HOSPITAL');
  const donor = await account('DONOR');
  const pending = await account('HOSPITAL', 'PENDING');
  const pendingAdmin = await account('ADMIN', 'PENDING');
  const suspended = await account('ADMIN', 'SUSPENDED');
  const values = (changes = {}) => Object.values({ hospital, group: '1', quantity: 2, priority: 'NORMAL', neededBy: '2030-01-02 10:00:00', note: null, status: 'SUBMITTED', reason: null, ...changes });
  async function create(changes = {}) {
    const [row] = await connection.execute(insertRequest, values(changes)); return String(row.insertId);
  }
  async function initial(id) { await connection.execute(insertHistory, [id, null, 'SUBMITTED', hospital, null]); }
  const requestId = await create(); await initial(requestId);
  const audit = createAuditWriter({ allowedActionCodes: ['test.only.request'] });
  await audit.write(connection, { actorAccountId: hospital, actionCode: 'test.only.request', subjectType: 'HospitalRequest', subjectId: requestId });
  // Model the next service's same-connection creation contract without routes.
  await connection.query('SAVEPOINT initial_history_failure');
  const noHistory = await create();
  await reject('initial-history-failure', 'ER_NO_REFERENCED_ROW_2', insertHistory, [noHistory, null, 'SUBMITTED', '999999', null]);
  await connection.query('ROLLBACK TO SAVEPOINT initial_history_failure');
  const [[missingInitial]] = await connection.execute('SELECT COUNT(*) AS n FROM HospitalRequest WHERE request_id=?', [noHistory]);
  assert.equal(Number(missingInitial.n), 0);
  await connection.query('SAVEPOINT initial_audit_failure');
  const noAudit = await create(); await initial(noAudit);
  await assert.rejects(audit.write(connection, { actorAccountId: '999999', actionCode: 'test.only.request', subjectType: 'HospitalRequest', subjectId: noAudit }),
    (error) => error.status === 503 && error.code === 'DATABASE_UNAVAILABLE');
  negatives.push('initial-audit-failure-propagates');
  await connection.query('ROLLBACK TO SAVEPOINT initial_audit_failure');
  const [[missingAuditRequest]] = await connection.execute('SELECT COUNT(*) AS n FROM HospitalRequest WHERE request_id=?', [noAudit]);
  const [[missingAuditHistory]] = await connection.execute('SELECT COUNT(*) AS n FROM RequestStatusHistory WHERE request_id=?', [noAudit]);
  assert.deepEqual([Number(missingAuditRequest.n), Number(missingAuditHistory.n)], [0, 0]);
  const [[defaults]] = await connection.execute('SELECT priority, request_status, created_at IS NOT NULL AS created, updated_at IS NOT NULL AS updated FROM HospitalRequest WHERE request_id=?', [requestId]);
  assert.deepEqual([defaults.priority, defaults.request_status, Number(defaults.created), Number(defaults.updated)], ['NORMAL', 'SUBMITTED', 1, 1]);
  // Also exercise omitted priority/status/time defaults, not just explicit values.
  await connection.execute('INSERT INTO HospitalRequest (hospital_account_id,recipient_group_id,quantity_requested,needed_by) VALUES (?,1,1,?)', [hospital, '2030-01-02 10:00:00']);
  for (const priority of ['EMERGENCY', 'URGENT', 'NORMAL']) await create({ priority, note: 'X'.repeat(500) });
  await create({ quantity: 65535 });
  for (const field of ['hospital', 'group', 'quantity', 'priority', 'neededBy', 'status']) {
    await reject('required-' + field, 'ER_BAD_NULL_ERROR', insertRequest, values({ [field]: null }));
  }
  for (const quantity of [0]) await reject('nonpositive-quantity', 'ER_CHECK_CONSTRAINT_VIOLATED', insertRequest, values({ quantity }));
  for (const quantity of [-1, 65536]) await reject('quantity-range-' + quantity, 'ER_WARN_DATA_OUT_OF_RANGE', insertRequest, values({ quantity }));
  for (const priority of ['LOW', 'urgent', 'NORMAL ']) await reject('priority-' + priority.trim(), 'ER_CHECK_CONSTRAINT_VIOLATED', insertRequest, values({ priority }));
  for (const status of [...statuses.filter((value) => value !== 'SUBMITTED'), 'UNKNOWN', 'submitted']) {
    await reject('creation-status-' + status, 'ER_SIGNAL_EXCEPTION', insertRequest, values({ status }));
  }
  await reject('creation-status-trailing-space', 'ER_CHECK_CONSTRAINT_VIOLATED', insertRequest, values({ status: 'SUBMITTED ' }));
  await reject('missing-hospital-parent', 'ER_NO_REFERENCED_ROW_2', insertRequest, values({ hospital: admin }));
  await reject('missing-blood-group', 'ER_NO_REFERENCED_ROW_2', insertRequest, values({ group: '999999' }));
  await reject('note-overlength', 'ER_DATA_TOO_LONG', insertRequest, values({ note: 'X'.repeat(501) }));
  await reject('invalid-needed-by', 'ER_TRUNCATED_WRONG_VALUE', insertRequest, values({ neededBy: 'not-a-date' }));
  await reject('immutable-quantity', 'ER_SIGNAL_EXCEPTION', 'UPDATE HospitalRequest SET quantity_requested=3 WHERE request_id=?', [requestId]);
  await connection.execute('UPDATE HospitalRequest SET quantity_requested=quantity_requested WHERE request_id=?', [requestId]);
  await clearContext();
  await reject('missing-actor-context', 'ER_SIGNAL_EXCEPTION', "UPDATE HospitalRequest SET request_status='UNDER_REVIEW' WHERE request_id=?", [requestId]);
  for (const [label, actor] of [['donor', donor], ['pending-admin', pendingAdmin], ['suspended-admin', suspended],
    ['foreign-hospital', otherHospital], ['missing-account', '999999'], ['noncanonical-id', '01'],
    ['injected-id', '1 OR 1=1'], ['control-character-id', '1\n']]) {
    await context(actor);
    await reject('context-' + label, 'ER_SIGNAL_EXCEPTION', "UPDATE HospitalRequest SET request_status='UNDER_REVIEW' WHERE request_id=?", [requestId]);
  }
  for (const [label, actor, reason, system] of [
    ['ambiguous', admin, null, token], ['invalid-system-operation', null, null, 'invalid'],
    ['system-operation-control-character', null, null, token + '\n'],
    ['blank-reason', admin, ' ', null], ['overlength-reason', admin, 'X'.repeat(41), null],
    ['control-character-reason', admin, 'bad\nreason', null],
  ]) {
    await context(actor, reason, system);
    await reject('context-' + label, 'ER_SIGNAL_EXCEPTION', "UPDATE HospitalRequest SET request_status='UNDER_REVIEW' WHERE request_id=?", [requestId]);
  }
  await context(admin);
  await reject('invalid-static-transition', 'ER_SIGNAL_EXCEPTION', "UPDATE HospitalRequest SET request_status='FULFILLED' WHERE request_id=?", [requestId]);
  await connection.execute("UPDATE HospitalRequest SET request_status='UNDER_REVIEW',updated_at=CURRENT_TIMESTAMP WHERE request_id=?", [requestId]);
  const countHistory = async (id) => { const [[row]] = await connection.execute('SELECT COUNT(*) AS n FROM RequestStatusHistory WHERE request_id=?', [id]); return Number(row.n); };
  assert.equal(await countHistory(requestId), 2);
  await connection.execute("UPDATE HospitalRequest SET priority='URGENT' WHERE request_id=?", [requestId]);
  assert.equal(await countHistory(requestId), 2, 'Non-status updates must not duplicate history.');
  for (const status of ['AWAITING_INVENTORY', 'PARTIALLY_FULFILLED', 'AWAITING_INVENTORY', 'PARTIALLY_FULFILLED', 'FULFILLED']) {
    await connection.execute('UPDATE HospitalRequest SET request_status=? WHERE request_id=?', [status, requestId]);
  }
  assert.equal(await countHistory(requestId), 7);
  await reject('fulfilled-terminal', 'ER_SIGNAL_EXCEPTION', "UPDATE HospitalRequest SET request_status='UNDER_REVIEW' WHERE request_id=?", [requestId]);
  const rejected = await create(); await initial(rejected);
  await connection.execute("UPDATE HospitalRequest SET request_status='UNDER_REVIEW' WHERE request_id=?", [rejected]);
  await reject('rejection-requires-reason', 'ER_CHECK_CONSTRAINT_VIOLATED', "UPDATE HospitalRequest SET request_status='REJECTED' WHERE request_id=?", [rejected]);
  await context(admin, 'TEST_ONLY_OTHER');
  await reject('rejection-context-mismatch', 'ER_SIGNAL_EXCEPTION', "UPDATE HospitalRequest SET request_status='REJECTED',rejection_reason_code='TEST_ONLY_REJECT' WHERE request_id=?", [rejected]);
  await context(admin, 'TEST_ONLY_REJECT');
  await connection.execute("UPDATE HospitalRequest SET request_status='REJECTED',rejection_reason_code='TEST_ONLY_REJECT' WHERE request_id=?", [rejected]);
  const [[reason]] = await connection.execute("SELECT reason_code FROM RequestStatusHistory WHERE request_id=? AND new_status='REJECTED'", [rejected]);
  assert.equal(reason.reason_code, 'TEST_ONLY_REJECT');
  await reject('rejected-terminal', 'ER_SIGNAL_EXCEPTION', "UPDATE HospitalRequest SET request_status='UNDER_REVIEW' WHERE request_id=?", [rejected]);
  const cancelled = await create(); await initial(cancelled);
  await context(otherHospital);
  await reject('foreign-hospital-cancel', 'ER_SIGNAL_EXCEPTION', "UPDATE HospitalRequest SET request_status='CANCELLED' WHERE request_id=?", [cancelled]);
  await context(admin);
  await reject('unapproved-admin-cancel', 'ER_SIGNAL_EXCEPTION', "UPDATE HospitalRequest SET request_status='CANCELLED' WHERE request_id=?", [cancelled]);
  await context(hospital, 'TEST_ONLY_CANCEL');
  await connection.execute("UPDATE HospitalRequest SET request_status='CANCELLED' WHERE request_id=?", [cancelled]);
  await reject('cancelled-terminal', 'ER_SIGNAL_EXCEPTION', "UPDATE HospitalRequest SET request_status='UNDER_REVIEW' WHERE request_id=?", [cancelled]);
  // Storage FKs alone do not authorize creation. This raw SQL-only fixture
  // isolates the proposed status guard for a pending Hospital owning the row.
  const pendingOwned = await create({ hospital: pending });
  await context(pending);
  await reject('pending-hospital-own-cancel', 'ER_SIGNAL_EXCEPTION', "UPDATE HospitalRequest SET request_status='CANCELLED' WHERE request_id=?", [pendingOwned]);
  const systemRequest = await create(); await initial(systemRequest);
  await context(admin); await connection.execute("UPDATE HospitalRequest SET request_status='UNDER_REVIEW' WHERE request_id=?", [systemRequest]);
  await context(null, 'TEST_ONLY_SYSTEM', token);
  await connection.execute("UPDATE HospitalRequest SET request_status='AWAITING_INVENTORY' WHERE request_id=?", [systemRequest]);
  const [[systemHistory]] = await connection.execute("SELECT changed_by_account_id,reason_code FROM RequestStatusHistory WHERE request_id=? AND new_status='AWAITING_INVENTORY'", [systemRequest]);
  assert.equal(systemHistory.changed_by_account_id, null); assert.equal(systemHistory.reason_code, 'TEST_ONLY_SYSTEM');
  await clearContext();
  const noContext = await create(); await initial(noContext);
  await reject('cleared-context-not-reused', 'ER_SIGNAL_EXCEPTION', "UPDATE HospitalRequest SET request_status='UNDER_REVIEW' WHERE request_id=?", [noContext]);
  await reject('history-missing-request', 'ER_NO_REFERENCED_ROW_2', insertHistory, ['999999', null, 'SUBMITTED', admin, null]);
  await reject('history-missing-actor', 'ER_NO_REFERENCED_ROW_2', insertHistory, [requestId, 'SUBMITTED', 'UNDER_REVIEW', '999999', null]);
  await reject('history-invalid-old-status', 'ER_CHECK_CONSTRAINT_VIOLATED', insertHistory, [requestId, 'UNKNOWN', 'UNDER_REVIEW', admin, null]);
  await reject('history-invalid-new-status', 'ER_CHECK_CONSTRAINT_VIOLATED', insertHistory, [requestId, 'SUBMITTED', 'UNKNOWN', admin, null]);
  await reject('history-initial-must-be-submitted', 'ER_CHECK_CONSTRAINT_VIOLATED', insertHistory, [requestId, null, 'UNDER_REVIEW', admin, null]);
  await reject('history-required-status', 'ER_BAD_NULL_ERROR', insertHistory, [requestId, 'SUBMITTED', null, admin, null]);
  await reject('history-overlength-reason', 'ER_DATA_TOO_LONG', insertHistory, [requestId, 'SUBMITTED', 'UNDER_REVIEW', admin, 'X'.repeat(41)]);
  await reject('history-restrict-request-delete', 'ER_ROW_IS_REFERENCED_2', 'DELETE FROM HospitalRequest WHERE request_id=?', [requestId]);
  await reject('history-restrict-actor-delete', 'ER_ROW_IS_REFERENCED_2', 'DELETE FROM Account WHERE account_id=?', [admin]);
  await reject('request-restrict-hospital-delete', 'ER_ROW_IS_REFERENCED_2', 'DELETE FROM Hospital WHERE account_id=?', [hospital]);
  await reject('request-restrict-group-delete', 'ER_ROW_IS_REFERENCED_2', 'DELETE FROM BloodGroup WHERE blood_group_id=1');
  await reject('history-restrict-request-key-update', 'ER_ROW_IS_REFERENCED_2', 'UPDATE HospitalRequest SET request_id=999999 WHERE request_id=?', [requestId]);
  await reject('history-restrict-actor-key-update', 'ER_ROW_IS_REFERENCED_2', 'UPDATE Account SET account_id=999999 WHERE account_id=?', [admin]);
  await reject('request-restrict-hospital-key-update', 'ER_ROW_IS_REFERENCED_2', 'UPDATE Hospital SET account_id=? WHERE account_id=?', [admin, hospital]);
  await reject('request-restrict-group-key-update', 'ER_ROW_IS_REFERENCED_2', 'UPDATE BloodGroup SET blood_group_id=999999 WHERE blood_group_id=1');
  const [[requests]] = await connection.query('SELECT COUNT(*) AS n FROM HospitalRequest'); requestCount = Number(requests.n);
  const [[histories]] = await connection.query('SELECT COUNT(*) AS n FROM RequestStatusHistory'); historyCount = Number(histories.n);
  const [seen] = await connection.query('SELECT DISTINCT new_status FROM RequestStatusHistory');
  assert.deepEqual(seen.map((row) => row.new_status).sort(), [...statuses].sort());
  stage = 'rollback';
} catch (error) {
  failure = error instanceof NegativeCheckFailure
    ? `${stage}:${error.label}:expected=${error.expectedCode}:actual=${error.actualCode}` : `${stage}:${safeCode(error)}`;
} finally {
  if (connection && !destroyed) {
    try {
      if (begun) { await connection.rollback(); begun = false; rolledBack = true; }
      await clearContext();
      const [[state]] = await connection.query('SELECT @request_actor_account_id AS actor, @request_reason_code AS reason, @request_system_operation_id AS operation_id');
      assert.deepEqual([state.actor, state.reason, state.operation_id], [null, null, null]);
      if (rolledBack) for (const table of tableNames) {
        const [[count]] = await connection.query(`SELECT COUNT(*) AS n FROM ${table}`); assert.equal(Number(count.n), 0);
      }
    } catch (error) { cleanupFailure = safeCode(error); destroy(); }
  }
  if (connection && !destroyed) {
    try { await connection.end(); closed = true; } catch (error) { cleanupFailure = safeCode(error); destroy(); }
  }
}
if (failure || cleanupFailure || !rolledBack || !closed) {
  console.error(`Request storage verification failed: ${failure || 'verification'}; cleanup=${cleanupFailure || 'not-confirmed'}.`);
  process.exitCode = 1;
} else {
  for (const label of negatives) console.log('PASS ' + label);
  console.log(`Request storage + UNASSIGNED history proposal passed: ${negatives.length} negative checks; ${requestCount} requests and ${historyCount} history fixtures rolled back; Account/Hospital/request/history/audit tables empty; context cleared; connection closed.`);
  console.log('This does not verify real Allocation-derived counts, pre-issue cancellation, web sessions, production history deployment or concurrency.');
}
