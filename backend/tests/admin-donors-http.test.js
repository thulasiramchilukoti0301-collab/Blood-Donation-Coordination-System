import assert from 'node:assert/strict';
import express from 'express';
import session from 'express-session';
import { test } from 'node:test';
import { createAdminDonorRouter } from '../src/modules/adminDonors/router.js';
import { adminDonorPatch } from '../src/modules/adminDonors/validation.js';
import { environment } from '../src/config/environment.js';
import { errorHandler } from '../src/middleware/errorHandler.js';

async function start(t) {
  const calls = [];
  const authService = { async authorizeSession(_sid, principal) { return { ...principal }; } };
  const donorService = {
    async list(actor, query) { calls.push(['list', actor, query]); return { donors: [], pagination: { page: 1, pageSize: 20, total: 0 } }; },
    async detail(actor, id) { calls.push(['detail', actor, id]); return { donorId: id, accountStatus: 'ACTIVE', reportedBloodGroup: { code: 'O+' }, confirmedBloodGroup: null }; },
    async update(actor, id, body, authorization) { adminDonorPatch(body); calls.push(['update', actor, id, body, authorization]); return { donorId: id, accountStatus: 'ACTIVE' }; },
  };
  const app = express(); app.use(express.json());
  app.use(session({ secret: 'fixture-session-secret-that-is-never-used-in-production', resave: false, saveUninitialized: true }));
  app.post('/fixture-login', (req, res) => {
    const role = req.query.role === 'DONOR' ? 'DONOR' : 'ADMIN';
    const accountStatus = ['PENDING', 'ACTIVE', 'SUSPENDED'].includes(req.query.status) ? req.query.status : 'ACTIVE';
    req.session.auth = { accountId: role === 'ADMIN' ? '31' : '41', role, accountStatus };
    req.session.csrfToken = 'a'.repeat(64);
    res.json({ success: true });
  });
  app.use('/api', createAdminDonorRouter({ authService, donorService, frontendUrl: environment.frontendUrl }));
  app.use(errorHandler);
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())); });
  const base = `http://127.0.0.1:${server.address().port}`;
  async function login(role, status = 'ACTIVE') {
    const response = await fetch(`${base}/fixture-login?role=${role}&status=${status}`, { method: 'POST' });
    return response.headers.get('set-cookie').split(';', 1)[0];
  }
  const request = (path, options = {}) => fetch(`${base}/api${path}`, { ...options,
    headers: { ...(options.cookie ? { Cookie: options.cookie } : {}), ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers },
    ...(options.body ? { body: JSON.stringify(options.body) } : {}) });
  return { request, login, calls };
}

test('Admin Donor routes require an authenticated ACTIVE Admin and ignore forged identity headers', async t => {
  const f = await start(t);
  assert.equal((await f.request('/admin/donors', { headers: { 'X-Role': 'ADMIN' } })).status, 401);
  const donor = await f.login('DONOR');
  assert.equal((await f.request('/admin/donors/41', { cookie: donor, headers: { 'X-Role': 'ADMIN' } })).status, 403);
  const suspendedAdmin = await f.login('ADMIN', 'SUSPENDED');
  assert.equal((await f.request('/admin/donors', { cookie: suspendedAdmin })).status, 401);
  assert.equal(f.calls.length, 0);
});

test('Admin Donor list/detail use no-store envelopes; PATCH requires trusted Origin and CSRF', async t => {
  const f = await start(t); const cookie = await f.login('ADMIN');
  const list = await f.request('/admin/donors?search=Fixture&page=1', { cookie });
  assert.equal(list.status, 200); assert.equal(list.headers.get('cache-control'), 'no-store');
  assert.deepEqual(Object.keys(await list.json()).sort(), ['donors', 'pagination', 'success']);
  const detail = await f.request('/admin/donors/41', { cookie });
  assert.equal(detail.status, 200); assert.equal(detail.headers.get('cache-control'), 'no-store');
  assert.deepEqual((await detail.json()).donor, { donorId: '41', accountStatus: 'ACTIVE', reportedBloodGroup: { code: 'O+' }, confirmedBloodGroup: null });
  const denied = await f.request('/admin/donors/41', { method: 'PATCH', cookie, body: { fullName: 'New' }, headers: { Origin: environment.frontendUrl } });
  assert.equal(denied.status, 403); assert.equal((await denied.json()).error.code, 'CSRF_TOKEN_INVALID');
  const saved = await f.request('/admin/donors/41', { method: 'PATCH', cookie, body: { fullName: 'New', originalValues: { fullName: 'Old' }, reasonCode: 'STAFF_PROFILE_CORRECTION' },
    headers: { Origin: environment.frontendUrl, 'X-CSRF-Token': 'a'.repeat(64) } });
  assert.equal(saved.status, 200); assert.deepEqual((await saved.json()).donor, { donorId: '41', accountStatus: 'ACTIVE' });
  assert.equal(f.calls.at(-1)[0], 'update'); assert.equal(f.calls.at(-1)[4].principal.role, 'ADMIN');
  assert.deepEqual(f.calls.at(-1)[3].originalValues, { fullName: 'Old' });
});

test('Admin Donor identifier routes reject unexpected query parameters', async t => {
  const f = await start(t); const cookie = await f.login('ADMIN');
  const response = await f.request('/admin/donors/41?fields=password', { cookie });
  assert.equal(response.status, 400); assert.equal((await response.json()).error.code, 'VALIDATION_ERROR');
});

test('Admin Donor HTTP PATCH requires exact original values for every changed field', async t => {
  const f = await start(t); const cookie = await f.login('ADMIN');
  const headers = { Origin: environment.frontendUrl, 'X-CSRF-Token': 'a'.repeat(64) };
  for (const body of [
    { fullName: 'Changed', reasonCode: 'STAFF_PROFILE_CORRECTION' },
    { fullName: 'Changed', originalValues: {}, reasonCode: 'STAFF_PROFILE_CORRECTION' },
    { fullName: 'Changed', phone: '555-0200', originalValues: { fullName: 'Old' }, reasonCode: 'STAFF_PROFILE_CORRECTION' },
    { confirmedBloodGroupId: '2', originalValues: { confirmedBloodGroupId: '' }, reasonCode: 'STAFF_GROUP_CONFIRMATION' },
  ]) {
    const response = await f.request('/admin/donors/41', { method: 'PATCH', cookie, body, headers });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error.code, 'VALIDATION_ERROR');
  }
  assert.equal(f.calls.some(([kind]) => kind === 'update'), false);
});
