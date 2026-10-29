import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { mysqlStatements } from '../../database/tests/helpers/mysql-script.mjs';

// Static contract checks only. Real SQL verification is separately disposable.
const requestSql = readFileSync(new URL('../../database/migrations/008_blood_requests.sql', import.meta.url), 'utf8');
const historySql = readFileSync(new URL('../../database/migrations/012_request_status_history.sql', import.meta.url), 'utf8');
const clean = (text) => text.replace(/--[^\r\n]*/gu, '').replace(/\s+/gu, ' ').trim();
const request = mysqlStatements(requestSql);
const history = mysqlStatements(historySql);
const statuses = ['SUBMITTED', 'UNDER_REVIEW', 'AWAITING_INVENTORY', 'PARTIALLY_FULFILLED', 'FULFILLED', 'REJECTED', 'CANCELLED'];
const columns = (text) => [...text.matchAll(/^  ([a-z][a-z0-9_]*) [A-Z]+\b/gmu)].map((match) => match[1]);

test('008 defines exactly HospitalRequest with the eleven approved fields and two row guards', () => {
  assert.equal(request.length, 3);
  assert.match(clean(request[0]), /^CREATE TABLE HospitalRequest /u);
  assert.deepEqual(columns(request[0]), ['request_id', 'hospital_account_id', 'recipient_group_id', 'quantity_requested',
    'priority', 'needed_by', 'request_note', 'request_status', 'rejection_reason_code', 'created_at', 'updated_at']);
  for (const definition of ['request_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT', 'hospital_account_id BIGINT UNSIGNED NOT NULL',
    'recipient_group_id BIGINT UNSIGNED NOT NULL', 'quantity_requested SMALLINT UNSIGNED NOT NULL', 'needed_by DATETIME NOT NULL',
    "priority VARCHAR(10) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'NORMAL'",
    "request_status VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'SUBMITTED'",
    'request_note VARCHAR(500)', 'rejection_reason_code VARCHAR(40)',
    'created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP', 'updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP']) {
    assert.ok(request[0].includes(definition), definition);
  }
  assert.match(clean(request[1]), /^CREATE TRIGGER trg_request_initial_status BEFORE INSERT ON HospitalRequest/u);
  assert.match(clean(request[2]), /^CREATE TRIGGER trg_request_update_guard BEFORE UPDATE ON HospitalRequest/u);
  assert.doesNotMatch(requestSql, /CREATE TABLE (?:Allocation|AuditEvent|RequestStatusHistory)|IF NOT EXISTS|ON UPDATE CURRENT_TIMESTAMP/iu);
});

