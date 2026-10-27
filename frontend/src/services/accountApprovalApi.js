import { ACCOUNT_ACTIONS, accountAction, accountQuery, isAccountId, readAccountPage } from '../features/accounts/accountApprovals.js';

export function createAccountApprovalApi(client) {
  async function sendAction(accountId, action, { isCurrent, signal } = {}, matchesConfirmation = () => true) {
    if (!isAccountId(accountId) || typeof isCurrent !== 'function') throw new Error('Choose a current account confirmation.');
    const checkCurrent = () => {
      if (signal?.aborted || !isCurrent() || !matchesConfirmation()) throw Object.assign(new Error('Confirmation is no longer current.'), { code: 'OBSOLETE_APPROVAL' });
    };
    checkCurrent();
    const { status, data } = await client.get('/auth/csrf', { signal });
    checkCurrent();
    if (status !== 200 || data?.success !== true || typeof data.csrfToken !== 'string'
      || !/^[a-f0-9]{64}$/u.test(data.csrfToken)) throw new Error('Security token could not be confirmed.');
    let result;
    try {
      // Once dispatched this mutation is not aborted/retried. Cancelling the
      // obsolete UI/CSRF read does not undo a server transaction.
      checkCurrent();
      result = await client.patch(`/admin/accounts/${encodeURIComponent(accountId)}`, {
        accountStatus: action.to, reason: action.reason,
      }, { headers: { 'X-CSRF-Token': data.csrfToken } });
    } catch (error) {
      if (error?.code !== 'OBSOLETE_APPROVAL') { error.statusDispatched = true; if (action.key === 'APPROVE') error.approvalDispatched = true; }
      throw error;
    }
    if (result?.status !== 200 || result.data?.success !== true || result.data.accountId !== accountId
      || result.data.accountStatus !== action.to) {
      throw Object.assign(new Error('Account action outcome needs checking.'), { code: action.key === 'APPROVE' ? 'APPROVAL_OUTCOME_UNKNOWN' : 'ACCOUNT_STATUS_OUTCOME_UNKNOWN' });
    }
    return { accountId, accountStatus: action.to };
  }
  return {
    async listAccounts(filters, page, { signal } = {}) {
      const { status, data } = await client.get('/admin/accounts', { params: accountQuery(filters, page), signal });
      const result = status === 200 ? readAccountPage(data, page) : null;
      if (!result) throw new Error('The account queue response could not be confirmed.');
      return result;
    },
    approveAccount(accountId, options = {}) {
      return sendAction(accountId, ACCOUNT_ACTIONS.APPROVE, options);
    },
    async changeAccountStatus(confirmation, options = {}) {
      const action = ACCOUNT_ACTIONS[confirmation?.action];
      const accountId = confirmation?.account?.accountId;
      if (!action || accountAction(confirmation.account) !== action || confirmation.sourceStatus !== action.from) {
        throw new Error('Choose a current account confirmation.');
      }
      const captured = { ...confirmation.account };
      const matchesConfirmation = () => confirmation.action === action.key && confirmation.sourceStatus === action.from
        && ['accountId', 'role', 'accountStatus', 'email'].every(key => confirmation.account?.[key] === captured[key]);
      return sendAction(accountId, action, options, matchesConfirmation);
    },
  };
}
