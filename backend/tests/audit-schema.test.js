import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { auditCheckExpression } from '../../database/tests/helpers/audit-metadata.mjs';

// Schema text, metadata parsing and CLI guard checks only: no SQL execution,
// private configuration import or database connection.
const migration = readFileSync(new URL('../../database/migrations/010_audit.sql', import.meta.url), 'utf8');
const sql = migration.replace(/\/\*[\s\S]*?\*\//gu, '').replace(/--[^\r\n]*/gu, '').trim();
const normalized = sql.replace(/\s+/gu, ' ');
const subjects = ['Account', 'Donor', 'Hospital', 'BloodGroup', 'BloodCompatibility', 'DonationSlot',
  'Booking', 'EligibilityDecision', 'Donation', 'BloodUnit', 'HospitalRequest', 'RequestStatusHistory',
  'Allocation', 'AuditEvent', 'SYSTEM_TASK'];

test('CHECK metadata accepts escaped quote delimiters without changing subject names or expression meaning', () => {
  const expression = "(`subject_type` in (_ascii'Account',_ascii'SYSTEM_TASK'))";
  const escaped = expression.replaceAll("'", "\\'");
  assert.equal(auditCheckExpression(escaped), expression);
  assert.equal(auditCheckExpression(expression), expression);
  const subjectId = "((`subject_type` = _ascii'SYSTEM_TASK') <=> (`subject_id` is null))";
  assert.equal(auditCheckExpression(subjectId.replaceAll("'", "\\'")), subjectId);
  assert.notEqual(auditCheckExpression(escaped.replace('Account', 'account')), expression);
  assert.notEqual(auditCheckExpression(escaped.replace('Account', 'Account\\\\')), expression);
  assert.equal(auditCheckExpression(expression + ' OR TRUE'), expression + ' OR TRUE');
  assert.throws(() => auditCheckExpression(null), TypeError);
});

test('Disposable verifier rejects unsafe instance/password configuration before attempting a connection', () => {
  const script = fileURLToPath(new URL('../../database/tests/verify-audit.mjs', import.meta.url));
  const directory = fileURLToPath(new URL('../../.tmp/audit-mysql-config-test/data', import.meta.url));
  const base = { SystemRoot: process.env.SystemRoot, PATH: process.env.PATH, TEMP: process.env.TEMP, TMP: process.env.TMP,
    PHASE3_AUDIT_TEST_DATABASE: 'bddc_phase3_test_audit_config', PHASE3_AUDIT_TEST_EMPTY_DATABASE: 'YES',
    DB_HOST: '127.0.0.1', DB_PORT: '9', PHASE3_TEST_DB_USER: 'isolated-test', PHASE3_TEST_DB_PASSWORD: '' };
  for (const changes of [
    {}, { PHASE3_AUDIT_TEST_DATA_DIRECTORY: directory, DB_PORT: '3306' },
    { PHASE3_AUDIT_TEST_DATA_DIRECTORY: fileURLToPath(new URL('../../database', import.meta.url)) },
    { PHASE3_AUDIT_TEST_DATA_DIRECTORY: directory, PHASE3_AUDIT_TEST_DATABASE: 'blood_donation_coordination' },
    { PHASE3_AUDIT_TEST_DATA_DIRECTORY: directory, DB_HOST: 'example.invalid' },
    { PHASE3_AUDIT_TEST_DATA_DIRECTORY: directory, PHASE3_TEST_DB_PASSWORD: undefined },
  ]) {
    const env = { ...base, ...changes };
    for (const key of Object.keys(env)) if (env[key] === undefined) delete env[key];
    const result = spawnSync(process.execPath, [script], { env, encoding: 'utf8', timeout: 5000 });
    assert.equal(result.error, undefined);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /^Configuration failed:/u);
    assert.doesNotMatch(result.stderr, /Audit storage verification failed/u);
  }
});

