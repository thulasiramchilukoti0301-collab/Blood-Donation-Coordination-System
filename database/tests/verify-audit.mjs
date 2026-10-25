import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { auditCheckExpression } from './helpers/audit-metadata.mjs';

// Standalone disposable verifier. Never import application config or load .env.
const testDatabase = process.env.PHASE3_AUDIT_TEST_DATABASE?.trim();
const host = process.env.DB_HOST?.trim().toLowerCase();
const portText = process.env.DB_PORT;
const port = Number(portText);
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const isolatedDirectory = process.env.PHASE3_AUDIT_TEST_DATA_DIRECTORY;
function configurationFailure(message) {
  console.error(`Configuration failed: ${message}`);
  process.exit(2);
}
if (!/^bddc_phase3_test_audit_[a-z0-9_]+$/u.test(testDatabase ?? '') || testDatabase.length > 64) {
  configurationFailure('set PHASE3_AUDIT_TEST_DATABASE to bddc_phase3_test_audit_<label> (maximum 64 characters).');
}
if (process.env.PHASE3_AUDIT_TEST_EMPTY_DATABASE !== 'YES') {
  configurationFailure('set PHASE3_AUDIT_TEST_EMPTY_DATABASE=YES only for an authorized fresh disposable schema.');
}
if (!['localhost', '127.0.0.1', '::1'].includes(host)) configurationFailure('explicit loopback DB_HOST is required.');
if (typeof portText !== 'string' || !/^[1-9][0-9]{0,4}$/u.test(portText) || port > 65535) {
  configurationFailure('set explicit DB_PORT to an integer between 1 and 65535.');
}
if (isolatedDirectory !== undefined) {
  const parts = relative(resolve(repositoryRoot, '.tmp'), resolve(isolatedDirectory)).split(sep);
  if (!isAbsolute(isolatedDirectory) || parts.length !== 2 || !/^audit-mysql-[a-z0-9_-]+$/u.test(parts[0])
    || parts[1] !== 'data' || port === 3306) {
    configurationFailure('isolated data directory must be an explicit workspace .tmp/audit-mysql-<label>/data target on a non-3306 port.');
  }
}
if (!process.env.PHASE3_TEST_DB_USER?.trim() || typeof process.env.PHASE3_TEST_DB_PASSWORD !== 'string'
  || (isolatedDirectory === undefined && !process.env.PHASE3_TEST_DB_PASSWORD.trim())) {
  configurationFailure('supply disposable-only PHASE3_TEST_DB_USER and an explicit PHASE3_TEST_DB_PASSWORD.');
}

const mysql = createRequire(resolve(repositoryRoot, 'backend/package.json'))('mysql2/promise');
const subjects = ['Account', 'Donor', 'Hospital', 'BloodGroup', 'BloodCompatibility', 'DonationSlot',
  'Booking', 'EligibilityDecision', 'Donation', 'BloodUnit', 'HospitalRequest', 'RequestStatusHistory',
  'Allocation', 'AuditEvent', 'SYSTEM_TASK'];
const expectedColumns = [
  ['audit_event_id', 'bigint unsigned', 'NO', null, 'auto_increment', null, null],
  ['actor_account_id', 'bigint unsigned', 'YES', null, '', null, null],
  ['action_code', 'varchar(48)', 'NO', null, '', 'ascii', 'ascii_bin'],
  ['subject_type', 'varchar(32)', 'NO', null, '', 'ascii', 'ascii_bin'],
  ['subject_id', 'bigint unsigned', 'YES', null, '', null, null],
  ['occurred_at', 'datetime', 'NO', 'CURRENT_TIMESTAMP', 'timestamp_default', null, null],
  ['reason_code', 'varchar(40)', 'YES', null, '', 'utf8mb4', 'utf8mb4_0900_ai_ci'],
  ['change_summary', 'varchar(1000)', 'YES', null, '', 'utf8mb4', 'utf8mb4_0900_ai_ci'],
  ['operation_id', 'char(36)', 'YES', null, '', 'ascii', 'ascii_bin'],
];
const expectedGroups = [[1, 'O-', 'O negative', 1], [2, 'O+', 'O positive', 1],
  [3, 'A-', 'A negative', 1], [4, 'A+', 'A positive', 1], [5, 'B-', 'B negative', 1],
  [6, 'B+', 'B positive', 1], [7, 'AB-', 'AB negative', 1], [8, 'AB+', 'AB positive', 1]];
