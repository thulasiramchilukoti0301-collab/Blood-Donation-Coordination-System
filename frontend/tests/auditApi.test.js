import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cleanAuditFilters, createAuditApi, readAuditResponse } from '../src/services/auditApi.js';

const event = { eventId: '91', actorAccountId: '7', actionCode: 'ACCOUNT_APPROVED', subjectType: 'Account', subjectId: '80',
  occurredAt: '2026-10-28T14:25:00+05:30', reasonCode: 'REGISTRATION_REVIEWED', changeSummary: 'PENDING -> ACTIVE' };

test('audit client validates indexed filters, exact dates, query names and page bounds', () => {
  assert.deepEqual(cleanAuditFilters({ actorAccountId: '7', actionCode: 'ACCOUNT_APPROVED', subjectType: 'Account', subjectId: '80', from: '2026-10-01', to: '2026-10-31', page: 2, pageSize: 100 }),
    { actorAccountId: '7', actionCode: 'ACCOUNT_APPROVED', subjectType: 'Account', subjectId: '80', from: '2026-10-01', to: '2026-10-31', page: 2, pageSize: 100 });
  for (const filters of [{ search: 'secret' }, { actorAccountId: '01' }, { actionCode: 'bad code' }, { subjectType: 'account' },
    { from: '2026-02-30' }, { from: '2026-10-31', to: '2026-10-01' }, { page: 0 }, { pageSize: 200 }]) assert.throws(() => cleanAuditFilters(filters));
});

test('audit response preserves only approved safe event fields and newest-first order', () => {
  const response = readAuditResponse({ success: true, events: [{ ...event, passwordHash: 'SECRET', operationId: 'omit-me' }], pagination: { page: 1, pageSize: 25, total: 1 } }, { page: 1, pageSize: 25 });
  assert.deepEqual(response.events[0], event);
  assert.throws(() => readAuditResponse({ success: true, events: [{ ...event, subjectType: 'SYSTEM_TASK' }], pagination: { page: 1, pageSize: 25, total: 1 } }, { page: 1, pageSize: 25 }));
  assert.throws(() => readAuditResponse({ success: true, events: [{ ...event, occurredAt: '2026-02-30T14:25:00+05:30' }], pagination: { page: 1, pageSize: 25, total: 1 } }, { page: 1, pageSize: 25 }));
  assert.throws(() => readAuditResponse({ success: true, events: [event, { ...event, eventId: '92', occurredAt: '2026-10-29T14:25:00+05:30' }], pagination: { page: 1, pageSize: 25, total: 2 } }, { page: 1, pageSize: 25 }));
});

test('audit API sends only structured filters via GET and preserves AbortSignal', async () => {
  const calls = []; const controller = new AbortController();
  const api = createAuditApi({ async get(path, options) { calls.push({ path, options }); return { data: { success: true, events: [event], pagination: { page: 1, pageSize: 25, total: 1 } } }; },
    async post() { assert.fail('Audit API must be read only'); } });
  await api.list({ actionCode: 'ACCOUNT_APPROVED' }, { signal: controller.signal });
  assert.equal(calls[0].path, '/admin/audit-events');
  assert.equal(calls[0].options.signal, controller.signal);
  assert.deepEqual(calls[0].options.params, { page: 1, pageSize: 25, actionCode: 'ACCOUNT_APPROVED' });
});
