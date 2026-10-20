import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readDatabaseConfig } from '../../backend/src/config/environment.js';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const backendRequire = createRequire(resolve(repositoryRoot, 'backend/package.json'));
const mysql = backendRequire('mysql2/promise');
const testDatabase = process.env.PHASE3_DONOR_TEST_DATABASE?.trim();

if (!/^bddc_phase3_test_donor_[a-z0-9_]+$/i.test(testDatabase ?? '')) {
  console.error('Configuration failed: set PHASE3_DONOR_TEST_DATABASE to bddc_phase3_test_donor_<label>.');
  process.exit(2);
}

const databaseConfig = readDatabaseConfig({
  ...process.env,
  DB_USER: process.env.PHASE3_TEST_DB_USER || process.env.DB_USER,
  DB_PASSWORD: process.env.PHASE3_TEST_DB_PASSWORD || process.env.DB_PASSWORD,
  DB_NAME: testDatabase,
});
if (!databaseConfig.options) {
  console.error('Configuration failed: database connection settings are incomplete.');
  process.exit(2);
}
if (!['localhost', '127.0.0.1', '::1'].includes(databaseConfig.options.host.toLowerCase())) {
  console.error('Configuration failed: donor verification is restricted to loopback MySQL.');
  process.exit(2);
}

const requiredColumns = [
  { name: 'account_id', type: 'bigint unsigned', nullable: 'NO', defaultValue: null, charset: null, collation: null },
  { name: 'full_name', type: 'varchar(120)', nullable: 'NO', defaultValue: null, charset: 'utf8mb4', collation: 'utf8mb4_0900_ai_ci' },
  { name: 'date_of_birth', type: 'date', nullable: 'NO', defaultValue: null, charset: null, collation: null },
  { name: 'phone', type: 'varchar(30)', nullable: 'NO', defaultValue: null, charset: 'utf8mb4', collation: 'utf8mb4_0900_ai_ci' },
  { name: 'address', type: 'varchar(255)', nullable: 'NO', defaultValue: null, charset: 'utf8mb4', collation: 'utf8mb4_0900_ai_ci' },
  { name: 'area', type: 'varchar(100)', nullable: 'YES', defaultValue: null, charset: 'utf8mb4', collation: 'utf8mb4_0900_ai_ci' },
  { name: 'reported_blood_group_id', type: 'bigint unsigned', nullable: 'YES', defaultValue: null, charset: null, collation: null },
  { name: 'confirmed_blood_group_id', type: 'bigint unsigned', nullable: 'YES', defaultValue: null, charset: null, collation: null },
  { name: 'created_at', type: 'datetime', nullable: 'NO', defaultValue: 'CURRENT_TIMESTAMP', charset: null, collation: null },
  { name: 'updated_at', type: 'datetime', nullable: 'NO', defaultValue: 'CURRENT_TIMESTAMP', charset: null, collation: null },
];

const donorInsert = `INSERT INTO Donor
  (account_id, full_name, date_of_birth, phone, address, area,
   reported_blood_group_id, confirmed_blood_group_id, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
const donorInsertWithDefaults = `INSERT INTO Donor
  (account_id, full_name, date_of_birth, phone, address, area,
   reported_blood_group_id, confirmed_blood_group_id)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;

function safeCode(error) {
  return typeof error?.code === 'string' && /^(?:ER_[A-Z0-9_]+|ECONN[A-Z0-9_]*|ETIMEDOUT|EPIPE|EAI_AGAIN|ENOTFOUND|PROTOCOL_[A-Z0-9_]+)$/.test(error.code)
    ? error.code
    : 'ASSERTION_FAILED';
}

class NegativeCheckFailure extends Error {
  constructor(label, expectedCode, actualCode) {
    super();
    this.label = label;
    this.expectedCode = expectedCode;
    this.actualCode = actualCode;
  }
}

