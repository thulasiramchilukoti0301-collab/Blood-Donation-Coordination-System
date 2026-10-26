import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import { test } from 'node:test';
import bcrypt from 'bcrypt';
import { bootstrapFirstAdmin, FirstAdminError, validateFirstAdminTarget } from '../src/modules/auth/firstAdmin.js';
import { runFirstAdminCli } from '../src/cli/bootstrap-first-admin.js';
import { createFirstAdminPrompts } from '../src/cli/firstAdminPrompts.js';

const env = Object.freeze({ NODE_ENV: 'development', DB_HOST: '127.0.0.1', DB_PORT: '3306',
  DB_NAME: 'blood_donation_coordination', FIRST_ADMIN_BOOTSTRAP_DATABASE: 'blood_donation_coordination' });
const email = '  Local.Admin@Example.test  ';
const password = '  Synthetic7!pass  ';
const hash = '$2b$12$' + 'A'.repeat(53); // Injected test result, never a usable provisioned Account.
const rawFailure = () => Object.assign(new Error('PRIVATE driver details/password/SQL'), { code: 'ER_TEST_PRIVATE' });

function fixture(options = {}) {
  const steps = [];
  const writes = [];
  const hashed = [];
  const fail = (stage) => { if (options.failAt === stage) throw rawFailure(); };
  const connection = {
    async execute({ sql, timeout }, values) {
      assert.equal(timeout, 10_000);
      assert.ok(Array.isArray(values));
      assert.doesNotMatch(sql, /UPDATE Account|DELETE|AuditEvent|Donor|Hospital|CREATE /u);
      if (sql.includes('SELECT DATABASE()')) {
        steps.push('database'); fail('database');
        return [[{ database_name: options.databaseName ?? env.DB_NAME }]];
      }
      if (sql.includes('information_schema.TABLES')) {
        steps.push('engine'); fail('engine');
        return [options.missingTable ? [] : [{ ENGINE: options.engine ?? 'InnoDB' }]];
      }
      if (sql.includes('GET_LOCK')) {
        steps.push('lock'); fail('lock');
        assert.match(values[0], /^bdcs:first-admin:[a-f0-9]{40}$/u);
        options.afterLock?.();
        return [[{ acquired: Object.hasOwn(options, 'lockResult') ? options.lockResult : '1' }]];
      }
      if (sql.includes('FROM Account WHERE role')) {
        steps.push('admin-check'); fail('admin-check');
        assert.deepEqual(values, ['ADMIN']);
        assert.match(sql, /LIMIT 1 FOR UPDATE$/u);
        assert.doesNotMatch(sql, /account_status/u);
        return [options.existingAdmin ? [{ account_id: '20', account_status: options.existingAdmin }] : []];
      }
      if (sql.startsWith('INSERT INTO Account')) {
        steps.push('insert');
        if (options.duplicate) throw Object.assign(rawFailure(), { code: 'ER_DUP_ENTRY' });
        fail('insert');
        writes.push(values);
        options.afterInsert?.();
        assert.equal(sql.match(/\?/gu).length, 4);
        return [{ affectedRows: options.affectedRows ?? 1, insertId: options.insertId ?? '18446744073709551615' }];
      }
      if (sql.includes('RELEASE_LOCK')) {
        steps.push('unlock'); fail('unlock');
        return [[{ released: Object.hasOwn(options, 'releaseResult') ? options.releaseResult : 1 }]];
      }
      assert.fail('Unexpected bootstrap statement.');
    },
    async beginTransaction() { steps.push('begin'); fail('begin'); },
    async commit() { steps.push('commit'); options.duringCommit?.(); fail('commit'); },
    async rollback() { steps.push('rollback'); if (options.rollbackFails) throw rawFailure(); },
    release() { steps.push('release'); fail('release'); },
    destroy() { steps.push('destroy'); if (options.destroyFails) throw rawFailure(); },
  };
  const pool = { async getConnection() { steps.push('acquire'); fail('acquire'); options.afterAcquire?.(); return connection; } };
  const passwordHasher = { async hash(value, rounds) { hashed.push([value, rounds]); fail('hash'); return options.hash ?? hash; } };
  const run = (overrides = {}) => bootstrapFirstAdmin({ databasePool: pool, env, email, password, passwordHasher, ...overrides });
  return { steps, writes, hashed, pool, run };
}

