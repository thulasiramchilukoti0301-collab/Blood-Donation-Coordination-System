import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readDatabaseConfig } from '../../backend/src/config/environment.js';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const backendRequire = createRequire(resolve(repositoryRoot, 'backend/package.json'));
const mysql = backendRequire('mysql2/promise');
const testDatabase = process.env.PHASE3_DONATION_TEST_DATABASE?.trim();

if (!/^bddc_phase3_test_donation_[a-z0-9_]+$/i.test(testDatabase ?? '')) {
  console.error('Configuration failed: set PHASE3_DONATION_TEST_DATABASE to bddc_phase3_test_donation_<label>.');
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
  console.error('Configuration failed: Donation verification is restricted to loopback MySQL.');
  process.exit(2);
}

const expectedColumns = [
  ['donation_id', 'bigint unsigned', 'NO', null, 'auto_increment', null, null],
  ['booking_id', 'bigint unsigned', 'NO', null, '', null, null],
  ['recorded_by_account_id', 'bigint unsigned', 'NO', null, '', null, null],
  ['outcome', 'varchar(16)', 'NO', null, '', 'ascii', 'ascii_bin'],
  ['collected_at', 'datetime', 'YES', null, '', null, null],
  ['collection_reference', 'varchar(80)', 'YES', null, '', 'utf8mb4', 'utf8mb4_0900_ai_ci'],
  ['release_status', 'varchar(16)', 'NO', 'PENDING', '', 'ascii', 'ascii_bin'],
  ['release_decided_by_account_id', 'bigint unsigned', 'YES', null, '', null, null],
  ['release_decided_at', 'datetime', 'YES', null, '', null, null],
  ['release_reason_code', 'varchar(40)', 'YES', null, '', 'utf8mb4', 'utf8mb4_0900_ai_ci'],
  ['created_at', 'datetime', 'NO', 'CURRENT_TIMESTAMP', '', null, null],
];

const expectedConstraints = [
  'PRIMARY:PRIMARY KEY',
  'uq_donation_booking_id:UNIQUE',
  'uq_donation_collection_reference:UNIQUE',
  'ck_donation_outcome:CHECK',
  'ck_donation_collected_at_matches_outcome:CHECK',
  'ck_donation_release_status_for_outcome:CHECK',
  'ck_donation_release_decision_timestamp:CHECK',
  'ck_donation_rejection_reason:CHECK',
  'fk_donation_booking:FOREIGN KEY',
  'fk_donation_recorded_by_account:FOREIGN KEY',
  'fk_donation_release_decided_by_account:FOREIGN KEY',
];

const expectedIndexes = [
  'PRIMARY:0:1:donation_id:BTREE',
  'uq_donation_booking_id:0:1:booking_id:BTREE',
  'uq_donation_collection_reference:0:1:collection_reference:BTREE',
  'ix_donation_recorded_by_account_id:1:1:recorded_by_account_id:BTREE',
  'ix_donation_release_decided_by_account_id:1:1:release_decided_by_account_id:BTREE',
  'ix_donation_collected_outcome_release:1:1:collected_at:BTREE',
  'ix_donation_collected_outcome_release:1:2:outcome:BTREE',
  'ix_donation_collected_outcome_release:1:3:release_status:BTREE',
];

const expectedForeignKeys = [
  {
    table: 'donation', constraint: 'fk_donation_booking', column: 'booking_id',
    ordinal: 1, referencedTable: 'booking', referencedColumn: 'booking_id',
    deleteRule: 'RESTRICT', updateRule: 'RESTRICT',
  },
  {
    table: 'donation', constraint: 'fk_donation_recorded_by_account', column: 'recorded_by_account_id',
    ordinal: 1, referencedTable: 'account', referencedColumn: 'account_id',
    deleteRule: 'RESTRICT', updateRule: 'RESTRICT',
  },
  {
    table: 'donation', constraint: 'fk_donation_release_decided_by_account', column: 'release_decided_by_account_id',
    ordinal: 1, referencedTable: 'account', referencedColumn: 'account_id',
    deleteRule: 'RESTRICT', updateRule: 'RESTRICT',
  },
];

