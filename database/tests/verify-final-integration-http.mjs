// Real production routers/services + HTTP + MySQL on a fresh disposable database.
// dotenv is replaced by no-private-env-loader; only explicit disposable env is supplied.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const bcrypt = createRequire(new URL('../../backend/package.json', import.meta.url))('bcrypt');
import { pool, closeDatabasePool } from '../../backend/src/config/database.js';
import { createApp } from '../../backend/src/app.js';

const origin = process.env.FRONTEND_URL;
const baseSchema = process.env.DB_NAME;
const allowedSchema = /^bddc_phase3_test_final_[a-z0-9]+$/u;
assert.match(baseSchema ?? '', allowedSchema);
assert.equal(process.env.DB_HOST, '127.0.0.1');
assert.ok(Number(process.env.DB_PORT) > 0 && Number(process.env.DB_PORT) !== 3306);
assert.ok(origin && /^http:\/\/localhost:\d+$/u.test(origin));
assert.ok(pool, 'Disposable-only MySQL configuration is required.');
let server;
let checks = 0;
const check = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks++; };
const pass = (condition, message) => { assert.ok(condition, message); checks++; };
const cookieValue = (response) => response.headers.get('set-cookie')?.match(/bdcs\.sid=[^;]+/u)?.[0];

try {
  const [[target]] = await pool.query('SELECT DATABASE() AS schemaName, @@datadir AS dataDirectory, @@port AS port');
  check(target.schemaName, baseSchema);
  check(Number(target.port), Number(process.env.DB_PORT));
  check(await pool.execute('SELECT 1'), await pool.execute('SELECT 1'));
  for (const table of ['Account', 'Donor', 'Hospital', 'HospitalRequest', 'RequestStatusHistory', 'AuditEvent', 'Donation', 'BloodUnit']) {
    const [[row]] = await pool.query(`SELECT COUNT(*) AS total FROM ${table}`);
    check(Number(row.total), 0, `Fresh disposable ${table} table starts empty.`);
  }

  const adminEmail = 'integration-admin@example.invalid';
  const adminPassword = 'Disposable Admin9!';
  const adminHash = await bcrypt.hash(adminPassword, 4);
  const [adminInsert] = await pool.execute(
    "INSERT INTO Account (email,password_hash,role,account_status) VALUES (?,?,'ADMIN','ACTIVE')",
    [adminEmail, adminHash],
  );
  const adminId = String(adminInsert.insertId);

  server = createApp().listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  const apiBase = `http://127.0.0.1:${server.address().port}/api`;

  async function request(path, { method = 'GET', cookie, csrf, body } = {}) {
    const response = await fetch(`${apiBase}${path}`, {
      method,
      headers: {
        Origin: origin,
        ...(cookie ? { Cookie: cookie } : {}),
        ...(csrf ? { 'X-CSRF-Token': csrf } : {}),
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const data = await response.json();
    const serialized = JSON.stringify(data);
    assert.doesNotMatch(serialized, /password_hash|passwordHash|session_data|SESSION_SECRET|SELECT |stack/iu);
    checks++;
    return { response, data };
  }
  async function csrfSession(cookie = undefined) {
    const result = await request('/auth/csrf', { cookie });
    check(result.response.status, 200);
    const token = result.data.csrfToken;
    pass(/^[a-f0-9]{64}$/u.test(token), 'CSRF endpoint returns a real session token.');
    return { cookie: cookieValue(result.response) ?? cookie, csrf: token };
  }
  async function login(email, password) {
    const anonymous = await csrfSession();
    const result = await request('/auth/login', {
      ...anonymous, method: 'POST', body: { email, password },
    });
    check(result.response.status, 200, 'Login succeeds against the real Account table.');
    const authenticatedCookie = cookieValue(result.response);
    pass(Boolean(authenticatedCookie), 'Login persists a server session cookie.');
    const session = await csrfSession(authenticatedCookie);
    const identity = await request('/auth/me', session);
    check(identity.response.status, 200);
    return session;
  }
  async function mutate(path, session, method, body) {
    const fresh = await csrfSession(session.cookie);
    return request(path, { ...fresh, method, body });
  }

  const admin = await login(adminEmail, adminPassword);

  const hospitalEmail = 'workflow-hospital@example.invalid';
  const hospitalPassword = 'Hospital Demo9!';
  const hospitalRegistration = await request('/auth/register/hospitals', {
    ...(await csrfSession()), method: 'POST', body: {
      email: hospitalEmail,
      password: hospitalPassword,
      organizationName: 'Disposable Workflow Hospital',
      registrationNumber: 'E2E-HOSP-001',
      contactName: 'Workflow Contact',
      phone: '+91 9876543210',
      address: 'Disposable test address',
    },
  });
  check(hospitalRegistration.response.status, 201, 'Hospital registration uses the real HTTP service.');
  const hospitalId = hospitalRegistration.data.accountId;
  pass(/^[1-9][0-9]*$/u.test(hospitalId), 'Hospital Account ID is returned as a decimal string.');
  check(hospitalRegistration.data.accountStatus, 'PENDING');
  const [[hospitalRows]] = await pool.execute(
    'SELECT COUNT(*) AS total FROM Hospital WHERE account_id = ?', [hospitalId],
  );
  check(Number(hospitalRows.total), 1, 'Hospital registration persists Account and Hospital together.');
  const pendingLogin = await login(hospitalEmail, hospitalPassword);
  const pendingRequest = await request('/hospitals/me/requests', pendingLogin);
  check(pendingRequest.response.status, 403, 'Pending Hospital cannot create operational requests.');

  const approval = await mutate(`/admin/accounts/${hospitalId}`, admin, 'PATCH', {
    accountStatus: 'ACTIVE', reason: 'REGISTRATION_REVIEWED',
  });
  check(approval.response.status, 200, 'ACTIVE Admin approves the real pending Hospital.');
  check(approval.data.accountStatus, 'ACTIVE');
  const hospital = await login(hospitalEmail, hospitalPassword);
  const ownProfile = await request('/hospitals/me', hospital);
  check(ownProfile.response.status, 200);
  check(ownProfile.data.profile.organizationName, 'Disposable Workflow Hospital');
  const adminHospitalList = await request('/admin/hospitals', admin);
  check(adminHospitalList.response.status, 200);
  check(adminHospitalList.data.hospitals.length, 1);

  const donorEmail = 'workflow-donor@example.invalid';
  const donorPassword = 'Donor Demo9!';
  const donorRegistration = await request('/auth/register/donors', {
    ...(await csrfSession()), method: 'POST', body: {
      email: donorEmail,
      password: donorPassword,
      fullName: 'Disposable Workflow Donor',
      dateOfBirth: '1992-03-04',
      phone: '+91 9123456780',
      address: 'Disposable donor address',
      area: 'Test area',
      reportedBloodGroupId: '1',
    },
  });
  check(donorRegistration.response.status, 201, 'Donor registration uses the real HTTP service.');
  const donorId = donorRegistration.data.accountId;
  const donorApproval = await mutate(`/admin/accounts/${donorId}`, admin, 'PATCH', {
    accountStatus: 'ACTIVE', reason: 'REGISTRATION_REVIEWED',
  });
  check(donorApproval.response.status, 200);
  const donor = await login(donorEmail, donorPassword);
  const donorProfile = await request('/donors/me', donor);
  check(donorProfile.response.status, 200);
  check(donorProfile.data.profile.fullName, 'Disposable Workflow Donor');
  check((await request('/donors/me', hospital)).response.status, 403);

  const neededBy = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 19) + 'Z';
  const requestBody = { recipientGroupId: '4', quantityRequested: 3, priority: 'URGENT', neededBy, note: 'Disposable test request' };
  const missingCsrf = await request('/hospitals/me/requests', { cookie: hospital.cookie, method: 'POST', body: requestBody });
  check(missingCsrf.response.status, 403, 'Request creation rejects missing CSRF.');
  const createRequest = await mutate('/hospitals/me/requests', hospital, 'POST', requestBody);
  check(createRequest.response.status, 201);
  const requestId = createRequest.data.requestId;
  pass(/^[1-9][0-9]*$/u.test(requestId), 'HospitalRequest ID is a decimal string.');
  check(createRequest.data.outstandingQuantity, 3);
  const [[savedRequest]] = await pool.execute(
    'SELECT request_status AS status, quantity_requested AS quantity FROM HospitalRequest WHERE request_id = ?', [requestId],
  );
  check([savedRequest.status, Number(savedRequest.quantity)], ['SUBMITTED', 3], 'Request mutation persists in MySQL.');
  const initialHistory = await request(`/hospitals/me/requests/${requestId}`, hospital);
  check(initialHistory.response.status, 200);
  check(initialHistory.data.request.requestStatusHistory.map((item) => item.newStatus), ['SUBMITTED']);

  const review = await mutate(`/admin/requests/${requestId}/review`, admin, 'POST', { decision: 'UNDER_REVIEW' });
  check(review.response.status, 200, 'Admin review uses the real HTTP route and trigger.');
  check(review.data.requestStatus, 'UNDER_REVIEW');
  const [[reviewRows]] = await pool.execute(
    'SELECT COUNT(*) AS total FROM RequestStatusHistory WHERE request_id = ? AND new_status = ?',
    [requestId, 'UNDER_REVIEW'],
  );
  check(Number(reviewRows.total), 1, 'The status trigger writes exactly one review history row.');
  const duplicateReview = await mutate(`/admin/requests/${requestId}/review`, admin, 'POST', { decision: 'UNDER_REVIEW' });
  check(duplicateReview.response.status, 409, 'Duplicate review does not create another history/audit event.');

  const cancellationWithoutCsrf = await request(`/hospitals/me/requests/${requestId}/cancellation`, {
    cookie: hospital.cookie, method: 'POST', body: {},
  });
  check(cancellationWithoutCsrf.response.status, 403, 'Cancellation rejects missing CSRF.');
  const cancellation = await mutate(`/hospitals/me/requests/${requestId}/cancellation`, hospital, 'POST', {});
  check(cancellation.response.status, 200, 'Owning Hospital cancels through the real API against an empty Allocation fixture.');
  check(cancellation.data.requestStatus, 'CANCELLED');
  const finalDetail = await request(`/hospitals/me/requests/${requestId}`, hospital);
  check(finalDetail.response.status, 200);
  check(finalDetail.data.request.requestStatusHistory.map((item) => item.newStatus),
    ['SUBMITTED', 'UNDER_REVIEW', 'CANCELLED'], 'Trigger-backed status history persists exactly once per transition.');
  const [historyActors] = await pool.execute(`SELECT new_status AS status, CAST(changed_by_account_id AS CHAR) AS actorId, reason_code AS reason
    FROM RequestStatusHistory WHERE request_id = ? ORDER BY request_status_history_id`, [requestId]);
  check(historyActors, [
    { status: 'SUBMITTED', actorId: hospitalId, reason: null },
    { status: 'UNDER_REVIEW', actorId: adminId, reason: 'REVIEW_STARTED' },
    { status: 'CANCELLED', actorId: hospitalId, reason: 'HOSPITAL_CANCELLED' },
  ], 'Status history carries the authenticated actor and exact transition reason.');
  const duplicateCancellation = await mutate(`/hospitals/me/requests/${requestId}/cancellation`, hospital, 'POST', {});
  check(duplicateCancellation.response.status, 409, 'Terminal cancellation retry is a conflict.');

  const [[auditRows]] = await pool.execute(`SELECT action_code AS action, COUNT(*) AS total FROM AuditEvent
    WHERE subject_type = 'HospitalRequest' AND subject_id = ? GROUP BY action_code ORDER BY action_code`, [requestId]);
  check(Number(auditRows.total), 1, 'Review/cancellation audit rows persist in MySQL.');
  const [[eventCounts]] = await pool.execute(`SELECT
      SUM(action_code = 'HOSPITAL_REQUEST_CREATED') AS created,
      SUM(action_code = 'HOSPITAL_REQUEST_STATUS_CHANGED') AS reviewed,
      SUM(action_code = 'HOSPITAL_REQUEST_CANCELLED') AS cancelled
    FROM AuditEvent WHERE subject_type='HospitalRequest' AND subject_id=?`, [requestId]);
  check([Number(eventCounts.created), Number(eventCounts.reviewed), Number(eventCounts.cancelled)], [1, 1, 1]);
  const [auditActors] = await pool.execute(`SELECT action_code AS action, CAST(actor_account_id AS CHAR) AS actorId,
    subject_type AS subjectType, CAST(subject_id AS CHAR) AS subjectId, COUNT(*) AS total FROM AuditEvent
    WHERE subject_type = 'HospitalRequest' AND subject_id = ? GROUP BY action_code, actor_account_id, subject_type, subject_id ORDER BY action_code`, [requestId]);
  check(auditActors.map((row) => [row.action, row.actorId, row.subjectType, row.subjectId, Number(row.total)]), [
    ['HOSPITAL_REQUEST_CANCELLED', hospitalId, 'HospitalRequest', requestId, 1],
    ['HOSPITAL_REQUEST_CREATED', hospitalId, 'HospitalRequest', requestId, 1],
    ['HOSPITAL_REQUEST_STATUS_CHANGED', adminId, 'HospitalRequest', requestId, 1],
  ], 'Audit rows preserve the authenticated actor, exact subject, and one event per action.');
  const auditLog = await request(`/admin/audit-events?subjectType=HospitalRequest&subjectId=${requestId}&page=1&pageSize=25`, admin);
  check(auditLog.response.status, 200);
  check(auditLog.data.events.length, 3, 'Admin Audit Log reads actual persisted events.');
  check(auditLog.data.events.map((item) => item.actionCode).sort(),
    ['HOSPITAL_REQUEST_CANCELLED', 'HOSPITAL_REQUEST_CREATED', 'HOSPITAL_REQUEST_STATUS_CHANGED'].sort());

  const adminDashboard = await request('/admin/dashboard', admin);
  check(adminDashboard.response.status, 200);
  check(Number(adminDashboard.data.counts.donors), 1);
  check(Number(adminDashboard.data.counts.hospitals), 1);
  const hospitalDashboard = await request('/hospitals/me/dashboard', hospital);
  check(hospitalDashboard.response.status, 200);
  check(hospitalDashboard.data.requests.length, 1);
  check(hospitalDashboard.data.recent[0].status, 'CANCELLED');
  const inventoryReport = await request('/admin/reports/inventory', admin);
  check(inventoryReport.response.status, 200);
  check(inventoryReport.data.inventory, [], 'Real inventory report reflects the empty BloodUnit table.');
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const donationReport = await request(`/admin/reports/donations?from=${today}&to=${today}&interval=DAY`, admin);
  check(donationReport.response.status, 200);
  check(donationReport.data.donations, []);
  const requestReport = await request(`/admin/reports/requests?from=${today}&to=${today}&interval=DAY`, admin);
  check(requestReport.response.status, 200, `Request report API response: ${JSON.stringify(requestReport.data)}`);
  check(requestReport.data.statuses.length, 1);
  check(requestReport.data.statuses[0].status, 'CANCELLED');
  check(Number(requestReport.data.statuses[0].quantity), 3);

  const logout = await mutate('/auth/logout', hospital, 'POST', {});
  check(logout.response.status, 200);
  const hospitalAgain = await login(hospitalEmail, hospitalPassword);
  const persistentDetail = await request(`/hospitals/me/requests/${requestId}`, hospitalAgain);
  check(persistentDetail.response.status, 200);
  check(persistentDetail.data.request.requestStatus, 'CANCELLED', 'Hospital login again reads persisted request state.');

  await pool.query(`CREATE TRIGGER e2e_fail_request_audit BEFORE INSERT ON AuditEvent FOR EACH ROW
    BEGIN IF NEW.action_code = 'HOSPITAL_REQUEST_CREATED' THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='E2E rollback'; END IF; END`);
  const beforeRollback = await pool.query('SELECT COUNT(*) AS total FROM HospitalRequest');
  const failedCreate = await mutate('/hospitals/me/requests', hospitalAgain, 'POST', { ...requestBody, priority: 'NORMAL' });
  check(failedCreate.response.status, 503, 'Audit failure propagates as a safe API error.');
  const [[afterRollback]] = await pool.query('SELECT COUNT(*) AS total FROM HospitalRequest');
  check(Number(afterRollback.total), Number(beforeRollback[0][0].total), 'Audit failure rolls back the real request insert.');
  const [[historyAfterRollback]] = await pool.query('SELECT COUNT(*) AS total FROM RequestStatusHistory');
  check(Number(historyAfterRollback.total), 3, 'Audit failure leaves no extra history row.');
  await pool.query('DROP TRIGGER e2e_fail_request_audit');

  const [[historyTotal]] = await pool.execute('SELECT COUNT(*) AS total FROM RequestStatusHistory WHERE request_id = ?', [requestId]);
  check(Number(historyTotal.total), 3);
  const [[approvedEvents]] = await pool.execute(`SELECT COUNT(*) AS total FROM AuditEvent
    WHERE action_code = 'ACCOUNT_APPROVED' AND subject_type = 'Account' AND subject_id IN (?,?)`, [hospitalId, donorId]);
  check(Number(approvedEvents.total), 2, 'Admin approvals are also persisted audit events.');
  console.log(`Disposable real HTTP/MySQL integration passed: ${checks} assertions; Hospital/Donor registration and approval, login/profile, request create/review/cancel, trigger history, audit log, dashboards/reports, persistence, CSRF and rollback.`);
  console.log('The disposable schema intentionally omitted migration 009; an empty test-only Allocation view exercised only pre-allocation Hospital cancellation. No allocation lifecycle was tested or enabled.');
} finally {
  if (server) {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
  await closeDatabasePool();
}