const insertAudit = `INSERT INTO AuditEvent
  (actor_account_id, action_code, subject_type, subject_id, occurred_at, reason_code, change_summary, operation_id)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;

function safeCode(error) {
  return typeof error?.code === 'string'
    && /^(?:ER_[A-Z0-9_]+|ECONN[A-Z0-9_]*|ETIMEDOUT|EPIPE|EAI_AGAIN|ENOTFOUND|PROTOCOL_[A-Z0-9_]+)$/u.test(error.code)
    ? error.code : 'ASSERTION_FAILED';
}
class NegativeCheckFailure extends Error {
  constructor(label, expectedCode, actualCode) { super(); Object.assign(this, { label, expectedCode, actualCode }); }
}
let connection;
let transactionStarted = false;
let rollbackSucceeded = false;
let connectionClosed = false;
let destroyed = false;
let verificationStage = 'connection';
let verificationFailure;
let failureStage;
let cleanupFailure;
const negativeResults = [];
let fixtureCount = 0;
function destroyConnection() {
  destroyed = true;
  try { connection?.destroy(); } catch { /* Preserve the original safe cleanup failure. */ }
}
async function rejectsSql(label, expectedCode, sql, values = []) {
  try { await connection.execute(sql, values); }
  catch (error) {
    const actualCode = safeCode(error);
    if (actualCode !== expectedCode) throw new NegativeCheckFailure(label, expectedCode, actualCode);
    negativeResults.push({ label, code: actualCode });
    return;
  }
  throw new NegativeCheckFailure(label, expectedCode, 'NO_ERROR');
}
function normalizeCheck(value) {
  return auditCheckExpression(value).replace(/_ascii|_utf8mb4/giu, '').replace(/[`\s()]/gu, '').toUpperCase();
}

