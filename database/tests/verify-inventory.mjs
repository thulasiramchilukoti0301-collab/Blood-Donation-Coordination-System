import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readDatabaseConfig } from '../../backend/src/config/environment.js';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const backendRequire = createRequire(resolve(repositoryRoot, 'backend/package.json'));
const mysql = backendRequire('mysql2/promise');
const testDatabase = process.env.PHASE3_INVENTORY_TEST_DATABASE?.trim();

if (!/^bddc_phase3_test_inventory_[a-z0-9_]+$/i.test(testDatabase ?? '')) {
  console.error('Configuration failed: set PHASE3_INVENTORY_TEST_DATABASE to bddc_phase3_test_inventory_<label>.');
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
  console.error('Configuration failed: inventory verification is restricted to loopback MySQL.');
  process.exit(2);
}

const expectedColumns = [
  ['blood_unit_id', 'bigint unsigned', 'NO', null, 'auto_increment', null, null],
  ['donation_id', 'bigint unsigned', 'NO', null, '', null, null],
  ['blood_group_id', 'bigint unsigned', 'NO', null, '', null, null],
  ['expiry_date', 'date', 'NO', null, '', null, null],
  ['unit_status', 'varchar(12)', 'NO', 'AVAILABLE', '', 'ascii', 'ascii_bin'],
  ['discarded_at', 'datetime', 'YES', null, '', null, null],
  ['discard_reason_code', 'varchar(40)', 'YES', null, '', 'utf8mb4', 'utf8mb4_0900_ai_ci'],
  ['expired_at', 'datetime', 'YES', null, '', null, null],
  ['created_at', 'datetime', 'NO', 'CURRENT_TIMESTAMP', '', null, null],
];

const expectedConstraints = [
  'PRIMARY:PRIMARY KEY',
  'uq_blood_unit_donation_id:UNIQUE',
  'ck_blood_unit_status:CHECK',
  'ck_blood_unit_discarded_at_matches_status:CHECK',
  'ck_blood_unit_discard_reason_matches_status:CHECK',
  'fk_blood_unit_donation:FOREIGN KEY',
  'fk_blood_unit_blood_group:FOREIGN KEY',
];
const expectedCheckNames = [
  'ck_blood_unit_status',
  'ck_blood_unit_discarded_at_matches_status',
  'ck_blood_unit_discard_reason_matches_status',
];
const expectedIndexes = [
  'PRIMARY:0:1:blood_unit_id:BTREE',
  'uq_blood_unit_donation_id:0:1:donation_id:BTREE',
  'ix_blood_unit_group_status_expiry_id:1:1:blood_group_id:BTREE',
  'ix_blood_unit_group_status_expiry_id:1:2:unit_status:BTREE',
  'ix_blood_unit_group_status_expiry_id:1:3:expiry_date:BTREE',
  'ix_blood_unit_group_status_expiry_id:1:4:blood_unit_id:BTREE',
];
const expectedForeignKeys = [
  {
    table: 'bloodunit', constraint: 'fk_blood_unit_blood_group', column: 'blood_group_id',
    ordinal: 1, referencedTable: 'bloodgroup', referencedColumn: 'blood_group_id',
    deleteRule: 'RESTRICT', updateRule: 'RESTRICT',
  },
  {
    table: 'bloodunit', constraint: 'fk_blood_unit_donation', column: 'donation_id',
    ordinal: 1, referencedTable: 'donation', referencedColumn: 'donation_id',
    deleteRule: 'RESTRICT', updateRule: 'RESTRICT',
  },
];

const insertUnit = `INSERT INTO BloodUnit
  (donation_id, blood_group_id, expiry_date, unit_status, discarded_at,
   discard_reason_code, expired_at)
  VALUES (?, ?, ?, ?, ?, ?, ?)`;
const insertUnitWithDefaults = `INSERT INTO BloodUnit
  (donation_id, blood_group_id, expiry_date, discarded_at, discard_reason_code, expired_at)
  VALUES (?, ?, ?, ?, ?, ?)`;
