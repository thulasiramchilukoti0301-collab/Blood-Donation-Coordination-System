import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readDatabaseConfig } from '../../backend/src/config/environment.js';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const backendRequire = createRequire(resolve(repositoryRoot, 'backend/package.json'));
const mysql = backendRequire('mysql2/promise');
const testDatabase = process.env.PHASE3_INVENTORY_VIEW_TEST_DATABASE?.trim();

if (!/^bddc_phase3_test_inventory_view_[a-z0-9_]+$/i.test(testDatabase ?? '')) {
  console.error('Configuration failed: set PHASE3_INVENTORY_VIEW_TEST_DATABASE to bddc_phase3_test_inventory_view_<label>.');
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
  console.error('Configuration failed: inventory view verification is restricted to loopback MySQL.');
  process.exit(2);
}

const expectedGroups = [
  [1, 'O-', 'O negative'], [2, 'O+', 'O positive'],
  [3, 'A-', 'A negative'], [4, 'A+', 'A positive'],
  [5, 'B-', 'B negative'], [6, 'B+', 'B positive'],
  [7, 'AB-', 'AB negative'], [8, 'AB+', 'AB positive'],
];
const expectedColumns = [
  'blood_group_id', 'code', 'display_name', 'available_unit_count',
];
const operationalTables = [
  'Account', 'Donor', 'DonationSlot', 'Booking',
  'EligibilityDecision', 'Donation', 'BloodUnit',
];

class VerificationAssertion extends Error {
  constructor(label) {
    super();
    this.label = label;
  }
}

function check(condition, label) {
  if (!condition) throw new VerificationAssertion(label);
}

function checkEqual(actual, expected, label) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new VerificationAssertion(label);
  }
}

function safeCode(error) {
  return typeof error?.code === 'string'
    && /^(?:ER_[A-Z0-9_]+|ECONN[A-Z0-9_]*|ETIMEDOUT|EPIPE|EAI_AGAIN|ENOTFOUND|PROTOCOL_[A-Z0-9_]+)$/.test(error.code)
    ? error.code
    : 'ASSERTION_FAILED';
}

function dateOffset(dateText, offsetDays) {
  const [year, month, day] = dateText.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + offsetDays));
  return date.toISOString().slice(0, 10);
}

function normalizedRows(rows) {
  return rows.map((row) => ({
    blood_group_id: Number(row.blood_group_id),
    code: row.code,
    display_name: row.display_name,
    available_unit_count: Number(row.available_unit_count),
  })).sort((left, right) => left.blood_group_id - right.blood_group_id);
}

let connection;
let transactionStarted = false;
let rollbackSucceeded = false;
let verificationFailure;
let cleanupFailure;
let verificationStage = 'connection';
let capturedDatabaseDate;

async function assertDatabaseDateStable() {
  const [[row]] = await connection.query('SELECT DATE_FORMAT(CURRENT_DATE(), \'%Y-%m-%d\') AS db_date');
  check(row.db_date === capturedDatabaseDate, 'database-date-remained-stable');
}

