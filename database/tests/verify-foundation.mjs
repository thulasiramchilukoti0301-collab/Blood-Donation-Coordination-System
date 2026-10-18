import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { readDatabaseConfig } from '../../backend/src/config/environment.js';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const backendRequire = createRequire(resolve(repositoryRoot, 'backend/package.json'));
const mysql = backendRequire('mysql2/promise');
const testDatabase = process.env.PHASE3_TEST_DATABASE?.trim();

if (!/^bddc_phase3_test_[a-z0-9_]+$/i.test(testDatabase ?? '')) {
  console.error('Set PHASE3_TEST_DATABASE to a disposable database named bddc_phase3_test_<label>.');
  process.exit(2);
}

const databaseConfig = readDatabaseConfig({
  ...process.env,
  DB_USER: process.env.PHASE3_TEST_DB_USER || process.env.DB_USER,
  DB_PASSWORD: process.env.PHASE3_TEST_DB_PASSWORD || process.env.DB_PASSWORD,
  DB_NAME: testDatabase,
});
if (!databaseConfig.options) {
  console.error('Database configuration is incomplete. Set private backend/.env or process environment values.');
  process.exit(2);
}
if (!['localhost', '127.0.0.1', '::1'].includes(databaseConfig.options.host.toLowerCase())) {
  console.error('Foundation verification is restricted to a loopback MySQL server.');
  process.exit(2);
}

let connection;
let verificationStage = 'connection';
const negativeResults = [];
const expectedCodes = ['O-', 'O+', 'A-', 'A+', 'B-', 'B+', 'AB-', 'AB+'];
const expectedNames = ['O negative', 'O positive', 'A negative', 'A positive', 'B negative', 'B positive', 'AB negative', 'AB positive'];
const requiredColumns = {
  BloodGroup: ['blood_group_id', 'code', 'display_name', 'is_active'],
  Account: ['account_id', 'email', 'password_hash', 'role', 'account_status', 'created_at', 'updated_at'],
};

async function rejectsSql(label, expectedCode, sql, values = []) {
  try {
    await connection.execute(sql, values);
  } catch (error) {
    const actualCode = typeof error?.code === 'string' && /^ER_[A-Z0-9_]+$/.test(error.code)
      ? error.code
      : 'NO_MYSQL_ERROR_CODE';
    if (actualCode !== expectedCode) {
      throw new VerificationDiagnostic(`negative check ${label}: expected ${expectedCode}, received ${actualCode}`);
    }
    negativeResults.push({ label, code: actualCode });
    return;
  }
  throw new VerificationDiagnostic(`negative check ${label}: expected ${expectedCode}, received NO_ERROR`);
}

class VerificationDiagnostic extends Error {}

