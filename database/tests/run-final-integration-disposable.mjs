// Fresh isolated MySQL instance for authorized final HTTP integration checks.
// Does not read .env, contact the development DB, or execute migration 009.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, readFile, rm } from 'node:fs/promises';
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
  ?? 'C:/Program Files/MySQL/MySQL Server 9.1';
assert.match(base.replaceAll('\\', '/'), /^C:\/Program Files\/MySQL\/MySQL Server (?:8\.0|9\.1)$/iu);
const label = randomUUID().replaceAll('-', '').slice(0, 10);
const directory = resolve(root, '.tmp', `final-mysql-${label}`);
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
    child.on('error', reject); child.on('close', (code) => code === 0 ? done(output) : reject(new Error(`Disposable verifier failed (${code}): ${output.slice(-2400)}`)));
  });
}
const socket = createServer(); await new Promise((done) => socket.listen(0, '127.0.0.1', done));
const port = socket.address().port; await new Promise((done) => socket.close(done)); assert.notEqual(port, 3306);
console.log(`Fresh disposable MySQL target: ${relative(root, directory)} on loopback port ${port}`);
await run(resolve(base, 'bin/mysqld.exe'), ['--no-defaults', '--initialize-insecure', `--basedir=${base}`, `--datadir=${data}`]);
const server = spawn(resolve(base, 'bin/mysqld.exe'), ['--no-defaults', `--basedir=${base}`, `--datadir=${data}`, '--bind-address=127.0.0.1', `--port=${port}`, '--mysqlx=0', '--skip-log-bin', '--console'], { cwd: directory, env, windowsHide: true, stdio: ['ignore', 'ignore', 'ignore'] });
let connection; let schema;
try {
  for (let i = 0; i < 120; i++) {
    try { connection = await mysql.createConnection({ host: '127.0.0.1', port, user: 'root', password: '', connectTimeout: 500 }); break; }
    catch { if (server.exitCode !== null) throw new Error('Fresh MySQL server exited.'); await new Promise((done) => setTimeout(done, 250)); }
  }
  assert.ok(connection, 'Fresh MySQL server started');
  const [[actual]] = await connection.query('SELECT @@datadir AS directory, @@port AS port, VERSION() AS version');
  assert.equal(resolve(actual.directory).toLowerCase(), data.toLowerCase()); assert.equal(Number(actual.port), port);
  schema = `bddc_phase3_test_final_${label}`;
  await connection.query(`CREATE DATABASE ${schema} CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`);
  await connection.changeUser({ database: schema }); await connection.query("SET time_zone = '+05:30'");
  for (const file of ['migrations/001_foundation.sql', 'migrations/002_auth.sql', 'infrastructure/auth_sessions.sql', 'seeds/reference_data.sql', 'migrations/003_donors.sql', 'migrations/004_hospitals.sql', 'migrations/005_eligibility_booking.sql', 'migrations/006_donations.sql', 'migrations/007_inventory.sql', 'migrations/008_blood_requests.sql', 'migrations/010_audit.sql', 'migrations/012_request_status_history.sql']) {
    for (const sql of mysqlStatements(await readFile(resolve(root, 'database', file), 'utf8'))) await connection.query(sql);
  }
  // Cancellation's pre-allocation check needs an empty relation. This test-only view
  // deliberately models no active rows and cannot create or mutate allocations.
  await connection.query("CREATE VIEW Allocation AS SELECT CAST(NULL AS UNSIGNED) AS request_id, CAST(NULL AS CHAR(16)) AS allocation_status WHERE 1=0");
  const vars = { DB_HOST: '127.0.0.1', DB_PORT: String(port), DB_NAME: schema, DB_USER: 'root', DB_PASSWORD: 'disposable-only', FRONTEND_URL: 'http://localhost:5173', SESSION_SECRET: randomUUID() + randomUUID(), SESSION_TTL_MINUTES: '120', NODE_ENV: 'test' };
  // Create a disposable-only passworded app user; this user has no privileges outside this fresh schema.
  await connection.query("CREATE USER 'bddc_app'@'127.0.0.1' IDENTIFIED BY 'disposable-only'");
  await connection.query(`GRANT ALL PRIVILEGES ON \`${schema}\`.* TO 'bddc_app'@'127.0.0.1'`);
  vars.DB_USER = 'bddc_app';
  await connection.end(); connection = null;
  console.log(`MySQL ${actual.version}; assembled approved prerequisites, skipping 009.`);
  console.log(await run(process.execPath, ['--experimental-loader', './backend/tests/helpers/no-private-env-loader.mjs', 'database/tests/verify-final-integration-http.mjs'], vars));
} finally {
  if (connection) { try { await connection.query('SHUTDOWN'); } catch {} try { await connection.end(); } catch {} }
  if (!connection && schema && /^bddc_phase3_test_final_[a-f0-9]{10}$/u.test(schema)) {
    let cleanup;
    try {
      cleanup = await mysql.createConnection({ host: '127.0.0.1', port, user: 'root', password: '', connectTimeout: 1000 });
      await cleanup.query(`DROP DATABASE IF EXISTS \`${schema}\``);
      await cleanup.query("DROP USER IF EXISTS 'bddc_app'@'127.0.0.1'");
      await cleanup.query('SHUTDOWN');
    } catch { /* The freshly spawned server is stopped below if SQL cleanup is unavailable. */ }
    finally { if (cleanup) try { await cleanup.end(); } catch {} }
  }
  if (server.exitCode === null) {
    await new Promise((done) => { const timer = setTimeout(done, 3000); server.once('exit', () => { clearTimeout(timer); done(); }); });
    if (server.exitCode === null) server.kill();
    await new Promise((done) => { if (server.exitCode !== null) done(); else server.once('exit', done); });
  }
  const resolvedTmp = resolve(root, '.tmp');
  assert.equal(relative(resolvedTmp, directory).startsWith('..'), false);
  await rm(directory, { recursive: true, force: false });
  console.log(`Disposable schema, user, server, and isolated files removed; development DB untouched.`);
}
