import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { resolve, relative, isAbsolute, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mysqlStatements } from './helpers/mysql-script.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const testDatabase = process.env.PHASE3_FEATURE8_TEST_DATABASE?.trim();
const testDirectory = process.env.PHASE3_FEATURE8_TEST_DATA_DIRECTORY?.trim();
const host = process.env.DB_HOST?.trim().toLowerCase();
const port = Number(process.env.DB_PORT);
const user = process.env.PHASE3_FEATURE8_TEST_DB_USER;
const password = process.env.PHASE3_FEATURE8_TEST_DB_PASSWORD;
assert.match(testDatabase ?? '', /^bddc_phase3_test_feature8_[a-z0-9_]+$/i, 'specific disposable database required');
assert.ok(host === '127.0.0.1' && Number.isInteger(port) && port > 0 && port !== 3306, 'loopback nondefault port required');
assert.ok(testDirectory && relative(resolve(root, '.tmp'), resolve(testDirectory))
  && !relative(resolve(root, '.tmp'), resolve(testDirectory)).startsWith('..')
  && !isAbsolute(relative(resolve(root, '.tmp'), resolve(testDirectory))), 'isolated workspace datadir required');
assert.equal(user, 'root', 'fresh isolated instance identity required');
assert.equal(password, '', 'fresh isolated instance has an empty bootstrap password only');
const mysql = createRequire(resolve(root, 'backend/package.json'))('mysql2/promise');
const migration = await readFile(resolve(root, 'database/migrations/009_compatibility_allocation.sql'), 'utf8');
const connection = await mysql.createConnection({ host, port, user, password, database: testDatabase,
  timezone: '+05:30', supportBigNumbers: true, bigNumberStrings: true });