async function rejectsSafely(promise, code) {
  await assert.rejects(promise, (error) => {
    assert.ok(error instanceof FirstAdminError);
    assert.equal(error.code, code);
    assert.doesNotMatch(String(error) + JSON.stringify(error), /PRIVATE|Synthetic|\$2b\$|driver details|ER_TEST_PRIVATE/u);
    return true;
  });
}

test('bootstrap requires an explicit loopback development target without system schemas or defaults', () => {
  assert.deepEqual(validateFirstAdminTarget(env), { databaseName: env.DB_NAME });
  assert.deepEqual(validateFirstAdminTarget({ ...env, DB_HOST: '::1' }), { databaseName: env.DB_NAME });
  for (const change of [
    { NODE_ENV: undefined }, { NODE_ENV: 'test' }, { NODE_ENV: 'production' },
    { DB_HOST: undefined }, { DB_HOST: 'localhost' }, { DB_HOST: '192.0.2.1' },
    { DB_PORT: undefined }, { DB_PORT: '0' }, { DB_PORT: '65536' }, { DB_PORT: '3306x' },
    { DB_NAME: undefined }, { DB_NAME: 'bad/name' }, { FIRST_ADMIN_BOOTSTRAP_DATABASE: undefined },
    { FIRST_ADMIN_BOOTSTRAP_DATABASE: 'other' },
    ...['mysql', 'sys', 'information_schema', 'performance_schema'].map((name) => ({ DB_NAME: name, FIRST_ADMIN_BOOTSTRAP_DATABASE: name })),
  ]) assert.throws(() => validateFirstAdminTarget({ ...env, ...change }), { code: 'BOOTSTRAP_CONFIGURATION_REQUIRED' });
});

test('bootstrap reuses registration email/password policy before hashing or acquiring a connection', async () => {
  for (const value of [null, '', 'bad', 'x'.repeat(255) + '@example.test', 'a\u0000@example.test']) {
    const f = fixture();
    await rejectsSafely(f.run({ email: value }), 'INVALID_EMAIL');
    assert.deepEqual(f.hashed, []); assert.deepEqual(f.steps, []);
  }
  for (const value of [null, '', 'Short7!', 'LongWithoutDigits!', 'LongWith1234', 'bad\n1234!', 'x'.repeat(71) + '7!']) {
    const f = fixture();
    await rejectsSafely(f.run({ password: value }), 'INVALID_PASSWORD');
    assert.deepEqual(f.hashed, []); assert.deepEqual(f.steps, []);
  }
  const f = fixture();
  const exact = 'é'.repeat(35) + '7!'; // Exactly 72 UTF-8 bytes.
  await f.run({ password: exact });
  assert.deepEqual(f.hashed, [[exact, 12]]);
  const tooLong = fixture();
  await rejectsSafely(tooLong.run({ password: exact + 'x' }), 'INVALID_PASSWORD');
  assert.deepEqual(tooLong.hashed, []);
});

test('bootstrap inserts one parameterized ADMIN/ACTIVE row, exact password hash and safe identity after cleanup', async () => {
  const f = fixture();
  assert.deepEqual(await f.run(), { accountId: '18446744073709551615', email: 'local.admin@example.test',
    role: 'ADMIN', accountStatus: 'ACTIVE' });
  assert.deepEqual(f.hashed, [[password, 12]]);
  assert.deepEqual(f.writes, [['local.admin@example.test', hash, 'ADMIN', 'ACTIVE']]);
  assert.deepEqual(f.steps, ['acquire', 'database', 'engine', 'lock', 'begin', 'admin-check', 'insert', 'commit', 'unlock', 'release']);
});