async function rejectsSql(connection, label, expectedCode, sql, parameters = []) {
  try {
    await connection.execute(sql, parameters);
  } catch (error) {
    const actualCode = typeof error?.code === 'string' && /^ER_[A-Z0-9_]+$/.test(error.code)
      ? error.code
      : 'NO_MYSQL_ERROR_CODE';
    if (actualCode !== expectedCode) throw new NegativeCheckFailure(label, expectedCode, actualCode);
    return { label, code: actualCode };
  }
  throw new NegativeCheckFailure(label, expectedCode, 'NO_ERROR');
}

let connection;
let transactionStarted = false;
let rollbackSucceeded = false;
let verificationFailure;
let cleanupFailure;
let verificationStage = 'connection';
const negativeResults = [];

try {
  connection = await mysql.createConnection({ ...databaseConfig.options, multipleStatements: false });
  verificationStage = 'selected-database';
  await connection.query("SET time_zone = '+05:30'");
  const [[selected]] = await connection.query('SELECT DATABASE() AS selected_database');
  assert.equal(selected.selected_database, testDatabase);
  const [[referenceGroups]] = await connection.query(
    'SELECT COUNT(*) AS group_count FROM BloodGroup WHERE blood_group_id IN (1, 2)',
  );
  assert.equal(Number(referenceGroups.group_count), 2, 'foundation reference groups 1 and 2 must exist');

  verificationStage = 'table-and-column-metadata';
  const [[table]] = await connection.execute(
    `SELECT ENGINE AS engine, TABLE_COLLATION AS table_collation
       FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE() AND LOWER(TABLE_NAME) = 'donor'`,
  );
  assert.equal(table?.engine, 'InnoDB');
  assert.equal(table?.table_collation, 'utf8mb4_0900_ai_ci');
  const [columns] = await connection.execute(
    `SELECT COLUMN_NAME AS name, COLUMN_TYPE AS type, IS_NULLABLE AS nullable,
            COLUMN_DEFAULT AS default_value, EXTRA AS extra,
            CHARACTER_SET_NAME AS charset, COLLATION_NAME AS collation
       FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND LOWER(TABLE_NAME) = 'donor'
      ORDER BY ORDINAL_POSITION`,
  );
  assert.equal(columns.length, requiredColumns.length);
  for (const [index, expected] of requiredColumns.entries()) {
    const actual = columns[index];
    assert.equal(actual.name, expected.name, `Donor column ${index + 1} name`);
    assert.equal(actual.type, expected.type, `${expected.name} type`);
    assert.equal(actual.nullable, expected.nullable, `${expected.name} nullability`);
    assert.equal(actual.charset, expected.charset, `${expected.name} character set`);
    assert.equal(actual.collation, expected.collation, `${expected.name} collation`);
    if (expected.defaultValue === 'CURRENT_TIMESTAMP') {
      assert.ok(String(actual.default_value).toUpperCase().includes('CURRENT_TIMESTAMP'), `${expected.name} default`);
    } else {
      assert.equal(actual.default_value, null, `${expected.name} default`);
    }
    assert.ok(!String(actual.extra).toLowerCase().includes('auto_increment'), `${expected.name} must not auto-increment`);
    assert.ok(!String(actual.extra).toLowerCase().includes('on update'), `${expected.name} must not update automatically`);
  }

  verificationStage = 'primary-key-and-foreign-key-metadata';
  const [constraints] = await connection.execute(
    `SELECT TABLE_NAME AS table_name, CONSTRAINT_NAME AS constraint_name, CONSTRAINT_TYPE AS constraint_type
       FROM information_schema.TABLE_CONSTRAINTS
      WHERE CONSTRAINT_SCHEMA = DATABASE() AND LOWER(TABLE_NAME) = 'donor'`,
  );
  assert.deepEqual(
    constraints.map(({ constraint_name, constraint_type }) => `${constraint_name}:${constraint_type}`).sort(),
    [
      'PRIMARY:PRIMARY KEY',
      'fk_donor_account:FOREIGN KEY',
      'fk_donor_confirmed_blood_group:FOREIGN KEY',
      'fk_donor_reported_blood_group:FOREIGN KEY',
    ].sort(),
  );
  const [foreignKeys] = await connection.execute(
    `SELECT kcu.CONSTRAINT_NAME AS constraint_name, kcu.COLUMN_NAME AS column_name,
            kcu.REFERENCED_TABLE_SCHEMA AS referenced_schema,
            kcu.REFERENCED_TABLE_NAME AS referenced_table,
            kcu.REFERENCED_COLUMN_NAME AS referenced_column,
            rc.DELETE_RULE AS delete_rule, rc.UPDATE_RULE AS update_rule
       FROM information_schema.KEY_COLUMN_USAGE kcu
       JOIN information_schema.REFERENTIAL_CONSTRAINTS rc
         ON rc.CONSTRAINT_SCHEMA = kcu.CONSTRAINT_SCHEMA
        AND rc.TABLE_NAME = kcu.TABLE_NAME
        AND rc.CONSTRAINT_NAME = kcu.CONSTRAINT_NAME
      WHERE kcu.CONSTRAINT_SCHEMA = DATABASE()
        AND LOWER(kcu.TABLE_NAME) = 'donor'
        AND kcu.REFERENCED_TABLE_NAME IS NOT NULL`,
  );
  assert.ok(foreignKeys.every((fk) => fk.referenced_schema === testDatabase), 'all Donor foreign keys reference the selected schema');
  const actualForeignKeys = foreignKeys.map((fk) => [
    fk.constraint_name,
    fk.column_name,
    fk.referenced_table.toLowerCase(),
    fk.referenced_column,
    fk.delete_rule,
    fk.update_rule,
  ].join(':')).sort();
  assert.deepEqual(actualForeignKeys, [
    'fk_donor_account:account_id:account:account_id:RESTRICT:RESTRICT',
    'fk_donor_confirmed_blood_group:confirmed_blood_group_id:bloodgroup:blood_group_id:RESTRICT:RESTRICT',
    'fk_donor_reported_blood_group:reported_blood_group_id:bloodgroup:blood_group_id:RESTRICT:RESTRICT',
  ].sort());
  const [indexes] = await connection.execute(
    `SELECT INDEX_NAME AS index_name, NON_UNIQUE AS non_unique, SEQ_IN_INDEX AS sequence,
            COLUMN_NAME AS column_name, INDEX_TYPE AS index_type
       FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE() AND LOWER(TABLE_NAME) = 'donor'
      ORDER BY INDEX_NAME, SEQ_IN_INDEX`,
  );
  const actualIndexes = indexes.map((index) => [
    index.index_name,
    Number(index.non_unique),
    Number(index.sequence),
    index.column_name,
    index.index_type,
  ].join(':')).sort();
  assert.deepEqual(actualIndexes, [
    'PRIMARY:0:1:account_id:BTREE',
    'ix_donor_confirmed_blood_group_id:1:1:confirmed_blood_group_id:BTREE',
    'ix_donor_full_name:1:1:full_name:BTREE',
    'ix_donor_reported_blood_group_id:1:1:reported_blood_group_id:BTREE',
  ].sort());

  verificationStage = 'transactional-fixtures';
  await connection.beginTransaction();
  transactionStarted = true;
  const fixtureToken = randomUUID();
  const accountIds = [];
  const sharedPhone = '+91-00000-00000';
  for (let index = 1; index <= 10; index += 1) {
    const [result] = await connection.execute(
      `INSERT INTO Account (email, password_hash, role, account_status)
       VALUES (?, ?, 'DONOR', 'PENDING')`,
      [`donor-verifier-${fixtureToken}-${index}@example.invalid`, 'DISPOSABLE_FIXTURE_NOT_A_LOGIN_HASH'],
    );
    const accountId = Number(result.insertId);
    accountIds.push(accountId);
    const nullable = index === 1;
    const reportedGroup = nullable ? null : 1;
    const confirmedGroup = nullable ? null : (index === 2 ? 2 : 1);
    await connection.execute(donorInsertWithDefaults, [
      accountId,
      `Disposable Donor ${String(index).padStart(2, '0')}`,
      '1990-01-01',
      sharedPhone,
      'Disposable verification address',
      nullable ? null : 'Verification area',
      reportedGroup,
      confirmedGroup,
    ]);
  }
  assert.equal(accountIds.length, 10);
  const accountPlaceholders = accountIds.map(() => '?').join(', ');
  const [[sharedContact]] = await connection.execute(
    `SELECT COUNT(*) AS donor_count, COUNT(DISTINCT phone) AS distinct_phones
       FROM Donor WHERE account_id IN (${accountPlaceholders})`,
    accountIds,
  );
  assert.equal(Number(sharedContact.donor_count), 10, 'ten disposable Donor fixtures');
  assert.equal(Number(sharedContact.distinct_phones), 1, 'shared phone numbers are permitted');
  const [[nullableFixture]] = await connection.execute(
    `SELECT area, reported_blood_group_id, confirmed_blood_group_id
       FROM Donor WHERE account_id = ?`, [accountIds[0]],
  );
  assert.equal(nullableFixture.area, null, 'area may be NULL');
  assert.equal(nullableFixture.reported_blood_group_id, null, 'reported group may be NULL');
  assert.equal(nullableFixture.confirmed_blood_group_id, null, 'confirmed group may be NULL');
  const [[differentGroups]] = await connection.execute(
    `SELECT reported_blood_group_id, confirmed_blood_group_id
       FROM Donor WHERE account_id = ?`, [accountIds[1]],
  );
  assert.equal(Number(differentGroups.reported_blood_group_id), 1);
  assert.equal(Number(differentGroups.confirmed_blood_group_id), 2);

  const [extraAccount] = await connection.execute(
    `INSERT INTO Account (email, password_hash, role, account_status)
     VALUES (?, ?, 'DONOR', 'PENDING')`,
    [`donor-verifier-unpaired-${fixtureToken}@example.invalid`, 'DISPOSABLE_FIXTURE_NOT_A_LOGIN_HASH'],
  );
  const unusedAccountId = Number(extraAccount.insertId);
  const [[accountMaximum]] = await connection.query('SELECT MAX(account_id) AS maximum_id FROM Account');
  const [[groupMaximum]] = await connection.query('SELECT MAX(blood_group_id) AS maximum_id FROM BloodGroup');
  const missingAccountId = Number(accountMaximum.maximum_id) + 1;
  const missingBloodGroupId = Number(groupMaximum.maximum_id) + 1;
  const validDonor = [unusedAccountId, 'Disposable Check Donor', '1990-01-01', sharedPhone, 'Valid test address', null, null, null, '2000-01-02 03:04:05', '2000-01-02 03:04:05'];

  verificationStage = 'negative-constraint-cases';
  const duplicateProfile = await rejectsSql(connection, 'duplicate-donor-profile', 'ER_DUP_ENTRY', donorInsertWithDefaults, [
    accountIds[0], 'Duplicate Profile Check', '1990-01-01', sharedPhone, 'Valid test address', null, null, null,
  ]);
  negativeResults.push(duplicateProfile);
  for (const [field, offset] of [
    ['account_id', 0],
    ['full_name', 1],
    ['date_of_birth', 2],
    ['phone', 3],
    ['address', 4],
    ['created_at', 8],
    ['updated_at', 9],
  ]) {
    const values = [...validDonor];
    values[offset] = null;
    const result = await rejectsSql(connection, `required-${field}-null`, 'ER_BAD_NULL_ERROR', donorInsert, values);
    negativeResults.push(result);
  }

  const missingAccountValues = [missingAccountId, ...validDonor.slice(1, 8)];
  negativeResults.push(await rejectsSql(connection, 'missing-account-parent', 'ER_NO_REFERENCED_ROW_2', donorInsertWithDefaults, missingAccountValues));
  const missingReported = validDonor.slice(0, 8);
  missingReported[6] = missingBloodGroupId;
  negativeResults.push(await rejectsSql(connection, 'missing-reported-blood-group-parent', 'ER_NO_REFERENCED_ROW_2', donorInsertWithDefaults, missingReported));
  const missingConfirmed = validDonor.slice(0, 8);
  missingConfirmed[7] = missingBloodGroupId;
  negativeResults.push(await rejectsSql(connection, 'missing-confirmed-blood-group-parent', 'ER_NO_REFERENCED_ROW_2', donorInsertWithDefaults, missingConfirmed));

  negativeResults.push(await rejectsSql(
    connection,
    'restrict-account-delete-with-donor',
    'ER_ROW_IS_REFERENCED_2',
    'DELETE FROM Account WHERE account_id = ?',
    [accountIds[0]],
  ));
  negativeResults.push(await rejectsSql(
    connection,
    'restrict-blood-group-delete-with-donor',
    'ER_ROW_IS_REFERENCED_2',
    'DELETE FROM BloodGroup WHERE blood_group_id = 1',
  ));

  verificationStage = 'timestamp-default-and-update-behavior';
  const [[initialTimes]] = await connection.execute(
    `SELECT DATE_FORMAT(created_at, '%Y-%m-%d %H:%i:%s') AS created_at,
            DATE_FORMAT(updated_at, '%Y-%m-%d %H:%i:%s') AS updated_at
       FROM Donor WHERE account_id = ?`, [accountIds[0]],
  );
  assert.match(initialTimes.created_at, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  assert.match(initialTimes.updated_at, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  await connection.execute("UPDATE Donor SET updated_at = '2000-01-02 03:04:05' WHERE account_id = ?", [accountIds[0]]);
  await connection.execute("UPDATE Donor SET full_name = 'Disposable Donor Updated' WHERE account_id = ?", [accountIds[0]]);
  const [[afterUpdate]] = await connection.execute(
    `SELECT DATE_FORMAT(updated_at, '%Y-%m-%d %H:%i:%s') AS updated_at
       FROM Donor WHERE account_id = ?`, [accountIds[0]],
  );
  assert.equal(afterUpdate.updated_at, '2000-01-02 03:04:05', 'updated_at is not automatically changed');
  verificationStage = 'fixture-rollback';
} catch (error) {
  verificationFailure = error instanceof NegativeCheckFailure
    ? `${error.label}: expected ${error.expectedCode}, received ${error.actualCode}`
    : safeCode(error);
} finally {
  if (transactionStarted) {
    try {
      await connection.rollback();
      transactionStarted = false;
      rollbackSucceeded = true;
    } catch (error) {
      cleanupFailure = `rollback:${safeCode(error)}`;
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

if (cleanupFailure) {
  console.error(`Donor verification cleanup failed during ${verificationStage}: ${cleanupFailure}.`);
  process.exitCode = 1;
} else if (verificationFailure) {
  console.error(`Donor verification failed during ${verificationStage}: ${verificationFailure}.`);
  process.exitCode = 1;
} else if (!rollbackSucceeded) {
  console.error('Donor verification failed during fixture-rollback: NO_TRANSACTION_ROLLBACK_CONFIRMED.');
  process.exitCode = 1;
} else {
  for (const { label, code } of negativeResults) console.log(`PASS ${label} (${code})`);
  console.log('Donor verification passed: ten disposable Account/Donor pairs were rolled back successfully; fixtures are not login accounts or permanent seeds.');
}