const expectCode = async (work, codes) => {
  await assert.rejects(work, (error) => codes.includes(error.code));
};
try {
  const [[server]] = await connection.query('SELECT @@datadir AS directory, @@port AS port, DATABASE() AS schema_name');
  assert.equal(resolve(server.directory).toLowerCase(), resolve(testDirectory, 'data').toLowerCase());
  assert.equal(Number(server.port), port); assert.equal(server.schema_name, testDatabase);
  const [before] = await connection.query(`SELECT LOWER(TABLE_NAME) AS name FROM information_schema.TABLES
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE'`);
  assert.equal(before.some((row) => ['bloodcompatibility', 'allocation'].includes(row.name)), false);
  const snapshotObjects = async () => {
    const [rows] = await connection.query(`SELECT CONCAT('TABLE:', TABLE_TYPE, ':', LOWER(TABLE_NAME)) AS object_name
        FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()
      UNION ALL SELECT CONCAT('TRIGGER:', LOWER(TRIGGER_NAME)) FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA = DATABASE()
      UNION ALL SELECT CONCAT('ROUTINE:', ROUTINE_TYPE, ':', LOWER(ROUTINE_NAME)) FROM information_schema.ROUTINES WHERE ROUTINE_SCHEMA = DATABASE()
      UNION ALL SELECT CONCAT('EVENT:', LOWER(EVENT_NAME)) FROM information_schema.EVENTS WHERE EVENT_SCHEMA = DATABASE()`);
    return rows.map((row) => row.object_name).sort();
  };
  const beforeObjects = await snapshotObjects();

  const groups = ['O-', 'O+', 'A-', 'A+', 'B-', 'B+', 'AB-', 'AB+'];
  const expected = new Map([
    ['O-', groups], ['O+', ['O+', 'A+', 'B+', 'AB+']], ['A-', ['A-', 'A+', 'AB-', 'AB+']],
    ['A+', ['A+', 'AB+']], ['B-', ['B-', 'B+', 'AB-', 'AB+']], ['B+', ['B+', 'AB+']],
    ['AB-', ['AB-', 'AB+']], ['AB+', ['AB+']],
  ]);
  for (const sql of mysqlStatements(migration)) await connection.query(sql);
  const [pairs] = await connection.query(`SELECT d.code AS donor, r.code AS recipient, c.is_compatible AS compatible
    FROM BloodCompatibility c JOIN BloodGroup d ON d.blood_group_id = c.donor_group_id
    JOIN BloodGroup r ON r.blood_group_id = c.recipient_group_id ORDER BY c.donor_group_id, c.recipient_group_id`);
  assert.equal(pairs.length, 64); assert.equal(pairs.filter((row) => Number(row.compatible) === 1).length, 27);
  for (const row of pairs) assert.equal(Number(row.compatible), expected.get(row.donor).includes(row.recipient) ? 1 : 0,
    `${row.donor} donor -> ${row.recipient} recipient`);

  const [objectsAfter] = await connection.query(`SELECT LOWER(TABLE_NAME) AS name FROM information_schema.TABLES
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE'`);
  assert.deepEqual(objectsAfter.map((row) => row.name).filter((name) => !before.some((old) => old.name === name)).sort(),
    ['allocation', 'bloodcompatibility']);
  const afterObjects = await snapshotObjects();
  assert.deepEqual(afterObjects.filter((name) => !beforeObjects.includes(name)),
    ['TABLE:BASE TABLE:allocation', 'TABLE:BASE TABLE:bloodcompatibility']);
  assert.deepEqual(beforeObjects.filter((name) => !afterObjects.includes(name)), []);
  const [constraints] = await connection.query(`SELECT LOWER(tc.TABLE_NAME) AS table_name, tc.CONSTRAINT_NAME AS name,
      tc.CONSTRAINT_TYPE AS kind FROM information_schema.TABLE_CONSTRAINTS tc
    WHERE tc.CONSTRAINT_SCHEMA = DATABASE() AND LOWER(tc.TABLE_NAME) IN ('bloodcompatibility', 'allocation')`);
  const has = (table, name, type) => assert.ok(constraints.some((x) => x.table_name === table && x.name === name && x.kind === type), `${table}.${name} ${type}`);
  has('bloodcompatibility', 'PRIMARY', 'PRIMARY KEY');
  has('bloodcompatibility', 'fk_compatibility_donor', 'FOREIGN KEY'); has('bloodcompatibility', 'fk_compatibility_recipient', 'FOREIGN KEY');
  for (const name of ['ck_compatibility_boolean', 'ck_allocation_status', 'ck_allocation_issued_at',
    'ck_allocation_cancelled_at', 'ck_allocation_cancel_reason']) has(name.startsWith('ck_compatibility') ? 'bloodcompatibility' : 'allocation', name, 'CHECK');
  has('allocation', 'PRIMARY', 'PRIMARY KEY'); has('allocation', 'uq_allocation_active_blood_unit', 'UNIQUE');
  for (const name of ['fk_allocation_request', 'fk_allocation_unit', 'fk_allocation_actor']) has('allocation', name, 'FOREIGN KEY');
  const [uniqueColumn] = await connection.query(`SELECT COLUMN_NAME, EXTRA, GENERATION_EXPRESSION FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Allocation' AND COLUMN_NAME = 'active_blood_unit_id'`);
  assert.equal(uniqueColumn.length, 1); assert.match(uniqueColumn[0].EXTRA, /STORED GENERATED/i);
  assert.match(uniqueColumn[0].GENERATION_EXPRESSION, /allocation_status/i);
  const [fkRules] = await connection.query(`SELECT CONSTRAINT_NAME, DELETE_RULE, UPDATE_RULE
    FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE()
    AND CONSTRAINT_NAME IN ('fk_compatibility_donor','fk_compatibility_recipient','fk_allocation_request','fk_allocation_unit','fk_allocation_actor')`);
  assert.equal(fkRules.length, 5); for (const row of fkRules) { assert.equal(row.DELETE_RULE, 'RESTRICT'); assert.equal(row.UPDATE_RULE, 'RESTRICT'); }

  await connection.execute(`INSERT INTO Account (account_id,email,password_hash,role,account_status) VALUES
    (1,'admin@example.test','fixture','ADMIN','ACTIVE'),(2,'hospital@example.test','fixture','HOSPITAL','ACTIVE'),
    (3,'donor@example.test','fixture','DONOR','ACTIVE')`);
  await connection.execute(`INSERT INTO Hospital (account_id,organization_name,contact_name,phone,address) VALUES (2,'Fixture Hospital','Contact','123','Test')`);
  await connection.execute(`INSERT INTO Donor (account_id,full_name,date_of_birth,phone,address,confirmed_blood_group_id)
    VALUES (3,'Fixture Donor','1990-01-01','123','Test',1)`);
  await connection.execute(`INSERT INTO DonationSlot (slot_id,starts_at,ends_at,capacity,created_by_account_id)
    VALUES (1,'2026-10-01 09:00:00','2026-10-01 10:00:00',1,1),
      (2,'2026-10-02 09:00:00','2026-10-02 10:00:00',1,1)`);
  await connection.execute(`INSERT INTO Booking (booking_id,donor_account_id,slot_id) VALUES (1,3,1),(2,3,2)`);
  await connection.execute(`INSERT INTO Donation (donation_id,booking_id,recorded_by_account_id,outcome,collected_at,
    release_status,release_decided_at) VALUES
    (1,1,1,'COLLECTED','2026-10-01 09:30:00','APPROVED','2026-10-01 12:00:00'),
    (2,2,1,'COLLECTED','2026-10-02 09:30:00','APPROVED','2026-10-02 12:00:00')`);
  await connection.execute(`INSERT INTO BloodUnit (blood_unit_id,donation_id,blood_group_id,expiry_date) VALUES
    (1,1,1,'2026-11-01'),(2,2,2,'2026-12-01')`);
  await connection.execute(`INSERT INTO HospitalRequest (request_id,hospital_account_id,recipient_group_id,quantity_requested,
    needed_by,request_status) VALUES (1,2,8,2,'2026-11-01 09:00:00','SUBMITTED'),(2,2,8,2,'2026-11-02 09:00:00','SUBMITTED')`);

  await connection.execute(`INSERT INTO Allocation (allocation_id,request_id,blood_unit_id,allocated_by_account_id)
    VALUES (1,1,1,1)`);
  await expectCode(() => connection.execute(`INSERT INTO Allocation (request_id,blood_unit_id,allocated_by_account_id)
    VALUES (2,1,1)`), ['ER_DUP_ENTRY']);
  await connection.execute(`UPDATE Allocation SET allocation_status='CANCELLED',cancelled_at=CURRENT_TIMESTAMP,
    cancellation_reason_code='TEST_RELEASE' WHERE allocation_id=1`);
  await connection.execute(`INSERT INTO Allocation (allocation_id,request_id,blood_unit_id,allocated_by_account_id)
    VALUES (2,2,1,1)`);
  const [[history]] = await connection.execute('SELECT COUNT(*) AS n FROM Allocation WHERE blood_unit_id=1');
  assert.equal(Number(history.n), 2, 'cancelled historical allocation remains after reallocation');
  await expectCode(() => connection.execute(`INSERT INTO Allocation (request_id,blood_unit_id,allocated_by_account_id,
    allocation_status,issued_at) VALUES (1,2,1,'ALLOCATED',CURRENT_TIMESTAMP)`), ['ER_CHECK_CONSTRAINT_VIOLATED']);
  await expectCode(() => connection.execute(`INSERT INTO Allocation (request_id,blood_unit_id,allocated_by_account_id)
    VALUES (999,2,1)`), ['ER_NO_REFERENCED_ROW_2']);
  await connection.beginTransaction();
  await connection.execute("UPDATE BloodUnit SET unit_status='ALLOCATED' WHERE blood_unit_id=1");
  await connection.execute(`INSERT INTO Allocation (request_id,blood_unit_id,allocated_by_account_id) VALUES (1,2,1)`);
  await connection.rollback();
  const [[unit]] = await connection.execute('SELECT unit_status FROM BloodUnit WHERE blood_unit_id=1');
  assert.equal(unit.unit_status, 'AVAILABLE', 'business fixture update rolled back');
  const [[allocCount]] = await connection.execute('SELECT COUNT(*) AS n FROM Allocation WHERE blood_unit_id=2 AND allocation_status="ALLOCATED"');
  assert.equal(Number(allocCount.n), 0, 'transaction rollback leaves no allocation insert');
  console.log('Feature 8 disposable checks passed: 64/27 matrix, 10 metadata/constraint groups, active duplicate rejection, cancelled history/reallocation, checks/FKs, and rollback.');
} finally {
  await connection.end();
}