const insertUnitWithCreatedAt = `INSERT INTO BloodUnit
  (donation_id, blood_group_id, expiry_date, unit_status, discarded_at,
   discard_reason_code, expired_at, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;

function safeCode(error) {
  return typeof error?.code === 'string'
    && /^(?:ER_[A-Z0-9_]+|ECONN[A-Z0-9_]*|ETIMEDOUT|EPIPE|EAI_AGAIN|ENOTFOUND|PROTOCOL_[A-Z0-9_]+)$/.test(error.code)
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

function compareStructuredRows(actual, expected, label) {
  const serializeSorted = (rows) => rows.map((row) => JSON.stringify(row)).sort();
  assert.deepEqual(serializeSorted(actual), serializeSorted(expected), label);
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
  assert.equal(selected.selected_database, testDatabase, 'selected disposable schema');

  verificationStage = 'table-column-and-engine-metadata';
  const [[table]] = await connection.execute(
    `SELECT ENGINE AS engine, TABLE_COLLATION AS table_collation
       FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE() AND LOWER(TABLE_NAME) = 'bloodunit'`,
  );
  assert.equal(table?.engine, 'InnoDB', 'BloodUnit engine');
  assert.equal(table?.table_collation, 'utf8mb4_0900_ai_ci', 'BloodUnit table collation');
  const [columns] = await connection.execute(
    `SELECT COLUMN_NAME AS name, COLUMN_TYPE AS type, IS_NULLABLE AS nullable,
            COLUMN_DEFAULT AS default_value, EXTRA AS extra,
            CHARACTER_SET_NAME AS charset_name, COLLATION_NAME AS collation_name
       FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND LOWER(TABLE_NAME) = 'bloodunit'
      ORDER BY ORDINAL_POSITION`,
  );
  assert.equal(columns.length, expectedColumns.length, 'BloodUnit exact column count');
  for (const [index, [name, type, nullable, defaultValue, expectedExtra, charset, collation]] of expectedColumns.entries()) {
    const actual = columns[index];
    assert.equal(actual.name, name, `BloodUnit column ${index + 1} name`);
    assert.equal(actual.type, type, `BloodUnit.${name} type`);
    assert.equal(actual.nullable, nullable, `BloodUnit.${name} nullability`);
    assert.equal(actual.charset_name, charset, `BloodUnit.${name} character set`);
    assert.equal(actual.collation_name, collation, `BloodUnit.${name} collation`);
    if (defaultValue === 'CURRENT_TIMESTAMP') {
      assert.equal(String(actual.default_value).toUpperCase(), 'CURRENT_TIMESTAMP', `BloodUnit.${name} exact default`);
    } else {
      assert.equal(actual.default_value, defaultValue, `BloodUnit.${name} default`);
    }
    assert.equal(String(actual.extra).toLowerCase().includes('auto_increment'), expectedExtra === 'auto_increment', `BloodUnit.${name} auto-increment`);
    assert.ok(!String(actual.extra).toLowerCase().includes('on update'), `BloodUnit.${name} has no automatic update`);
  }

  verificationStage = 'constraint-and-primary-key-metadata';
  const [constraintRows] = await connection.execute(
    `SELECT CONSTRAINT_NAME AS constraint_name, CONSTRAINT_TYPE AS constraint_type,
            ENFORCED AS enforced
       FROM information_schema.TABLE_CONSTRAINTS
      WHERE CONSTRAINT_SCHEMA = DATABASE() AND LOWER(TABLE_NAME) = 'bloodunit'`,
  );
  assert.deepEqual(
    constraintRows.map((row) => `${row.constraint_name}:${row.constraint_type}`).sort(),
    [...expectedConstraints].sort(),
    'BloodUnit exact named constraints',
  );
  const enforcedChecks = constraintRows
    .filter((row) => row.constraint_type === 'CHECK')
    .map((row) => ({ name: row.constraint_name, enforced: row.enforced }))
    .sort((left, right) => left.name.localeCompare(right.name));
  assert.deepEqual(
    enforcedChecks,
    expectedCheckNames.map((name) => ({ name, enforced: 'YES' }))
      .sort((left, right) => left.name.localeCompare(right.name)),
    'BloodUnit CHECK constraints are all enforced',
  );
  const [primaryRows] = await connection.execute(
    `SELECT tc.CONSTRAINT_NAME AS constraint_name, tc.CONSTRAINT_TYPE AS constraint_type,
            kcu.COLUMN_NAME AS column_name, kcu.ORDINAL_POSITION AS ordinal_position
       FROM information_schema.TABLE_CONSTRAINTS tc
       JOIN information_schema.KEY_COLUMN_USAGE kcu
         ON kcu.CONSTRAINT_SCHEMA = tc.CONSTRAINT_SCHEMA
        AND kcu.TABLE_NAME = tc.TABLE_NAME
        AND kcu.CONSTRAINT_NAME = tc.CONSTRAINT_NAME
      WHERE tc.CONSTRAINT_SCHEMA = DATABASE() AND LOWER(tc.TABLE_NAME) = 'bloodunit'
        AND tc.CONSTRAINT_NAME = 'PRIMARY'
      ORDER BY kcu.ORDINAL_POSITION`,
  );
  assert.deepEqual(primaryRows.map((row) => ({
    name: row.constraint_name,
    type: row.constraint_type,
    column: row.column_name,
    ordinal: Number(row.ordinal_position),
  })), [{ name: 'PRIMARY', type: 'PRIMARY KEY', column: 'blood_unit_id', ordinal: 1 }], 'BloodUnit physical primary key');

  verificationStage = 'index-metadata';
  const [indexRows] = await connection.execute(
    `SELECT INDEX_NAME AS index_name, NON_UNIQUE AS non_unique, SEQ_IN_INDEX AS sequence,
            COLUMN_NAME AS column_name, INDEX_TYPE AS index_type
       FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE() AND LOWER(TABLE_NAME) = 'bloodunit'
      ORDER BY INDEX_NAME, SEQ_IN_INDEX`,
  );
  assert.deepEqual(indexRows.map((row) => [
    row.index_name, Number(row.non_unique), Number(row.sequence), row.column_name, row.index_type,
  ].join(':')).sort(), [...expectedIndexes].sort(), 'BloodUnit exact indexes');

  verificationStage = 'foreign-key-metadata';
  const [foreignKeyRows] = await connection.execute(
    `SELECT LOWER(kcu.TABLE_NAME) AS table_name, kcu.CONSTRAINT_NAME AS constraint_name,
            kcu.COLUMN_NAME AS column_name, kcu.REFERENCED_TABLE_SCHEMA AS referenced_schema,
            LOWER(kcu.REFERENCED_TABLE_NAME) AS referenced_table,
            kcu.REFERENCED_COLUMN_NAME AS referenced_column,
            kcu.ORDINAL_POSITION AS ordinal_position,
            rc.DELETE_RULE AS delete_rule, rc.UPDATE_RULE AS update_rule
       FROM information_schema.KEY_COLUMN_USAGE kcu
       JOIN information_schema.REFERENTIAL_CONSTRAINTS rc
         ON rc.CONSTRAINT_SCHEMA = kcu.CONSTRAINT_SCHEMA
        AND rc.TABLE_NAME = kcu.TABLE_NAME
        AND rc.CONSTRAINT_NAME = kcu.CONSTRAINT_NAME
      WHERE kcu.CONSTRAINT_SCHEMA = DATABASE() AND LOWER(kcu.TABLE_NAME) = 'bloodunit'
        AND kcu.REFERENCED_TABLE_NAME IS NOT NULL`,
  );
  assert.ok(foreignKeyRows.every((row) => row.referenced_schema.toLowerCase() === testDatabase.toLowerCase()), 'all BloodUnit FKs target the selected schema');
  compareStructuredRows(foreignKeyRows.map((row) => ({
    table: row.table_name,
    constraint: row.constraint_name,
    column: row.column_name,
    ordinal: Number(row.ordinal_position),
    referencedTable: row.referenced_table,
    referencedColumn: row.referenced_column,
    deleteRule: row.delete_rule,
    updateRule: row.update_rule,
  })), expectedForeignKeys, 'BloodUnit exact foreign-key metadata');

  verificationStage = 'rollback-only-fixture-transaction';
  const [groups] = await connection.execute(
    `SELECT blood_group_id, code FROM BloodGroup
      WHERE blood_group_id BETWEEN 1 AND 8 ORDER BY blood_group_id`,
  );
  assert.deepEqual(groups.map((row) => [Number(row.blood_group_id), row.code]), [
    [1, 'O-'], [2, 'O+'], [3, 'A-'], [4, 'A+'],
    [5, 'B-'], [6, 'B+'], [7, 'AB-'], [8, 'AB+'],
  ], 'canonical BloodGroup reference rows');

  await connection.beginTransaction();
  transactionStarted = true;
  const fixtureToken = randomUUID();
  async function insertAccount(role, suffix) {
    const [result] = await connection.execute(
      `INSERT INTO Account (email, password_hash, role, account_status)
       VALUES (?, ?, ?, 'PENDING')`,
      [`inventory-verifier-${suffix}-${fixtureToken}@example.invalid`, 'DISPOSABLE_FIXTURE_NOT_A_LOGIN_HASH', role],
    );
    return Number(result.insertId);
  }
  const actorId = await insertAccount('ADMIN', 'actor');
  const donorIds = [];
  for (let index = 1; index <= 11; index += 1) {
    const accountId = await insertAccount('DONOR', `donor-${index}`);
    donorIds.push(accountId);
    await connection.execute(
      `INSERT INTO Donor (account_id, full_name, date_of_birth, phone, address)
       VALUES (?, ?, '1990-01-01', '+91-00000-00000', 'Disposable inventory verifier address')`,
      [accountId, `Disposable Inventory Donor ${String(index).padStart(2, '0')}`],
    );
  }

  const slotIds = [];
  for (let index = 1; index <= 11; index += 1) {
    const day = String(index).padStart(2, '0');
    const [result] = await connection.execute(
      `INSERT INTO DonationSlot (starts_at, ends_at, capacity, created_by_account_id)
       VALUES (?, ?, 2, ?)`, [`2040-04-${day} 09:00:00`, `2040-04-${day} 10:00:00`, actorId],
    );
    slotIds.push(Number(result.insertId));
  }
  const bookingIds = [];
  for (let index = 0; index < 11; index += 1) {
    const [result] = await connection.execute(
      `INSERT INTO Booking (donor_account_id, slot_id, booking_status)
       VALUES (?, ?, 'CHECKED_IN')`, [donorIds[index], slotIds[index]],
    );
    bookingIds.push(Number(result.insertId));
  }

  const donationIds = [];
  for (let index = 0; index < 11; index += 1) {
    const day = String(index + 1).padStart(2, '0');
    const [result] = await connection.execute(
      `INSERT INTO Donation
         (booking_id, recorded_by_account_id, outcome, collected_at, release_status, release_decided_at)
       VALUES (?, ?, 'COLLECTED', ?, 'APPROVED', ?)`,
      [bookingIds[index], actorId, `2040-03-${day} 08:00:00`, `2040-03-${day} 12:00:00`],
    );
    donationIds.push(Number(result.insertId));
  }
  assert.equal(donationIds.length, 11, 'ten fixture and one spare approved source Donation');

  const fixtureRows = [
    { donationId: donationIds[0], groupId: 1, expiry: '2040-05-01', status: 'AVAILABLE', discardedAt: null, reason: null, expiredAt: null, useDefault: true },
    { donationId: donationIds[1], groupId: 2, expiry: '2040-05-02', status: 'ALLOCATED', discardedAt: null, reason: null, expiredAt: null },
    { donationId: donationIds[2], groupId: 3, expiry: '2040-05-03', status: 'ISSUED', discardedAt: null, reason: null, expiredAt: null },
    { donationId: donationIds[3], groupId: 4, expiry: '2040-05-04', status: 'EXPIRED', discardedAt: null, reason: null, expiredAt: null },
    { donationId: donationIds[4], groupId: 5, expiry: '2040-05-05', status: 'DISCARDED', discardedAt: '2040-04-05 13:00:00', reason: 'TEST_DISCARD', expiredAt: null },
    { donationId: donationIds[5], groupId: 6, expiry: '2040-05-06', status: 'AVAILABLE', discardedAt: null, reason: null, expiredAt: '2040-04-06 13:00:00' },
    { donationId: donationIds[6], groupId: 7, expiry: '2040-05-07', status: 'ALLOCATED', discardedAt: null, reason: null, expiredAt: null },
    { donationId: donationIds[7], groupId: 8, expiry: '2040-05-08', status: 'ISSUED', discardedAt: null, reason: null, expiredAt: null },
    { donationId: donationIds[8], groupId: 1, expiry: '2040-05-09', status: 'EXPIRED', discardedAt: null, reason: null, expiredAt: '2040-05-09 00:00:00' },
    { donationId: donationIds[9], groupId: 2, expiry: '2040-05-10', status: 'DISCARDED', discardedAt: '2040-04-10 13:00:00', reason: 'OTHER_DISCARD', expiredAt: null },
  ];
  for (const row of fixtureRows) {
    const common = [row.donationId, row.groupId, row.expiry];
    if (row.useDefault) {
      await connection.execute(insertUnitWithDefaults, [...common, row.discardedAt, row.reason, row.expiredAt]);
    } else {
      await connection.execute(insertUnit, [...common, row.status, row.discardedAt, row.reason, row.expiredAt]);
    }
  }
  assert.equal(fixtureRows.length, 10, 'ten synthetic BloodUnit fixtures');
  const [[fixtureSummary]] = await connection.execute(
    `SELECT COUNT(*) AS row_count,
            COUNT(DISTINCT unit_status) AS status_count,
            SUM(unit_status = 'AVAILABLE' AND expired_at IS NOT NULL) AS available_with_expired_at,
            SUM(unit_status = 'EXPIRED' AND expired_at IS NULL) AS expired_without_expired_at
       FROM BloodUnit WHERE donation_id IN (${donationIds.slice(0, 10).map(() => '?').join(',')})`,
    donationIds.slice(0, 10),
  );
  assert.equal(Number(fixtureSummary.row_count), 10, 'ten BloodUnit rows');
  assert.equal(Number(fixtureSummary.status_count), 5, 'all five permitted unit statuses');
  assert.ok(Number(fixtureSummary.available_with_expired_at) >= 1, 'expired_at is not restricted to EXPIRED status');
  assert.ok(Number(fixtureSummary.expired_without_expired_at) >= 1, 'EXPIRED does not require expired_at');
  const [[defaultEvidence]] = await connection.execute(
    `SELECT unit_status, DATE_FORMAT(created_at, '%Y-%m-%d %H:%i:%s') AS created_at
       FROM BloodUnit WHERE donation_id = ?`, [donationIds[0]],
  );
  assert.equal(defaultEvidence.unit_status, 'AVAILABLE', 'unit_status default');
  assert.match(defaultEvidence.created_at, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);

  verificationStage = 'negative-constraint-cases';
  const spareDonationId = donationIds[10];
  const valid = {
    donationId: spareDonationId,
    groupId: 8,
    expiry: '2040-06-01',
    status: 'AVAILABLE',
    discardedAt: null,
    reason: null,
    expiredAt: null,
  };
  const values = (overrides = {}) => {
    const row = { ...valid, ...overrides };
    return [row.donationId, row.groupId, row.expiry, row.status, row.discardedAt, row.reason, row.expiredAt];
  };
  negativeResults.push(await rejectsSql(connection, 'duplicate-donation-id', 'ER_DUP_ENTRY', insertUnit, values({ donationId: donationIds[0] })));
  negativeResults.push(await rejectsSql(connection, 'status-lowercase', 'ER_CHECK_CONSTRAINT_VIOLATED', insertUnit, values({ status: 'available' })));
  negativeResults.push(await rejectsSql(connection, 'status-unknown-uppercase', 'ER_CHECK_CONSTRAINT_VIOLATED', insertUnit, values({ status: 'QUARANTINED' })));
  negativeResults.push(await rejectsSql(connection, 'discarded-at-required-for-discarded', 'ER_CHECK_CONSTRAINT_VIOLATED', insertUnit, values({ status: 'DISCARDED', reason: 'TEST_DISCARD' })));
  negativeResults.push(await rejectsSql(connection, 'discard-reason-required-for-discarded', 'ER_CHECK_CONSTRAINT_VIOLATED', insertUnit, values({ status: 'DISCARDED', discardedAt: '2040-04-11 13:00:00' })));
  negativeResults.push(await rejectsSql(connection, 'discarded-at-forbidden-for-available', 'ER_CHECK_CONSTRAINT_VIOLATED', insertUnit, values({ discardedAt: '2040-04-11 13:00:00' })));
  negativeResults.push(await rejectsSql(connection, 'discard-reason-forbidden-for-available', 'ER_CHECK_CONSTRAINT_VIOLATED', insertUnit, values({ reason: 'TEST_DISCARD' })));

  const [[maxDonation]] = await connection.query('SELECT COALESCE(MAX(donation_id), 0) AS max_id FROM Donation');
  const missingDonationId = Number(maxDonation.max_id) + 1;
  negativeResults.push(await rejectsSql(connection, 'missing-donation-parent', 'ER_NO_REFERENCED_ROW_2', insertUnit, values({ donationId: missingDonationId })));
  const [[maxGroup]] = await connection.query('SELECT COALESCE(MAX(blood_group_id), 0) AS max_id FROM BloodGroup');
  const missingGroupId = Number(maxGroup.max_id) + 1;
  negativeResults.push(await rejectsSql(connection, 'missing-blood-group-parent', 'ER_NO_REFERENCED_ROW_2', insertUnit, values({ groupId: missingGroupId })));

  const requiredNullCases = [
    ['donation-id-null', insertUnit, [null, valid.groupId, valid.expiry, valid.status, null, null, null]],
    ['blood-group-id-null', insertUnit, [spareDonationId, null, valid.expiry, valid.status, null, null, null]],
    ['expiry-date-null', insertUnit, [spareDonationId, valid.groupId, null, valid.status, null, null, null]],
    ['unit-status-null', insertUnit, [spareDonationId, valid.groupId, valid.expiry, null, null, null, null]],
    ['created-at-null', insertUnitWithCreatedAt, [...values(), null]],
  ];
  for (const [label, sql, parameters] of requiredNullCases) {
    negativeResults.push(await rejectsSql(connection, label, 'ER_BAD_NULL_ERROR', sql, parameters));
  }

  negativeResults.push(await rejectsSql(connection, 'restrict-donation-delete', 'ER_ROW_IS_REFERENCED_2', 'DELETE FROM Donation WHERE donation_id = ?', [donationIds[0]]));
  negativeResults.push(await rejectsSql(connection, 'restrict-blood-group-delete', 'ER_ROW_IS_REFERENCED_2', 'DELETE FROM BloodGroup WHERE blood_group_id = ?', [1]));

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
  console.error(`Inventory verification cleanup failed during ${verificationStage}: ${cleanupFailure}.`);
  process.exitCode = 1;
} else if (verificationFailure) {
  console.error(`Inventory verification failed during ${verificationStage}: ${verificationFailure}.`);
  process.exitCode = 1;
} else if (!rollbackSucceeded) {
  console.error('Inventory verification failed during fixture-rollback: NO_TRANSACTION_ROLLBACK_CONFIRMED.');
  process.exitCode = 1;
} else {
  for (const { label, code } of negativeResults) console.log(`PASS ${label} (${code})`);
  console.log(`BloodUnit storage verification passed: ${negativeResults.length} negative checks; ten synthetic BloodUnit fixtures and their prerequisites were rolled back; connection closed.`);
}
