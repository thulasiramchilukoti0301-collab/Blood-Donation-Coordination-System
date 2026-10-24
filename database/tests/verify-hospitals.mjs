import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Deliberately do not import backend environment.js: it reads a private file.
// Only explicitly supplied process variables configure this disposable verifier.
const testDatabase = process.env.PHASE3_HOSPITAL_TEST_DATABASE?.trim();
const port = Number(process.env.DB_PORT || 3306);
const host = process.env.DB_HOST?.trim().toLowerCase();
function configurationFailure(message) {
  console.error(`Configuration failed: ${message}`);
  process.exit(2);
}
if (!/^bddc_phase3_test_hospital_[a-z0-9_]+$/.test(testDatabase ?? '') || testDatabase.length > 64) {
  configurationFailure('set PHASE3_HOSPITAL_TEST_DATABASE to bddc_phase3_test_hospital_<label> (maximum 64 characters).');
}
if (process.env.PHASE3_HOSPITAL_TEST_EMPTY_DATABASE !== 'YES') {
  configurationFailure('set PHASE3_HOSPITAL_TEST_EMPTY_DATABASE=YES only for a separately authorized fresh disposable schema.');
}
if (!['localhost', '127.0.0.1', '::1'].includes(host)) {
  configurationFailure('Hospital verification requires an explicit loopback DB_HOST.');
}
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  configurationFailure('DB_PORT must be an integer between 1 and 65535.');
}
if (!process.env.PHASE3_TEST_DB_USER?.trim() || !process.env.PHASE3_TEST_DB_PASSWORD?.trim()) {
  configurationFailure('supply disposable-only PHASE3_TEST_DB_USER and PHASE3_TEST_DB_PASSWORD in the process environment.');
}

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const mysql = createRequire(resolve(repositoryRoot, 'backend/package.json'))('mysql2/promise');
const expectedColumns = [
  ['account_id', 'bigint unsigned', 'NO'],
  ['organization_name', 'varchar(180)', 'NO'],
  ['registration_number', 'varchar(80)', 'YES'],
  ['contact_name', 'varchar(120)', 'NO'],
  ['phone', 'varchar(30)', 'NO'],
  ['address', 'varchar(255)', 'NO'],
  ['created_at', 'datetime', 'NO'],
  ['updated_at', 'datetime', 'NO'],
];
const expectedGroups = [
  [1, 'O-', 'O negative', 1], [2, 'O+', 'O positive', 1],
  [3, 'A-', 'A negative', 1], [4, 'A+', 'A positive', 1],
  [5, 'B-', 'B negative', 1], [6, 'B+', 'B positive', 1],
  [7, 'AB-', 'AB negative', 1], [8, 'AB+', 'AB positive', 1],
];
const insertHospital = `INSERT INTO Hospital
  (account_id, organization_name, registration_number, contact_name, phone, address, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;
const insertWithDefaults = `INSERT INTO Hospital
  (account_id, organization_name, registration_number, contact_name, phone, address)
  VALUES (?, ?, ?, ?, ?, ?)`;

function safeCode(error) {
  return typeof error?.code === 'string'
    && /^(?:ER_[A-Z0-9_]+|ECONN[A-Z0-9_]*|ETIMEDOUT|EPIPE|EAI_AGAIN|ENOTFOUND|PROTOCOL_[A-Z0-9_]+)$/.test(error.code)
    ? error.code : 'ASSERTION_FAILED';
}
class NegativeCheckFailure extends Error {
  constructor(label, expectedCode, actualCode) {
    super();
    this.label = label;
    this.expectedCode = expectedCode;
    this.actualCode = actualCode;
  }
}
const negativeResults = [];
async function rejectsSql(label, expectedCode, sql, parameters) {
  try {
    await connection.execute(sql, parameters);
  } catch (error) {
    const actualCode = safeCode(error);
    if (actualCode !== expectedCode) throw new NegativeCheckFailure(label, expectedCode, actualCode);
    negativeResults.push({ label, code: actualCode });
    return;
  }
  throw new NegativeCheckFailure(label, expectedCode, 'NO_ERROR');
}

let connection;
let transactionStarted = false;
let rollbackSucceeded = false;
let verificationFailure;
let failureStage;
let cleanupFailure;
let verificationStage = 'connection';
try {
  connection = await mysql.createConnection({
    host, port, user: process.env.PHASE3_TEST_DB_USER,
    password: process.env.PHASE3_TEST_DB_PASSWORD, database: testDatabase,
    timezone: '+05:30', connectTimeout: 5000, multipleStatements: false,
    supportBigNumbers: true, bigNumberStrings: true,
  });
  await connection.query("SET time_zone = '+05:30'");
  const [[selected]] = await connection.query('SELECT DATABASE() AS selected_database');
  assert.equal(selected.selected_database, testDatabase);

  verificationStage = 'metadata-visibility-and-fresh-schema';
  // Require a direct ALL grant on this disposable schema, not global grants or
  // role inference. This makes trigger/routine/event absence checks meaningful.
  // SHOW GRANTS is inspected internally and is never printed.
  const [grantRows] = await connection.query('SHOW GRANTS');
  const schemaGrant = `ALL PRIVILEGES ON \`${testDatabase}\`.* TO `;
  assert.ok(grantRows.some((row) => Object.values(row).some((grant) =>
    typeof grant === 'string' && grant.startsWith(`GRANT ${schemaGrant}`))),
  'direct disposable-schema ALL grant required for metadata visibility');
  const [tables] = await connection.query(
    `SELECT TABLE_NAME AS name, TABLE_TYPE AS type, ENGINE AS engine, TABLE_COLLATION AS collation
       FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() ORDER BY TABLE_NAME`,
  );
  assert.deepEqual(tables.map((row) => row.name.toLowerCase()).sort(), ['account', 'bloodgroup', 'hospital']);
  assert.ok(tables.every((row) => row.type === 'BASE TABLE' && row.engine === 'InnoDB'
    && row.collation === 'utf8mb4_0900_ai_ci'));
  for (const [catalogue, schemaColumn] of [
    ['TRIGGERS', 'TRIGGER_SCHEMA'], ['ROUTINES', 'ROUTINE_SCHEMA'], ['EVENTS', 'EVENT_SCHEMA'],
  ]) {
    const [[row]] = await connection.query(
      `SELECT COUNT(*) AS object_count FROM information_schema.${catalogue} WHERE ${schemaColumn} = DATABASE()`,
    );
    assert.equal(Number(row.object_count), 0, 'no triggers, routines or events permitted');
  }
  for (const table of ['Account', 'Hospital']) {
    const [[row]] = await connection.query(`SELECT COUNT(*) AS row_count FROM ${table}`);
    assert.equal(Number(row.row_count), 0, 'refuse populated disposable operational tables');
  }
  const [groups] = await connection.query(
    'SELECT blood_group_id, code, display_name, is_active FROM BloodGroup ORDER BY blood_group_id',
  );
  assert.deepEqual(groups.map((row) => [Number(row.blood_group_id), row.code.trim(), row.display_name, Number(row.is_active)]), expectedGroups);
  const [[session]] = await connection.query(
    'SELECT @@SESSION.sql_mode AS sql_mode, @@SESSION.foreign_key_checks AS fk_checks, @@SESSION.unique_checks AS uq_checks',
  );
  assert.ok(session.sql_mode.split(',').some((mode) => ['STRICT_TRANS_TABLES', 'STRICT_ALL_TABLES'].includes(mode)));
  assert.equal(Number(session.fk_checks), 1);
  assert.equal(Number(session.uq_checks), 1);
  const [parentKey] = await connection.query(
    `SELECT COLUMN_TYPE AS type, IS_NULLABLE AS nullable, COLUMN_KEY AS column_key
       FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND LOWER(TABLE_NAME) = 'account' AND COLUMN_NAME = 'account_id'`,
  );
  assert.equal(parentKey.length, 1);
  assert.deepEqual([parentKey[0].type, parentKey[0].nullable, parentKey[0].column_key], ['bigint unsigned', 'NO', 'PRI']);

  verificationStage = 'exact-hospital-metadata';
  const [columns] = await connection.query(
    `SELECT COLUMN_NAME AS name, COLUMN_TYPE AS type, IS_NULLABLE AS nullable,
            COLUMN_DEFAULT AS default_value, EXTRA AS extra, GENERATION_EXPRESSION AS generation_text,
            CHARACTER_SET_NAME AS charset, COLLATION_NAME AS collation
       FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND LOWER(TABLE_NAME) = 'hospital' ORDER BY ORDINAL_POSITION`,
  );
  assert.equal(columns.length, expectedColumns.length);
  for (const [index, [name, type, nullable]] of expectedColumns.entries()) {
    const actual = columns[index];
    assert.deepEqual([actual.name, actual.type, actual.nullable], [name, type, nullable]);
    const textColumn = type.startsWith('varchar');
    assert.equal(actual.charset, textColumn ? 'utf8mb4' : null);
    assert.equal(actual.collation, textColumn ? 'utf8mb4_0900_ai_ci' : null);
    assert.equal(actual.generation_text, '');
    if (type === 'datetime') {
      assert.match(String(actual.default_value).toUpperCase(), /^CURRENT_TIMESTAMP(?:\(\))?$/);
      assert.ok(['', 'DEFAULT_GENERATED'].includes(actual.extra.toUpperCase()));
    } else {
      assert.equal(actual.default_value, null);
      assert.equal(actual.extra, '');
    }
  }
  const [constraints] = await connection.query(
    `SELECT CONSTRAINT_NAME AS name, CONSTRAINT_TYPE AS type
       FROM information_schema.TABLE_CONSTRAINTS
      WHERE CONSTRAINT_SCHEMA = DATABASE() AND LOWER(TABLE_NAME) = 'hospital'`,
  );
  assert.deepEqual(constraints.map((row) => `${row.name}:${row.type}`).sort(), [
    'PRIMARY:PRIMARY KEY', 'fk_hospital_account:FOREIGN KEY', 'uq_hospital_registration_number:UNIQUE',
  ].sort());
  const [indexes] = await connection.query(
    `SELECT INDEX_NAME AS name, NON_UNIQUE AS non_unique, SEQ_IN_INDEX AS ordinal,
            COLUMN_NAME AS column_name, INDEX_TYPE AS type, SUB_PART AS prefix_length
       FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE() AND LOWER(TABLE_NAME) = 'hospital'`,
  );
  assert.deepEqual(indexes.map((row) => [row.name, Number(row.non_unique), Number(row.ordinal), row.column_name,
    row.type, row.prefix_length].join(':')).sort(), [
    'PRIMARY:0:1:account_id:BTREE:', 'uq_hospital_registration_number:0:1:registration_number:BTREE:',
  ].sort());
  const [foreignKeys] = await connection.query(
    `SELECT k.CONSTRAINT_NAME AS name, k.COLUMN_NAME AS column_name,
            k.ORDINAL_POSITION AS ordinal, k.POSITION_IN_UNIQUE_CONSTRAINT AS parent_ordinal,
            k.REFERENCED_TABLE_SCHEMA AS parent_schema, k.REFERENCED_TABLE_NAME AS parent_table,
            k.REFERENCED_COLUMN_NAME AS parent_column, r.UPDATE_RULE AS update_rule, r.DELETE_RULE AS delete_rule
       FROM information_schema.KEY_COLUMN_USAGE k
       JOIN information_schema.REFERENTIAL_CONSTRAINTS r
         ON r.CONSTRAINT_SCHEMA = k.CONSTRAINT_SCHEMA AND r.TABLE_NAME = k.TABLE_NAME
        AND r.CONSTRAINT_NAME = k.CONSTRAINT_NAME
      WHERE k.CONSTRAINT_SCHEMA = DATABASE() AND LOWER(k.TABLE_NAME) = 'hospital'`,
  );
  assert.equal(foreignKeys.length, 1);
  const fk = foreignKeys[0];
  assert.deepEqual([fk.name, fk.column_name, Number(fk.ordinal), Number(fk.parent_ordinal), fk.parent_schema,
    fk.parent_table.toLowerCase(), fk.parent_column, fk.update_rule, fk.delete_rule],
  ['fk_hospital_account', 'account_id', 1, 1, testDatabase, 'account', 'account_id', 'RESTRICT', 'RESTRICT']);

  verificationStage = 'transactional-fixtures';
  await connection.beginTransaction();
  transactionStarted = true;
  const token = randomUUID();
  const ids = [];
  for (let index = 0; index < 11; index += 1) {
    const [result] = await connection.execute(
      `INSERT INTO Account (email, password_hash, role, account_status) VALUES (?, ?, 'HOSPITAL', 'PENDING')`,
      [`hospital-verifier-${token}-${index}@example.invalid`, 'DISPOSABLE_FIXTURE_NOT_A_LOGIN_HASH'],
    );
    ids.push(String(result.insertId));
    if (index < 10) {
      await connection.execute(insertWithDefaults, [ids[index], `Disposable Hospital ${index}`,
        index < 2 ? null : `REG-${token}-${index}`, 'Synthetic Contact', '+91-00000-00000', 'Disposable address']);
    }
  }
  const [[fixtureCounts]] = await connection.query(
    'SELECT COUNT(*) AS total, SUM(registration_number IS NULL) AS null_registrations FROM Hospital',
  );
  assert.equal(Number(fixtureCounts.total), 10);
  assert.equal(Number(fixtureCounts.null_registrations), 2);
  const [[times]] = await connection.execute(
    `SELECT created_at BETWEEN CURRENT_TIMESTAMP - INTERVAL 5 MINUTE AND CURRENT_TIMESTAMP AS created_recent,
            updated_at = created_at AS equal_defaults FROM Hospital WHERE account_id = ?`, [ids[0]],
  );
  assert.equal(Number(times.created_recent), 1);
  assert.equal(Number(times.equal_defaults), 1);
  await connection.execute("UPDATE Hospital SET updated_at = '2000-01-02 03:04:05' WHERE account_id = ?", [ids[0]]);
  await connection.execute("UPDATE Hospital SET contact_name = 'Synthetic Updated Contact' WHERE account_id = ?", [ids[0]]);
  const [[updated]] = await connection.execute(
    "SELECT DATE_FORMAT(updated_at, '%Y-%m-%d %H:%i:%s') AS updated_at FROM Hospital WHERE account_id = ?", [ids[0]],
  );
  assert.equal(updated.updated_at, '2000-01-02 03:04:05');

  verificationStage = 'negative-constraint-cases';
  const valid = [ids[10], 'Synthetic Hospital', `UNUSED-${token}`, 'Synthetic Contact', '0000000000',
    'Synthetic address', '2000-01-02 03:04:05', '2000-01-02 03:04:05'];
  for (const [index, [name, , nullable]] of expectedColumns.entries()) {
    if (nullable === 'YES') continue;
    const values = [...valid];
    values[index] = null;
    await rejectsSql(`required-${name}-null`, 'ER_BAD_NULL_ERROR', insertHospital, values);
  }
  await rejectsSql('duplicate-hospital-account', 'ER_DUP_ENTRY', insertHospital, [ids[0], ...valid.slice(1)]);
  await rejectsSql('duplicate-registration-number', 'ER_DUP_ENTRY', insertHospital,
    [ids[10], valid[1], `REG-${token}-2`, ...valid.slice(3)]);
  await rejectsSql('registration-case-insensitive-duplicate', 'ER_DUP_ENTRY', insertHospital,
    [ids[10], valid[1], `reg-${token}-2`, ...valid.slice(3)]);
  const missingId = (BigInt(ids[10]) + 1n).toString();
  await rejectsSql('missing-account-parent', 'ER_NO_REFERENCED_ROW_2', insertHospital, [missingId, ...valid.slice(1)]);
  await rejectsSql('restrict-account-delete', 'ER_ROW_IS_REFERENCED_2', 'DELETE FROM Account WHERE account_id = ?', [ids[0]]);
  await rejectsSql('restrict-account-update', 'ER_ROW_IS_REFERENCED_2',
    'UPDATE Account SET account_id = ? WHERE account_id = ?', [missingId, ids[0]]);
  await rejectsSql('invalid-account-id', 'ER_TRUNCATED_WRONG_VALUE_FOR_FIELD', insertHospital, ['invalid', ...valid.slice(1)]);
  for (const [index, maxLength] of [[1, 180], [2, 80], [3, 120], [4, 30], [5, 255]]) {
    const values = [...valid];
    values[index] = 'X'.repeat(maxLength + 1);
    await rejectsSql(`overlength-${expectedColumns[index][0]}`, 'ER_DATA_TOO_LONG', insertHospital, values);
  }
  await rejectsSql('invalid-created-at', 'ER_TRUNCATED_WRONG_VALUE', insertHospital,
    [...valid.slice(0, 6), 'not-a-date', valid[7]]);
  await rejectsSql('invalid-updated-at', 'ER_TRUNCATED_WRONG_VALUE', insertHospital,
    [...valid.slice(0, 7), 'not-a-date']);
  verificationStage = 'fixture-rollback';
} catch (error) {
  failureStage = verificationStage;
  verificationFailure = error instanceof NegativeCheckFailure
    ? `${error.label}: expected ${error.expectedCode}, received ${error.actualCode}` : safeCode(error);
} finally {
  if (transactionStarted) {
    try {
      await connection.rollback();
      transactionStarted = false;
      rollbackSucceeded = true;
      verificationStage = 'post-rollback-empty-tables';
      for (const table of ['Account', 'Hospital']) {
        const [[row]] = await connection.query(`SELECT COUNT(*) AS row_count FROM ${table}`);
        assert.equal(Number(row.row_count), 0);
      }
    } catch (error) {
      cleanupFailure = `rollback-or-post-rollback-check:${safeCode(error)}`;
    }
  }
  if (connection) {
    try {
      await connection.end();
    } catch (error) {
      cleanupFailure = [cleanupFailure, `connection-close:${safeCode(error)}`].filter(Boolean).join(',');
    }
  }
}
if (cleanupFailure || verificationFailure || !rollbackSucceeded) {
  console.error(`Hospital verification failed during ${cleanupFailure ? verificationStage : (failureStage || verificationStage)}: ${cleanupFailure || verificationFailure || 'NO_TRANSACTION_ROLLBACK_CONFIRMED'}.`);
  process.exitCode = 1;
} else {
  for (const { label, code } of negativeResults) console.log(`PASS ${label} (${code})`);
  console.log(`Hospital storage verification passed: ${negativeResults.length} negative checks; ten synthetic Hospital rows and all Account fixtures rolled back; both tables empty; connection closed.`);
}
