import assert from 'node:assert/strict';
import { test } from 'node:test';
import { canUseRequests, cleanFilters, requestAvailability, requestFailure, requestId, timestamp, validateDraft } from '../src/features/blood-requests/model.js';
import { createBloodRequestApi, readRequest } from '../src/services/bloodRequestApi.js';

const row = { requestId: '9007199254740993', recipientGroupId: '4', recipientBloodGroupCode: 'A+', recipientBloodGroupName: 'A Positive', quantityRequested: 3, priority: 'URGENT', requestStatus: 'SUBMITTED', neededBy: '2035-10-28T10:00:00+05:30', note: null, createdAt: '2026-10-27T10:00:00+05:30' };
const body = { recipientGroupId: '4', quantityRequested: 3, priority: 'NORMAL', neededBy: '2035-10-28T10:00:00+05:30', note: null };
test('only ACTIVE Hospital/Admin accounts enter their respective request workspace', () => {
  for (const role of ['ADMIN', 'HOSPITAL']) {
    assert.equal(canUseRequests({ role, accountStatus: 'ACTIVE' }, role), true);
    for (const user of [null, { role, accountStatus: 'PENDING' }, { role, accountStatus: 'SUSPENDED' }, { role: 'DONOR', accountStatus: 'ACTIVE' }]) assert.equal(canUseRequests(user, role), false);
  }
  assert.deepEqual(requestAvailability, { reads: true, creation: true });
});
test('query filters and identifiers reject injection, unknown values and reversed dates', () => {
  assert.deepEqual(cleanFilters({ priority: 'URGENT', hospitalId: '31', q: 'ignored' }, true), { priority: 'URGENT', hospitalId: '31' });
  assert.deepEqual(cleanFilters({ hospitalId: '31' }), {});
  for (const draft of [{ priority: 'urgent' }, { requestStatus: 'ALLOCATED' }, { recipientGroupId: '4 OR 1=1' }, { neededByFrom: '2026-02-30' }, { submittedFrom: '2035-10-28', submittedTo: '2026-10-27' }]) assert.throws(() => cleanFilters(draft));
  for (const value of ['01', '1\n', '18446744073709551616', 1]) assert.throws(() => requestId(value));
});
test('draft validation preserves IST candidate meaning and exact creation fields', () => {
  const draft = { recipientGroupId: '4', quantityRequested: '3', priority: 'NORMAL', neededBy: '2035-10-28T10:00', note: '' };
  assert.deepEqual(validateDraft(draft), { errors: {}, body });
  for (const patch of [{ quantityRequested: '0' }, { quantityRequested: '1.5' }, { neededBy: '2026-02-30T10:00' }, { priority: 'urgent' }, { note: 'a\nprivate' }]) assert.ok(Object.keys(validateDraft({ ...draft, ...patch }).errors).length);
  assert.match(timestamp(body.neededBy), /IST$/u);
  assert.equal(timestamp('2035-10-28 10:00:00'), 'Time unavailable');
});
test('real API clients bind documented paths/filters and validate page metadata', async () => {
  const calls = [];
  const controller = new AbortController();
  const client = createBloodRequestApi({ get: async (...args) => { calls.push(args); return { data: { success: true, requests: [row], pagination: { page: 2, pageSize: 20, total: 21 } } }; } });
  const result = await client.list({ page: 2, priority: 'URGENT', hospitalId: '12', q: 'not-approved' }, { admin: true, signal: controller.signal });
  assert.deepEqual(calls[0], ['/admin/requests', { params: { priority: 'URGENT', hospitalId: '12', page: 2 }, signal: controller.signal }]);
  assert.equal(result.requests[0].requestId, row.requestId);
  await assert.rejects(client.list({ page: 0 }));
  for (const pagination of [{ page: 1, pageSize: 21, total: 1 }, { page: 1, pageSize: 20, total: -1 }, { page: 2, pageSize: 20, total: 0 }]) {
    await assert.rejects(createBloodRequestApi({ get: async () => ({ data: { success: true, requests: [row], pagination } }) }).list());
  }
});
test('detail checks identity and projects only safe data, genuine history and optional totals', async () => {
  const client = createBloodRequestApi({ get: async (path) => {
    assert.equal(path, `/hospitals/me/requests/${row.requestId}`);
    return { data: { success: true, request: { ...row, passwordHash: 'PRIVATE', donorId: 'PRIVATE', requestStatusHistory: [{ oldStatus: null, newStatus: 'SUBMITTED', changedAt: row.createdAt, safeNote: 'PRIVATE' }] } } };
  } });
  const result = await client.detail(row.requestId);
  assert.equal(result.outstandingQuantity, undefined);
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE/u);
  assert.equal(result.requestStatusHistory.length, 1);
  await assert.rejects(client.detail('91'));
  assert.throws(() => readRequest({ ...row, allocatedQuantity: 2, issuedQuantity: 2 }));
  assert.throws(() => readRequest({ ...row, allocatedQuantity: 1, issuedQuantity: 1, outstandingQuantity: 2 }));
});
test('creation defaults closed and opt-in adapter gets CSRF then accepts only confirmed creation', async () => {
  const calls = [];
  const transport = {
    get: async (...args) => { calls.push(args); return { data: { success: true, csrfToken: 'a'.repeat(64) } }; },
    post: async (...args) => { calls.push(args); return { status: 201, data: { success: true, requestId: '90', requestStatus: 'SUBMITTED', outstandingQuantity: 3 } }; },
  };
  await assert.rejects(createBloodRequestApi(transport).create(body));
  assert.equal(calls.length, 0);
  const result = await createBloodRequestApi(transport, { creationEnabled: true }).create({ ...body, hospitalId: '31' });
  assert.equal(result.requestId, '90');
  assert.equal(calls[0][0], '/auth/csrf');
  assert.deepEqual(calls[1][1], body);
  assert.equal(calls[1][2].headers['X-CSRF-Token'], 'a'.repeat(64));
  for (const status of [200, 503]) await assert.rejects(createBloodRequestApi({ ...transport, post: async () => ({ status, data: {} }) }, { creationEnabled: true }).create(body));
});
test('API error presentation is safe and distinguishes unavailable, missing and denied', () => {
  const error = (status, code) => ({ response: { status, data: { error: { code, message: 'PRIVATE SQL details' } } } });
  assert.equal(requestFailure(error(404, 'NOT_FOUND')).state, 'unavailable');
  assert.equal(requestFailure(error(404, 'REQUEST_NOT_FOUND')).state, 'missing');
  assert.equal(requestFailure(error(401, 'ACCOUNT_UNAVAILABLE')).state, 'denied');
  assert.doesNotMatch(requestFailure(error(503, 'DATABASE_UNAVAILABLE')).message, /PRIVATE/u);
});

