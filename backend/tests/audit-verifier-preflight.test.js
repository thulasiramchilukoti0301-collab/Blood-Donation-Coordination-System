import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const verifier = fileURLToPath(new URL('../../database/tests/verify-audit.mjs', import.meta.url));
const loader = new URL('./helpers/audit-verifier-loader.mjs', import.meta.url).href;
const driver = new URL('./helpers/audit-verifier-database.mjs', import.meta.url).href;
const directory = fileURLToPath(new URL('../../.tmp/audit-mysql-preflight/data', import.meta.url));

function runVerifier(scenario) {
  // No inherited DB settings, NODE_OPTIONS, credentials, or dotenv loading.
  const env = { SystemRoot: process.env.SystemRoot, PATH: process.env.PATH, TEMP: process.env.TEMP,
    TMP: process.env.TMP, NODE_ENV: 'test', AUDIT_PREFLIGHT_TEST_CASE: scenario,
    DB_HOST: '127.0.0.1', DB_PORT: '50469', PHASE3_AUDIT_TEST_DATABASE: 'bddc_phase3_test_audit_preflight',
    PHASE3_AUDIT_TEST_EMPTY_DATABASE: 'YES', PHASE3_TEST_DB_USER: 'disposable_probe',
    PHASE3_TEST_DB_PASSWORD: 'synthetic-probe-value' };
  if (scenario.startsWith('dedicated-')) env.PHASE3_AUDIT_TEST_DATA_DIRECTORY = directory;
  const result = spawnSync(process.execPath, ['--experimental-loader', loader, '--import', driver, verifier],
    { env, encoding: 'utf8', timeout: 10000 });
  assert.equal(result.error, undefined, 'Probe subprocess must complete.');
  assert.equal(result.status, 1, 'The read-only probe must reject or stop before fixtures, never report storage success.');
  const records = result.stdout.split(/\r?\n/u).filter((line) => line.startsWith('AUDIT_PREFLIGHT_PROBE '));
  assert.equal(records.length, 1, 'The injected verifier dependency must report exactly once.');
  const state = JSON.parse(records[0].slice('AUDIT_PREFLIGHT_PROBE '.length));
  assert.equal(state.fixtureWrites, 0);
  assert.equal(state.transactionStarts, 0);
  assert.equal(state.outboundAttempts, 0);
  assert.equal(state.closed, true);
  assert.equal(state.destroyed, false);
  assert.doesNotMatch(result.stdout + result.stderr, /Audit storage verification passed|synthetic-probe-value|disposable_probe/u);
  return { state, stderr: result.stderr };
}

for (const mode of ['normal', 'dedicated']) {
  for (const evidence of ['missing', 'insufficient']) {
    test(`Actual audit verifier ${mode} mode rejects ${evidence} visibility evidence before inventory or fixtures`, () => {
      const { state, stderr } = runVerifier(`${mode}-${evidence}`);
      assert.deepEqual(state.steps, ['connect', 'timezone', 'selected-database',
        ...(mode === 'dedicated' ? ['instance-identity'] : []), 'visibility', 'close']);
      assert.match(stderr, /Audit storage verification failed during metadata-visibility-and-fresh-schema: ASSERTION_FAILED\./u);
    });
  }
  for (const evidence of ['sufficient', 'all']) {
    test(`Actual audit verifier ${mode} mode advances through preflight with ${evidence} visibility`, () => {
      const { state, stderr } = runVerifier(`${mode}-${evidence}`);
      assert.deepEqual(state.steps, ['connect', 'timezone', 'selected-database',
        ...(mode === 'dedicated' ? ['instance-identity'] : []), 'visibility', 'object-inventory',
        'auxiliary-inventory', 'auxiliary-inventory', 'auxiliary-inventory', 'empty-table', 'empty-table',
        'reference-data', 'session-guards', 'parent-key', 'preflight-complete', 'close']);
      assert.match(stderr, /Audit storage verification failed during exact-audit-metadata: ER_AUDIT_TEST_PREFLIGHT_COMPLETE\./u);
    });
  }
}

for (const mismatch of ['directory', 'port']) {
  test(`Actual audit verifier still rejects a dedicated-server ${mismatch} mismatch`, () => {
    const { state, stderr } = runVerifier(`dedicated-${mismatch}-mismatch`);
    assert.deepEqual(state.steps, ['connect', 'timezone', 'selected-database', 'instance-identity', 'close']);
    assert.match(stderr, /Audit storage verification failed during metadata-visibility-and-fresh-schema: ASSERTION_FAILED\./u);
  });
}
