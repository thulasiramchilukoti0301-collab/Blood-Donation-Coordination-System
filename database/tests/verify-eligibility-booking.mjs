import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readDatabaseConfig } from '../../backend/src/config/environment.js';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const backendRequire = createRequire(resolve(repositoryRoot, 'backend/package.json'));
const mysql = backendRequire('mysql2/promise');
const testDatabase = process.env.PHASE3_BOOKING_TEST_DATABASE?.trim();

if (!/^bddc_phase3_test_booking_[a-z0-9_]+$/i.test(testDatabase ?? '')) {
  console.error('Configuration failed: set PHASE3_BOOKING_TEST_DATABASE to bddc_phase3_test_booking_<label>.');
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
  console.error('Configuration failed: eligibility/booking verification is restricted to loopback MySQL.');
  process.exit(2);
}

const expectedColumns = {
  DonationSlot: [
    ['slot_id', 'bigint unsigned', 'NO', null, 'auto_increment', null, null],
    ['starts_at', 'datetime', 'NO', null, '', null, null],
    ['ends_at', 'datetime', 'NO', null, '', null, null],
    ['capacity', 'smallint unsigned', 'NO', null, '', null, null],
    ['slot_status', 'varchar(12)', 'NO', 'OPEN', '', 'ascii', 'ascii_bin'],
    ['created_by_account_id', 'bigint unsigned', 'NO', null, '', null, null],
    ['created_at', 'datetime', 'NO', 'CURRENT_TIMESTAMP', '', null, null],
  ],
  Booking: [
    ['booking_id', 'bigint unsigned', 'NO', null, 'auto_increment', null, null],
    ['donor_account_id', 'bigint unsigned', 'NO', null, '', null, null],
    ['slot_id', 'bigint unsigned', 'NO', null, '', null, null],
    ['booking_status', 'varchar(20)', 'NO', 'BOOKED', '', 'ascii', 'ascii_bin'],
    ['booked_at', 'datetime', 'NO', 'CURRENT_TIMESTAMP', '', null, null],
    ['status_changed_at', 'datetime', 'NO', 'CURRENT_TIMESTAMP', '', null, null],
    ['cancellation_reason', 'varchar(160)', 'YES', null, '', 'utf8mb4', 'utf8mb4_0900_ai_ci'],
  ],
  EligibilityDecision: [
    ['eligibility_decision_id', 'bigint unsigned', 'NO', null, 'auto_increment', null, null],
    ['donor_account_id', 'bigint unsigned', 'NO', null, '', null, null],
    ['booking_id', 'bigint unsigned', 'YES', null, '', null, null],
    ['decided_by_account_id', 'bigint unsigned', 'NO', null, '', null, null],
    ['decision', 'varchar(24)', 'NO', null, '', 'ascii', 'ascii_bin'],
    ['reason_code', 'varchar(40)', 'YES', null, '', 'utf8mb4', 'utf8mb4_0900_ai_ci'],
    ['deferred_until', 'date', 'YES', null, '', null, null],
    ['decided_at', 'datetime', 'NO', 'CURRENT_TIMESTAMP', '', null, null],
  ],
};

const expectedConstraints = {
  donationslot: [
    'PRIMARY:PRIMARY KEY',
    'ck_donation_slot_time_order:CHECK',
    'ck_donation_slot_capacity_positive:CHECK',
    'ck_donation_slot_status:CHECK',
    'fk_donation_slot_created_by_account:FOREIGN KEY',
  ],
  booking: [
    'PRIMARY:PRIMARY KEY',
    'uq_booking_donor_slot:UNIQUE',
    'uq_booking_booking_donor:UNIQUE',
    'ck_booking_status:CHECK',
    'fk_booking_donor:FOREIGN KEY',
    'fk_booking_slot:FOREIGN KEY',
  ],
  eligibilitydecision: [
    'PRIMARY:PRIMARY KEY',
    'ck_eligibility_decision_value:CHECK',
    'ck_eligibility_temporary_deferral_date:CHECK',
    'fk_eligibility_decision_donor:FOREIGN KEY',
    'fk_eligibility_decision_booking_donor:FOREIGN KEY',
    'fk_eligibility_decision_decided_by_account:FOREIGN KEY',
  ],
};

