import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  DEFAULT_FILTERS, accountApprovalError, accountPages, accountQuery, accountTimestamp,
  canApproveAccounts, isAccountId, readAccountPage, validateAccountFilters,
} from '../src/features/accounts/accountApprovals.js';
import { createAccountApprovalApi } from '../src/services/accountApprovalApi.js';

const row = { accountId: '9007199254740993', email: 'fixture@example.test', role: 'DONOR',
  accountStatus: 'PENDING', createdAt: '2026-10-26 09:30:00' };
const page = { success: true, accounts: [row], pagination: { page: 1, pageSize: 20, total: 1 } };
const token = 'b'.repeat(64);
function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }
function clientFixture() {
  const calls = [];
  const client = {
    async get(url, config) { calls.push({ url, config }); return { status: 200, data: url === '/auth/csrf' ? { success: true, csrfToken: token } : page }; },
    async patch(url, data, config) { calls.push({ url, data, config }); return { status: 200, data: { success: true, accountId: row.accountId, accountStatus: 'ACTIVE' } }; },
  };
  return { client, calls, service: createAccountApprovalApi(client) };
}

test('Account approvals permit only an ACTIVE Admin and preserve exact BIGINT IDs', () => {
  const admin = { accountId: row.accountId, role: 'ADMIN', accountStatus: 'ACTIVE' };
  assert.equal(canApproveAccounts(admin), true);
  for (const id of ['1', row.accountId, '18446744073709551615']) assert.equal(isAccountId(id), true);
  for (const accountId of ['1\n', '01', '0', ' 1', 1, null, '18446744073709551616']) {
    assert.equal(isAccountId(accountId), false);
    assert.equal(canApproveAccounts({ ...admin, accountId }), false);
  }
  for (const user of [null, {}, { ...admin, role: 'DONOR' }, { ...admin, role: 'HOSPITAL' },
    { ...admin, accountStatus: 'PENDING' }, { ...admin, accountStatus: 'SUSPENDED' }]) assert.equal(canApproveAccounts(user), false);
});
test('Account filters match raw Unicode limits, exact statuses and omitted both-role query', () => {
  assert.deepEqual(accountQuery(DEFAULT_FILTERS, 1), { accountStatus: 'PENDING', page: 1 });
  assert.deepEqual(accountQuery({ role: 'HOSPITAL', accountStatus: 'ACTIVE', search: '  !_test%  ' }, 2),
    { role: 'HOSPITAL', accountStatus: 'ACTIVE', search: '!_test%', page: 2 });
  assert.equal(validateAccountFilters({ search: '\u{1F600}'.repeat(254) }).valid, true);
  for (const search of ['x'.repeat(255), ' '.repeat(255), '\u0085', 'a\n', {}, null]) assert.equal(validateAccountFilters({ search }).valid, false);
  for (const role of ['ALL', 'ADMIN', null, []]) assert.equal(validateAccountFilters({ role }).valid, false);
  for (const accountStatus of ['', 'ALL', 'pending', null]) assert.equal(validateAccountFilters({ accountStatus }).valid, false);
  for (const badPage of [0, '1', NaN, 1.1, Number.MAX_SAFE_INTEGER]) assert.throws(() => accountQuery(DEFAULT_FILTERS, badPage));
});
test('Account response projection drops secrets and rejects malformed rows/pagination', () => {
  assert.deepEqual(readAccountPage({ ...page, accounts: [{ ...row, passwordHash: 'SENTINEL', session: 'SENTINEL' }] }, 1),
    { accounts: [row], pagination: page.pagination });
  for (const response of [{ ...page, success: false }, { ...page, accounts: [row, row] },
    ...[{ accountId: 123 }, { accountId: '1\n' }, { role: 'ADMIN' }, { accountStatus: 'unknown' }, { email: null }, { createdAt: '2026-02-30 09:30:00' }]
      .map(change => ({ ...page, accounts: [{ ...row, ...change }] })),
    { ...page, pagination: { page: 1, pageSize: 10, total: 1 } }, { ...page, pagination: { page: 1, pageSize: 20, total: '1' } }]) {
    assert.equal(readAccountPage(response, 1), null);
  }
  assert.equal(accountPages({ total: 0 }), 1);
  assert.equal(accountPages({ total: 21 }), 2);
  assert.ok(readAccountPage({ ...page, accounts: [], pagination: { page: 2, pageSize: 20, total: 20 } }, 2));
});
test('Account DATETIME strings are explicitly interpreted as Asia/Kolkata, independent of local timezone', () => {
  assert.equal(new Date(accountTimestamp(row.createdAt).iso).toISOString(), '2026-10-26T04:00:00.000Z');
  for (const value of ['2026-02-30 01:00:00', '2026-13-01 01:00:00', '2026-10-26T09:30:00Z', 'bad', null]) assert.equal(accountTimestamp(value), null);
});
test('Account service uses shared-client GET and exact fresh-CSRF approval payload, no mutation signal/retry', async () => {
  const f = clientFixture();
  await f.service.listAccounts(DEFAULT_FILTERS, 1);
  const controller = new AbortController();
  assert.deepEqual(await f.service.approveAccount(row.accountId, { signal: controller.signal, isCurrent: () => true }),
    { accountId: row.accountId, accountStatus: 'ACTIVE' });
  assert.deepEqual(f.calls[0], { url: '/admin/accounts', config: { params: { accountStatus: 'PENDING', page: 1 }, signal: undefined } });
  assert.equal(f.calls[1].url, '/auth/csrf');
  assert.equal(f.calls[1].config.signal, controller.signal);
  assert.deepEqual(f.calls[2], { url: '/admin/accounts/' + row.accountId,
    data: { accountStatus: 'ACTIVE', reason: 'REGISTRATION_REVIEWED' }, config: { headers: { 'X-CSRF-Token': token } } });
});
test('obsolete identity/selection or aborted preflight cannot dispatch approval after delayed CSRF', async () => {
  for (const change of ['identity', 'abort']) {
    const f = clientFixture(); const entered = deferred(); const release = deferred();
    let current = true; const controller = new AbortController();
    f.client.get = async () => { entered.resolve(); await release.promise; return { status: 200, data: { success: true, csrfToken: token } }; };
    const result = f.service.approveAccount(row.accountId, { isCurrent: () => current, signal: controller.signal });
    await entered.promise;
    if (change === 'identity') current = false; else controller.abort();
    release.resolve();
    await assert.rejects(result, { code: 'OBSOLETE_APPROVAL' });
    assert.equal(f.calls.length, 0, 'No PATCH after obsolete CSRF completion.');
  }
});
test('unconfirmed CSRF and invalid account IDs never dispatch PATCH', async () => {
  const f = clientFixture();
  f.client.get = async () => ({ status: 200, data: { success: true, csrfToken: 'bad' } });
  await assert.rejects(f.service.approveAccount(row.accountId, { isCurrent: () => true }));
  await assert.rejects(f.service.approveAccount('1\n', { isCurrent: () => true }));
  await assert.rejects(f.service.approveAccount(row.accountId, { isCurrent: () => false }), { code: 'OBSOLETE_APPROVAL' });
  assert.equal(f.calls.length, 0);
});
test('approval requires a valid matching success response; malformed/uncertain responses are not successes', async () => {
  for (const data of [{ success: false }, { success: true, accountId: '2', accountStatus: 'ACTIVE' },
    { success: true, accountId: row.accountId, accountStatus: 'PENDING' }]) {
    const f = clientFixture(); f.client.patch = async () => ({ status: 200, data });
    await assert.rejects(f.service.approveAccount(row.accountId, { isCurrent: () => true }), { code: 'APPROVAL_OUTCOME_UNKNOWN' });
  }
  const f = clientFixture(); f.client.get = async () => ({ status: 200, data: { ...page, success: false } });
  await assert.rejects(f.service.listAccounts(DEFAULT_FILTERS, 1));
});
test('conflicts and dispatched timeouts/unknown commits have distinct safe messages and never retry PATCH', async () => {
  for (const [status, code, kind] of [[409, 'ACCOUNT_APPROVAL_CONFLICT', 'conflict'], [503, 'TRANSACTION_OUTCOME_UNKNOWN', 'uncertain'], [null, 'ECONNABORTED', 'uncertain'], [403, 'CSRF_TOKEN_INVALID', 'error']]) {
    const f = clientFixture(); let patches = 0;
    f.client.patch = async () => { patches++; throw Object.assign(new Error('PRIVATE DRIVER MESSAGE'), {
      code, ...(status ? { response: { status, data: { error: { code, message: 'PRIVATE' } } } } : {}),
    }); };
    await assert.rejects(f.service.approveAccount(row.accountId, { isCurrent: () => true }), error => {
      const result = accountApprovalError(error);
      assert.equal(result.kind, kind); assert.ok(!result.message.includes('PRIVATE')); return true;
    });
    assert.equal(patches, 1);
  }
});