for (const status of ['ACTIVE', 'PENDING', 'SUSPENDED']) {
  test(`any existing ${status} Admin refuses creation without modifying Accounts`, async () => {
    const f = fixture({ existingAdmin: status });
    await rejectsSafely(f.run(), 'ADMIN_ALREADY_EXISTS');
    assert.deepEqual(f.writes, []);
    assert.deepEqual(f.steps.slice(-3), ['rollback', 'unlock', 'release']);
    assert.ok(!f.steps.includes('commit'));
  });
}

test('duplicate email is a safe refusal, never an upsert, promotion or reset', async () => {
  const f = fixture({ duplicate: true });
  await rejectsSafely(f.run(), 'EMAIL_CONFLICT');
  assert.deepEqual(f.writes, []);
  assert.deepEqual(f.steps.slice(-3), ['rollback', 'unlock', 'release']);
});

for (const stage of ['acquire', 'database', 'engine', 'lock', 'begin', 'admin-check', 'insert', 'commit']) {
  test(`bootstrap sanitizes ${stage} failures and disposes the transaction/lock safely`, async () => {
    const f = fixture({ failAt: stage });
    await rejectsSafely(f.run(), stage === 'commit' ? 'BOOTSTRAP_OUTCOME_UNKNOWN' : 'BOOTSTRAP_DATABASE_UNAVAILABLE');
    assert.equal(f.steps.filter((s) => s === 'release' || s === 'destroy').length, stage === 'acquire' ? 0 : 1);
    if (['begin', 'admin-check', 'insert', 'commit'].includes(stage)) {
      assert.deepEqual(f.steps.slice(-3), ['rollback', 'unlock', 'release']);
    }
    if (stage === 'lock') assert.equal(f.steps.at(-1), 'destroy');
  });
}

test('hash failures or a wrong-cost/malformed hash cannot reach the database', async () => {
  for (const options of [{ failAt: 'hash' }, { hash: 'plaintext' }, { hash: '$2b$10$' + 'A'.repeat(53) }]) {
    const f = fixture(options);
    await rejectsSafely(f.run(), 'BOOTSTRAP_HASH_UNAVAILABLE');
    assert.deepEqual(f.steps, []);
  }
});

test('wrong selected schema or missing/non-InnoDB Account refuses before writes', async () => {
  for (const options of [{ databaseName: 'other' }, { engine: 'MyISAM' }, { missingTable: true }]) {
    const f = fixture(options);
    await rejectsSafely(f.run(), options.databaseName ? 'BOOTSTRAP_CONFIGURATION_REQUIRED' : 'BOOTSTRAP_DATABASE_UNAVAILABLE');
    assert.equal(f.steps.at(-1), 'release');
    assert.ok(!f.steps.includes('lock')); assert.deepEqual(f.writes, []);
  }
});

test('lock timeout refuses cleanly; unconfirmed ownership destroys the connection', async () => {
  for (const lockResult of [0, '0', null, undefined, 2]) {
    const f = fixture({ lockResult });
    const timedOut = lockResult === 0 || lockResult === '0';
    await rejectsSafely(f.run(), timedOut ? 'BOOTSTRAP_BUSY' : 'BOOTSTRAP_DATABASE_UNAVAILABLE');
    assert.equal(f.steps.at(-1), timedOut ? 'release' : 'destroy');
    assert.ok(!f.steps.includes('begin')); assert.deepEqual(f.writes, []);
  }
});

test('invalid insertion metadata rolls back instead of confirming success', async () => {
  for (const options of [{ affectedRows: 0 }, { insertId: 0 }, { insertId: '18446744073709551616' }]) {
    const f = fixture(options);
    await rejectsSafely(f.run(), 'BOOTSTRAP_DATABASE_UNAVAILABLE');
    assert.deepEqual(f.steps.slice(-3), ['rollback', 'unlock', 'release']);
    assert.ok(!f.steps.includes('commit'));
  }
});