try {
  connection = await mysql.createConnection({ host, port, database: testDatabase,
    user: process.env.PHASE3_TEST_DB_USER, password: process.env.PHASE3_TEST_DB_PASSWORD,
    connectTimeout: 5000, multipleStatements: false, timezone: '+05:30',
    supportBigNumbers: true, bigNumberStrings: true });
  await connection.query("SET time_zone = '+05:30'");
  const [[selected]] = await connection.query('SELECT DATABASE() AS selected_database');
  assert.equal(selected.selected_database, testDatabase);

  verificationStage = 'metadata-visibility-and-fresh-schema';
  if (isolatedDirectory !== undefined) {
    // The caller assembled this fresh schema on its dedicated workspace server.
    // Verify that exact instance without inspecting or changing any grants.
    const [[instance]] = await connection.query('SELECT @@datadir AS data_directory, @@port AS port');
    const canonical = (path) => process.platform === 'win32' ? resolve(path).toLowerCase() : resolve(path);
    assert.equal(canonical(instance.data_directory), canonical(isolatedDirectory));
    assert.equal(Number(instance.port), port);
  } else {
    const [grantRows] = await connection.query('SHOW GRANTS');
    const globalPrivileges = new Set();
    for (const row of grantRows) for (const grant of Object.values(row)) {
      if (typeof grant !== 'string') continue;
      const match = grant.match(/^GRANT\s+(.+?)\s+ON\s+`?\*`?\.`?\*`?\s+TO\s+/iu);
      if (match) for (const privilege of match[1].replaceAll('`', '').split(/\s*,\s*/u)) globalPrivileges.add(privilege.toUpperCase());
    }
    assert.ok(globalPrivileges.has('ALL PRIVILEGES')
      || ['SELECT', 'SHOW_ROUTINE', 'TRIGGER', 'EVENT'].every((privilege) => globalPrivileges.has(privilege)),
    'direct global metadata visibility is required');
  }
  const [tables] = await connection.query(`SELECT TABLE_NAME AS name, TABLE_TYPE AS type,
    ENGINE AS engine, TABLE_COLLATION AS collation FROM information_schema.TABLES
    WHERE TABLE_SCHEMA = DATABASE() ORDER BY TABLE_NAME`);
  assert.deepEqual(tables.map((row) => row.name.toLowerCase()).sort(), ['account', 'auditevent', 'bloodgroup']);
  assert.ok(tables.every((row) => row.type === 'BASE TABLE' && row.engine === 'InnoDB' && row.collation === 'utf8mb4_0900_ai_ci'));
  for (const [catalogue, schemaColumn] of [['TRIGGERS', 'TRIGGER_SCHEMA'], ['ROUTINES', 'ROUTINE_SCHEMA'], ['EVENTS', 'EVENT_SCHEMA']]) {
    const [[row]] = await connection.query(`SELECT COUNT(*) AS object_count FROM information_schema.${catalogue} WHERE ${schemaColumn} = DATABASE()`);
    assert.equal(Number(row.object_count), 0);
  }
  for (const table of ['Account', 'AuditEvent']) {
    const [[row]] = await connection.query(`SELECT COUNT(*) AS row_count FROM ${table}`);
    assert.equal(Number(row.row_count), 0, 'refuse populated disposable tables');
  }
  const [groups] = await connection.query('SELECT blood_group_id, code, display_name, is_active FROM BloodGroup ORDER BY blood_group_id');
  assert.deepEqual(groups.map((row) => [Number(row.blood_group_id), row.code.trim(), row.display_name, Number(row.is_active)]), expectedGroups);
  const [[session]] = await connection.query('SELECT @@SESSION.sql_mode AS sql_mode, @@SESSION.foreign_key_checks AS fk_checks, @@SESSION.unique_checks AS uq_checks');
  assert.ok(session.sql_mode.split(',').some((mode) => ['STRICT_TRANS_TABLES', 'STRICT_ALL_TABLES'].includes(mode)));
  assert.equal(Number(session.fk_checks), 1); assert.equal(Number(session.uq_checks), 1);
  const [parentColumns] = await connection.query(`SELECT COLUMN_TYPE AS type, IS_NULLABLE AS nullable, COLUMN_KEY AS column_key
    FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND LOWER(TABLE_NAME) = 'account' AND COLUMN_NAME = 'account_id'`);
  assert.equal(parentColumns.length, 1);
  assert.deepEqual([parentColumns[0].type, parentColumns[0].nullable, parentColumns[0].column_key], ['bigint unsigned', 'NO', 'PRI']);

  verificationStage = 'exact-audit-metadata';
  const [columns] = await connection.query(`SELECT COLUMN_NAME AS name, COLUMN_TYPE AS type, IS_NULLABLE AS nullable,
    COLUMN_DEFAULT AS default_value, EXTRA AS extra, GENERATION_EXPRESSION AS generation_text,
    CHARACTER_SET_NAME AS charset, COLLATION_NAME AS collation FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND LOWER(TABLE_NAME) = 'auditevent' ORDER BY ORDINAL_POSITION`);
  assert.equal(columns.length, expectedColumns.length);
  for (const [index, [name, type, nullable, defaultValue, extra, charset, collation]] of expectedColumns.entries()) {
    verificationStage = `audit-column-${name}`;
    const actual = columns[index];
    assert.deepEqual([actual.name, actual.type, actual.nullable, actual.charset, actual.collation], [name, type, nullable, charset, collation]);
    assert.equal(actual.generation_text, '');
    if (defaultValue === 'CURRENT_TIMESTAMP') {
      assert.match(String(actual.default_value).toUpperCase(), /^CURRENT_TIMESTAMP(?:\(\))?$/u);
      assert.ok(['', 'DEFAULT_GENERATED'].includes(actual.extra.toUpperCase()));
    } else { assert.equal(actual.default_value, defaultValue); assert.equal(actual.extra.toLowerCase(), extra); }
  }
  verificationStage = 'audit-constraints';
  const [constraints] = await connection.query(`SELECT tc.CONSTRAINT_NAME AS name, tc.CONSTRAINT_TYPE AS type,
    tc.ENFORCED AS enforced, cc.CHECK_CLAUSE AS clause FROM information_schema.TABLE_CONSTRAINTS tc
    LEFT JOIN information_schema.CHECK_CONSTRAINTS cc ON cc.CONSTRAINT_SCHEMA = tc.CONSTRAINT_SCHEMA AND cc.CONSTRAINT_NAME = tc.CONSTRAINT_NAME
    WHERE tc.CONSTRAINT_SCHEMA = DATABASE() AND LOWER(tc.TABLE_NAME) = 'auditevent'`);
  assert.deepEqual(constraints.map((row) => `${row.name}:${row.type}`).sort(), ['PRIMARY:PRIMARY KEY',
    'fk_audit_event_actor:FOREIGN KEY', 'ck_audit_event_subject_type:CHECK', 'ck_audit_event_subject_id:CHECK'].sort());
  const checks = constraints.filter((row) => row.type === 'CHECK');
  assert.ok(checks.every((row) => row.enforced === 'YES'));
  const whitelist = auditCheckExpression(checks.find((row) => row.name === 'ck_audit_event_subject_type').clause);
  assert.deepEqual([...whitelist.matchAll(/'([^']+)'/gu)].map((match) => match[1]).sort(), [...subjects].sort());
  assert.ok(normalizeCheck(whitelist).startsWith('SUBJECT_TYPEIN'));
  const subjectRule = normalizeCheck(checks.find((row) => row.name === 'ck_audit_event_subject_id').clause);
  assert.ok(subjectRule === "SUBJECT_TYPE='SYSTEM_TASK'<=>SUBJECT_IDISNULL"
    || subjectRule === "SUBJECT_TYPE='SYSTEM_TASK'=SUBJECT_IDISNULL"
    || subjectRule === "SUBJECT_TYPE='SYSTEM_TASK'ANDSUBJECT_IDISNULLORSUBJECT_TYPE<>'SYSTEM_TASK'ANDSUBJECT_IDISNOTNULL");
  verificationStage = 'audit-indexes';
  const [indexes] = await connection.query(`SELECT INDEX_NAME AS name, NON_UNIQUE AS non_unique, SEQ_IN_INDEX AS ordinal,
    COLUMN_NAME AS column_name, INDEX_TYPE AS type, SUB_PART AS prefix_length FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND LOWER(TABLE_NAME) = 'auditevent'`);
  assert.deepEqual(indexes.map((row) => [row.name, Number(row.non_unique), Number(row.ordinal), row.column_name, row.type, row.prefix_length].join(':')).sort(), [
    'PRIMARY:0:1:audit_event_id:BTREE:', 'ix_audit_event_subject:1:1:subject_type:BTREE:',
    'ix_audit_event_subject:1:2:subject_id:BTREE:', 'ix_audit_event_subject:1:3:occurred_at:BTREE:',
    'ix_audit_event_actor:1:1:actor_account_id:BTREE:', 'ix_audit_event_actor:1:2:occurred_at:BTREE:',
  ].sort());
  verificationStage = 'audit-actor-foreign-key';
  const [foreignKeys] = await connection.query(`SELECT k.CONSTRAINT_NAME AS name, k.COLUMN_NAME AS column_name,
    k.ORDINAL_POSITION AS ordinal, k.POSITION_IN_UNIQUE_CONSTRAINT AS parent_ordinal,
    k.REFERENCED_TABLE_SCHEMA AS parent_schema, k.REFERENCED_TABLE_NAME AS parent_table, k.REFERENCED_COLUMN_NAME AS parent_column,
    r.UPDATE_RULE AS update_rule, r.DELETE_RULE AS delete_rule FROM information_schema.KEY_COLUMN_USAGE k
    JOIN information_schema.REFERENTIAL_CONSTRAINTS r ON r.CONSTRAINT_SCHEMA = k.CONSTRAINT_SCHEMA
    AND r.TABLE_NAME = k.TABLE_NAME AND r.CONSTRAINT_NAME = k.CONSTRAINT_NAME
    WHERE k.CONSTRAINT_SCHEMA = DATABASE() AND LOWER(k.TABLE_NAME) = 'auditevent'`);
  assert.equal(foreignKeys.length, 1);
  const fk = foreignKeys[0];
  assert.deepEqual([fk.name, fk.column_name, Number(fk.ordinal), Number(fk.parent_ordinal), fk.parent_schema,
    fk.parent_table.toLowerCase(), fk.parent_column, fk.update_rule, fk.delete_rule],
  ['fk_audit_event_actor', 'actor_account_id', 1, 1, testDatabase, 'account', 'account_id', 'RESTRICT', 'RESTRICT']);

  verificationStage = 'transactional-fixtures';
  await connection.beginTransaction(); transactionStarted = true;
  const token = randomUUID();
  const [account] = await connection.execute(`INSERT INTO Account (email, password_hash, role, account_status)
    VALUES (?, ?, 'ADMIN', 'ACTIVE')`, [`audit-verifier-${token}@example.invalid`, 'DISPOSABLE_FIXTURE_NOT_A_LOGIN_HASH']);
  const actorId = String(account.insertId);
  const absentActorId = (BigInt(actorId) + 1n).toString();
  const values = (changes = {}) => Object.values({ actorId, action: 'TEST_ONLY_STORAGE_CHECK', subject: 'Account',
    subjectId: actorId, occurredAt: '2026-01-02 03:04:05', reason: null, summary: null, operationId: null, ...changes });
  for (const subject of subjects) {
    await connection.execute(insertAudit, values({ subject, subjectId: subject === 'SYSTEM_TASK' ? null : actorId,
      actorId: subject === 'SYSTEM_TASK' ? null : actorId, operationId: token }));
    fixtureCount += 1;
  }
  // NULL scheduler actors may identify per-unit system events; role/target
  // authorization remains the consuming service's responsibility.
  await connection.execute(insertAudit, values({ actorId: null, subject: 'BloodUnit', operationId: token })); fixtureCount += 1;
  for (let index = 0; index < 2; index += 1) {
    await connection.execute(`INSERT INTO AuditEvent (actor_account_id, action_code, subject_type, subject_id)
      VALUES (?, 'TEST_ONLY_DEFAULT_TIME', 'Account', ?)`, [actorId, actorId]); fixtureCount += 1;
  }
  const [[defaults]] = await connection.query(`SELECT COUNT(*) AS count_rows, SUM(reason_code IS NULL AND change_summary IS NULL AND operation_id IS NULL) AS nullable_rows,
    SUM(occurred_at BETWEEN CURRENT_TIMESTAMP - INTERVAL 5 MINUTE AND CURRENT_TIMESTAMP + INTERVAL 1 MINUTE) AS current_rows
    FROM AuditEvent WHERE action_code = 'TEST_ONLY_DEFAULT_TIME'`);
  assert.deepEqual([Number(defaults.count_rows), Number(defaults.nullable_rows), Number(defaults.current_rows)], [2, 2, 2]);
  const [[shared]] = await connection.execute('SELECT COUNT(*) AS count_rows FROM AuditEvent WHERE operation_id = ?', [token]);
  assert.equal(Number(shared.count_rows), subjects.length + 1);
  const boundarySummary = '🏥'.repeat(1000);
  await connection.execute(insertAudit, values({ action: 'X'.repeat(48), reason: '理'.repeat(40), summary: boundarySummary,
    operationId: 'X'.repeat(36) })); fixtureCount += 1;
  const [[boundary]] = await connection.execute(`SELECT CHAR_LENGTH(reason_code) AS reason_length, CHAR_LENGTH(change_summary) AS summary_length,
    CHAR_LENGTH(action_code) AS action_length, CHAR_LENGTH(operation_id) AS operation_length FROM AuditEvent WHERE action_code = ?`, ['X'.repeat(48)]);
  assert.deepEqual([Number(boundary.reason_length), Number(boundary.summary_length), Number(boundary.action_length), Number(boundary.operation_length)], [40, 1000, 48, 36]);
  const [[first]] = await connection.query('SELECT CAST(MIN(audit_event_id) AS CHAR) AS first_id, COUNT(*) AS total FROM AuditEvent');
  assert.equal(Number(first.total), fixtureCount);
  assert.ok(/^[1-9][0-9]*$/u.test(first.first_id));

  verificationStage = 'negative-storage-checks';
  for (const [field, label] of [['action', 'action-code'], ['subject', 'subject-type'], ['occurredAt', 'occurred-at']]) {
    await rejectsSql(`required-${label}-null`, 'ER_BAD_NULL_ERROR', insertAudit, values({ [field]: null }));
  }
  await rejectsSql('duplicate-explicit-primary-key', 'ER_DUP_ENTRY', `INSERT INTO AuditEvent
    (audit_event_id, actor_account_id, action_code, subject_type, subject_id) VALUES (?, ?, 'TEST_ONLY_DUPLICATE', 'Account', ?)`, [first.first_id, actorId, actorId]);
  await rejectsSql('missing-actor-parent', 'ER_NO_REFERENCED_ROW_2', insertAudit, values({ actorId: absentActorId }));
  await rejectsSql('restrict-actor-delete', 'ER_ROW_IS_REFERENCED_2', 'DELETE FROM Account WHERE account_id = ?', [actorId]);
  await rejectsSql('restrict-actor-key-update', 'ER_ROW_IS_REFERENCED_2', 'UPDATE Account SET account_id = ? WHERE account_id = ?', [absentActorId, actorId]);
  for (const subject of ['UNKNOWN', 'account', 'system_task', '']) {
    await rejectsSql(`invalid-subject-${subject || 'blank'}`, 'ER_CHECK_CONSTRAINT_VIOLATED', insertAudit, values({ subject }));
  }
  await rejectsSql('system-task-forbids-subject-id', 'ER_CHECK_CONSTRAINT_VIOLATED', insertAudit, values({ subject: 'SYSTEM_TASK' }));
  await rejectsSql('entity-requires-subject-id', 'ER_CHECK_CONSTRAINT_VIOLATED', insertAudit, values({ subjectId: null }));
  for (const [field, limit] of [['action', 48], ['subject', 32], ['reason', 40], ['summary', 1000], ['operationId', 36]]) {
    await rejectsSql(`overlength-${field}`, 'ER_DATA_TOO_LONG', insertAudit, values({ [field]: 'X'.repeat(limit + 1) }));
  }
  await rejectsSql('invalid-actor-id', 'ER_TRUNCATED_WRONG_VALUE_FOR_FIELD', insertAudit, values({ actorId: 'invalid' }));
  await rejectsSql('invalid-subject-id', 'ER_TRUNCATED_WRONG_VALUE_FOR_FIELD', insertAudit, values({ subjectId: 'invalid' }));
  await rejectsSql('negative-actor-id', 'ER_WARN_DATA_OUT_OF_RANGE', insertAudit, values({ actorId: '-1' }));
  await rejectsSql('negative-subject-id', 'ER_WARN_DATA_OUT_OF_RANGE', insertAudit, values({ subjectId: '-1' }));
  await rejectsSql('invalid-occurred-at', 'ER_TRUNCATED_WRONG_VALUE', insertAudit, values({ occurredAt: 'not-a-date' }));
  verificationStage = 'fixture-rollback';
} catch (error) {
  failureStage = verificationStage;
  verificationFailure = error instanceof NegativeCheckFailure
    ? `${error.label}: expected ${error.expectedCode}, received ${error.actualCode}` : safeCode(error);
} finally {
  if (transactionStarted) {
    try {
      await connection.rollback(); transactionStarted = false; rollbackSucceeded = true;
      verificationStage = 'post-rollback-empty-tables';
      for (const table of ['Account', 'AuditEvent']) {
        const [[row]] = await connection.query(`SELECT COUNT(*) AS row_count FROM ${table}`);
        assert.equal(Number(row.row_count), 0);
      }
    } catch (error) { cleanupFailure = `rollback-or-post-rollback-check:${safeCode(error)}`; destroyConnection(); }
  }
  if (connection && !destroyed) {
    try { await connection.end(); connectionClosed = true; }
    catch (error) { cleanupFailure = `connection-close:${safeCode(error)}`; destroyConnection(); }
  }
}
if (cleanupFailure || verificationFailure || !rollbackSucceeded || !connectionClosed) {
  console.error(`Audit storage verification failed during ${cleanupFailure ? verificationStage : (failureStage || verificationStage)}: ${cleanupFailure || verificationFailure || 'ROLLBACK_AND_CLOSE_NOT_CONFIRMED'}.`);
  process.exitCode = 1;
} else {
  for (const result of negativeResults) console.log(`PASS ${result.label} (${result.code})`);
  console.log(`Audit storage verification passed: ${negativeResults.length} negative checks; ${fixtureCount} synthetic audit rows and one Account fixture rolled back; both tables empty; connection closed.`);
}