const insertDonation = `INSERT INTO Donation
  (booking_id, recorded_by_account_id, outcome, collected_at, collection_reference,
   release_status, release_decided_by_account_id, release_decided_at, release_reason_code)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;
const insertDonationWithDefaultStatus = `INSERT INTO Donation
  (booking_id, recorded_by_account_id, outcome, collected_at, collection_reference)
  VALUES (?, ?, ?, ?, ?)`;
const insertDonationWithCreatedAt = `INSERT INTO Donation
  (booking_id, recorded_by_account_id, outcome, collected_at, collection_reference,
   release_status, release_decided_by_account_id, release_decided_at, release_reason_code, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

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
  const sortRows = (rows) => rows.map((row) => JSON.stringify(row)).sort();
  assert.deepEqual(sortRows(actual), sortRows(expected), label);
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
      WHERE TABLE_SCHEMA = DATABASE() AND LOWER(TABLE_NAME) = 'donation'`,
  );
  assert.equal(table?.engine, 'InnoDB', 'Donation engine');
  assert.equal(table?.table_collation, 'utf8mb4_0900_ai_ci', 'Donation table collation');
  const [columns] = await connection.execute(
    `SELECT COLUMN_NAME AS name, COLUMN_TYPE AS type, IS_NULLABLE AS nullable,
            COLUMN_DEFAULT AS default_value, EXTRA AS extra,
            CHARACTER_SET_NAME AS charset_name, COLLATION_NAME AS collation_name
       FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND LOWER(TABLE_NAME) = 'donation'
      ORDER BY ORDINAL_POSITION`,
  );
  assert.equal(columns.length, expectedColumns.length, 'Donation exact column count');
  for (const [index, [name, type, nullable, defaultValue, expectedExtra, charset, collation]] of expectedColumns.entries()) {
    const actual = columns[index];
    assert.equal(actual.name, name, `Donation column ${index + 1} name`);
    assert.equal(actual.type, type, `Donation.${name} type`);
    assert.equal(actual.nullable, nullable, `Donation.${name} nullability`);
    assert.equal(actual.charset_name, charset, `Donation.${name} character set`);
    assert.equal(actual.collation_name, collation, `Donation.${name} collation`);
    if (defaultValue === 'CURRENT_TIMESTAMP') {
      assert.equal(String(actual.default_value).toUpperCase(), 'CURRENT_TIMESTAMP', `Donation.${name} exact default`);
    } else {
      assert.equal(actual.default_value, defaultValue, `Donation.${name} default`);
    }
    assert.equal(String(actual.extra).toLowerCase().includes('auto_increment'), expectedExtra === 'auto_increment', `Donation.${name} auto-increment`);
    assert.ok(!String(actual.extra).toLowerCase().includes('on update'), `Donation.${name} has no automatic update`);
  }

  verificationStage = 'constraint-and-primary-key-metadata';
  const [constraintRows] = await connection.execute(
    `SELECT CONSTRAINT_NAME AS constraint_name, CONSTRAINT_TYPE AS constraint_type,
            ENFORCED AS enforced
       FROM information_schema.TABLE_CONSTRAINTS
      WHERE CONSTRAINT_SCHEMA = DATABASE() AND LOWER(TABLE_NAME) = 'donation'`,
  );
  assert.deepEqual(
    constraintRows.map((row) => `${row.constraint_name}:${row.constraint_type}`).sort(),
    [...expectedConstraints].sort(),
    'Donation exact named constraints',
  );
  const expectedCheckNames = [
    'ck_donation_outcome',
    'ck_donation_collected_at_matches_outcome',
    'ck_donation_release_status_for_outcome',
    'ck_donation_release_decision_timestamp',
    'ck_donation_rejection_reason',
  ];
  const checkEnforcement = constraintRows
    .filter((row) => row.constraint_type === 'CHECK')
    .map((row) => ({ name: row.constraint_name, enforced: row.enforced }))
    .sort((left, right) => left.name.localeCompare(right.name));
  assert.deepEqual(
    checkEnforcement,
    expectedCheckNames.map((name) => ({ name, enforced: 'YES' }))
      .sort((left, right) => left.name.localeCompare(right.name)),
    'Donation CHECK constraints are all enforced',
  );
  const [primaryRows] = await connection.execute(
    `SELECT tc.CONSTRAINT_NAME AS constraint_name, tc.CONSTRAINT_TYPE AS constraint_type,
            kcu.COLUMN_NAME AS column_name, kcu.ORDINAL_POSITION AS ordinal_position
       FROM information_schema.TABLE_CONSTRAINTS tc
       JOIN information_schema.KEY_COLUMN_USAGE kcu
         ON kcu.CONSTRAINT_SCHEMA = tc.CONSTRAINT_SCHEMA
        AND kcu.TABLE_NAME = tc.TABLE_NAME
        AND kcu.CONSTRAINT_NAME = tc.CONSTRAINT_NAME
      WHERE tc.CONSTRAINT_SCHEMA = DATABASE() AND LOWER(tc.TABLE_NAME) = 'donation'
        AND tc.CONSTRAINT_NAME = 'PRIMARY'
      ORDER BY kcu.ORDINAL_POSITION`,
  );
  assert.deepEqual(primaryRows.map((row) => ({
    name: row.constraint_name,
    type: row.constraint_type,
    column: row.column_name,
    ordinal: Number(row.ordinal_position),
  })), [{ name: 'PRIMARY', type: 'PRIMARY KEY', column: 'donation_id', ordinal: 1 }], 'Donation physical primary key');

  verificationStage = 'index-metadata';
  const [indexRows] = await connection.execute(
    `SELECT INDEX_NAME AS index_name, NON_UNIQUE AS non_unique, SEQ_IN_INDEX AS sequence,
            COLUMN_NAME AS column_name, INDEX_TYPE AS index_type
       FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE() AND LOWER(TABLE_NAME) = 'donation'
      ORDER BY INDEX_NAME, SEQ_IN_INDEX`,
  );
  assert.deepEqual(indexRows.map((row) => [
    row.index_name, Number(row.non_unique), Number(row.sequence), row.column_name, row.index_type,
  ].join(':')).sort(), [...expectedIndexes].sort(), 'Donation exact indexes');

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
      WHERE kcu.CONSTRAINT_SCHEMA = DATABASE() AND LOWER(kcu.TABLE_NAME) = 'donation'
        AND kcu.REFERENCED_TABLE_NAME IS NOT NULL`,
  );
  assert.ok(foreignKeyRows.every((row) => row.referenced_schema.toLowerCase() === testDatabase.toLowerCase()), 'all Donation FKs target the selected schema');
  compareStructuredRows(foreignKeyRows.map((row) => ({
    table: row.table_name,
    constraint: row.constraint_name,
    column: row.column_name,
    ordinal: Number(row.ordinal_position),
    referencedTable: row.referenced_table,
    referencedColumn: row.referenced_column,
    deleteRule: row.delete_rule,
    updateRule: row.update_rule,
  })), expectedForeignKeys, 'Donation exact foreign-key metadata');

  verificationStage = 'rollback-only-fixture-transaction';
  await connection.beginTransaction();
  transactionStarted = true;
  const fixtureToken = randomUUID();
  async function insertAccount(role, suffix) {
    const [result] = await connection.execute(
      `INSERT INTO Account (email, password_hash, role, account_status)
       VALUES (?, ?, ?, 'PENDING')`,
      [`donation-verifier-${suffix}-${fixtureToken}@example.invalid`, 'DISPOSABLE_FIXTURE_NOT_A_LOGIN_HASH', role],
    );
    return Number(result.insertId);
  }

  const slotCreatorId = await insertAccount('ADMIN', 'slot-creator');
  const donationRecorderId = await insertAccount('ADMIN', 'recorder');
  const releaseActorId = await insertAccount('ADMIN', 'release-actor');
  const donorIds = [];
  for (let index = 1; index <= 10; index += 1) {
    const accountId = await insertAccount('DONOR', `donor-${index}`);
    donorIds.push(accountId);
    await connection.execute(
      `INSERT INTO Donor (account_id, full_name, date_of_birth, phone, address)
       VALUES (?, ?, '1990-01-01', '+91-00000-00000', 'Disposable Donation verifier address')`,
      [accountId, `Disposable Donation Donor ${String(index).padStart(2, '0')}`],
    );
  }
  assert.equal(donorIds.length, 10, 'ten synthetic Account/Donor prerequisites');

  const slotIds = [];
  for (let index = 1; index <= 11; index += 1) {
    const date = `2040-01-${String(index).padStart(2, '0')}`;
    const [result] = await connection.execute(
      `INSERT INTO DonationSlot (starts_at, ends_at, capacity, created_by_account_id)
       VALUES (?, ?, 2, ?)`, [`${date} 09:00:00`, `${date} 10:00:00`, slotCreatorId],
    );
    slotIds.push(Number(result.insertId));
  }
  assert.equal(slotIds.length, 11, 'ten DonationSlot prerequisites and one spare slot');

  const bookingIds = [];
  for (let index = 0; index < 10; index += 1) {
    const [result] = await connection.execute(
      `INSERT INTO Booking (donor_account_id, slot_id, booking_status)
       VALUES (?, ?, 'CHECKED_IN')`, [donorIds[index], slotIds[index]],
    );
    bookingIds.push(Number(result.insertId));
  }
  const [spareBooking] = await connection.execute(
    `INSERT INTO Booking (donor_account_id, slot_id, booking_status)
     VALUES (?, ?, 'CHECKED_IN')`, [donorIds[0], slotIds[10]],
  );
  const spareBookingId = Number(spareBooking.insertId);
  assert.equal(bookingIds.length, 10, 'ten Booking prerequisites');

  const fixtures = [
    { bookingId: bookingIds[0], outcome: 'COLLECTED', collectedAt: '2040-01-01 08:00:00', reference: 'DONATION-REF-001', releaseStatus: null, releaseActor: null, releaseAt: null, reason: null, useDefaultStatus: true },
    { bookingId: bookingIds[1], outcome: 'COLLECTED', collectedAt: '2040-01-02 08:00:00', reference: 'DONATION-REF-002', releaseStatus: 'APPROVED', releaseActor: null, releaseAt: '2040-01-03 10:00:00', reason: 'OPTIONAL_REASON', useDefaultStatus: false },
    { bookingId: bookingIds[2], outcome: 'COLLECTED', collectedAt: '2040-01-03 08:00:00', reference: 'DONATION-REF-003', releaseStatus: 'REJECTED', releaseActor: releaseActorId, releaseAt: '2040-01-04 10:00:00', reason: 'TEST_REJECTION', useDefaultStatus: false },
    { bookingId: bookingIds[3], outcome: 'INCOMPLETE', collectedAt: null, reference: null, releaseStatus: 'NOT_REQUIRED', releaseActor: null, releaseAt: '2000-01-01 00:00:00', reason: 'OPTIONAL_NONRELEASE_REASON', useDefaultStatus: false },
    { bookingId: bookingIds[4], outcome: 'DEFERRED', collectedAt: null, reference: null, releaseStatus: 'NOT_REQUIRED', releaseActor: releaseActorId, releaseAt: null, reason: null, useDefaultStatus: false },
    { bookingId: bookingIds[5], outcome: 'COLLECTED', collectedAt: '2040-01-06 08:00:00', reference: 'DONATION-REF-006', releaseStatus: 'PENDING', releaseActor: releaseActorId, releaseAt: null, reason: 'OPTIONAL_PENDING_REASON', useDefaultStatus: false },
    { bookingId: bookingIds[6], outcome: 'INCOMPLETE', collectedAt: null, reference: null, releaseStatus: 'NOT_REQUIRED', releaseActor: null, releaseAt: null, reason: null, useDefaultStatus: false },
    { bookingId: bookingIds[7], outcome: 'DEFERRED', collectedAt: null, reference: null, releaseStatus: 'NOT_REQUIRED', releaseActor: null, releaseAt: null, reason: null, useDefaultStatus: false },
    { bookingId: bookingIds[8], outcome: 'COLLECTED', collectedAt: '2040-01-09 08:00:00', reference: null, releaseStatus: 'APPROVED', releaseActor: null, releaseAt: '2040-01-10 10:00:00', reason: null, useDefaultStatus: false },
    { bookingId: bookingIds[9], outcome: 'COLLECTED', collectedAt: '2040-01-11 08:00:00', reference: 'DONATION-REF-010', releaseStatus: 'PENDING', releaseActor: null, releaseAt: '2000-01-01 00:00:00', reason: null, useDefaultStatus: false },
  ];
  for (const fixture of fixtures) {
    const values = [fixture.bookingId, donationRecorderId, fixture.outcome, fixture.collectedAt, fixture.reference];
    if (fixture.useDefaultStatus) {
      await connection.execute(insertDonationWithDefaultStatus, values);
    } else {
      await connection.execute(insertDonation, [...values, fixture.releaseStatus, fixture.releaseActor, fixture.releaseAt, fixture.reason]);
    }
  }
  assert.equal(fixtures.length, 10, 'ten synthetic Donation fixtures');
  const [[fixtureSummary]] = await connection.execute(
    `SELECT COUNT(*) AS row_count,
            COUNT(DISTINCT CONCAT(outcome, ':', release_status)) AS combination_count,
            SUM(collection_reference IS NULL) AS null_reference_count,
            SUM(collected_at IS NULL) AS non_collected_count
       FROM Donation WHERE booking_id IN (${bookingIds.map(() => '?').join(',')})`, bookingIds,
  );
  assert.equal(Number(fixtureSummary.row_count), 10, 'ten Donation rows');
  assert.equal(Number(fixtureSummary.combination_count), 5, 'all five permitted outcome/release combinations');
  assert.ok(Number(fixtureSummary.null_reference_count) >= 4, 'multiple NULL unique collection references');
  assert.ok(Number(fixtureSummary.non_collected_count) >= 2, 'both non-collected outcomes');
  const [[defaultStatus]] = await connection.execute(
    'SELECT release_status FROM Donation WHERE booking_id = ?', [bookingIds[0]],
  );
  assert.equal(defaultStatus.release_status, 'PENDING', 'collected release-status default');
  const [[timeEvidence]] = await connection.execute(
    `SELECT DATE_FORMAT(created_at, '%Y-%m-%d %H:%i:%s') AS created_at,
            collected_at > created_at AS collection_after_creation
       FROM Donation WHERE booking_id = ?`, [bookingIds[9]],
  );
  assert.match(timeEvidence.created_at, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  assert.equal(Number(timeEvidence.collection_after_creation), 1, 'no collection/creation timestamp ordering rule');

  verificationStage = 'negative-constraint-cases';
  const valid = {
    bookingId: spareBookingId,
    actorId: donationRecorderId,
    outcome: 'COLLECTED',
    collectedAt: '2040-02-01 08:00:00',
    reference: null,
    releaseStatus: 'PENDING',
    releaseActor: null,
    releaseAt: null,
    reason: null,
  };
  const insertValues = (overrides = {}) => {
    const row = { ...valid, ...overrides };
    return [row.bookingId, row.actorId, row.outcome, row.collectedAt, row.reference,
      row.releaseStatus, row.releaseActor, row.releaseAt, row.reason];
  };

  negativeResults.push(await rejectsSql(connection, 'duplicate-donation-for-booking', 'ER_DUP_ENTRY', insertDonation, insertValues({ bookingId: bookingIds[0] })));
  negativeResults.push(await rejectsSql(connection, 'duplicate-collection-reference', 'ER_DUP_ENTRY', insertDonation, insertValues({ reference: 'DONATION-REF-002' })));
  negativeResults.push(await rejectsSql(connection, 'outcome-lowercase', 'ER_CHECK_CONSTRAINT_VIOLATED', insertDonation, insertValues({ outcome: 'collected', collectedAt: null })));
  negativeResults.push(await rejectsSql(connection, 'outcome-unknown-uppercase', 'ER_CHECK_CONSTRAINT_VIOLATED', insertDonation, insertValues({ outcome: 'HARVESTED', collectedAt: null })));
  negativeResults.push(await rejectsSql(connection, 'collected-outcome-requires-time', 'ER_CHECK_CONSTRAINT_VIOLATED', insertDonation, insertValues({ collectedAt: null })));
  negativeResults.push(await rejectsSql(connection, 'incomplete-outcome-forbids-time', 'ER_CHECK_CONSTRAINT_VIOLATED', insertDonation, insertValues({ outcome: 'INCOMPLETE', collectedAt: '2040-02-01 08:00:00', releaseStatus: 'NOT_REQUIRED' })));
  negativeResults.push(await rejectsSql(connection, 'deferred-outcome-forbids-time', 'ER_CHECK_CONSTRAINT_VIOLATED', insertDonation, insertValues({ outcome: 'DEFERRED', collectedAt: '2040-02-01 08:00:00', releaseStatus: 'NOT_REQUIRED' })));
  negativeResults.push(await rejectsSql(connection, 'collected-not-required-release', 'ER_CHECK_CONSTRAINT_VIOLATED', insertDonation, insertValues({ releaseStatus: 'NOT_REQUIRED' })));
  negativeResults.push(await rejectsSql(connection, 'incomplete-requires-not-required-release', 'ER_CHECK_CONSTRAINT_VIOLATED', insertDonation, insertValues({ outcome: 'INCOMPLETE', collectedAt: null, releaseStatus: 'PENDING' })));
  negativeResults.push(await rejectsSql(connection, 'incomplete-approved-release-forbidden', 'ER_CHECK_CONSTRAINT_VIOLATED', insertDonation, insertValues({ outcome: 'INCOMPLETE', collectedAt: null, releaseStatus: 'APPROVED', releaseAt: '2040-02-01 09:00:00' })));
  negativeResults.push(await rejectsSql(connection, 'incomplete-rejected-release-forbidden', 'ER_CHECK_CONSTRAINT_VIOLATED', insertDonation, insertValues({ outcome: 'INCOMPLETE', collectedAt: null, releaseStatus: 'REJECTED', releaseAt: '2040-02-01 09:00:00', reason: 'TEST_REJECTION' })));
  negativeResults.push(await rejectsSql(connection, 'deferred-pending-release-forbidden', 'ER_CHECK_CONSTRAINT_VIOLATED', insertDonation, insertValues({ outcome: 'DEFERRED', collectedAt: null, releaseStatus: 'PENDING' })));
  negativeResults.push(await rejectsSql(connection, 'deferred-rejected-release-forbidden', 'ER_CHECK_CONSTRAINT_VIOLATED', insertDonation, insertValues({ outcome: 'DEFERRED', collectedAt: null, releaseStatus: 'REJECTED', releaseAt: '2040-02-01 09:00:00', reason: 'TEST_REJECTION' })));
  negativeResults.push(await rejectsSql(connection, 'non-collected-default-pending-rejected', 'ER_CHECK_CONSTRAINT_VIOLATED', insertDonationWithDefaultStatus, [spareBookingId, donationRecorderId, 'INCOMPLETE', null, null]));
  negativeResults.push(await rejectsSql(connection, 'deferred-requires-not-required-release', 'ER_CHECK_CONSTRAINT_VIOLATED', insertDonation, insertValues({ outcome: 'DEFERRED', collectedAt: null, releaseStatus: 'APPROVED', releaseAt: '2040-02-01 09:00:00' })));
  negativeResults.push(await rejectsSql(connection, 'release-status-lowercase', 'ER_CHECK_CONSTRAINT_VIOLATED', insertDonation, insertValues({ releaseStatus: 'pending' })));
  negativeResults.push(await rejectsSql(connection, 'release-status-unknown-uppercase', 'ER_CHECK_CONSTRAINT_VIOLATED', insertDonation, insertValues({ releaseStatus: 'WITHHELD' })));
  negativeResults.push(await rejectsSql(connection, 'approved-release-requires-time', 'ER_CHECK_CONSTRAINT_VIOLATED', insertDonation, insertValues({ releaseStatus: 'APPROVED' })));
  negativeResults.push(await rejectsSql(connection, 'rejected-release-requires-time', 'ER_CHECK_CONSTRAINT_VIOLATED', insertDonation, insertValues({ releaseStatus: 'REJECTED', reason: 'TEST_REJECTION' })));
  negativeResults.push(await rejectsSql(connection, 'rejected-release-requires-reason', 'ER_CHECK_CONSTRAINT_VIOLATED', insertDonation, insertValues({ releaseStatus: 'REJECTED', releaseAt: '2040-02-01 09:00:00' })));
  const [[maxBooking]] = await connection.query('SELECT COALESCE(MAX(booking_id), 0) AS max_id FROM Booking');
  const missingBookingId = Number(maxBooking.max_id) + 1;
  negativeResults.push(await rejectsSql(connection, 'missing-booking-parent', 'ER_NO_REFERENCED_ROW_2', insertDonation, insertValues({ bookingId: missingBookingId })));
  const [[maxAccount]] = await connection.query('SELECT COALESCE(MAX(account_id), 0) AS max_id FROM Account');
  const missingAccountId = Number(maxAccount.max_id) + 1;
  negativeResults.push(await rejectsSql(connection, 'missing-recording-account', 'ER_NO_REFERENCED_ROW_2', insertDonation, insertValues({ actorId: missingAccountId })));
  negativeResults.push(await rejectsSql(connection, 'missing-release-decision-account', 'ER_NO_REFERENCED_ROW_2', insertDonation, insertValues({ releaseActor: missingAccountId })));

  const requiredNullCases = [
    ['booking-id-null', insertDonation, [null, donationRecorderId, 'COLLECTED', '2040-02-01 08:00:00', null, 'PENDING', null, null, null]],
    ['recording-account-null', insertDonation, [spareBookingId, null, 'COLLECTED', '2040-02-01 08:00:00', null, 'PENDING', null, null, null]],
    ['outcome-null', insertDonation, insertValues({ outcome: null })],
    ['release-status-null', insertDonation, insertValues({ releaseStatus: null })],
    ['created-at-null', insertDonationWithCreatedAt, [...insertValues(), null]],
  ];
  for (const [label, sql, parameters] of requiredNullCases) {
    negativeResults.push(await rejectsSql(connection, label, 'ER_BAD_NULL_ERROR', sql, parameters));
  }

  negativeResults.push(await rejectsSql(connection, 'restrict-booking-delete', 'ER_ROW_IS_REFERENCED_2', 'DELETE FROM Booking WHERE booking_id = ?', [bookingIds[0]]));
  negativeResults.push(await rejectsSql(connection, 'restrict-recording-account-delete', 'ER_ROW_IS_REFERENCED_2', 'DELETE FROM Account WHERE account_id = ?', [donationRecorderId]));
  negativeResults.push(await rejectsSql(connection, 'restrict-release-actor-delete', 'ER_ROW_IS_REFERENCED_2', 'DELETE FROM Account WHERE account_id = ?', [releaseActorId]));

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
  console.error(`Donation verification cleanup failed during ${verificationStage}: ${cleanupFailure}.`);
  process.exitCode = 1;
} else if (verificationFailure) {
  console.error(`Donation verification failed during ${verificationStage}: ${verificationFailure}.`);
  process.exitCode = 1;
} else if (!rollbackSucceeded) {
  console.error('Donation verification failed during fixture-rollback: NO_TRANSACTION_ROLLBACK_CONFIRMED.');
  process.exitCode = 1;
} else {
  for (const { label, code } of negativeResults) console.log(`PASS ${label} (${code})`);
  console.log(`Donation storage verification passed: ${negativeResults.length} negative checks; ten synthetic Donation fixtures and their prerequisites were rolled back; connection closed.`);
}
