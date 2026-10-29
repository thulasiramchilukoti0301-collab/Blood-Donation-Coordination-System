// Explicitly authorized fresh workspace-only MySQL verification. Never reads .env.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { dirname, resolve, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { mysqlStatements } from './helpers/mysql-script.mjs';

if (process.argv[2] !== '--allow-fresh-disposable') throw new Error('Explicit fresh disposable authorization required.');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const mysql = createRequire(resolve(root, 'backend/package.json'))('mysql2/promise');
const base = process.argv.find((arg) => arg.startsWith('--mysql-basedir='))?.slice('--mysql-basedir='.length)
  ?? 'C:/Program Files/MySQL/MySQL Server 8.0';
if (!/^C:[\\/]Program Files[\\/]MySQL[\\/]MySQL Server (?:8\.0|9\.1)$/iu.test(base)) {
  throw new Error('Only an installed MySQL 8.0 or 9.1 server base directory is supported.');
}
const label = `feature7_${randomUUID().replaceAll('-', '').slice(0, 10)}`;
const directory = resolve(root, '.tmp', `requests-mysql-${label}`);
const data = resolve(directory, 'data');
const within = relative(resolve(root, '.tmp'), directory);
assert.ok(within && !within.startsWith('..') && !isAbsolute(within));
await mkdir(directory); // Never reuse a directory or existing server.
const env = Object.fromEntries(['SystemRoot', 'WINDIR', 'PATH', 'Path', 'TEMP', 'TMP', 'COMSPEC', 'PATHEXT'].filter((key) => process.env[key] !== undefined).map((key) => [key, process.env[key]]));
function run(executable, args, extra = {}) {
  return new Promise((done, reject) => {
    const child = spawn(executable, args, { cwd: root, env: { ...env, ...extra }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', (chunk) => { output += chunk; }); child.stderr.on('data', (chunk) => { output += chunk; });
    child.on('error', reject);
    child.on('close', (code) => code === 0 ? done(output) : reject(new Error(`Verification child failed (${code}): ${output.slice(-1800)}`)));
  });
}
const socket = createServer(); await new Promise((done) => socket.listen(0, '127.0.0.1', done));
const port = socket.address().port; await new Promise((done) => socket.close(done));
assert.notEqual(port, 3306);
console.log(`Fresh disposable target: ${relative(root, directory)}, loopback port ${port}`);
await run(resolve(base, 'bin/mysqld.exe'), ['--no-defaults', '--initialize-insecure', `--basedir=${base}`, `--datadir=${data}`]);
const server = spawn(resolve(base, 'bin/mysqld.exe'), ['--no-defaults', `--basedir=${base}`, `--datadir=${data}`, '--bind-address=127.0.0.1', `--port=${port}`, '--mysqlx=0', '--skip-log-bin', '--console'], { cwd: directory, env, windowsHide: true, stdio: ['ignore', 'ignore', 'ignore'] });
let connection;
try {
  for (let i = 0; i < 120; i++) {
    try { connection = await mysql.createConnection({ host: '127.0.0.1', port, user: 'root', password: '', connectTimeout: 500 }); break; }
    catch { if (server.exitCode !== null) throw new Error('Fresh MySQL server exited.'); await new Promise((done) => setTimeout(done, 250)); }
  }
  assert.ok(connection, 'Fresh server started');
  const [[actual]] = await connection.query('SELECT @@datadir AS directory, @@port AS port, VERSION() AS version');
  assert.equal(resolve(actual.directory).toLowerCase(), data.toLowerCase()); assert.equal(Number(actual.port), port);
  const schema = `bddc_phase3_test_requests_${label}`;
  await connection.query(`CREATE DATABASE ${schema} CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`);
  await connection.changeUser({ database: schema });
  await connection.query("SET time_zone = '+05:30'");
  for (const file of ['migrations/001_foundation.sql', 'migrations/002_auth.sql', 'seeds/reference_data.sql', 'migrations/004_hospitals.sql', 'migrations/008_blood_requests.sql', 'migrations/010_audit.sql', 'migrations/012_request_status_history.sql']) {
    for (const sql of mysqlStatements(await readFile(resolve(root, 'database', file), 'utf8'))) await connection.query(sql);
  }
  const extra = { PHASE3_REQUEST_TEST_DATABASE: schema, PHASE3_REQUEST_TEST_EMPTY_DATABASE: 'YES', DB_HOST: '127.0.0.1', DB_PORT: String(port), PHASE3_REQUEST_TEST_DATA_DIRECTORY: data,
    PHASE3_TEST_DB_USER: 'root', PHASE3_TEST_DB_PASSWORD: '', NODE_ENV: 'test' };
  console.log(`MySQL ${actual.version}; assembled 001/002/reference/004/008/010/012`);
  console.log(await run(process.execPath, ['database/tests/verify-blood-requests.mjs'], extra));
  if (process.argv.includes('--http')) console.log(await run(process.execPath, ['--experimental-loader', './backend/tests/helpers/no-private-env-loader.mjs', 'database/tests/verify-request-http.mjs'], extra));
} finally {
  if (connection) {
    try { await connection.query('SHUTDOWN'); } catch { /* Only the freshly spawned process below may be stopped. */ }
    try { await connection.end(); } catch {}
  }
  if (server.exitCode === null) {
    await Promise.race([new Promise((done) => server.once('exit', done)), new Promise((done) => setTimeout(done, 5000))]);
    if (server.exitCode === null) server.kill();
  }
}
console.log('Fresh disposable verification complete; server stopped. Development database untouched.');
