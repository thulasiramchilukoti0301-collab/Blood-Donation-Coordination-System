// Real HTTP + MySQL against the explicitly authorized fresh server only.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mysqlStatements } from './helpers/mysql-script.mjs';
import { createApp } from '../../backend/src/app.js';
import { createAuthRuntime } from '../../backend/src/modules/auth/router.js';
import { createOperationalBloodRequestRouter } from '../../backend/src/modules/blood-requests/runtime.js';
import { createHospitalRouter } from '../../backend/src/modules/hospitals/router.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(resolve(root, 'backend/package.json'));
const mysql = require('mysql2/promise'); const bcrypt = require('bcrypt');
const schema = process.env.PHASE3_REQUEST_TEST_DATABASE;
const directory = process.env.PHASE3_REQUEST_TEST_DATA_DIRECTORY;
const port = Number(process.env.DB_PORT);
assert.match(schema || '', /^bddc_phase3_test_requests_feature7_[a-z0-9]+$/u);
assert.ok(port > 0 && port !== 3306 && process.env.DB_HOST === '127.0.0.1');
assert.equal(resolve(directory || '').toLowerCase(), resolve(root, '.tmp', `requests-mysql-${schema.slice('bddc_phase3_test_requests_'.length)}`, 'data').toLowerCase());
const pool = mysql.createPool({ host: '127.0.0.1', port, user: process.env.PHASE3_TEST_DB_USER, password: process.env.PHASE3_TEST_DB_PASSWORD,
  database: schema, connectionLimit: 4, multipleStatements: false, timezone: '+05:30', supportBigNumbers: true, bigNumberStrings: true });