test('HospitalRequest uses exact priority/status values, positive quantity, conditional reason and restrictive parents/indexes', () => {
  const sql = clean(request[0]);
  const status = sql.match(/ck_request_status CHECK \(BINARY request_status IN \(([^)]+)\)/u);
  assert.deepEqual([...status[1].matchAll(/'([^']+)'/gu)].map((match) => match[1]), statuses);
  assert.match(sql, /ck_request_priority CHECK \(BINARY priority IN \('EMERGENCY', 'URGENT', 'NORMAL'\)\)/u);
  assert.match(sql, /ck_request_quantity CHECK \(quantity_requested > 0\)/u);
  assert.match(sql, /request_status <> 'REJECTED' OR rejection_reason_code IS NOT NULL/u);
  assert.match(sql, /FOREIGN KEY \(hospital_account_id\) REFERENCES Hospital \(account_id\) ON DELETE RESTRICT ON UPDATE RESTRICT/u);
  assert.match(sql, /FOREIGN KEY \(recipient_group_id\) REFERENCES BloodGroup \(blood_group_id\) ON DELETE RESTRICT ON UPDATE RESTRICT/u);
  assert.match(sql, /\(request_status, priority, needed_by, created_at\)/u);
  assert.match(sql, /\(hospital_account_id, created_at\)/u);
  assert.match(sql, /KEY ix_request_recipient_group \(recipient_group_id\)/u);
});

test('Storage guards enforce initial status, immutable quantity and terminal/static transition rules without allocation work', () => {
  assert.match(request[1], /NEW\.request_status <> 'SUBMITTED'/u);
  assert.match(request[2], /NOT \(NEW\.quantity_requested <=> OLD\.quantity_requested\)/u);
  assert.match(request[2], /OLD\.request_status IN \('FULFILLED', 'REJECTED', 'CANCELLED'\)/u);
  assert.match(request[2], /SIGNAL SQLSTATE '45000'/u);
  assert.doesNotMatch(request.join('\n'), /(?:SELECT|INSERT INTO|UPDATE|DELETE FROM) Allocation/iu);
});

test('012 history migration preserves seven approved columns, parent FKs and timeline index', () => {
  assert.match(historySql, /Approved Feature 7 history migration/u);
  const proposal = mysqlStatements(readFileSync(new URL('../../database/proposals/request-status-history.sql', import.meta.url), 'utf8'));
  assert.equal(clean(history[0]), clean(proposal[0]), 'Promotion preserves every tested table definition/constraint/index');
  assert.equal(history.length, 2);
  assert.deepEqual(columns(history[0]), ['request_status_history_id', 'request_id', 'old_status', 'new_status',
    'changed_by_account_id', 'reason_code', 'changed_at']);
  const sql = clean(history[0]);
  assert.match(sql, /FOREIGN KEY \(request_id\) REFERENCES HospitalRequest \(request_id\) ON DELETE RESTRICT ON UPDATE RESTRICT/u);
  assert.match(sql, /FOREIGN KEY \(changed_by_account_id\) REFERENCES Account \(account_id\) ON DELETE RESTRICT ON UPDATE RESTRICT/u);
  assert.match(sql, /KEY ix_request_history_request_changed \(request_id, changed_at\)/u);
  assert.match(sql, /old_status IS NOT NULL OR new_status = 'SUBMITTED'/u);
  assert.doesNotMatch(sql, /\bUNIQUE\b|\bCASCADE\b/u);
});

test('Only the conditional AFTER UPDATE trigger writes update history; actor/reason cleanup is caller-owned', () => {
  const sql = clean(history[1]);
  assert.match(sql, /^CREATE TRIGGER trg_request_status_history_update AFTER UPDATE ON HospitalRequest/u);
  assert.match(sql, /IF NOT \(OLD.request_status <=> NEW.request_status\) THEN/u);
  assert.equal((sql.match(/INSERT INTO RequestStatusHistory/gu) || []).length, 1);
  assert.match(sql, /@request_actor_account_id/u);
  assert.match(sql, /@request_reason_code/u);
  assert.match(sql, /@request_system_operation_id/u);
  assert.match(sql, /FROM Account WHERE account_id = actor_id FOR UPDATE/u);
  assert.match(sql, /IF @request_reason_code IS NULL THEN SIGNAL/u);
  assert.match(sql, /IF @request_actor_account_id IS NULL THEN SIGNAL/u);
  assert.doesNotMatch(sql, /REGEXP '\^\[0-9A-Fa-f\]/u);
  assert.doesNotMatch(sql, /INSERT INTO AuditEvent|COMMIT|ROLLBACK|CREATE TRIGGER.*AFTER INSERT/iu);
});

test('Checked-in SQL splitter preserves trigger bodies and fails closed on unfinished statements', () => {
  const script = "-- header\nCREATE TABLE example (id INT);\nDELIMITER $$\nCREATE TRIGGER example_trigger BEFORE UPDATE ON example FOR EACH ROW BEGIN\n SET NEW.id = OLD.id;\nEND$$\nDELIMITER ;\n";
  const statements = mysqlStatements(script);
  assert.equal(statements.length, 2);
  assert.ok(statements[1].includes('SET NEW.id = OLD.id;'));
  assert.doesNotMatch(statements[1], /DELIMITER|\$\$/u);
  assert.throws(() => mysqlStatements('CREATE TABLE unfinished (id INT)'), /Unterminated/u);
  assert.throws(() => mysqlStatements('CREATE TABLE unfinished\nDELIMITER $$'), /Delimiter changed/u);
});