const expectedIndexes = {
  donationslot: [
    'PRIMARY:0:1:slot_id:BTREE',
    'ix_donation_slot_created_by_account_id:1:1:created_by_account_id:BTREE',
    'ix_donation_slot_status_starts_at:1:1:slot_status:BTREE',
    'ix_donation_slot_status_starts_at:1:2:starts_at:BTREE',
  ],
  booking: [
    'PRIMARY:0:1:booking_id:BTREE',
    'uq_booking_booking_donor:0:1:booking_id:BTREE',
    'uq_booking_booking_donor:0:2:donor_account_id:BTREE',
    'uq_booking_donor_slot:0:1:donor_account_id:BTREE',
    'uq_booking_donor_slot:0:2:slot_id:BTREE',
    'ix_booking_donor_account_status:1:1:donor_account_id:BTREE',
    'ix_booking_donor_account_status:1:2:booking_status:BTREE',
    'ix_booking_slot_status:1:1:slot_id:BTREE',
    'ix_booking_slot_status:1:2:booking_status:BTREE',
  ],
  eligibilitydecision: [
    'PRIMARY:0:1:eligibility_decision_id:BTREE',
    'ix_eligibility_decision_booking_donor:1:1:booking_id:BTREE',
    'ix_eligibility_decision_booking_donor:1:2:donor_account_id:BTREE',
    'ix_eligibility_decision_decided_by_account_id:1:1:decided_by_account_id:BTREE',
    'ix_eligibility_decision_donor_decided_at:1:1:donor_account_id:BTREE',
    'ix_eligibility_decision_donor_decided_at:1:2:decided_at:BTREE',
  ],
};

const expectedForeignKeys = [
  'donationslot:fk_donation_slot_created_by_account:created_by_account_id:account:account_id:RESTRICT:RESTRICT:1',
  'booking:fk_booking_donor:donor_account_id:donor:account_id:RESTRICT:RESTRICT:1',
  'booking:fk_booking_slot:slot_id:donationslot:slot_id:RESTRICT:RESTRICT:1',
  'eligibilitydecision:fk_eligibility_decision_donor:donor_account_id:donor:account_id:RESTRICT:RESTRICT:1',
  'eligibilitydecision:fk_eligibility_decision_booking_donor:booking_id:booking:booking_id:RESTRICT:RESTRICT:1',
  'eligibilitydecision:fk_eligibility_decision_booking_donor:donor_account_id:booking:donor_account_id:RESTRICT:RESTRICT:2',
  'eligibilitydecision:fk_eligibility_decision_decided_by_account:decided_by_account_id:account:account_id:RESTRICT:RESTRICT:1',
];

const insertSlot = `INSERT INTO DonationSlot
  (starts_at, ends_at, capacity, slot_status, created_by_account_id)
  VALUES (?, ?, ?, ?, ?)`;
const insertSlotWithDefaults = `INSERT INTO DonationSlot
  (starts_at, ends_at, capacity, created_by_account_id)
  VALUES (?, ?, ?, ?)`;
const insertSlotWithCreatedAt = `INSERT INTO DonationSlot
  (starts_at, ends_at, capacity, slot_status, created_by_account_id, created_at)
  VALUES (?, ?, ?, ?, ?, ?)`;
const insertBooking = `INSERT INTO Booking
  (donor_account_id, slot_id, booking_status, cancellation_reason)
  VALUES (?, ?, ?, ?)`;
const insertBookingWithDefaultStatus = `INSERT INTO Booking
  (donor_account_id, slot_id, cancellation_reason)
  VALUES (?, ?, ?)`;
const insertBookingWithTimestamps = `INSERT INTO Booking
  (donor_account_id, slot_id, booking_status, booked_at, status_changed_at, cancellation_reason)
  VALUES (?, ?, ?, ?, ?, ?)`;
const insertEligibility = `INSERT INTO EligibilityDecision
  (donor_account_id, booking_id, decided_by_account_id, decision, reason_code, deferred_until)
  VALUES (?, ?, ?, ?, ?, ?)`;
const insertEligibilityWithDecidedAt = `INSERT INTO EligibilityDecision
  (donor_account_id, booking_id, decided_by_account_id, decision, reason_code, deferred_until, decided_at)
  VALUES (?, ?, ?, ?, ?, ?, ?)`;

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