test('authenticated group lookup returns only real validated identifiers and display choices', async () => {
  const calls = [];
  const api = createBloodRequestApi({ get: async (...args) => { calls.push(args); return { data: { success: true, bloodGroups: [{ bloodGroupId: '4', code: 'A+', displayName: 'A positive', secret: 'PRIVATE' }] } }; } });
  const groups = await api.groups();
  assert.equal(calls[0][0], '/blood-groups');
  assert.deepEqual(groups, [{ bloodGroupId: '4', code: 'A+', displayName: 'A positive' }]);
  await assert.rejects(createBloodRequestApi({ get: async () => ({ data: { success: true, bloodGroups: [{ bloodGroupId: '01', code: 'A+', displayName: 'A positive' }] } }) }).groups());
});

test('client future-deadline boundary matches second-precision server contract', () => {
  const draft = { recipientGroupId: '4', quantityRequested: '3', priority: 'NORMAL', neededBy: '2035-10-28T10:00:00', note: '' };
  const deadline = Date.parse('2035-10-28T10:00:00+05:30');
  assert.deepEqual(validateDraft(draft, { now: deadline - 1 }).errors, {});
  assert.match(validateDraft(draft, { now: deadline }).errors.neededBy, /future/u);
  assert.equal(requestFailure({ response: { status: 503, data: { error: { code: 'REQUEST_STORAGE_UNAVAILABLE' } } } }).state, 'unavailable');
});