try {
  connection = await mysql.createConnection({ ...databaseConfig.options, multipleStatements: false });

  verificationStage = 'selected-database-and-time-zone';
  await connection.query("SET time_zone = '+05:30'");
  const [[selected]] = await connection.query('SELECT DATABASE() AS selected_database');
  check(selected.selected_database === testDatabase, 'explicit-disposable-schema-selected');
  const [[dateRow]] = await connection.query('SELECT DATE_FORMAT(CURRENT_DATE(), \'%Y-%m-%d\') AS db_date');
  capturedDatabaseDate = dateRow.db_date;
  check(/^\d{4}-\d{2}-\d{2}$/.test(capturedDatabaseDate), 'database-session-date-captured');

  verificationStage = 'view-and-metadata-preflight';
  const [[view]] = await connection.execute(
    `SELECT SECURITY_TYPE AS security_type
       FROM information_schema.VIEWS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'v_available_inventory_by_group'`,
  );
  check(view?.security_type === 'INVOKER', 'view-exists-with-invoker-security');
  const [columns] = await connection.execute(
    `SELECT COLUMN_NAME AS column_name
       FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'v_available_inventory_by_group'
      ORDER BY ORDINAL_POSITION`,
  );
  checkEqual(columns.map((row) => row.column_name), expectedColumns, 'view-exposes-exact-columns-in-order');

  verificationStage = 'fresh-schema-preflight';
  for (const tableName of operationalTables) {
    const [[row]] = await connection.query(`SELECT COUNT(*) AS row_count FROM \`${tableName}\``);
    check(Number(row.row_count) === 0, `fresh-schema-table-empty-${tableName}`);
  }
  const [groups] = await connection.query(
    `SELECT blood_group_id, code, display_name FROM BloodGroup ORDER BY blood_group_id`,
  );
  checkEqual(groups.map((row) => [Number(row.blood_group_id), row.code, row.display_name]), expectedGroups, 'canonical-eight-blood-groups');
  const [initialRows] = await connection.query(
    `SELECT blood_group_id, code, display_name, available_unit_count
       FROM v_available_inventory_by_group`,
  );
  checkEqual(normalizedRows(initialRows), [], 'initial-inventory-view-is-empty');
  await assertDatabaseDateStable();

  verificationStage = 'rollback-only-fixture-transaction';
  await connection.beginTransaction();
  transactionStarted = true;
  const token = randomUUID();
  const [actorResult] = await connection.execute(
    `INSERT INTO Account (email, password_hash, role, account_status)
     VALUES (?, ?, 'ADMIN', 'PENDING')`,
    [`inventory-view-actor-${token}@example.invalid`, 'DISPOSABLE_FIXTURE_NOT_A_LOGIN_HASH'],
  );
  const actorId = Number(actorResult.insertId);

  const fixtures = [
    { label: 'future-group-one-tomorrow', groupId: 1, expiryOffset: 1, unitStatus: 'AVAILABLE', outcome: 'COLLECTED', release: 'APPROVED' },
    { label: 'future-group-one-plus-two-days', groupId: 1, expiryOffset: 2, unitStatus: 'AVAILABLE', outcome: 'COLLECTED', release: 'APPROVED' },
    { label: 'future-group-one-plus-three-days', groupId: 1, expiryOffset: 3, unitStatus: 'AVAILABLE', outcome: 'COLLECTED', release: 'APPROVED' },
    { label: 'future-group-two-tomorrow', groupId: 2, expiryOffset: 1, unitStatus: 'AVAILABLE', outcome: 'COLLECTED', release: 'APPROVED' },
    { label: 'expires-today', groupId: 3, expiryOffset: 0, unitStatus: 'AVAILABLE', outcome: 'COLLECTED', release: 'APPROVED' },
    { label: 'expired-yesterday', groupId: 3, expiryOffset: -1, unitStatus: 'AVAILABLE', outcome: 'COLLECTED', release: 'APPROVED' },
    { label: 'allocated-status-excluded', groupId: 4, expiryOffset: 5, unitStatus: 'ALLOCATED', outcome: 'COLLECTED', release: 'APPROVED' },
    { label: 'issued-status-excluded', groupId: 5, expiryOffset: 5, unitStatus: 'ISSUED', outcome: 'COLLECTED', release: 'APPROVED' },
    { label: 'expired-status-excluded', groupId: 6, expiryOffset: 5, unitStatus: 'EXPIRED', outcome: 'COLLECTED', release: 'APPROVED' },
    { label: 'discarded-status-excluded', groupId: 7, expiryOffset: 5, unitStatus: 'DISCARDED', outcome: 'COLLECTED', release: 'APPROVED' },
    { label: 'collected-pending-excluded', groupId: 8, expiryOffset: 5, unitStatus: 'AVAILABLE', outcome: 'COLLECTED', release: 'PENDING' },
    { label: 'collected-rejected-excluded', groupId: 8, expiryOffset: 5, unitStatus: 'AVAILABLE', outcome: 'COLLECTED', release: 'REJECTED' },
    { label: 'incomplete-not-required-excluded', groupId: 8, expiryOffset: 5, unitStatus: 'AVAILABLE', outcome: 'INCOMPLETE', release: 'NOT_REQUIRED' },
    { label: 'deferred-not-required-excluded', groupId: 8, expiryOffset: 5, unitStatus: 'AVAILABLE', outcome: 'DEFERRED', release: 'NOT_REQUIRED' },
  ];

  for (const [index, fixture] of fixtures.entries()) {
    const suffix = `${index + 1}-${token}`;
    const [accountResult] = await connection.execute(
      `INSERT INTO Account (email, password_hash, role, account_status)
       VALUES (?, ?, 'DONOR', 'PENDING')`,
      [`inventory-view-donor-${suffix}@example.invalid`, 'DISPOSABLE_FIXTURE_NOT_A_LOGIN_HASH'],
    );
    const donorId = Number(accountResult.insertId);
    await connection.execute(
      `INSERT INTO Donor (account_id, full_name, date_of_birth, phone, address, area)
       VALUES (?, ?, '1990-01-01', '+91-00000-00000', ?, NULL)`,
      [donorId, `Disposable View Donor ${index + 1}`, `Fixture address ${index + 1}`],
    );
    const slotDay = String(index + 1).padStart(2, '0');
    const [slotResult] = await connection.execute(
      `INSERT INTO DonationSlot (starts_at, ends_at, capacity, created_by_account_id)
       VALUES (?, ?, 1, ?)`,
      [`2040-04-${slotDay} 09:00:00`, `2040-04-${slotDay} 10:00:00`, actorId],
    );
    const [bookingResult] = await connection.execute(
      `INSERT INTO Booking (donor_account_id, slot_id, booking_status)
       VALUES (?, ?, 'CHECKED_IN')`,
      [donorId, Number(slotResult.insertId)],
    );
    const collectedAt = fixture.outcome === 'COLLECTED' ? `${capturedDatabaseDate} 08:00:00` : null;
    const releaseAt = ['APPROVED', 'REJECTED'].includes(fixture.release) ? `${capturedDatabaseDate} 09:00:00` : null;
    const reason = fixture.release === 'REJECTED' ? 'VIEW_TEST_REJECTION' : null;
    const [donationResult] = await connection.execute(
      `INSERT INTO Donation
         (booking_id, recorded_by_account_id, outcome, collected_at, release_status,
          release_decided_at, release_reason_code)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [Number(bookingResult.insertId), actorId, fixture.outcome, collectedAt, fixture.release, releaseAt, reason],
    );
    const expiryDate = dateOffset(capturedDatabaseDate, fixture.expiryOffset);
    const discardedAt = fixture.unitStatus === 'DISCARDED' ? `${capturedDatabaseDate} 10:00:00` : null;
    const discardReason = fixture.unitStatus === 'DISCARDED' ? 'VIEW_TEST_DISCARD' : null;
    await connection.execute(
      `INSERT INTO BloodUnit
         (donation_id, blood_group_id, expiry_date, unit_status, discarded_at, discard_reason_code)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [Number(donationResult.insertId), fixture.groupId, expiryDate, fixture.unitStatus, discardedAt, discardReason],
    );
  }
  check(fixtures.length === 14, 'fourteen-storage-level-view-fixtures-created');

  verificationStage = 'view-result-and-date-boundaries';
  await assertDatabaseDateStable();
  const [actualRows] = await connection.query(
    `SELECT blood_group_id, code, display_name, available_unit_count
       FROM v_available_inventory_by_group`,
  );
  const expectedRows = [
    { blood_group_id: 1, code: 'O-', display_name: 'O negative', available_unit_count: 3 },
    { blood_group_id: 2, code: 'O+', display_name: 'O positive', available_unit_count: 1 },
  ];
  const actualNormalized = normalizedRows(actualRows);
  checkEqual(actualNormalized, expectedRows, 'exact-qualifying-group-rows-and-counts');
  checkEqual(
    actualNormalized.reduce((sum, row) => sum + row.available_unit_count, 0),
    4,
    'exact-total-counted-units',
  );
  check(!actualNormalized.some((row) => [3, 4, 5, 6, 7, 8].includes(row.blood_group_id)), 'zero-qualifying-groups-are-absent');
  await assertDatabaseDateStable();

  verificationStage = 'fixture-rollback';
} catch (error) {
  verificationFailure = error instanceof VerificationAssertion
    ? error.label
    : safeCode(error);
} finally {
  if (transactionStarted) {
    try {
      await connection.rollback();
      transactionStarted = false;
      rollbackSucceeded = true;
      verificationStage = 'post-rollback-view-check';
      const [rowsAfterRollback] = await connection.query(
        `SELECT blood_group_id, code, display_name, available_unit_count
           FROM v_available_inventory_by_group`,
      );
      checkEqual(normalizedRows(rowsAfterRollback), [], 'view-empty-after-fixture-rollback');
      await assertDatabaseDateStable();
    } catch (error) {
      cleanupFailure = `rollback-or-post-rollback-check:${error instanceof VerificationAssertion ? error.label : safeCode(error)}`;
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
  console.error(`Inventory view verification cleanup failed during ${verificationStage}: ${cleanupFailure}.`);
  process.exitCode = 1;
} else if (verificationFailure) {
  console.error(`Inventory view verification failed during ${verificationStage}: ${verificationFailure}.`);
  process.exitCode = 1;
} else if (!rollbackSucceeded) {
  console.error('Inventory view verification failed during fixture-rollback: NO_TRANSACTION_ROLLBACK_CONFIRMED.');
  process.exitCode = 1;
} else {
  console.log('Available inventory view verification passed: 14 disposable storage fixtures matched the date/status/release filters; fixtures rolled back; connection closed.');
}