function normalizeCheckClause(clause) {
  // CHECK_CLAUSE may escape its quote delimiters once in metadata. Remove only
  // that metadata layer; do not recursively unescape copied/exported text.
  const input = String(clause).replaceAll("\\'", "'").replaceAll('`', '');
  let normalized = '';
  let inString = false;

  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];
    if (inString) {
      normalized += character;
      if (character === '\\' && index + 1 < input.length) {
        normalized += input[index + 1];
        index += 1;
      } else if (character === "'" && input[index + 1] === "'") {
        normalized += input[index + 1];
        index += 1;
      } else if (character === "'") {
        inString = false;
      }
      continue;
    }

    if (character === "'") {
      inString = true;
      normalized += character;
      continue;
    }

    if (character === '_' && /^_[A-Z0-9]+(?=')/i.test(input.slice(index))) {
      index += input.slice(index).match(/^_[A-Z0-9]+/i)[0].length - 1;
      continue;
    }
    if (/\s/.test(character) || character === '(' || character === ')') continue;
    normalized += character.toUpperCase();
  }

  return normalized;
}

class CheckClauseMismatch extends Error {
  constructor(constraintName) {
    super();
    this.constraintName = constraintName;
  }
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

  verificationStage = 'table-column-and-engine-metadata';
  for (const [tableName, expected] of Object.entries(expectedColumns)) {
    const [[table]] = await connection.execute(
      `SELECT ENGINE AS engine, TABLE_COLLATION AS table_collation
         FROM information_schema.TABLES
        WHERE TABLE_SCHEMA = DATABASE() AND LOWER(TABLE_NAME) = LOWER(?)`, [tableName],
    );
    assert.equal(table?.engine, 'InnoDB', `${tableName} engine`);
    assert.equal(table?.table_collation, 'utf8mb4_0900_ai_ci', `${tableName} table collation`);
    const [columns] = await connection.execute(
      `SELECT COLUMN_NAME AS name, COLUMN_TYPE AS type, IS_NULLABLE AS nullable,
              COLUMN_DEFAULT AS default_value, EXTRA AS extra,
              CHARACTER_SET_NAME AS charset_name, COLLATION_NAME AS collation_name
         FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND LOWER(TABLE_NAME) = LOWER(?)
        ORDER BY ORDINAL_POSITION`, [tableName],
    );
    assert.equal(columns.length, expected.length, `${tableName} exact column count`);
    for (const [index, [name, type, nullable, defaultValue, expectedExtra, charset, collation]] of expected.entries()) {
      const actual = columns[index];
      assert.equal(actual.name, name, `${tableName} column ${index + 1} name`);
      assert.equal(actual.type, type, `${tableName}.${name} type`);
      assert.equal(actual.nullable, nullable, `${tableName}.${name} nullability`);
      assert.equal(actual.charset_name, charset, `${tableName}.${name} character set`);
      assert.equal(actual.collation_name, collation, `${tableName}.${name} collation`);
      if (defaultValue === 'CURRENT_TIMESTAMP') {
        assert.equal(String(actual.default_value).toUpperCase(), 'CURRENT_TIMESTAMP', `${tableName}.${name} exact default`);
      } else {
        assert.equal(actual.default_value, defaultValue, `${tableName}.${name} default`);
      }
      assert.equal(String(actual.extra).toLowerCase().includes('auto_increment'), expectedExtra === 'auto_increment', `${tableName}.${name} auto-increment`);
      assert.ok(!String(actual.extra).toLowerCase().includes('on update'), `${tableName}.${name} has no automatic update`);
    }
  }

  verificationStage = 'constraint-and-check-metadata';
  const [constraintRows] = await connection.execute(
    `SELECT LOWER(tc.TABLE_NAME) AS table_name, tc.CONSTRAINT_NAME AS constraint_name,
            tc.CONSTRAINT_TYPE AS constraint_type, cc.CHECK_CLAUSE AS check_clause
       FROM information_schema.TABLE_CONSTRAINTS tc
       LEFT JOIN information_schema.CHECK_CONSTRAINTS cc
         ON cc.CONSTRAINT_SCHEMA = tc.CONSTRAINT_SCHEMA
        AND cc.CONSTRAINT_NAME = tc.CONSTRAINT_NAME
      WHERE tc.CONSTRAINT_SCHEMA = DATABASE()
        AND LOWER(tc.TABLE_NAME) IN ('donationslot', 'booking', 'eligibilitydecision')`,
  );
  for (const [tableName, expected] of Object.entries(expectedConstraints)) {
    const actual = constraintRows
      .filter((row) => row.table_name === tableName)
      .map((row) => `${row.constraint_name}:${row.constraint_type}`)
      .sort();
    assert.deepEqual(actual, [...expected].sort(), `${tableName} exact constraints`);
  }
  const checks = new Map(constraintRows
    .filter((row) => row.constraint_type === 'CHECK')
    .map((row) => [row.constraint_name, normalizeCheckClause(row.check_clause)]));
  for (const [name, expectedClause] of [
    ['ck_donation_slot_time_order', 'ENDS_AT>STARTS_AT'],
    ['ck_donation_slot_capacity_positive', 'CAPACITY>0'],
    ['ck_donation_slot_status', "SLOT_STATUSIN'OPEN','CLOSED','CANCELLED'"],
    ['ck_booking_status', "BOOKING_STATUSIN'BOOKED','CANCELLED_BY_DONOR','CANCELLED_BY_STAFF','CHECKED_IN','NO_SHOW','COMPLETED'"],
    ['ck_eligibility_decision_value', "DECISIONIN'ACCEPTED','TEMPORARILY_DEFERRED','REVIEW_REQUIRED'"],
    ['ck_eligibility_temporary_deferral_date', "DECISION<>'TEMPORARILY_DEFERRED'ORDEFERRED_UNTILISNOTNULL"],
  ]) {
    if (checks.get(name) !== expectedClause) throw new CheckClauseMismatch(name);
  }