test('rollback failures destroy without unlocking/pooling an uncertain transaction', async () => {
  for (const destroyFails of [false, true]) {
    const f = fixture({ duplicate: true, rollbackFails: true, destroyFails });
    await rejectsSafely(f.run(), 'BOOTSTRAP_CLEANUP_FAILED');
    assert.deepEqual(f.steps.slice(-2), ['rollback', 'destroy']);
    assert.ok(!f.steps.includes('release')); assert.ok(!f.steps.includes('unlock'));
  }
});

test('unlock or pool-release failure after commit reports uncertain outcome, never success', async () => {
  for (const options of [{ failAt: 'unlock' }, { releaseResult: 0 }, { failAt: 'release' }]) {
    const f = fixture(options);
    await rejectsSafely(f.run(), 'BOOTSTRAP_OUTCOME_UNKNOWN');
    assert.equal(f.steps.at(-1), 'destroy');
    assert.equal(f.steps.filter((s) => s === 'commit').length, 1);
  }
});

test('cancellation before hashing or after insert rolls back; cancellation during commit cannot misreport a cancellation', async () => {
  const cancelled = new AbortController(); cancelled.abort();
  const early = fixture();
  await rejectsSafely(early.run({ signal: cancelled.signal }), 'BOOTSTRAP_CANCELLED');
  assert.deepEqual(early.hashed, []); assert.deepEqual(early.steps, []);
  const controller = new AbortController();
  const mid = fixture({ afterInsert: () => controller.abort() });
  await rejectsSafely(mid.run({ signal: controller.signal }), 'BOOTSTRAP_CANCELLED');
  assert.deepEqual(mid.steps.slice(-3), ['rollback', 'unlock', 'release']);
  assert.ok(!mid.steps.includes('commit'));
  const lateController = new AbortController();
  const late = fixture({ duringCommit: () => lateController.abort() });
  assert.equal((await late.run({ signal: lateController.signal })).role, 'ADMIN');
  assert.deepEqual(late.steps.slice(-3), ['commit', 'unlock', 'release']);
});

test('cancellation during connection/lock acquisition cleans up before any transaction or insert', async () => {
  for (const stage of ['afterAcquire', 'afterLock']) {
    const controller = new AbortController();
    const f = fixture({ [stage]: () => controller.abort() });
    await rejectsSafely(f.run({ signal: controller.signal }), 'BOOTSTRAP_CANCELLED');
    assert.ok(!f.steps.includes('begin')); assert.deepEqual(f.writes, []);
    assert.equal(f.steps.at(-1), 'release');
    if (stage === 'afterLock') assert.equal(f.steps.at(-2), 'unlock');
  }
});

test('cleanup failure on a rolled-back refusal is reported safely instead of hiding uncertain lock disposal', async () => {
  for (const failAt of ['unlock', 'release']) {
    const f = fixture({ duplicate: true, failAt });
    await rejectsSafely(f.run(), 'BOOTSTRAP_CLEANUP_FAILED');
    assert.equal(f.steps.at(-1), 'destroy');
    assert.ok(!f.steps.includes('commit'));
  }
});

