import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ACCOUNT_ACTIONS, accountAction, captureAccountAction, accountApprovalError } from '../src/features/accounts/accountApprovals.js';
import { createAccountApprovalApi } from '../src/services/accountApprovalApi.js';

const row = (role, status) => ({ accountId: '9007199254740993', email: 'disposable@example.test', role, accountStatus: status });
const token = 'c'.repeat(64);
function fixture(action, role = 'DONOR') {
  const calls = [];
  const confirmation = captureAccountAction(row(role, action.from), '31');
  const client = {
    async get(url, config) { calls.push({ url, config }); return { status: 200, data: { success: true, csrfToken: token } }; },
    async patch(url, data, config) { calls.push({ url, data, config }); return { status: 200, data: { success: true, accountId: confirmation.account.accountId, accountStatus: action.to } }; },
  };
  return { calls, client, confirmation, service: createAccountApprovalApi(client) };
}
function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }

for (const role of ['DONOR', 'HOSPITAL']) for (const action of Object.values(ACCOUNT_ACTIONS)) {
  test(`${role} ${action.key} captures its exact source/action and sends only its approved body`, async () => {
    const f = fixture(action, role); const controller = new AbortController();
    assert.equal(accountAction(f.confirmation.account, '31'), action);
    assert.ok(Object.isFrozen(f.confirmation) && Object.isFrozen(f.confirmation.account));
    assert.deepEqual(await f.service.changeAccountStatus(f.confirmation, { isCurrent: () => true, signal: controller.signal }),
      { accountId: f.confirmation.account.accountId, accountStatus: action.to });
    assert.equal(f.calls.length, 2); assert.equal(f.calls[0].url, '/auth/csrf'); assert.equal(f.calls[0].config.signal, controller.signal);
    assert.deepEqual(f.calls[1], { url: '/admin/accounts/9007199254740993', data: { accountStatus: action.to, reason: action.reason },
      config: { headers: { 'X-CSRF-Token': token } } });
  });
}
test('actions exclude Admin/self/invalid targets and unsupported states without widening permissions', () => {
  for (const target of [row('ADMIN', 'ACTIVE'), row('DONOR', 'unknown'), { ...row('DONOR', 'ACTIVE'), accountId: '31' },
    { ...row('HOSPITAL', 'SUSPENDED'), accountId: 7 }]) {
    assert.equal(accountAction(target, '31'), null); assert.throws(() => captureAccountAction(target, '31'));
  }
});
test('source/action mismatches never request CSRF or reinterpret stale approval as reactivation', async () => {
  for (const action of Object.values(ACCOUNT_ACTIONS)) {
    const f = fixture(action);
    for (const invalid of [{ ...f.confirmation, sourceStatus: 'wrong' }, { ...f.confirmation, action: 'unexpected' },
      { ...f.confirmation, account: { ...f.confirmation.account, accountStatus: action.to } }]) {
      await assert.rejects(f.service.changeAccountStatus(invalid, { isCurrent: () => true }));
    }
    assert.equal(f.calls.length, 0);
  }
});
test('delayed CSRF rechecks identity, selected source/action, and cancellation before any PATCH', async () => {
  for (const action of Object.values(ACCOUNT_ACTIONS)) for (const change of ['identity', 'source', 'action', 'email', 'abort']) {
    const f = fixture(action); const entered = deferred(); const release = deferred(); const controller = new AbortController();
    let current = true; const choice = { ...f.confirmation, account: { ...f.confirmation.account } };
    f.client.get = async () => { entered.resolve(); await release.promise; return { status: 200, data: { success: true, csrfToken: token } }; };
    const pending = f.service.changeAccountStatus(choice, { isCurrent: () => current, signal: controller.signal });
    await entered.promise;
    if (change === 'identity') current = false;
    if (change === 'source') choice.account.accountStatus = action.to;
    if (change === 'action') choice.action = action.key === 'APPROVE' ? 'REACTIVATE' : 'APPROVE';
    if (change === 'email') choice.account.email = 'changed@example.test';
    if (change === 'abort') controller.abort();
    release.resolve(); await assert.rejects(pending, { code: 'OBSOLETE_APPROVAL' }); assert.equal(f.calls.length, 0);
  }
});
test('every action rejects malformed success, wrong identity and wrong destination as uncertain', async () => {
  for (const action of Object.values(ACCOUNT_ACTIONS)) for (const response of [null, { status: 204, data: {} },
    { status: 200, data: { success: true, accountId: '2', accountStatus: action.to } },
    { status: 200, data: { success: true, accountId: '9007199254740993', accountStatus: action.from } },
    { status: 200, data: { success: false } }]) {
    const f = fixture(action); let patches = 0; f.client.patch = async () => { patches++; return response; };
    await assert.rejects(f.service.changeAccountStatus(f.confirmation, { isCurrent: () => true }), error => {
      assert.equal(accountApprovalError(error, action).kind, 'uncertain'); return true;
    }); assert.equal(patches, 1);
  }
});
test('status conflicts, dispatched failures and authorization errors stay distinct and safe without retries', async () => {
  for (const action of Object.values(ACCOUNT_ACTIONS)) for (const [status, code, kind] of [
    [409, action.key === 'APPROVE' ? 'ACCOUNT_APPROVAL_CONFLICT' : 'ACCOUNT_STATUS_CONFLICT', 'conflict'],
    [null, 'ECONNABORTED', 'uncertain'], [503, 'TRANSACTION_OUTCOME_UNKNOWN', 'uncertain'], [503, 'DATABASE_UNAVAILABLE', 'uncertain'],
    [401, 'ACCOUNT_UNAVAILABLE', 'error'], [403, 'CSRF_TOKEN_INVALID', 'error'],
  ]) {
    const f = fixture(action); let patches = 0;
    f.client.patch = async () => { patches++; throw Object.assign(new Error('PRIVATE'), { code,
      ...(status ? { response: { status, data: { error: { code, message: 'PRIVATE' } } } } : {}) }); };
    await assert.rejects(f.service.changeAccountStatus(f.confirmation, { isCurrent: () => true }), error => {
      const result = accountApprovalError(error, action); assert.equal(result.kind, kind); assert.doesNotMatch(result.message, /PRIVATE/);
      if (kind === 'uncertain') assert.match(result.message, /matching status does not prove/); return true;
    }); assert.equal(patches, 1);
  }
});
test('invalid CSRF or pre-dispatch transient failure cannot dispatch or masquerade as mutation uncertainty', async () => {
  for (const action of Object.values(ACCOUNT_ACTIONS)) {
    const f = fixture(action); let patches = 0; f.client.patch = async () => { patches++; };
    f.client.get = async () => ({ status: 200, data: { success: true, csrfToken: 'bad' } });
    await assert.rejects(f.service.changeAccountStatus(f.confirmation, { isCurrent: () => true }));
    f.client.get = async () => { throw { response: { status: 503 } }; };
    await assert.rejects(f.service.changeAccountStatus(f.confirmation, { isCurrent: () => true }), error => {
      assert.equal(accountApprovalError(error, action).kind, 'error'); return true;
    }); assert.equal(patches, 0);
  }
});
