import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readDatabaseConfig } from '../../backend/src/config/environment.js';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const backendRequire = createRequire(resolve(repositoryRoot, 'backend/package.json'));
const mysql = backendRequire('mysql2/promise');
const testDatabase = process.env.PHASE3_DONOR_INVENTORY_QUERY_TEST_DATABASE?.trim();
const queryFile = resolve(repositoryRoot, 'database/queries/donor_inventory.sql');
const expectedQueryNames = [
  'donor-donation-history',
  'blood-unit-traceability',
  'donation-search',
  'inventory-search',
  'donation-outcome-counts',
  'inventory-status-counts',
  'approved-collection-to-release-duration',
];
const expectedParameterCounts = [5, 1, 8, 8, 4, 0, 0];

class VerificationFailure extends Error {
  constructor(label) {
    super();
    this.label = label;
  }
}

function check(condition, label) {
  if (!condition) throw new VerificationFailure(label);
}

function checkDeepEqual(actual, expected, label) {
  try {
    assert.deepEqual(actual, expected);
  } catch {
    throw new VerificationFailure(label);
  }
}

function safeCode(error) {
  return typeof error?.code === 'string'
    && /^(?:ER_[A-Z0-9_]+|ECONN[A-Z0-9_]*|ETIMEDOUT|EPIPE|EAI_AGAIN|ENOTFOUND|PROTOCOL_[A-Z0-9_]+)$/.test(error.code)
    ? error.code
    : 'ASSERTION_FAILED';
}

function readCanonicalQueries() {
  const contents = readFileSync(queryFile, 'utf8');
  const sections = new Map();
  let currentName;
  let currentLines = [];

  function saveCurrent() {
    if (!currentName) return;
    const sql = currentLines
      .filter((line) => !/^\s*--/.test(line))
      .join('\n')
      .trim()
      .replace(/;+\s*$/, '');
    check(sql.length > 0, `query-section-empty-${currentName}`);
    check(/^SELECT\b/i.test(sql), `query-section-not-select-${currentName}`);
    check(!sections.has(currentName), `duplicate-query-section-${currentName}`);
    sections.set(currentName, sql);
  }

  for (const line of contents.split(/\r?\n/)) {
    const marker = line.match(/^\s*--\s*query:\s*([a-z0-9-]+)\s*$/i);
    if (marker) {
      saveCurrent();
      currentName = marker[1];
      currentLines = [];
    } else if (currentName) {
      currentLines.push(line);
    }
  }
  saveCurrent();

  checkDeepEqual([...sections.keys()], expectedQueryNames, 'query-name-set-and-order');
  for (const [index, name] of expectedQueryNames.entries()) {
    check((sections.get(name).match(/\?/g) ?? []).length === expectedParameterCounts[index], `query-parameter-count-${name}`);
  }
  return sections;
}

function normalizeHistory(rows) {
  return rows.map((row) => ({
    donor_account_id: Number(row.donor_account_id),
    donor_name: row.donor_name,
    booking_id: Number(row.booking_id),
    booking_status: row.booking_status,
    slot_id: Number(row.slot_id),
    slot_starts_at: row.slot_starts_at,
    slot_ends_at: row.slot_ends_at,
    donation_id: Number(row.donation_id),
    outcome: row.outcome,
    collected_at: row.collected_at,
    release_status: row.release_status,
    release_decided_at: row.release_decided_at,
  }));
}

function normalizeDonationSearch(rows) {
  return rows.map((row) => ({
    donation_id: Number(row.donation_id),
    booking_id: Number(row.booking_id),
    donor_account_id: Number(row.donor_account_id),
    outcome: row.outcome,
    collected_at: row.collected_at,
    release_status: row.release_status,
    release_decided_at: row.release_decided_at,
  }));
}

function normalizeInventorySearch(rows) {
  return rows.map((row) => ({
    blood_unit_id: Number(row.blood_unit_id),
    blood_group_id: Number(row.blood_group_id),
    blood_group_code: row.blood_group_code,
    blood_group_name: row.blood_group_name,
    expiry_date: row.expiry_date,
    unit_status: row.unit_status,
    donation_id: Number(row.donation_id),
    donation_outcome: row.donation_outcome,
    release_status: row.release_status,
  }));
}