test('Audit migration contains exactly one plain AuditEvent CREATE and no unrelated statements', () => {
  const statements = sql.split(';').map((statement) => statement.trim()).filter(Boolean);
  assert.equal(statements.length, 1);
  assert.match(statements[0], /^CREATE TABLE AuditEvent \(/u);
  assert.doesNotMatch(normalized, /\bIF NOT EXISTS\b|\bCREATE (?:TRIGGER|EVENT|PROCEDURE|FUNCTION|VIEW)\b/iu);
  assert.match(normalized, /\) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;$/u);
});

test('AuditEvent has exactly the approved nine columns, nullability, encodings and timestamp default', () => {
  const columns = [...sql.matchAll(/^ {2}([a-z][a-z0-9_]*)\s+([A-Za-z][A-Za-z0-9_]*)\b[^\r\n]*/gmu)];
  assert.deepEqual(columns.map((column) => column[1]), ['audit_event_id', 'actor_account_id', 'action_code',
    'subject_type', 'subject_id', 'occurred_at', 'reason_code', 'change_summary', 'operation_id']);
  const definitions = new Map(columns.map((column) => [column[1], column[0].trim().replace(/,$/u, '')]));
  const expected = {
    audit_event_id: 'audit_event_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT',
    actor_account_id: 'actor_account_id BIGINT UNSIGNED NULL',
    action_code: 'action_code VARCHAR(48) CHARACTER SET ascii COLLATE ascii_bin NOT NULL',
    subject_type: 'subject_type VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL',
    subject_id: 'subject_id BIGINT UNSIGNED NULL',
    occurred_at: 'occurred_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP',
    reason_code: 'reason_code VARCHAR(40) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL',
    change_summary: 'change_summary VARCHAR(1000) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL',
    operation_id: 'operation_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL',
  };
  for (const [name, definition] of Object.entries(expected)) assert.equal(definitions.get(name), definition, name);
  assert.doesNotMatch(normalized, /ON UPDATE CURRENT_TIMESTAMP|GENERATED ALWAYS|\bJSON\b|\bENUM\b/iu);
});

test('AuditEvent actor FK is restrictive and its two exact composite indexes preserve history lookup', () => {
  assert.match(normalized, /PRIMARY KEY \(audit_event_id\)/u);
  assert.match(normalized, /KEY ix_audit_event_subject \(subject_type, subject_id, occurred_at\)/u);
  assert.match(normalized, /KEY ix_audit_event_actor \(actor_account_id, occurred_at\)/u);
  assert.equal([...normalized.matchAll(/\bFOREIGN KEY\b/gu)].length, 1);
  assert.match(normalized, /CONSTRAINT fk_audit_event_actor FOREIGN KEY \(actor_account_id\) REFERENCES Account \(account_id\) ON DELETE RESTRICT ON UPDATE RESTRICT/u);
  assert.doesNotMatch(normalized, /\bUNIQUE\b|\bCASCADE\b|ON DELETE SET NULL/iu);
});

test('AuditEvent subject whitelist is exact and subject ID is NULL exactly for a run-level SYSTEM_TASK', () => {
  const whitelist = normalized.match(/CONSTRAINT ck_audit_event_subject_type CHECK \(\s*subject_type IN \(([^)]+)\)\s*\)/u);
  assert.ok(whitelist, 'named subject whitelist CHECK is present');
  assert.deepEqual([...whitelist[1].matchAll(/'([^']+)'/gu)].map((match) => match[1]).sort(), [...subjects].sort());
  assert.match(normalized, /CONSTRAINT ck_audit_event_subject_id CHECK \(/u);
  assert.match(normalized, /CONSTRAINT ck_audit_event_subject_id CHECK \(\s*\(subject_type = 'SYSTEM_TASK'\) <=> \(subject_id IS NULL\)\s*\)/u,
    'subject-ID condition has the approved two-way meaning');
  assert.equal([...normalized.matchAll(/\bCHECK\s*\(/gu)].length, 2);
});