pool.on('connection', (connection) => connection.query("SET time_zone = '+05:30'", (error) => { if (error) connection.destroy(); }));
let server; let checks = 0;
const check = (value, expected, message) => { assert.deepEqual(value, expected, message); checks++; };
try {
  const [[actual]] = await pool.query('SELECT DATABASE() AS db, @@datadir AS directory, @@port AS port');
  check(actual.db, schema); check(resolve(actual.directory).toLowerCase(), resolve(directory).toLowerCase()); check(Number(actual.port), port);
  for (const table of ['Account', 'Hospital', 'HospitalRequest', 'RequestStatusHistory', 'AuditEvent']) {
    const [[row]] = await pool.query(`SELECT COUNT(*) AS n FROM ${table}`); check(Number(row.n), 0);
  }
  for (const sql of mysqlStatements(await readFile(resolve(root, 'database/infrastructure/auth_sessions.sql'), 'utf8'))) await pool.query(sql);
  const password = 'Disposable request test7!'; const hash = await bcrypt.hash(password, 4);
  async function actor(role, status = 'ACTIVE') {
    const [result] = await pool.execute('INSERT INTO Account (email,password_hash,role,account_status) VALUES (?,?,?,?)', [`${role.toLowerCase()}-${status.toLowerCase()}-${checks++}@example.invalid`, hash, role, status]);
    const id = String(result.insertId);
    if (role === 'HOSPITAL') await pool.execute('INSERT INTO Hospital (account_id,organization_name,contact_name,phone,address) VALUES (?,?,?,?,?)', [id, 'Disposable Hospital', 'Disposable contact', '123', 'Isolated verification']);
    const [[row]] = await pool.execute('SELECT email FROM Account WHERE account_id=?', [id]); return { id, email: row.email };
  }
  const hospital = await actor('HOSPITAL'), other = await actor('HOSPITAL'), admin = await actor('ADMIN'), pending = await actor('HOSPITAL', 'PENDING'), donor = await actor('DONOR');
  const origin = 'http://localhost:5173';
  server = createApp({ authRuntime: createAuthRuntime({ databasePool: pool, frontendUrl: origin, env: { SESSION_SECRET: 'fresh-disposable-request-http-secret-over-32-bytes', SESSION_TTL_MINUTES: '5' } }),
    hospitalRouter: createHospitalRouter({ databasePool: pool }), bloodRequestRouter: createOperationalBloodRequestRouter({ databasePool: pool, frontendUrl: origin }), verifyDatabase: async () => true }).listen(0, '127.0.0.1');
  await new Promise((done) => server.once('listening', done));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  async function request(path, { method = 'GET', cookie, csrf, body } = {}) {
    const response = await fetch(`${base}${path}`, { method, headers: { Origin: origin, ...(cookie ? { Cookie: cookie } : {}), ...(csrf ? { 'X-CSRF-Token': csrf } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const data = await response.json();
    assert.doesNotMatch(JSON.stringify(data), /password_hash|session_data|SELECT |stack/iu); checks++;
    return { response, data };
  }
  async function token(cookie) {
    const { response, data } = await request('/auth/csrf', { cookie }); check(response.status, 200);
    return { cookie: response.headers.get('set-cookie')?.split(';')[0] || cookie, csrf: data.csrfToken };
  }
  async function login(account) {
    const anonymous = await token(); const { response } = await request('/auth/login', { ...anonymous, method: 'POST', body: { email: account.email, password } });
    check(response.status, 200); return token(response.headers.get('set-cookie').split(';')[0]);
  }
  check((await request('/hospitals/me/requests')).response.status, 401);
  const session = await login(hospital), second = await login(other), staff = await login(admin), waitlist = await login(pending), donorSession = await login(donor);
  check((await request('/hospitals/me/requests', waitlist)).response.status, 403);
  check((await request('/blood-groups', donorSession)).response.status, 403);
  check((await request('/admin/requests', session)).response.status, 403);
  const groups = await request('/blood-groups', session); check(groups.response.status, 200); check(groups.data.bloodGroups.length, 8);
  const deadline = new Date(Date.now() + 86400000).toISOString().slice(0, 19) + 'Z';
  const body = { recipientGroupId: '4', quantityRequested: 3, priority: 'URGENT', neededBy: deadline };
  check((await request('/hospitals/me/requests', { cookie: session.cookie, method: 'POST', body })).response.status, 403);
  const created = await request('/hospitals/me/requests', { ...session, method: 'POST', body }); check(created.response.status, 201);
  const id = created.data.requestId; assert.match(id, /^[1-9][0-9]*$/u); checks++;
  check(created.data.outstandingQuantity, 3);
  const detail = await request(`/hospitals/me/requests/${id}`, session); check(detail.response.status, 200);
  check(detail.response.headers.get('cache-control'), 'no-store'); check(detail.data.request.requestStatusHistory.length, 1);
  check(detail.data.request.requestStatusHistory[0].newStatus, 'SUBMITTED');
  assert.match(detail.data.request.neededBy, /\+05:30$/u); checks++;
  check(Date.parse(detail.data.request.neededBy), Date.parse(deadline)); check(Object.hasOwn(detail.data.request, 'issuedQuantity'), false);
  check((await request(`/hospitals/me/requests/${id}`, second)).response.status, 404);
  check((await request(`/admin/requests/${id}`, staff)).response.status, 200);
  check((await request('/hospitals/me/requests?priority=URGENT&page=1', session)).data.requests.length, 1);
  check((await request('/admin/requests?hospitalId=' + hospital.id, staff)).data.requests.length, 1);
  const [[audit]] = await pool.execute("SELECT COUNT(*) AS n FROM AuditEvent WHERE subject_type='HospitalRequest' AND subject_id=? AND action_code='HOSPITAL_REQUEST_CREATED'", [id]); check(Number(audit.n), 1);
  const [[history]] = await pool.execute('SELECT changed_by_account_id AS actor FROM RequestStatusHistory WHERE request_id=?', [id]); check(String(history.actor), hospital.id);
  await pool.execute('UPDATE BloodGroup SET is_active=0 WHERE blood_group_id=4');
  check((await request('/hospitals/me/requests', { ...session, method: 'POST', body })).response.status, 400);
  check((await request(`/hospitals/me/requests/${id}`, session)).response.status, 200);
  check((await request('/blood-groups', session)).data.bloodGroups.some((group) => group.bloodGroupId === '4'), false);
  await pool.execute("UPDATE Account SET account_status='SUSPENDED' WHERE account_id=?", [other.id]);
  check((await request('/hospitals/me/requests', second)).response.status, 401);
  await pool.execute('UPDATE BloodGroup SET is_active=1 WHERE blood_group_id=4');
  for (const neededBy of ['2020-01-01T12:00:00Z', '2035-02-30T12:00:00Z', '2035-01-01T12:00:00']) check((await request('/hospitals/me/requests', { ...session, method: 'POST', body: { ...body, neededBy } })).response.status, 400);
  // Inject a one-connection audit failure; verify the actual driver transaction rolls back.
  const { createBloodRequestService } = await import('../../backend/src/modules/blood-requests/service.js');
  const { createBloodRequestRepository } = await import('../../backend/src/modules/blood-requests/repository.js');
  const { createRequestContextAdapter } = await import('../../backend/src/modules/blood-requests/context.js');
  const { sessionAuthorization } = await import('../../backend/src/modules/accounts/sessionAuthorization.js');
  const [[stored]] = await pool.execute("SELECT session_id AS sid FROM app_session WHERE JSON_UNQUOTE(JSON_EXTRACT(session_data,'$.auth.accountId'))=? AND revoked_at IS NULL", [hospital.id]);
  const rollbackService = createBloodRequestService({ repository: createBloodRequestRepository(pool, { contextAdapter: createRequestContextAdapter({ enabled: true }) }),
    requestCreatedActionCode: 'HOSPITAL_REQUEST_CREATED', requestableBloodGroup: (group) => group.isActive === 1, auditWriter: { write: async () => { throw new Error('Isolated audit failure'); } } });
  const actorContext = { accountId: hospital.id, role: 'HOSPITAL', accountStatus: 'ACTIVE' };
  await assert.rejects(rollbackService.createHospitalRequest({ accountId: hospital.id, session: sessionAuthorization(stored.sid, actorContext) }, body), { code: 'DATABASE_UNAVAILABLE' }); checks++;
  const [[count]] = await pool.query('SELECT COUNT(*) AS n FROM HospitalRequest'); check(Number(count.n), 1);
  const [[historyCount]] = await pool.query('SELECT COUNT(*) AS n FROM RequestStatusHistory'); check(Number(historyCount.n), 1);
  // Inject only cleanup-method failures around actual mysql2 connections. The
  // real socket must be destroyed and never returned to the pool in either case.
  const { createAuditWriter } = await import('../../backend/src/modules/audit/writer.js');
  for (const mode of ['rollback', 'cleanup']) {
    const disposal = { release: 0, destroy: 0 };
    const wrappedPool = { execute: (...args) => pool.execute(...args), async getConnection() {
      const raw = await pool.getConnection(); let resets = 0;
      return {
        execute(sql, values) { if (sql.startsWith('SET') && !values && ++resets === 2 && mode === 'cleanup') throw new Error('Injected reset failure'); return raw.execute(sql, values); },
        beginTransaction: () => raw.beginTransaction(), commit: () => raw.commit(),
        rollback: () => { if (mode === 'rollback') throw new Error('Injected rollback failure'); return raw.rollback(); },
        release() { disposal.release++; raw.release(); }, destroy() { disposal.destroy++; raw.destroy(); },
      };
    } };
    const service = createBloodRequestService({ repository: createBloodRequestRepository(wrappedPool, { contextAdapter: createRequestContextAdapter({ enabled: true }) }),
      requestCreatedActionCode: 'HOSPITAL_REQUEST_CREATED', requestableBloodGroup: (group) => group.isActive === 1,
      auditWriter: mode === 'rollback' ? { write: async () => { throw new Error('Injected operation failure'); } }
        : createAuditWriter({ allowedActionCodes: ['HOSPITAL_REQUEST_CREATED'] }) });
    await assert.rejects(service.createHospitalRequest({ accountId: hospital.id, session: sessionAuthorization(stored.sid, actorContext) }, body),
      { code: mode === 'rollback' ? 'DATABASE_UNAVAILABLE' : 'TRANSACTION_OUTCOME_UNKNOWN' }); checks++;
    check(disposal, { release: 0, destroy: 1 });
    const [[rows]] = await pool.query('SELECT COUNT(*) AS n FROM HospitalRequest'); check(Number(rows.n), mode === 'rollback' ? 1 : 2);
    const fresh = await pool.getConnection();
    try { const [[state]] = await fresh.query('SELECT @request_actor_account_id AS actor, @request_reason_code AS reason, @request_system_operation_id AS operation'); check([state.actor, state.reason, state.operation], [null, null, null]); }
    finally { fresh.release(); }
  }
  // A loaded session tombstone must defeat both the HTTP guard and later replay.
  await pool.execute('UPDATE app_session SET revoked_at=?, session_data=NULL WHERE session_id=?', [Date.now(), stored.sid]);
  check((await request('/hospitals/me/requests', session)).response.status, 401);
  for (const path of [`/hospitals/me/requests/${id}/cancellation`, `/admin/requests/${id}/review`]) check((await request(path, { ...staff, method: 'POST', body: {} })).response.status, 404);
  await pool.query('CREATE TRIGGER extra_request_history_writer AFTER UPDATE ON HospitalRequest FOR EACH ROW SET @extra_request_trigger_seen = 1');
  const duplicate = await request('/admin/requests', staff); check(duplicate.response.status, 503); check(duplicate.data.error.code, 'REQUEST_STORAGE_UNAVAILABLE');
  await pool.query('DROP TRIGGER extra_request_history_writer');
  await pool.query('DROP TRIGGER trg_request_status_history_update'); // Fresh disposable schema only.
  const missing = await request('/admin/requests', staff); check(missing.response.status, 503); check(missing.data.error.code, 'REQUEST_STORAGE_UNAVAILABLE');
  console.log(`Disposable real HTTP/session/MySQL verification passed: ${checks} assertions; actual create/list/detail/lookup, ownership/roles, future/IST, deactivation, history/audit, audit-failure rollback, real-socket disposal on injected rollback/reset failures, revocation, missing-infrastructure refusal. No development connection.`);
} finally {
  if (server) { server.closeAllConnections(); await new Promise((done) => server.close(done)); }
  await pool.end();
}
