import { accountQuery, isAccountId, readAccountPage } from '../features/accounts/accountApprovals.js';

export function createAccountApprovalApi(client) {
  return {
    async listAccounts(filters, page, { signal } = {}) {
      const { status, data } = await client.get('/admin/accounts', { params: accountQuery(filters, page), signal });
      const result = status === 200 ? readAccountPage(data, page) : null;
      if (!result) throw new Error('The account queue response could not be confirmed.');
      return result;
    },
    async approveAccount(accountId, { isCurrent, signal } = {}) {
      if (!isAccountId(accountId) || typeof isCurrent !== 'function') throw new Error('Choose a current account confirmation.');
      const checkCurrent = () => {
        if (signal?.aborted || !isCurrent()) throw Object.assign(new Error('Confirmation is no longer current.'), { code: 'OBSOLETE_APPROVAL' });
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
          accountStatus: 'ACTIVE', reason: 'REGISTRATION_REVIEWED',
        }, { headers: { 'X-CSRF-Token': data.csrfToken } });
      } catch (error) {
        if (error?.code !== 'OBSOLETE_APPROVAL') error.approvalDispatched = true;
        throw error;
      }
      if (result.status !== 200 || result.data?.success !== true || result.data.accountId !== accountId
        || result.data.accountStatus !== 'ACTIVE') {
        throw Object.assign(new Error('Approval outcome needs checking.'), { code: 'APPROVAL_OUTCOME_UNKNOWN' });
      }
      return { accountId, accountStatus: 'ACTIVE' };
    },
  };
}