test('two concurrent bootstrap callers serialize before beginning transactions and create only one Admin', async () => {
  const committed = [];
  const events = [];
  let owner;
  let waiter;
  let nextId = 0;
  let expectedLock;
  const pool = { async getConnection() {
    const id = ++nextId;
    let pending;
    return {
      async execute({ sql }, values) {
        if (sql.includes('SELECT DATABASE()')) return [[{ database_name: env.DB_NAME }]];
        if (sql.includes('information_schema.TABLES')) return [[{ ENGINE: 'InnoDB' }]];
        if (sql.includes('GET_LOCK')) {
          expectedLock ??= values[0]; assert.equal(values[0], expectedLock);
          if (owner) { events.push(`${id}:wait`); await new Promise((resolveWait) => { waiter = resolveWait; }); }
          owner = id; events.push(`${id}:lock`); return [[{ acquired: 1 }]];
        }
        if (sql.includes('FROM Account')) { assert.equal(owner, id); return [committed]; }
        if (sql.startsWith('INSERT INTO Account')) {
          assert.equal(owner, id); assert.equal(committed.length, 0);
          pending = { account_id: String(id) }; events.push(`${id}:insert`);
          return [{ affectedRows: 1, insertId: id }];
        }
        if (sql.includes('RELEASE_LOCK')) {
          assert.equal(owner, id); owner = undefined; events.push(`${id}:unlock`);
          waiter?.(); waiter = undefined; return [[{ released: 1 }]];
        }
        assert.fail('Unexpected concurrent bootstrap SQL.');
      },
      async beginTransaction() { events.push(`${id}:begin`); assert.equal(owner, id); },
      async commit() { committed.push(pending); events.push(`${id}:commit`); },
      async rollback() { pending = undefined; events.push(`${id}:rollback`); },
      release() { events.push(`${id}:release`); },
      destroy() { assert.fail('No connection should be destroyed in the successful concurrency probe.'); },
    };
  } };
  const invoke = () => bootstrapFirstAdmin({ databasePool: pool, env, email, password,
    passwordHasher: { async hash() { return hash; } } });
  const results = await Promise.allSettled([invoke(), invoke()]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(results.find((r) => r.status === 'rejected').reason.code, 'ADMIN_ALREADY_EXISTS');
  assert.equal(committed.length, 1);
  assert.ok(events.indexOf('2:wait') < events.indexOf('1:commit'));
  assert.ok(events.indexOf('1:commit') < events.indexOf('2:begin'));
  assert.equal(events.filter((e) => e.endsWith(':release')).length, 2);
});

function terminalFixture() {
  const input = new PassThrough();
  input.isTTY = true; input.isRaw = false;
  input.setRawMode = (raw) => { input.isRaw = raw; return input; };
  let printed = '';
  const output = new Writable({ write(chunk, _encoding, done) { printed += chunk.toString(); done(); } });
  output.isTTY = true;
  return { input, output, text: () => printed };
}

test('real prompt suppresses password/email echo and preserves exact Unicode/spaces, then restores raw mode', async () => {
  const tty = terminalFixture();
  const controller = new AbortController();
  const prompts = createFirstAdminPrompts({ ...tty, signal: controller.signal, cancel: () => controller.abort() });
  try {
    const answer = prompts.ask('Hidden input: ');
    const exact = '  é7!synthetic  ';
    tty.input.write(exact + '\r');
    assert.equal(await answer, exact);
    assert.equal(tty.text(), 'Hidden input: \n');
  } finally { prompts.close(); }
  assert.equal(tty.input.isRaw, false);
});

test('multiline typeahead cannot leak a pasted password through the email prompt', async () => {
  const tty = terminalFixture();
  const controller = new AbortController();
  const prompts = createFirstAdminPrompts({ ...tty, signal: controller.signal, cancel: () => controller.abort() });
  try {
    const answer = prompts.ask('Email (hidden): ');
    tty.input.write('local@example.test\rnever-echo-password\r');
    assert.equal(await answer, 'local@example.test');
    assert.equal(tty.text(), 'Email (hidden): \n');
  } finally { prompts.close(); }
});

for (const action of ['interrupt', 'eof']) {
  test(`real hidden prompt handles ${action} without exposing input and restores the terminal`, async () => {
    const tty = terminalFixture();
    const controller = new AbortController();
    const prompts = createFirstAdminPrompts({ ...tty, signal: controller.signal, cancel: () => controller.abort() });
    const answer = prompts.ask('Hidden input: ');
    tty.input.write('secret-draft');
    if (action === 'interrupt') tty.input.write('\u0003'); else tty.input.end();
    try { await rejectsSafely(answer, 'BOOTSTRAP_CANCELLED'); }
    finally { prompts.close(); }
    assert.equal(tty.input.isRaw, false);
    assert.doesNotMatch(tty.text(), /secret-draft/u);
  });
}

function cliFixture(options = {}) {
  const tty = terminalFixture();
  const signals = new EventEmitter();
  const f = fixture(options);
  let errors = '';
  const inputs = [email, password, options.confirmation ?? password];
  let loaded = 0;
  let closed = 0;
  let promptClosed = 0;
  const run = (overrides = {}) => runFirstAdminCli({ ...tty, signals,
    args: [], errorOutput: { write(value) { errors += value; } },
    loadRuntime: async () => { loaded++; return { env, databasePool: f.pool,
      async close() { closed++; if (options.poolCloseFails) throw rawFailure(); } }; },
    promptFactory: ({ cancel }) => ({ async ask() { if (options.cancel) cancel(); return inputs.shift(); },
      close() { promptClosed++; } }), ...overrides });
  return { ...f, tty, signals, run, errors: () => errors,
    counts: () => ({ loaded, closed, promptClosed }) };
}

test('CLI uses real bcrypt cost 12 with exact password, emits only safe identity, closes pool and listeners', async () => {
  const f = cliFixture();
  assert.equal(await f.run(), 0);
  const storedHash = f.writes[0][1];
  assert.equal(bcrypt.getRounds(storedHash), 12);
  assert.equal(await bcrypt.compare(password, storedHash), true);
  assert.equal(await bcrypt.compare(password.trim(), storedHash), false);
  const payload = JSON.parse(f.tty.text().slice('First Admin created. '.length));
  assert.deepEqual(Object.keys(payload), ['accountId', 'email', 'role', 'accountStatus']);
  assert.equal(payload.email, 'local.admin@example.test');
  assert.doesNotMatch(f.tty.text() + f.errors(), /Synthetic|\$2b\$|PRIVATE/u);
  assert.deepEqual(f.counts(), { loaded: 1, closed: 1, promptClosed: 1 });
  assert.equal(f.signals.listenerCount('SIGINT'), 0);
  assert.equal(f.signals.listenerCount('SIGTERM'), 0);
});

test('arguments and redirected input/output refuse before private runtime loading; arguments are never echoed', async () => {
  for (const overrides of [{ args: ['--password=never-echo-this'] }, { input: { isTTY: false } }, { output: { isTTY: false } }]) {
    const f = cliFixture();
    assert.equal(await f.run(overrides), 1);
    assert.deepEqual(f.counts(), { loaded: 0, closed: 0, promptClosed: 0 });
    assert.doesNotMatch(f.errors(), /never-echo-this/u);
    assert.deepEqual(f.steps, []);
  }
});

test('CLI confirmation mismatch or cancellation does not write and always closes the prompts/runtime', async () => {
  for (const options of [{ confirmation: 'other-value' }, { cancel: true }]) {
    const f = cliFixture(options);
    assert.equal(await f.run(), options.cancel ? 130 : 1);
    assert.deepEqual(f.steps, []);
    assert.equal(f.counts().closed, 1);
    assert.equal(f.counts().promptClosed, 1);
    assert.doesNotMatch(f.errors() + f.tty.text(), /Synthetic|other-value|PRIVATE/u);
  }
});

test('CLI handles a process termination signal without writes and removes its signal handlers', async () => {
  const f = cliFixture();
  assert.equal(await f.run({ promptFactory: () => ({
    async ask() { f.signals.emit('SIGTERM'); return password; }, close() {},
  }) }), 130);
  assert.deepEqual(f.steps, []);
  assert.equal(f.counts().closed, 1);
  assert.equal(f.signals.listenerCount('SIGINT'), 0);
  assert.equal(f.signals.listenerCount('SIGTERM'), 0);
});

test('CLI sanitizes config loading/pool cleanup failures and never confirms success before pool closure', async () => {
  const unloaded = cliFixture();
  assert.equal(await unloaded.run({ loadRuntime: async () => { throw rawFailure(); } }), 1);
  assert.doesNotMatch(unloaded.errors(), /PRIVATE|ER_TEST_PRIVATE/u);
  const f = cliFixture({ poolCloseFails: true });
  assert.equal(await f.run(), 1);
  assert.match(f.errors(), /BOOTSTRAP_OUTCOME_UNKNOWN/u);
  assert.equal(f.tty.text(), '');
  assert.equal(f.counts().closed, 1);
});
