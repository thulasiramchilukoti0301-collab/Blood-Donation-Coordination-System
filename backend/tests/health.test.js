import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createApp } from '../src/app.js';
import { environment, readDatabaseConfig } from '../src/config/environment.js';
import { verifyDatabaseConnection, closeDatabasePool } from '../src/config/database.js';
import { HttpError } from '../src/utils/httpError.js';

let server;
let baseUrl;
let checkDatabase;

before(async () => {
  server = createApp({ verifyDatabase: () => checkDatabase() }).listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await closeDatabasePool();
});

test('API liveness succeeds independently of the database and sets no cookie', async () => {
  checkDatabase = () => { throw new Error('Database must not be queried for liveness'); };
  const response = await fetch(`${baseUrl}/api/health`);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('set-cookie'), null);
  assert.deepEqual(await response.json(), {
    success: true, message: 'Blood Donation Coordination System API is running',
  });
});

test('database health succeeds only after a connectivity check', async () => {
  let calls = 0;
  checkDatabase = async () => { calls += 1; return true; };
  const response = await fetch(`${baseUrl}/api/health/db`);
  assert.equal(response.status, 200);
  assert.equal(calls, 1);
  assert.deepEqual(await response.json(), { success: true, database: 'connected' });
});

test('missing database configuration returns a safe 503', async () => {
  checkDatabase = () => verifyDatabaseConnection(null);
  const response = await fetch(`${baseUrl}/api/health/db`);
  assert.equal(response.status, 503);
  const body = await response.json();
  assert.equal(body.success, false);
  assert.equal(body.error.code, 'DATABASE_NOT_CONFIGURED');
});

test('database driver failures return 503 without leaking secrets', async () => {
  checkDatabase = () => verifyDatabaseConnection({
    getConnection: async () => { throw new Error('password=private-test-secret SQL SELECT * FROM account'); },
  });
  const response = await fetch(`${baseUrl}/api/health/db`);
  assert.equal(response.status, 503);
  const body = await response.text();
  assert.equal(JSON.parse(body).error.code, 'DATABASE_UNAVAILABLE');
  assert.doesNotMatch(body, /private-test-secret|SELECT|stack|password/);
});

test('unknown and unimplemented business routes return JSON 404', async () => {
  for (const path of ['/api/unknown', '/api/auth/me', '/api/inventory']) {
    const response = await fetch(`${baseUrl}${path}`);
    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), {
      success: false, error: { code: 'NOT_FOUND', message: 'API route not found.' },
    });
  }
});

test('malformed JSON is handled centrally without echoing the payload', async () => {
  const response = await fetch(`${baseUrl}/api/unknown`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"password":"private-test-secret",',
  });
  assert.equal(response.status, 400);
  const body = await response.text();
  assert.equal(JSON.parse(body).error.code, 'INVALID_JSON');
  assert.doesNotMatch(body, /private-test-secret|password|stack/);
});

test('unexpected failures use a safe 500 envelope', async () => {
  checkDatabase = async () => { throw new Error('private-test-secret'); };
  const response = await fetch(`${baseUrl}/api/health/db`);
  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), {
    success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: 'An unexpected server error occurred.' },
  });
});

test('credentialed CORS permits only the configured frontend origin', async () => {
  const allowed = await fetch(`${baseUrl}/api/health`, { headers: { Origin: environment.frontendUrl } });
  assert.equal(allowed.status, 200);
  assert.equal(allowed.headers.get('access-control-allow-origin'), environment.frontendUrl);
  assert.equal(allowed.headers.get('access-control-allow-credentials'), 'true');

  const denied = await fetch(`${baseUrl}/api/health`, { headers: { Origin: 'https://untrusted.invalid' } });
  assert.equal(denied.status, 403);
  assert.equal(denied.headers.get('access-control-allow-origin'), null);
  assert.equal((await denied.json()).error.code, 'ORIGIN_NOT_ALLOWED');
});

test('CORS preflight supports health requests with credentials', async () => {
  const response = await fetch(`${baseUrl}/api/health`, {
    method: 'OPTIONS', headers: { Origin: environment.frontendUrl, 'Access-Control-Request-Method': 'GET' },
  });
  assert.equal(response.status, 204);
  assert.equal(response.headers.get('access-control-allow-origin'), environment.frontendUrl);
  assert.equal(response.headers.get('access-control-allow-credentials'), 'true');
});

test('database probe executes SELECT 1 and releases its connection', async () => {
  let releases = 0;
  let statement;
  const connection = {
    query: async (query) => { statement = query; return [[{ connected: 1 }]]; },
    release: () => { releases += 1; },
  };
  assert.equal(await verifyDatabaseConnection({ getConnection: async () => connection }), true);
  assert.equal(statement.sql, 'SELECT 1 AS connected');
  assert.equal(statement.timeout, 5000);
  assert.equal(releases, 1);

  connection.query = async () => { throw new Error('private-test-secret'); };
  await assert.rejects(verifyDatabaseConnection({ getConnection: async () => connection }),
    (error) => error instanceof HttpError && error.status === 503 && error.code === 'DATABASE_UNAVAILABLE');
  assert.equal(releases, 2);
});

test('a non-successful SELECT result cannot be reported as connected', async () => {
  let released = false;
  await assert.rejects(verifyDatabaseConnection({ getConnection: async () => ({
    query: async () => [[{ connected: 0 }]], release: () => { released = true; },
  }) }), (error) => error.code === 'DATABASE_UNAVAILABLE');
  assert.equal(released, true);
});

test('database configuration has no implicit credentials and validates the port', () => {
  assert.equal(readDatabaseConfig({}).options, null);
  const env = { DB_HOST: '127.0.0.1', DB_USER: 'test', DB_PASSWORD: 'test-only', DB_NAME: 'test' };
  assert.equal(readDatabaseConfig({ ...env, DB_PORT: 'not-a-port' }).options, null);
  const { options } = readDatabaseConfig(env);
  assert.equal(options.port, 3306);
  assert.equal(options.multipleStatements, false);
  assert.equal(options.waitForConnections, false);
  assert.equal(options.timezone, '+05:30');
});