  verificationStage = 'primary-key-metadata';
  for (const [tableName, columnName] of [
    ['DonationSlot', 'slot_id'],
    ['Booking', 'booking_id'],
    ['EligibilityDecision', 'eligibility_decision_id'],
  ]) {
    const [primaryRows] = await connection.execute(
      `SELECT tc.CONSTRAINT_NAME AS constraint_name, tc.CONSTRAINT_TYPE AS constraint_type,
              kcu.COLUMN_NAME AS column_name, kcu.ORDINAL_POSITION AS ordinal_position
         FROM information_schema.TABLE_CONSTRAINTS tc
         JOIN information_schema.KEY_COLUMN_USAGE kcu
           ON kcu.CONSTRAINT_SCHEMA = tc.CONSTRAINT_SCHEMA
          AND kcu.TABLE_NAME = tc.TABLE_NAME
          AND kcu.CONSTRAINT_NAME = tc.CONSTRAINT_NAME
        WHERE tc.CONSTRAINT_SCHEMA = DATABASE()
          AND LOWER(tc.TABLE_NAME) = LOWER(?) AND tc.CONSTRAINT_NAME = 'PRIMARY'
        ORDER BY kcu.ORDINAL_POSITION`, [tableName],
    );
    assert.equal(primaryRows.length, 1, `${tableName} primary key column count`);
    assert.equal(primaryRows[0].constraint_name, 'PRIMARY');
    assert.equal(primaryRows[0].constraint_type, 'PRIMARY KEY');
    assert.equal(primaryRows[0].column_name, columnName);
    assert.equal(Number(primaryRows[0].ordinal_position), 1);
  }