function normalizeIds(rows, field) {
  return rows.map((row) => Number(row[field]));
}

let verificationStage = 'configuration';
let verificationFailure;
let cleanupFailure;
let connection;
let transactionStarted = false;
let rollbackSucceeded = false;
let fixtures;
const results = new Map();

try {
  check(/^bddc_phase3_test_donor_inventory_queries_[a-z0-9_]+$/i.test(testDatabase ?? ''), 'explicit-disposable-database-name');
  const queries = readCanonicalQueries();
  const databaseConfig = readDatabaseConfig({
    ...process.env,
    DB_USER: process.env.PHASE3_TEST_DB_USER || process.env.DB_USER,
    DB_PASSWORD: process.env.PHASE3_TEST_DB_PASSWORD || process.env.DB_PASSWORD,
    DB_NAME: testDatabase,
  });
  check(Boolean(databaseConfig.options), 'database-connection-settings-present');
  check(['localhost', '127.0.0.1', '::1'].includes(databaseConfig.options.host.toLowerCase()), 'loopback-host-only');

  connection = await mysql.createConnection({ ...databaseConfig.options, dateStrings: true, multipleStatements: false });
  verificationStage = 'selected-schema-and-time-zone';
  await connection.query("SET time_zone = '+05:30'");
  const [[databaseRow]] = await connection.query('SELECT DATABASE() AS selected_database');
  check(databaseRow.selected_database === testDatabase, 'explicit-disposable-schema-selected');

  verificationStage = 'fresh-schema-preflight';
  const operationalTables = ['Account', 'Donor', 'DonationSlot', 'Booking', 'EligibilityDecision', 'Donation', 'BloodUnit'];
  for (const tableName of operationalTables) {
    const [[row]] = await connection.query(`SELECT COUNT(*) AS row_count FROM \`${tableName}\``);
    check(Number(row.row_count) === 0, `fresh-table-empty-${tableName}`);
  }
  const [groups] = await connection.query(
    'SELECT blood_group_id, code, display_name FROM BloodGroup ORDER BY blood_group_id',
  );
  checkDeepEqual(groups.map((row) => [Number(row.blood_group_id), row.code, row.display_name]), [
    [1, 'O-', 'O negative'], [2, 'O+', 'O positive'],
    [3, 'A-', 'A negative'], [4, 'A+', 'A positive'],
    [5, 'B-', 'B negative'], [6, 'B+', 'B positive'],
    [7, 'AB-', 'AB negative'], [8, 'AB+', 'AB positive'],
  ], 'canonical-eight-blood-groups');

  verificationStage = 'empty-schema-query-results';
  const emptySearch = await connection.execute(queries.get('donation-search'), [null, null, null, null, null, null, null, null]);
  checkDeepEqual(emptySearch[0], [], 'empty-donation-search');
  checkDeepEqual((await connection.execute(queries.get('inventory-search'), [null, null, null, null, null, null, null, null]))[0], [], 'empty-inventory-search');
  checkDeepEqual((await connection.execute(queries.get('donation-outcome-counts'), [null, null, null, null]))[0], [], 'empty-donation-outcome-counts');
  checkDeepEqual((await connection.execute(queries.get('inventory-status-counts'), []))[0], [], 'empty-inventory-status-counts');
  const [emptyDurationRows] = await connection.execute(queries.get('approved-collection-to-release-duration'), []);
  const emptyDuration = emptyDurationRows[0];
  check(Number(emptyDuration.eligible_donation_count) === 0, 'empty-duration-count-zero');
  check(emptyDuration.average_elapsed_hours === null, 'empty-duration-average-null');

  verificationStage = 'rollback-only-fixture-transaction';
  await connection.beginTransaction();
  transactionStarted = true;
  const token = randomUUID();
  const [adminResult] = await connection.execute(
    `INSERT INTO Account (email, password_hash, role, account_status)
     VALUES (?, ?, 'ADMIN', 'PENDING')`,
    [`query-demo-admin-${token}@example.invalid`, 'DISPOSABLE_FIXTURE_NOT_A_LOGIN_HASH'],
  );
  const adminId = Number(adminResult.insertId);
  const donorIds = [];
  for (let index = 0; index < 3; index += 1) {
    const [accountResult] = await connection.execute(
      `INSERT INTO Account (email, password_hash, role, account_status)
       VALUES (?, ?, 'DONOR', 'PENDING')`,
      [`query-demo-donor-${index + 1}-${token}@example.invalid`, 'DISPOSABLE_FIXTURE_NOT_A_LOGIN_HASH'],
    );
    const donorId = Number(accountResult.insertId);
    donorIds.push(donorId);
    await connection.execute(
      `INSERT INTO Donor (account_id, full_name, date_of_birth, phone, address, area)
       VALUES (?, ?, '1990-01-01', '+91-00000-00000', ?, NULL)`,
      [donorId, `Query Demo Donor ${index + 1}`, `Disposable query fixture address ${index + 1}`],
    );
  }

  const donationSpecs = [
    { donorIndex: 0, outcome: 'COLLECTED', collectedAt: '2040-06-20 09:00:00', release: 'APPROVED', releaseAt: '2040-06-20 10:30:00', reason: null, unit: { groupId: 1, expiry: '2040-07-01', status: 'AVAILABLE' } },
    { donorIndex: 0, outcome: 'COLLECTED', collectedAt: '2040-06-21 00:00:00', release: 'PENDING', releaseAt: null, reason: null, unit: { groupId: 1, expiry: '2040-06-30', status: 'ALLOCATED' } },
    { donorIndex: 0, outcome: 'INCOMPLETE', collectedAt: null, release: 'NOT_REQUIRED', releaseAt: null, reason: null, unit: null },
    { donorIndex: 1, outcome: 'COLLECTED', collectedAt: '2040-06-21 23:59:59', release: 'APPROVED', releaseAt: '2040-06-22 02:14:59', reason: null, unit: { groupId: 2, expiry: '2040-07-02', status: 'AVAILABLE' } },
    { donorIndex: 1, outcome: 'COLLECTED', collectedAt: '2040-06-22 00:00:00', release: 'REJECTED', releaseAt: '2040-06-23 01:00:00', reason: 'QUERY_TEST_REJECTION', unit: { groupId: 1, expiry: '2040-06-29', status: 'DISCARDED' } },
    { donorIndex: 1, outcome: 'DEFERRED', collectedAt: null, release: 'NOT_REQUIRED', releaseAt: null, reason: null, unit: null },
    { donorIndex: 2, outcome: 'COLLECTED', collectedAt: '2040-06-22 12:00:00', release: 'APPROVED', releaseAt: '2040-06-22 14:00:00', reason: null, unit: { groupId: 3, expiry: '2040-06-28', status: 'EXPIRED' } },
    { donorIndex: 2, outcome: 'COLLECTED', collectedAt: '2040-06-23 12:00:00', release: 'APPROVED', releaseAt: '2040-06-23 12:45:00', reason: null, unit: { groupId: 1, expiry: '2040-07-03', status: 'ISSUED' } },
  ];
  const bookingIds = [];
  const slotIds = [];
  const donationIds = [];
  const unitIds = [];
  for (const [index, spec] of donationSpecs.entries()) {
    const slotDay = String(index + 1).padStart(2, '0');
    const [slotResult] = await connection.execute(
      `INSERT INTO DonationSlot (starts_at, ends_at, capacity, created_by_account_id)
       VALUES (?, ?, 1, ?)`,
      [`2040-04-${slotDay} 09:00:00`, `2040-04-${slotDay} 10:00:00`, adminId],
    );
    const slotId = Number(slotResult.insertId);
    slotIds.push(slotId);
    const [bookingResult] = await connection.execute(
      `INSERT INTO Booking (donor_account_id, slot_id, booking_status)
       VALUES (?, ?, 'COMPLETED')`,
      [donorIds[spec.donorIndex], slotId],
    );
    const bookingId = Number(bookingResult.insertId);
    bookingIds.push(bookingId);
    const [donationResult] = await connection.execute(
      `INSERT INTO Donation
         (booking_id, recorded_by_account_id, outcome, collected_at, release_status,
          release_decided_at, release_reason_code)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [bookingId, adminId, spec.outcome, spec.collectedAt, spec.release, spec.releaseAt, spec.reason],
    );
    const donationId = Number(donationResult.insertId);
    donationIds.push(donationId);
    if (spec.unit) {
      const discardedAt = spec.unit.status === 'DISCARDED' ? '2040-06-24 10:00:00' : null;
      const discardReason = spec.unit.status === 'DISCARDED' ? 'QUERY_TEST_DISCARD' : null;
      const [unitResult] = await connection.execute(
        `INSERT INTO BloodUnit
           (donation_id, blood_group_id, expiry_date, unit_status, discarded_at, discard_reason_code)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [donationId, spec.unit.groupId, spec.unit.expiry, spec.unit.status, discardedAt, discardReason],
      );
      unitIds.push(Number(unitResult.insertId));
    }
  }
  fixtures = { token, donorIds, bookingIds, slotIds, donationIds, unitIds, donationSpecs };

  async function query(name, parameters, normalize = (rows) => rows) {
    const [rows] = await connection.execute(queries.get(name), parameters);
    return normalize(rows);
  }

  verificationStage = 'donor-donation-history';
  const expectedHistory = (donorIndex, specIndexes) => specIndexes.map((index) => {
    const spec = donationSpecs[index];
    return {
      donor_account_id: donorIds[donorIndex],
      donor_name: `Query Demo Donor ${donorIndex + 1}`,
      booking_id: bookingIds[index],
      booking_status: 'COMPLETED',
      slot_id: slotIds[index],
      slot_starts_at: `2040-04-${String(index + 1).padStart(2, '0')} 09:00:00`,
      slot_ends_at: `2040-04-${String(index + 1).padStart(2, '0')} 10:00:00`,
      donation_id: donationIds[index],
      outcome: spec.outcome,
      collected_at: spec.collectedAt,
      release_status: spec.release,
      release_decided_at: spec.releaseAt,
    };
  });
  const historyDonorA = await query('donor-donation-history', [donorIds[0], null, null, null, null], normalizeHistory);
  checkDeepEqual(historyDonorA, expectedHistory(0, [1, 0, 2]), 'history-donor-a-isolation-and-three-rows');
  checkDeepEqual(await query('donor-donation-history', [donorIds[1], null, null, null, null], normalizeHistory), expectedHistory(1, [4, 3, 5]), 'history-donor-b-isolation');
  checkDeepEqual(await query('donor-donation-history', [donorIds[0], '2040-06-21 00:00:00', '2040-06-21 00:00:00', null, null], normalizeHistory), expectedHistory(0, [1]), 'history-lower-bound-only');
  checkDeepEqual(await query('donor-donation-history', [donorIds[0], null, null, '2040-06-21 00:00:00', '2040-06-21 00:00:00'], normalizeHistory), expectedHistory(0, [0]), 'history-upper-bound-only');
  checkDeepEqual(await query('donor-donation-history', [donorIds[0], '2040-06-20 09:00:00', '2040-06-20 09:00:00', '2040-06-21 00:00:00', '2040-06-21 00:00:00'], normalizeHistory), expectedHistory(0, [0]), 'history-lower-inclusive-upper-exclusive');

  verificationStage = 'blood-unit-traceability';
  const [traceRows] = await connection.execute(queries.get('blood-unit-traceability'), [unitIds[0]]);
  check(traceRows.length === 1, 'traceability-one-row');
  const trace = traceRows[0];
  checkDeepEqual({
    blood_unit_id: Number(trace.blood_unit_id), blood_group_id: Number(trace.blood_group_id),
    blood_group_code: trace.blood_group_code, blood_group_name: trace.blood_group_name,
    unit_status: trace.unit_status, expiry_date: trace.expiry_date,
    donation_id: Number(trace.donation_id), booking_id: Number(trace.booking_id),
    donor_account_id: Number(trace.donor_account_id), collected_at: trace.collected_at,
    release_status: trace.release_status,
  }, {
    blood_unit_id: unitIds[0], blood_group_id: 1, blood_group_code: 'O-', blood_group_name: 'O negative',
    unit_status: 'AVAILABLE', expiry_date: '2040-07-01', donation_id: donationIds[0],
    booking_id: bookingIds[0], donor_account_id: donorIds[0], collected_at: '2040-06-20 09:00:00',
    release_status: 'APPROVED',
  }, 'traceability-identifiers-and-fields');
  const [missingUnitRows] = await connection.execute(queries.get('blood-unit-traceability'), [unitIds.at(-1) + 1]);
  checkDeepEqual(missingUnitRows, [], 'missing-unit-has-no-result');

  verificationStage = 'donation-search';
  checkDeepEqual(await query('donation-search', [null, null, null, null, null, null, null, null], normalizeDonationSearch), [7,6,4,3,1,0,5,2].map((index) => ({
    donation_id: donationIds[index], booking_id: bookingIds[index], donor_account_id: donorIds[donationSpecs[index].donorIndex],
    outcome: donationSpecs[index].outcome, collected_at: donationSpecs[index].collectedAt,
    release_status: donationSpecs[index].release, release_decided_at: donationSpecs[index].releaseAt,
  })), 'donation-search-all-one-row-per-donation');
  checkDeepEqual(await query('donation-search', [donorIds[0], donorIds[0], null, null, null, null, null, null], normalizeDonationSearch).then((rows) => normalizeIds(rows, 'donation_id')), [donationIds[1], donationIds[0], donationIds[2]], 'donation-search-donor-filter');
  checkDeepEqual(await query('donation-search', [null, null, 'COLLECTED', 'COLLECTED', null, null, null, null], normalizeDonationSearch).then((rows) => normalizeIds(rows, 'donation_id')), [donationIds[0], donationIds[1], donationIds[3], donationIds[4], donationIds[6], donationIds[7]].reverse(), 'donation-search-outcome-filter');
  checkDeepEqual(await query('donation-search', [null, null, null, null, '2040-06-21 00:00:00', '2040-06-21 00:00:00', null, null], normalizeDonationSearch).then((rows) => normalizeIds(rows, 'donation_id')), [donationIds[1], donationIds[3], donationIds[4], donationIds[6], donationIds[7]].reverse(), 'donation-search-lower-bound-only');
  checkDeepEqual(await query('donation-search', [null, null, null, null, null, null, '2040-06-21 00:00:00', '2040-06-21 00:00:00'], normalizeDonationSearch).then((rows) => normalizeIds(rows, 'donation_id')), [donationIds[0]], 'donation-search-upper-bound-only');
  checkDeepEqual(await query('donation-search', [donorIds[1], donorIds[1], 'COLLECTED', 'COLLECTED', '2040-06-21 00:00:00', '2040-06-21 00:00:00', '2040-06-22 00:00:00', '2040-06-22 00:00:00'], normalizeDonationSearch).then((rows) => normalizeIds(rows, 'donation_id')), [donationIds[3]], 'donation-search-combined-filters-and-boundaries');

  verificationStage = 'inventory-search';
  const allInventory = await query('inventory-search', [null, null, null, null, null, null, null, null], normalizeInventorySearch);
  checkDeepEqual(allInventory.map((row) => row.blood_unit_id), [unitIds[4], unitIds[3], unitIds[1], unitIds[0], unitIds[2], unitIds[5]], 'inventory-search-one-row-per-unit-and-order');
  checkDeepEqual([...new Set(allInventory.map((row) => row.unit_status))].sort(), ['ALLOCATED', 'AVAILABLE', 'DISCARDED', 'EXPIRED', 'ISSUED'], 'inventory-search-includes-all-statuses');
  checkDeepEqual(await query('inventory-search', [1, 1, null, null, null, null, null, null], normalizeInventorySearch).then((rows) => normalizeIds(rows, 'blood_unit_id')), [unitIds[3], unitIds[1], unitIds[0], unitIds[5]], 'inventory-search-group-filter');
  checkDeepEqual(await query('inventory-search', [null, null, 'AVAILABLE', 'AVAILABLE', null, null, null, null], normalizeInventorySearch).then((rows) => normalizeIds(rows, 'blood_unit_id')), [unitIds[0], unitIds[2]], 'inventory-search-status-filter');
  checkDeepEqual(await query('inventory-search', [null, null, null, null, '2040-06-30', '2040-06-30', null, null], normalizeInventorySearch).then((rows) => normalizeIds(rows, 'blood_unit_id')), [unitIds[1], unitIds[0], unitIds[2], unitIds[5]], 'inventory-search-inclusive-lower-date');
  checkDeepEqual(await query('inventory-search', [null, null, null, null, null, null, '2040-06-30', '2040-06-30'], normalizeInventorySearch).then((rows) => normalizeIds(rows, 'blood_unit_id')), [unitIds[4], unitIds[3], unitIds[1]], 'inventory-search-inclusive-upper-date');
  checkDeepEqual(await query('inventory-search', [1, 1, 'AVAILABLE', 'AVAILABLE', '2040-06-30', '2040-06-30', '2040-07-01', '2040-07-01'], normalizeInventorySearch).then((rows) => normalizeIds(rows, 'blood_unit_id')), [unitIds[0]], 'inventory-search-combined-filters');
  checkDeepEqual(await query('inventory-search', [null, null, 'NO_SUCH_STATUS', 'NO_SUCH_STATUS', null, null, null, null], normalizeInventorySearch), [], 'inventory-search-no-match');

  verificationStage = 'donation-outcome-counts';
  const normalizeOutcomeCounts = (rows) => rows.map((row) => ({ outcome: row.outcome, donation_count: Number(row.donation_count) }));
  const outcomeCounts = await query('donation-outcome-counts', [null, null, null, null], normalizeOutcomeCounts);
  checkDeepEqual(outcomeCounts, [
    { outcome: 'COLLECTED', donation_count: 6 }, { outcome: 'DEFERRED', donation_count: 1 }, { outcome: 'INCOMPLETE', donation_count: 1 },
  ], 'outcome-counts-exact');
  checkDeepEqual(outcomeCounts.reduce((sum, row) => sum + row.donation_count, 0), donationIds.length, 'outcome-counts-sum-to-donation-total');
  checkDeepEqual(await query('donation-outcome-counts', ['2040-06-21 00:00:00', '2040-06-21 00:00:00', '2040-06-22 00:00:00', '2040-06-22 00:00:00'], normalizeOutcomeCounts), [
    { outcome: 'COLLECTED', donation_count: 2 },
  ], 'outcome-counts-exclusive-upper-bound-and-null-exclusion');
  checkDeepEqual(await query('donation-outcome-counts', ['2040-06-22 00:00:00', '2040-06-22 00:00:00', null, null], normalizeOutcomeCounts), [
    { outcome: 'COLLECTED', donation_count: 3 },
  ], 'outcome-counts-lower-bound-only');
  checkDeepEqual(await query('donation-outcome-counts', [null, null, '2040-06-21 00:00:00', '2040-06-21 00:00:00'], normalizeOutcomeCounts), [
    { outcome: 'COLLECTED', donation_count: 1 },
  ], 'outcome-counts-upper-bound-only');
  checkDeepEqual((await connection.execute(queries.get('donation-outcome-counts'), ['2040-07-01 00:00:00', '2040-07-01 00:00:00', '2040-07-02 00:00:00', '2040-07-02 00:00:00']))[0], [], 'outcome-counts-empty-window');

  verificationStage = 'inventory-status-counts';
  const normalizeStatusCounts = (rows) => rows.map((row) => ({
    blood_group_id: Number(row.blood_group_id), blood_group_code: row.blood_group_code,
    blood_group_name: row.blood_group_name, unit_status: row.unit_status, unit_count: Number(row.unit_count),
  }));
  const statusCounts = await query('inventory-status-counts', [], normalizeStatusCounts);
  checkDeepEqual(statusCounts, [
    { blood_group_id: 1, blood_group_code: 'O-', blood_group_name: 'O negative', unit_status: 'ALLOCATED', unit_count: 1 },
    { blood_group_id: 1, blood_group_code: 'O-', blood_group_name: 'O negative', unit_status: 'AVAILABLE', unit_count: 1 },
    { blood_group_id: 1, blood_group_code: 'O-', blood_group_name: 'O negative', unit_status: 'DISCARDED', unit_count: 1 },
    { blood_group_id: 1, blood_group_code: 'O-', blood_group_name: 'O negative', unit_status: 'ISSUED', unit_count: 1 },
    { blood_group_id: 2, blood_group_code: 'O+', blood_group_name: 'O positive', unit_status: 'AVAILABLE', unit_count: 1 },
    { blood_group_id: 3, blood_group_code: 'A-', blood_group_name: 'A negative', unit_status: 'EXPIRED', unit_count: 1 },
  ], 'inventory-status-counts-exact');
  checkDeepEqual(statusCounts.reduce((sum, row) => sum + row.unit_count, 0), unitIds.length, 'inventory-status-counts-sum-to-unit-total');

  verificationStage = 'approved-collection-to-release-duration';
  const [durationRows] = await connection.execute(queries.get('approved-collection-to-release-duration'), []);
  const duration = durationRows[0];
  check(Number(duration.eligible_donation_count) === 4, 'approved-duration-eligible-count');
  check(Math.abs(Number(duration.average_elapsed_hours) - 1.625) < 1e-12, 'approved-duration-fractional-hour-average');

  verificationStage = 'fixture-rollback';
} catch (error) {
  verificationFailure = error instanceof VerificationFailure ? error.label : safeCode(error);
} finally {
  if (transactionStarted) {
    try {
      await connection.rollback();
      transactionStarted = false;
      rollbackSucceeded = true;
      verificationStage = 'post-rollback-empty-state';
      for (const tableName of ['Account', 'Donor', 'DonationSlot', 'Booking', 'EligibilityDecision', 'Donation', 'BloodUnit']) {
        const [[row]] = await connection.query(`SELECT COUNT(*) AS row_count FROM \`${tableName}\``);
        check(Number(row.row_count) === 0, `post-rollback-empty-${tableName}`);
      }
      if (fixtures) {
        checkDeepEqual((await connection.execute('SELECT account_id FROM Account WHERE email LIKE ?', [`query-demo-%-${fixtures.token}@example.invalid`]))[0], [], 'synthetic-account-fixtures-absent-after-rollback');
      }
      checkDeepEqual((await connection.execute('SELECT outcome, COUNT(*) AS row_count FROM Donation GROUP BY outcome'))[0], [], 'donation-table-empty-after-rollback');
    } catch (error) {
      cleanupFailure = `rollback-or-empty-state:${error instanceof VerificationFailure ? error.label : safeCode(error)}`;
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
  console.error(`Donor/inventory query verification cleanup failed during ${verificationStage}: ${cleanupFailure}.`);
  process.exitCode = 1;
} else if (verificationFailure) {
  console.error(`Donor/inventory query verification failed during ${verificationStage}: ${verificationFailure}.`);
  process.exitCode = 1;
} else if (!rollbackSucceeded) {
  console.error('Donor/inventory query verification failed during fixture-rollback: NO_TRANSACTION_ROLLBACK_CONFIRMED.');
  process.exitCode = 1;
} else {
  console.log('Donor/inventory query verification passed: seven canonical queries and fixture assertions succeeded; synthetic data rolled back; connection closed.');
}