try {
  connection = await mysql.createConnection({ ...databaseConfig.options, multipleStatements: false });
  verificationStage = 'database-session';
  await connection.query("SET time_zone = '+05:30'");
  const [[db]] = await connection.query('SELECT DATABASE() AS selected_database');
  assert.equal(db.selected_database, testDatabase);

  verificationStage = 'schema-metadata';
  for (const [table, columns] of Object.entries(requiredColumns)) {
    const [[engine]] = await connection.execute(
      `SELECT ENGINE AS engine, TABLE_COLLATION AS table_collation FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND LOWER(TABLE_NAME) = LOWER(?)`, [table],
    );
    assert.equal(engine?.engine, 'InnoDB', `${table} must use InnoDB`);
    assert.equal(engine?.table_collation, 'utf8mb4_0900_ai_ci', `${table} table default collation differs from the documented choice`);
    const [actualColumns] = await connection.execute(
      `SELECT COLUMN_NAME AS name, COLUMN_TYPE AS type, IS_NULLABLE AS nullable,
              COLUMN_DEFAULT AS default_value, EXTRA AS extra, CHARACTER_SET_NAME AS charset_name,
              COLLATION_NAME AS collation_name
         FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND LOWER(TABLE_NAME) = LOWER(?) ORDER BY ORDINAL_POSITION`, [table],
    );
    assert.deepEqual(actualColumns.map(({ name }) => name), columns, `${table} columns/order differ from the approved foundation`);
    assert.ok(actualColumns.every(({ nullable }) => nullable === 'NO'), `${table} required columns must be NOT NULL`);
    assert.ok(actualColumns[0].type === 'bigint unsigned' && actualColumns[0].extra.toLowerCase().includes('auto_increment'), `${table} key must be generated BIGINT UNSIGNED`);
    assert.ok(actualColumns.every(({ collation_name }) => collation_name === null || collation_name === 'utf8mb4_0900_ai_ci' || collation_name === 'ascii_bin'), `${table} column collation differs from the documented choice`);
    if (table === 'BloodGroup') {
      assert.deepEqual(actualColumns.map(({ type }) => type), ['bigint unsigned', 'char(3)', 'varchar(12)', 'tinyint(1)']);
      assert.equal(String(actualColumns[3].default_value), '1');
      assert.equal(actualColumns[1].collation_name, 'ascii_bin');
    } else {
      assert.deepEqual(actualColumns.map(({ type }) => type), ['bigint unsigned', 'varchar(254)', 'varchar(255)', 'varchar(16)', 'varchar(16)', 'datetime', 'datetime']);
      assert.equal(actualColumns[1].collation_name, 'utf8mb4_0900_ai_ci');
      assert.equal(actualColumns[2].collation_name, 'utf8mb4_0900_ai_ci');
      assert.equal(actualColumns[3].collation_name, 'ascii_bin');
      assert.equal(actualColumns[4].collation_name, 'ascii_bin');
      assert.equal(String(actualColumns[4].default_value), 'PENDING');
      assert.ok(String(actualColumns[5].default_value).toUpperCase().includes('CURRENT_TIMESTAMP'));
      assert.ok(String(actualColumns[6].default_value).toUpperCase().includes('CURRENT_TIMESTAMP'));
      assert.ok(!actualColumns[6].extra.toLowerCase().includes('on update'));
    }
  }

  verificationStage = 'blood-group-reference-data';
  const [groups] = await connection.query('SELECT blood_group_id, code, display_name, is_active FROM BloodGroup ORDER BY blood_group_id');
  assert.equal(groups.length, 8);
  assert.deepEqual(groups.map(({ blood_group_id }) => Number(blood_group_id)), [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.deepEqual(groups.map(({ code }) => code.trim()), expectedCodes);
  assert.deepEqual(groups.map(({ display_name }) => display_name), expectedNames);
  assert.ok(groups.every(({ is_active }) => Number(is_active) === 1));

  verificationStage = 'constraint-metadata';
  const [constraints] = await connection.execute(
    `SELECT tc.TABLE_NAME AS table_name, tc.CONSTRAINT_NAME AS constraint_name, tc.CONSTRAINT_TYPE AS constraint_type,
            cc.CHECK_CLAUSE AS check_clause
       FROM information_schema.TABLE_CONSTRAINTS tc
       LEFT JOIN information_schema.CHECK_CONSTRAINTS cc
         ON cc.CONSTRAINT_SCHEMA = tc.CONSTRAINT_SCHEMA AND cc.CONSTRAINT_NAME = tc.CONSTRAINT_NAME
      WHERE tc.CONSTRAINT_SCHEMA = DATABASE() AND tc.TABLE_NAME IN ('Account', 'BloodGroup')`,
  );
  const keys = new Set(constraints.map(({ table_name, constraint_name, constraint_type }) => `${table_name.toLowerCase()}:${constraint_name}:${constraint_type}`));
  for (const [table, column] of [['BloodGroup', 'blood_group_id'], ['Account', 'account_id']]) {
    const [primaryRows] = await connection.execute(
      `SELECT tc.CONSTRAINT_NAME AS constraint_name, tc.CONSTRAINT_TYPE AS constraint_type,
              kcu.COLUMN_NAME AS column_name, kcu.ORDINAL_POSITION AS ordinal_position
         FROM information_schema.TABLE_CONSTRAINTS tc
         JOIN information_schema.KEY_COLUMN_USAGE kcu
           ON kcu.CONSTRAINT_SCHEMA = tc.CONSTRAINT_SCHEMA
          AND kcu.TABLE_NAME = tc.TABLE_NAME
          AND kcu.CONSTRAINT_NAME = tc.CONSTRAINT_NAME
        WHERE tc.CONSTRAINT_SCHEMA = DATABASE()
          AND LOWER(tc.TABLE_NAME) = LOWER(?)
          AND tc.CONSTRAINT_NAME = 'PRIMARY'
        ORDER BY kcu.ORDINAL_POSITION`, [table],
    );
    assert.equal(primaryRows.length, 1, `${table} must have one primary-key column`);
    assert.equal(primaryRows[0].constraint_name, 'PRIMARY', `${table} physical primary-key name differs`);
    assert.equal(primaryRows[0].constraint_type, 'PRIMARY KEY', `${table} primary-key type differs`);
    assert.equal(primaryRows[0].column_name, column, `${table} primary-key column differs`);
    assert.equal(Number(primaryRows[0].ordinal_position), 1, `${table} primary-key column position differs`);
  }
  for (const required of [
    'bloodgroup:uq_blood_group_code:UNIQUE',
    'bloodgroup:uq_blood_group_display_name:UNIQUE', 'bloodgroup:ck_blood_group_code:CHECK',
    'bloodgroup:ck_blood_group_is_active:CHECK', 'account:uq_account_email:UNIQUE',
    'account:ck_account_role:CHECK', 'account:ck_account_status:CHECK',
  ]) assert.ok(keys.has(required), `Missing ${required}`);

  verificationStage = 'defaults-and-timestamps';
  await connection.beginTransaction();
  await connection.execute('DELETE FROM BloodGroup WHERE blood_group_id = 8');
  await connection.execute('INSERT INTO BloodGroup (code, display_name) VALUES (?, ?)', ['AB+', 'AB test']);
  const [[groupDefault]] = await connection.query("SELECT is_active FROM BloodGroup WHERE code = 'AB+'");
  assert.equal(Number(groupDefault.is_active), 1);
  await connection.query("UPDATE BloodGroup SET is_active = FALSE WHERE code = 'AB+'");
  const [[inactiveGroup]] = await connection.query("SELECT is_active FROM BloodGroup WHERE code = 'AB+'");
  assert.equal(Number(inactiveGroup.is_active), 0);
  await connection.query("DELETE FROM BloodGroup WHERE code = 'AB+'");

  verificationStage = 'account-role-and-status-values';
  const seedEmail = `foundation-check-${process.pid}@example.invalid`;
  for (const role of ['ADMIN', 'HOSPITAL', 'DONOR']) {
    for (const status of ['PENDING', 'ACTIVE', 'SUSPENDED']) {
      await connection.execute(
        'INSERT INTO Account (email, password_hash, role, account_status) VALUES (?, ?, ?, ?)',
        [`${role.toLowerCase()}-${status.toLowerCase()}-${seedEmail}`, 'verification-only-not-a-usable-hash', role, status],
      );
    }
  }

  const [defaultResult] = await connection.execute(
    'INSERT INTO Account (email, password_hash, role) VALUES (?, ?, ?)',
    [`default-${seedEmail}`, 'verification-only-not-a-usable-hash', 'DONOR'],
  );
  const [[defaults]] = await connection.execute(
    'SELECT account_status, created_at, updated_at FROM Account WHERE account_id = ?', [defaultResult.insertId],
  );
  assert.equal(defaults.account_status, 'PENDING');
  assert.ok(defaults.created_at instanceof Date && defaults.updated_at instanceof Date);
  await connection.execute('UPDATE Account SET updated_at = ? WHERE account_id = ?', ['2000-01-02 03:04:05', defaultResult.insertId]);
  const [[updatedText]] = await connection.execute('SELECT DATE_FORMAT(updated_at, \'%Y-%m-%d %H:%i:%s\') AS updated_at FROM Account WHERE account_id = ?', [defaultResult.insertId]);
  assert.equal(updatedText.updated_at, '2000-01-02 03:04:05');
  await connection.execute('UPDATE Account SET email = ? WHERE account_id = ?', [`changed-${seedEmail}`, defaultResult.insertId]);
  const [[notAutoUpdated]] = await connection.execute('SELECT DATE_FORMAT(updated_at, \'%Y-%m-%d %H:%i:%s\') AS updated_at FROM Account WHERE account_id = ?', [defaultResult.insertId]);
  assert.equal(notAutoUpdated.updated_at, '2000-01-02 03:04:05');

  verificationStage = 'negative-sql-cases';
  await rejectsSql('account-role-lowercase', 'ER_CHECK_CONSTRAINT_VIOLATED', "INSERT INTO Account (email, password_hash, role) VALUES (?, ?, 'donor')", [`bad-role-${seedEmail}`, 'synthetic']);
  await rejectsSql('account-role-unknown-uppercase', 'ER_CHECK_CONSTRAINT_VIOLATED', "INSERT INTO Account (email, password_hash, role) VALUES (?, ?, 'STAFF')", [`bad-role-upper-${seedEmail}`, 'synthetic']);
  await rejectsSql('account-status-lowercase', 'ER_CHECK_CONSTRAINT_VIOLATED', "INSERT INTO Account (email, password_hash, role, account_status) VALUES (?, 'synthetic', 'DONOR', 'pending')", [`bad-status-${seedEmail}`]);
  await rejectsSql('account-status-unknown-uppercase', 'ER_CHECK_CONSTRAINT_VIOLATED', "INSERT INTO Account (email, password_hash, role, account_status) VALUES (?, 'synthetic', 'DONOR', 'DEACTIVATED')", [`bad-status-upper-${seedEmail}`]);
  await rejectsSql('account-email-null', 'ER_BAD_NULL_ERROR', 'INSERT INTO Account (email, password_hash, role) VALUES (NULL, ?, ?)', ['synthetic', 'DONOR']);
  await rejectsSql('account-password-hash-null', 'ER_BAD_NULL_ERROR', 'INSERT INTO Account (email, password_hash, role) VALUES (?, NULL, ?)', [`null-hash-${seedEmail}`, 'DONOR']);
  await rejectsSql('account-role-null', 'ER_BAD_NULL_ERROR', 'INSERT INTO Account (email, password_hash, role) VALUES (?, ?, NULL)', [`null-role-${seedEmail}`, 'synthetic']);
  await rejectsSql('account-status-null', 'ER_BAD_NULL_ERROR', 'INSERT INTO Account (email, password_hash, role, account_status) VALUES (?, ?, ?, NULL)', [`null-status-${seedEmail}`, 'synthetic', 'DONOR']);
  await rejectsSql('account-created-at-null', 'ER_BAD_NULL_ERROR', 'INSERT INTO Account (email, password_hash, role, created_at) VALUES (?, ?, ?, NULL)', [`null-created-${seedEmail}`, 'synthetic', 'DONOR']);
  await rejectsSql('account-updated-at-null', 'ER_BAD_NULL_ERROR', 'INSERT INTO Account (email, password_hash, role, updated_at) VALUES (?, ?, ?, NULL)', [`null-updated-${seedEmail}`, 'synthetic', 'DONOR']);
  await rejectsSql('account-email-duplicate', 'ER_DUP_ENTRY', 'INSERT INTO Account (email, password_hash, role) VALUES (?, ?, ?)', [`donor-pending-${seedEmail}`, 'synthetic', 'DONOR']);
  await connection.execute('INSERT INTO Account (email, password_hash, role) VALUES (?, ?, ?)', ['Case@example.invalid', 'synthetic', 'DONOR']);
  await rejectsSql('account-email-case-insensitive-duplicate', 'ER_DUP_ENTRY', 'INSERT INTO Account (email, password_hash, role) VALUES (?, ?, ?)', ['case@example.invalid', 'synthetic', 'DONOR']);
  await rejectsSql('blood-group-code-lowercase', 'ER_CHECK_CONSTRAINT_VIOLATED', 'INSERT INTO BloodGroup (code, display_name) VALUES (?, ?)', ['o+', 'lowercase']);
  await rejectsSql('blood-group-code-unknown-uppercase', 'ER_CHECK_CONSTRAINT_VIOLATED', 'INSERT INTO BloodGroup (code, display_name) VALUES (?, ?)', ['X+', 'unknown']);
  await rejectsSql('blood-group-display-name-duplicate', 'ER_DUP_ENTRY', 'UPDATE BloodGroup SET display_name = ? WHERE blood_group_id = 1', ['O positive']);
  await rejectsSql('blood-group-code-duplicate', 'ER_DUP_ENTRY', 'INSERT INTO BloodGroup (code, display_name) VALUES (?, ?)', ['O-', 'duplicate']);
  await rejectsSql('blood-group-code-null', 'ER_BAD_NULL_ERROR', 'INSERT INTO BloodGroup (code, display_name) VALUES (NULL, ?)', ['null code']);
  await rejectsSql('blood-group-display-name-null', 'ER_BAD_NULL_ERROR', 'INSERT INTO BloodGroup (code, display_name) VALUES (?, NULL)', ['AB+']);
  await rejectsSql('blood-group-is-active-check', 'ER_CHECK_CONSTRAINT_VIOLATED', 'INSERT INTO BloodGroup (code, display_name, is_active) VALUES (?, ?, 2)', ['AB+', 'invalid']);
  await rejectsSql('blood-group-is-active-null', 'ER_BAD_NULL_ERROR', 'INSERT INTO BloodGroup (code, display_name, is_active) VALUES (?, ?, NULL)', ['AB+', 'null active']);

  await rejectsSql('intentional-missing-table', 'ER_NO_SUCH_TABLE', 'SELECT * FROM __phase3_verification_missing_table__');
  for (const { label, code } of negativeResults) console.log(`PASS negative check ${label} (${code})`);
  console.log(`Foundation verification passed for disposable schema ${testDatabase}; synthetic Account rows are rolled back.`);
} catch (error) {
  await connection?.rollback().catch(() => {});
  if (error instanceof VerificationDiagnostic) {
    console.error(`Foundation verification failed during ${verificationStage}: ${error.message}.`);
  } else {
    const mysqlCode = typeof error?.code === 'string' && /^ER_[A-Z0-9_]+$/.test(error.code)
      ? error.code
      : 'ASSERTION_FAILED';
    console.error(`Foundation verification failed during ${verificationStage}: ${mysqlCode}. Driver details are suppressed.`);
  }
  process.exitCode = 1;
} finally {
  await connection?.rollback().catch(() => {});
  await connection?.end().catch(() => {});
}
