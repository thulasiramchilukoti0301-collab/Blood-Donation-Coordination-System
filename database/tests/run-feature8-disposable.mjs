// Starts a new private MySQL instance under .tmp; no configured/development DB is read.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, resolve, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import { mysqlStatements } from './helpers/mysql-script.mjs';

if (process.argv[2] !== '--allow-fresh-disposable') throw new Error('Explicit fresh disposable authorization required.');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const mysql = createRequire(resolve(root, 'backend/package.json'))('mysql2/promise');
const base = process.argv.find((arg) => arg.startsWith('--mysql-basedir='))?.slice('--mysql-basedir='.length)
  ?? 'C:/Program Files/MySQL/MySQL Server 8.0';
assert.match(base.replaceAll('\\', '/'), /^C:\/Program Files\/MySQL\/MySQL Server (?:8\.0|9\.1)$/iu,
  'only an installed MySQL 8.0 or 9.1 server base directory is supported');
const label = `feature8_${randomUUID().replaceAll('-', '').slice(0, 10)}`;
const directory = resolve(root, '.tmp', `feature8-mysql-${label}`);
const data = resolve(directory, 'data');
const within = relative(resolve(root, '.tmp'), directory);
assert.ok(within && !within.startsWith('..') && !isAbsolute(within));
await mkdir(directory, { recursive: false });
const env = Object.fromEntries(['SystemRoot', 'WINDIR', 'PATH', 'Path', 'TEMP', 'TMP', 'COMSPEC', 'PATHEXT']
  .filter((key) => process.env[key] !== undefined).map((key) => [key, process.env[key]]));
function run(executable, args, extra = {}) {
  return new Promise((done, reject) => {
    const child = spawn(executable, args, { cwd: root, env: { ...env, ...extra }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', (chunk) => { output += chunk; }); child.stderr.on('data', (chunk) => { output += chunk; });
    child.on('error', reject);
    child.on('close', (code) => code === 0 ? done(output) : reject(new Error(`Verifier failed (${code}): ${output.slice(-2400)}`)));
  });
}
const socket = createServer(); await new Promise((done) => socket.listen(0, '127.0.0.1', done));
const port = socket.address().port; await new Promise((done) => socket.close(done));
assert.notEqual(port, 3306);
console.log(`Fresh Feature 8 disposable instance: ${relative(root, directory)}; loopback port ${port}`);
await run(resolve(base, 'bin/mysqld.exe'), ['--no-defaults', '--initialize-insecure', `--basedir=${base}`, `--datadir=${data}`]);
const server = spawn(resolve(base, 'bin/mysqld.exe'), ['--no-defaults', `--basedir=${base}`, `--datadir=${data}`,
  '--bind-address=127.0.0.1', `--port=${port}`, '--mysqlx=0', '--skip-log-bin', '--console'],
{ cwd: directory, env, windowsHide: true, stdio: ['ignore', 'ignore', 'ignore'] });
const serverExit = new Promise((done) => server.once('exit', (code, signal) => done({ code, signal })));
const assertPortClosed = async () => {
  const probe = createServer();
  const occupied = await new Promise((done) => {
    probe.once('error', () => done(true));
    probe.listen(port, '127.0.0.1', () => { probe.close(() => done(false)); });
  });
  assert.equal(occupied, false, 'fresh disposable MySQL port is closed');
};
let connection;
let schema;
try {
  for (let i = 0; i < 120; i++) {
    try { connection = await mysql.createConnection({ host: '127.0.0.1', port, user: 'root', password: '', connectTimeout: 500 }); break; }
    catch { if (server.exitCode !== null) throw new Error('Fresh MySQL server exited.'); await new Promise((done) => setTimeout(done, 250)); }
  }
  assert.ok(connection, 'fresh disposable server started');
  const [[actual]] = await connection.query('SELECT @@datadir AS directory, @@port AS port, VERSION() AS version');
  assert.equal(resolve(actual.directory).toLowerCase(), data.toLowerCase()); assert.equal(Number(actual.port), port);
  schema = `bddc_phase3_test_feature8_${label}`;
  await connection.query(`CREATE DATABASE ${schema} CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`);
  await connection.changeUser({ database: schema });
  await connection.query("SET time_zone = '+05:30'");
  for (const file of ['migrations/001_foundation.sql', 'migrations/002_auth.sql', 'seeds/reference_data.sql',
    'migrations/003_donors.sql', 'migrations/004_hospitals.sql', 'migrations/005_eligibility_booking.sql',
    'migrations/006_donations.sql', 'migrations/007_inventory.sql', 'migrations/008_blood_requests.sql']) {
    for (const sql of mysqlStatements(await readFile(resolve(root, 'database', file), 'utf8'))) await connection.query(sql);
  }
  const extra = { PHASE3_FEATURE8_TEST_DATABASE: schema, PHASE3_FEATURE8_TEST_DATA_DIRECTORY: directory,
    DB_HOST: '127.0.0.1', DB_PORT: String(port), PHASE3_FEATURE8_TEST_DB_USER: 'root', PHASE3_FEATURE8_TEST_DB_PASSWORD: '' };
  console.log(`MySQL ${actual.version}; assembled exact 001-008 prerequisites on the fresh instance.`);
  console.log(await run(process.execPath, ['database/tests/verify-compatibility-allocation.mjs'], extra));
  console.log('Verified Feature 8 schema on disposable MySQL; server stopped. Development database was never configured or contacted.');
} finally {
  if (connection) {
    if (schema && /^bddc_phase3_test_feature8_[a-z0-9_]+$/i.test(schema)) {
      try {
        await connection.changeUser({ database: 'mysql' });
        await connection.query(`DROP DATABASE IF EXISTS \`${schema}\``);
        const [[left]] = await connection.execute('SELECT COUNT(*) AS n FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = ?', [schema]);
        assert.equal(Number(left.n), 0, 'disposable schema removed');
        console.log('Disposable schema and fixtures removed.');
      } catch (error) { console.error(`Disposable schema cleanup failed: ${error.message}`); }
    }
    try { await connection.query('SHUTDOWN'); } catch { /* Only the fresh child server is stopped below. */ }
    try { await connection.end(); } catch {}
  }
  if (server.exitCode === null) {
    await Promise.race([serverExit, new Promise((done) => setTimeout(done, 5000))]);
    if (server.exitCode === null) {
      server.kill();
      await Promise.race([serverExit, new Promise((done) => setTimeout(done, 5000))]);
    }
    assert.notEqual(server.exitCode, null, 'fresh disposable mysqld process exited');
  }
  await assertPortClosed();
}