  verificationStage = 'index-metadata';
  const [indexRows] = await connection.execute(
    `SELECT LOWER(TABLE_NAME) AS table_name, INDEX_NAME AS index_name,
            NON_UNIQUE AS non_unique, SEQ_IN_INDEX AS sequence,
            COLUMN_NAME AS column_name, INDEX_TYPE AS index_type
       FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE()
        AND LOWER(TABLE_NAME) IN ('donationslot', 'booking', 'eligibilitydecision')
      ORDER BY TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX`,
  );
  for (const [tableName, expected] of Object.entries(expectedIndexes)) {
    const actual = indexRows
      .filter((row) => row.table_name === tableName)
      .map((row) => [row.index_name, Number(row.non_unique), Number(row.sequence), row.column_name, row.index_type].join(':'))
      .sort();
    assert.deepEqual(actual, [...expected].sort(), `${tableName} exact indexes`);
  }

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
      WHERE kcu.CONSTRAINT_SCHEMA = DATABASE()
        AND LOWER(kcu.TABLE_NAME) IN ('donationslot', 'booking', 'eligibilitydecision')
        AND kcu.REFERENCED_TABLE_NAME IS NOT NULL`,
  );
  assert.ok(foreignKeyRows.every((row) => row.referenced_schema.toLowerCase() === testDatabase.toLowerCase()), 'all foreign keys target the selected schema');
  const actualForeignKeys = foreignKeyRows.map((row) => [
    row.table_name, row.constraint_name, row.column_name, row.referenced_table,
    row.referenced_column, row.delete_rule, row.update_rule,
    Number(row.ordinal_position),
  ].join(':')).sort();
  assert.deepEqual(actualForeignKeys, [...expectedForeignKeys].sort());

  verificationStage = 'rollback-only-fixture-transaction';
  await connection.beginTransaction();
  transactionStarted = true;
  const fixtureToken = randomUUID();
  const [adminResult] = await connection.execute(
    `INSERT INTO Account (email, password_hash, role, account_status)
     VALUES (?, ?, 'ADMIN', 'ACTIVE')`,
    [`booking-verifier-admin-${fixtureToken}@example.invalid`, 'DISPOSABLE_FIXTURE_NOT_A_LOGIN_HASH'],
  );
  const adminId = Number(adminResult.insertId);
  const donorIds = [];
  const sharedPhone = '+91-00000-00000';
  for (let index = 1; index <= 10; index += 1) {
    const [accountResult] = await connection.execute(
      `INSERT INTO Account (email, password_hash, role, account_status)
       VALUES (?, ?, 'DONOR', 'ACTIVE')`,
      [`booking-verifier-donor-${fixtureToken}-${index}@example.invalid`, 'DISPOSABLE_FIXTURE_NOT_A_LOGIN_HASH'],
    );
    const donorId = Number(accountResult.insertId);
    donorIds.push(donorId);
    await connection.execute(
      `INSERT INTO Donor (account_id, full_name, date_of_birth, phone, address)
       VALUES (?, ?, '1990-01-01', ?, 'Disposable booking verification address')`,
      [donorId, `Disposable Booking Donor ${String(index).padStart(2, '0')}`, sharedPhone],
    );
  }
  assert.equal(donorIds.length, 10, 'ten synthetic Account/Donor prerequisites');

  const slotStatuses = ['OPEN', 'CLOSED', 'CANCELLED', 'OPEN', 'CLOSED', 'CANCELLED', 'OPEN', 'CLOSED', 'CANCELLED', 'OPEN'];
  const slotIds = [];
  for (let index = 0; index < 10; index += 1) {
    const day = String(index + 1).padStart(2, '0');
    const [slotResult] = index === 0
      ? await connection.execute(insertSlotWithDefaults, [`2035-01-${day} 09:00:00`, `2035-01-${day} 10:00:00`, index + 1, adminId])
      : await connection.execute(insertSlot, [`2035-01-${day} 09:00:00`, `2035-01-${day} 10:00:00`, index + 1, slotStatuses[index], adminId]);
    slotIds.push(Number(slotResult.insertId));
  }
  assert.equal(slotIds.length, 10, 'ten synthetic DonationSlot fixtures');
  const [[slotRows]] = await connection.query(
    "SELECT COUNT(*) AS row_count, COUNT(DISTINCT slot_status) AS status_count FROM DonationSlot WHERE slot_id IN (" + slotIds.map(() => '?').join(',') + ')',
    slotIds,
  );
  assert.equal(Number(slotRows.row_count), 10);
  assert.equal(Number(slotRows.status_count), 3, 'all valid slot statuses');
  const [[defaultSlotStatus]] = await connection.execute('SELECT slot_status FROM DonationSlot WHERE slot_id = ?', [slotIds[0]]);
  assert.equal(defaultSlotStatus.slot_status, 'OPEN', 'DonationSlot status default');

  const bookingStatuses = [
    'BOOKED', 'CANCELLED_BY_DONOR', 'CANCELLED_BY_STAFF', 'CHECKED_IN', 'NO_SHOW',
    'COMPLETED', 'BOOKED', 'CHECKED_IN', 'CANCELLED_BY_DONOR', 'COMPLETED',
  ];
  const bookingIds = [];
  for (let index = 0; index < 10; index += 1) {
    const cancellationReason = ['CANCELLED_BY_DONOR', 'CANCELLED_BY_STAFF'].includes(bookingStatuses[index])
      ? 'DISPOSABLE_TEST_CANCELLATION'
      : null;
    const [bookingResult] = index === 0
      ? await connection.execute(insertBookingWithDefaultStatus, [donorIds[index], slotIds[index], cancellationReason])
      : await connection.execute(insertBooking, [donorIds[index], slotIds[index], bookingStatuses[index], cancellationReason]);
    bookingIds.push(Number(bookingResult.insertId));
  }
  assert.equal(bookingIds.length, 10, 'ten synthetic Booking fixtures');
  const [actualBookingStatuses] = await connection.execute(
    `SELECT DISTINCT booking_status FROM Booking WHERE booking_id IN (${bookingIds.map(() => '?').join(',')}) ORDER BY booking_status`, bookingIds,
  );
  assert.deepEqual(actualBookingStatuses.map(({ booking_status }) => booking_status).sort(), [
    'BOOKED', 'CANCELLED_BY_DONOR', 'CANCELLED_BY_STAFF', 'CHECKED_IN', 'COMPLETED', 'NO_SHOW',
  ].sort());
  const [[defaultBookingStatus]] = await connection.execute('SELECT booking_status FROM Booking WHERE booking_id = ?', [bookingIds[0]]);
  assert.equal(defaultBookingStatus.booking_status, 'BOOKED', 'Booking status default');

  const decisions = ['ACCEPTED', 'TEMPORARILY_DEFERRED', 'REVIEW_REQUIRED'];
  for (let index = 0; index < 10; index += 1) {
    const decision = decisions[index % decisions.length];
    await connection.execute(insertEligibility, [
      donorIds[index], index % 2 === 0 ? bookingIds[index] : null, adminId, decision,
      decision === 'REVIEW_REQUIRED' ? 'STAFF_REVIEW' : null,
      decision === 'TEMPORARILY_DEFERRED' ? '2000-01-15' : null,
    ]);
  }
  const [[decisionSummary]] = await connection.execute(
    `SELECT COUNT(*) AS row_count, COUNT(DISTINCT decision) AS decision_count,
            SUM(booking_id IS NULL) AS bookingless_count,
            SUM(decision = 'TEMPORARILY_DEFERRED' AND deferred_until IS NOT NULL) AS valid_temporary_count
       FROM EligibilityDecision WHERE donor_account_id IN (${donorIds.map(() => '?').join(',')})`, donorIds,
  );
  assert.equal(Number(decisionSummary.row_count), 10, 'ten synthetic EligibilityDecision fixtures');
  assert.equal(Number(decisionSummary.decision_count), 3, 'all valid eligibility decisions');
  assert.ok(Number(decisionSummary.bookingless_count) > 0, 'nullable booking link is supported');
  assert.ok(Number(decisionSummary.valid_temporary_count) > 0, 'temporary deferral stores its required date');

  const [[maxAccount]] = await connection.query('SELECT MAX(account_id) AS maximum_id FROM Account');
  const [[maxSlot]] = await connection.query('SELECT MAX(slot_id) AS maximum_id FROM DonationSlot');
  const [[maxBooking]] = await connection.query('SELECT MAX(booking_id) AS maximum_id FROM Booking');
  const missingAccountId = Number(maxAccount.maximum_id) + 1;
  const missingSlotId = Number(maxSlot.maximum_id) + 1;
  const missingBookingId = Number(maxBooking.maximum_id) + 1;
  const day = '2035-02-01';
  const validSlot = [`${day} 09:00:00`, `${day} 10:00:00`, 2, 'OPEN', adminId];
  const validBooking = [donorIds[0], slotIds[0], 'BOOKED', null];
  const validDecision = [donorIds[0], null, adminId, 'ACCEPTED', null, null];

  verificationStage = 'negative-constraint-cases';
  await connection.execute('UPDATE Booking SET booking_status = ? WHERE booking_id = ?', ['CANCELLED_BY_DONOR', bookingIds[0]]);
  negativeResults.push(await rejectsSql(connection, 'duplicate-donor-slot-after-cancellation', 'ER_DUP_ENTRY', insertBooking, [donorIds[0], slotIds[0], 'BOOKED', null]));

  negativeResults.push(await rejectsSql(connection, 'slot-end-not-after-start', 'ER_CHECK_CONSTRAINT_VIOLATED', insertSlot, [`${day} 10:00:00`, `${day} 10:00:00`, 1, 'OPEN', adminId]));
  negativeResults.push(await rejectsSql(connection, 'slot-capacity-zero', 'ER_CHECK_CONSTRAINT_VIOLATED', insertSlot, [validSlot[0], validSlot[1], 0, 'OPEN', adminId]));
  negativeResults.push(await rejectsSql(connection, 'slot-status-lowercase', 'ER_CHECK_CONSTRAINT_VIOLATED', insertSlot, [validSlot[0], validSlot[1], 1, 'open', adminId]));
  negativeResults.push(await rejectsSql(connection, 'slot-status-unknown-uppercase', 'ER_CHECK_CONSTRAINT_VIOLATED', insertSlot, [validSlot[0], validSlot[1], 1, 'PAUSED', adminId]));
  negativeResults.push(await rejectsSql(connection, 'booking-status-lowercase', 'ER_CHECK_CONSTRAINT_VIOLATED', insertBooking, [donorIds[0], slotIds[1], 'booked', null]));
  negativeResults.push(await rejectsSql(connection, 'booking-status-unknown-uppercase', 'ER_CHECK_CONSTRAINT_VIOLATED', insertBooking, [donorIds[0], slotIds[1], 'ATTENDED', null]));
  negativeResults.push(await rejectsSql(connection, 'eligibility-decision-lowercase', 'ER_CHECK_CONSTRAINT_VIOLATED', insertEligibility, [donorIds[1], null, adminId, 'accepted', null, null]));
  negativeResults.push(await rejectsSql(connection, 'eligibility-decision-unknown-uppercase', 'ER_CHECK_CONSTRAINT_VIOLATED', insertEligibility, [donorIds[1], null, adminId, 'INELIGIBLE', null, null]));
  negativeResults.push(await rejectsSql(connection, 'temporary-deferral-requires-date', 'ER_CHECK_CONSTRAINT_VIOLATED', insertEligibility, [donorIds[1], null, adminId, 'TEMPORARILY_DEFERRED', null, null]));

  negativeResults.push(await rejectsSql(connection, 'missing-slot-creator-account', 'ER_NO_REFERENCED_ROW_2', insertSlot, [validSlot[0], validSlot[1], 1, 'OPEN', missingAccountId]));
  negativeResults.push(await rejectsSql(connection, 'missing-booking-donor', 'ER_NO_REFERENCED_ROW_2', insertBooking, [missingAccountId, slotIds[0], 'BOOKED', null]));
  negativeResults.push(await rejectsSql(connection, 'missing-booking-slot', 'ER_NO_REFERENCED_ROW_2', insertBooking, [donorIds[0], missingSlotId, 'BOOKED', null]));
  negativeResults.push(await rejectsSql(connection, 'missing-eligibility-donor', 'ER_NO_REFERENCED_ROW_2', insertEligibility, [missingAccountId, null, adminId, 'ACCEPTED', null, null]));
  negativeResults.push(await rejectsSql(connection, 'eligibility-booking-donor-mismatch', 'ER_NO_REFERENCED_ROW_2', insertEligibility, [donorIds[1], bookingIds[0], adminId, 'ACCEPTED', null, null]));
  negativeResults.push(await rejectsSql(connection, 'missing-eligibility-decided-by-account', 'ER_NO_REFERENCED_ROW_2', insertEligibility, [donorIds[0], null, missingAccountId, 'ACCEPTED', null, null]));
  negativeResults.push(await rejectsSql(connection, 'missing-eligibility-booking', 'ER_NO_REFERENCED_ROW_2', insertEligibility, [donorIds[0], missingBookingId, adminId, 'ACCEPTED', null, null]));

  const requiredNullCases = [
    ['slot-start-null', insertSlot, [null, validSlot[1], 1, 'OPEN', adminId]],
    ['slot-end-null', insertSlot, [validSlot[0], null, 1, 'OPEN', adminId]],
    ['slot-capacity-null', insertSlot, [validSlot[0], validSlot[1], null, 'OPEN', adminId]],
    ['slot-status-null', insertSlot, [validSlot[0], validSlot[1], 1, null, adminId]],
    ['slot-creator-null', insertSlot, [validSlot[0], validSlot[1], 1, 'OPEN', null]],
    ['slot-created-at-null', insertSlotWithCreatedAt, [validSlot[0], validSlot[1], 1, 'OPEN', adminId, null]],
    ['booking-donor-null', insertBooking, [null, slotIds[2], 'BOOKED', null]],
    ['booking-slot-null', insertBooking, [donorIds[2], null, 'BOOKED', null]],
    ['booking-status-null', insertBooking, [donorIds[0], slotIds[1], null, null]],
    ['booking-booked-at-null', insertBookingWithTimestamps, [donorIds[0], slotIds[1], 'BOOKED', null, '2035-02-01 08:00:00', null]],
    ['booking-status-changed-at-null', insertBookingWithTimestamps, [donorIds[0], slotIds[1], 'BOOKED', '2035-02-01 08:00:00', null, null]],
    ['eligibility-donor-null', insertEligibility, [null, null, adminId, 'ACCEPTED', null, null]],
    ['eligibility-decided-by-null', insertEligibility, [donorIds[3], null, null, 'ACCEPTED', null, null]],
    ['eligibility-decision-null', insertEligibility, [donorIds[3], null, adminId, null, null, null]],
    ['eligibility-decided-at-null', insertEligibilityWithDecidedAt, [donorIds[3], null, adminId, 'ACCEPTED', null, null, null]],
  ];
  for (const [label, sql, parameters] of requiredNullCases) {
    negativeResults.push(await rejectsSql(connection, label, 'ER_BAD_NULL_ERROR', sql, parameters));
  }

  negativeResults.push(await rejectsSql(connection, 'restrict-donor-delete', 'ER_ROW_IS_REFERENCED_2', 'DELETE FROM Donor WHERE account_id = ?', [donorIds[0]]));
  negativeResults.push(await rejectsSql(connection, 'restrict-slot-delete', 'ER_ROW_IS_REFERENCED_2', 'DELETE FROM DonationSlot WHERE slot_id = ?', [slotIds[0]]));
  negativeResults.push(await rejectsSql(connection, 'restrict-booking-delete', 'ER_ROW_IS_REFERENCED_2', 'DELETE FROM Booking WHERE booking_id = ?', [bookingIds[0]]));
  negativeResults.push(await rejectsSql(connection, 'restrict-creator-account-delete', 'ER_ROW_IS_REFERENCED_2', 'DELETE FROM Account WHERE account_id = ?', [adminId]));

  verificationStage = 'timestamp-default-and-update-behavior';
  const [[timestamps]] = await connection.execute(
    `SELECT DATE_FORMAT(booked_at, '%Y-%m-%d %H:%i:%s') AS booked_at,
            DATE_FORMAT(status_changed_at, '%Y-%m-%d %H:%i:%s') AS status_changed_at
       FROM Booking WHERE booking_id = ?`, [bookingIds[2]],
  );
  assert.match(timestamps.booked_at, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  assert.match(timestamps.status_changed_at, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  const [[slotCreated]] = await connection.execute(
    `SELECT DATE_FORMAT(created_at, '%Y-%m-%d %H:%i:%s') AS created_at
       FROM DonationSlot WHERE slot_id = ?`, [slotIds[0]],
  );
  assert.match(slotCreated.created_at, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  const [[decisionCreated]] = await connection.execute(
    `SELECT DATE_FORMAT(decided_at, '%Y-%m-%d %H:%i:%s') AS decided_at
       FROM EligibilityDecision WHERE donor_account_id = ?`, [donorIds[0]],
  );
  assert.match(decisionCreated.decided_at, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  await connection.execute("UPDATE Booking SET status_changed_at = '2000-01-02 03:04:05' WHERE booking_id = ?", [bookingIds[2]]);
  await connection.execute("UPDATE Booking SET booking_status = 'NO_SHOW' WHERE booking_id = ?", [bookingIds[2]]);
  const [[unchangedTimestamp]] = await connection.execute(
    `SELECT DATE_FORMAT(status_changed_at, '%Y-%m-%d %H:%i:%s') AS status_changed_at
       FROM Booking WHERE booking_id = ?`, [bookingIds[2]],
  );
  assert.equal(unchangedTimestamp.status_changed_at, '2000-01-02 03:04:05', 'status_changed_at has no automatic-update behavior');
  verificationStage = 'fixture-rollback';
} catch (error) {
  verificationFailure = error instanceof NegativeCheckFailure
    ? `${error.label}: expected ${error.expectedCode}, received ${error.actualCode}`
    : error instanceof CheckClauseMismatch
      ? `constraint ${error.constraintName}: CHECK_CLAUSE_MISMATCH`
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
  console.error(`Eligibility/booking verification cleanup failed during ${verificationStage}: ${cleanupFailure}.`);
  process.exitCode = 1;
} else if (verificationFailure) {
  console.error(`Eligibility/booking verification failed during ${verificationStage}: ${verificationFailure}.`);
  process.exitCode = 1;
} else if (!rollbackSucceeded) {
  console.error('Eligibility/booking verification failed during fixture-rollback: NO_TRANSACTION_ROLLBACK_CONFIRMED.');
  process.exitCode = 1;
} else {
  for (const { label, code } of negativeResults) console.log(`PASS ${label} (${code})`);
  console.log('Eligibility/booking storage verification passed: ten fixtures per new table were rolled back and the connection closed. This does not verify concurrency or booking workflows.');
}
