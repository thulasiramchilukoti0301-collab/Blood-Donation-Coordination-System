import assert from 'node:assert/strict';
import net from 'node:net';
import { resolve } from 'node:path';

// Preloaded only in the verifier-probe subprocess. Even a broken loader cannot
// open a socket: any attempted outbound connection fails and is reported.
const scenario = process.env.AUDIT_PREFLIGHT_TEST_CASE;
const scenarios = new Set([
  'normal-missing', 'dedicated-missing', 'normal-insufficient', 'dedicated-insufficient',
  'normal-sufficient', 'dedicated-sufficient', 'normal-all', 'dedicated-all',
  'dedicated-directory-mismatch', 'dedicated-port-mismatch',
]);
assert.ok(scenarios.has(scenario), 'An explicit controlled verifier probe is required.');
const state = { steps: [], fixtureWrites: 0, transactionStarts: 0, outboundAttempts: 0, closed: false, destroyed: false };
const failure = (code) => Object.assign(new Error(), { code });
net.Socket.prototype.connect = function rejectOutboundConnection() {
  state.outboundAttempts += 1;
  throw failure('ER_AUDIT_TEST_NETWORK_FORBIDDEN');
};
process.once('exit', () => {
  process.stdout.write(`AUDIT_PREFLIGHT_PROBE ${JSON.stringify(state)}\n`);
});

const groups = [[1, 'O-', 'O negative'], [2, 'O+', 'O positive'], [3, 'A-', 'A negative'], [4, 'A+', 'A positive'],
  [5, 'B-', 'B negative'], [6, 'B+', 'B positive'], [7, 'AB-', 'AB negative'], [8, 'AB+', 'AB positive']];

const connection = {
  async query(sql) {
    if (sql.startsWith('SET time_zone')) { state.steps.push('timezone'); return []; }
    if (sql.includes('DATABASE() AS selected_database')) {
      state.steps.push('selected-database');
      return [[{ selected_database: 'bddc_phase3_test_audit_preflight' }]];
    }
    if (sql.includes('@@datadir')) {
      state.steps.push('instance-identity');
      return [[{
        data_directory: scenario === 'dedicated-directory-mismatch'
          ? resolve(process.env.PHASE3_AUDIT_TEST_DATA_DIRECTORY, 'different') : process.env.PHASE3_AUDIT_TEST_DATA_DIRECTORY,
        port: scenario === 'dedicated-port-mismatch' ? 50470 : 50469,
      }]];
    }
    if (sql === 'SHOW GRANTS') {
      state.steps.push('visibility');
      const privileges = scenario.endsWith('-all') ? 'ALL PRIVILEGES'
        : scenario.endsWith('-sufficient') ? 'SELECT, SHOW_ROUTINE, TRIGGER, EVENT'
          : scenario.endsWith('-insufficient') ? 'SELECT, SHOW_ROUTINE, TRIGGER' : null;
      return [privileges ? [{ grant: `GRANT ${privileges} ON *.* TO 'disposable_probe'@'localhost'` }] : []];
    }
    if (sql.includes('FROM information_schema.TABLES')) {
      state.steps.push('object-inventory');
      return [[...['Account', 'AuditEvent', 'BloodGroup'].map((name) => ({
        name, type: 'BASE TABLE', engine: 'InnoDB', collation: 'utf8mb4_0900_ai_ci',
      }))]];
    }
    if (sql.includes('COUNT(*) AS object_count')) {
      state.steps.push('auxiliary-inventory'); return [[{ object_count: 0 }]];
    }
    if (sql.includes('COUNT(*) AS row_count')) {
      state.steps.push('empty-table'); return [[{ row_count: 0 }]];
    }
    if (sql.startsWith('SELECT blood_group_id')) {
      state.steps.push('reference-data');
      return [groups.map(([blood_group_id, code, display_name]) => ({ blood_group_id, code, display_name, is_active: 1 }))];
    }
    if (sql.includes('@@SESSION.sql_mode')) {
      state.steps.push('session-guards'); return [[{ sql_mode: 'STRICT_TRANS_TABLES', fk_checks: 1, uq_checks: 1 }]];
    }
    if (sql.includes("LOWER(TABLE_NAME) = 'account'")) {
      state.steps.push('parent-key'); return [[{ type: 'bigint unsigned', nullable: 'NO', column_key: 'PRI' }]];
    }
    if (sql.includes("LOWER(TABLE_NAME) = 'auditevent'") && sql.includes('information_schema.COLUMNS')) {
      // Successful preflight is observed at the next real verifier stage. Stop
      // deliberately before metadata/fixtures; this is not a storage pass.
      state.steps.push('preflight-complete'); throw failure('ER_AUDIT_TEST_PREFLIGHT_COMPLETE');
    }
    throw failure('ER_AUDIT_TEST_UNEXPECTED_QUERY');
  },
  async execute() { state.fixtureWrites += 1; throw failure('ER_AUDIT_TEST_UNEXPECTED_WRITE'); },
  async beginTransaction() { state.transactionStarts += 1; throw failure('ER_AUDIT_TEST_UNEXPECTED_TRANSACTION'); },
  async end() { state.steps.push('close'); state.closed = true; },
  destroy() { state.destroyed = true; },
};

// The loader substitutes this export for node:module only in verify-audit.mjs.
// It never imports mysql2 or constructs a real connection.
export function createRequire() {
  return (specifier) => {
    assert.equal(specifier, 'mysql2/promise');
    return {
      async createConnection() { state.steps.push('connect'); return connection; },
    };
  };
}
