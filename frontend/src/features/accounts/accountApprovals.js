export const ACCOUNT_STATUSES = Object.freeze(['PENDING', 'ACTIVE', 'SUSPENDED']);
export const ACCOUNT_ROLES = Object.freeze(['DONOR', 'HOSPITAL']);
export const DEFAULT_FILTERS = Object.freeze({ role: '', accountStatus: 'PENDING', search: '' });

export function isAccountId(value) {
  return typeof value === 'string' && /^[1-9][0-9]{0,19}$/u.exec(value)?.[0] === value
    && BigInt(value) <= 18446744073709551615n;
}
export function canApproveAccounts(user) {
  return Boolean(isAccountId(user?.accountId) && user.role === 'ADMIN' && user.accountStatus === 'ACTIVE');
}
export function validateAccountFilters(input = {}) {
  const { role = '', accountStatus = 'PENDING', search = '' } = input;
  const errors = {};
  if (role !== '' && !ACCOUNT_ROLES.includes(role)) errors.role = 'Choose both roles, Donor or Hospital.';
  if (!ACCOUNT_STATUSES.includes(accountStatus)) errors.accountStatus = 'Choose an available account status.';
  if (typeof search !== 'string' || [...search].length > 254) errors.search = 'Use no more than 254 characters.';
  else if (/\p{Cc}/u.test(search)) errors.search = 'Remove control characters from your search.';
  return { valid: !Object.keys(errors).length, errors,
    values: { role, accountStatus, search: typeof search === 'string' ? search.trim() : '' } };
}
export function accountQuery(filters, page) {
  const validation = validateAccountFilters(filters);
  if (!validation.valid || !Number.isSafeInteger(page) || page < 1 || page > Math.floor(Number.MAX_SAFE_INTEGER / 20)) {
    throw new Error('Review the account filters and page.');
  }
  return { ...(validation.values.role ? { role: validation.values.role } : {}),
    accountStatus: validation.values.accountStatus,
    ...(validation.values.search ? { search: validation.values.search } : {}), page };
}
// The API returns project-local MySQL DATETIME text, not UTC or browser-local time.
export function accountTimestamp(value) {
  if (typeof value !== 'string' || !/^[1-9][0-9]{3}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$/u.test(value)) return null;
  const iso = value.replace(' ', 'T') + '+05:30';
  const parsed = new Date(iso);
  if (!Number.isFinite(parsed.getTime()) || new Date(parsed.getTime() + 19_800_000).toISOString().slice(0, 19).replace('T', ' ') !== value) return null;
  return { iso, label: new Intl.DateTimeFormat('en-IN', {
    dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata',
  }).format(parsed) };
}
export function readAccountPage(input, expectedPage) {
  const p = input?.pagination;
  if (input?.success !== true || !Array.isArray(input.accounts) || input.accounts.length > 20
    || !p || p.page !== expectedPage || !Number.isSafeInteger(p.page) || p.page < 1
    || p.pageSize !== 20 || !Number.isSafeInteger(p.total) || p.total < 0) return null;
  const accounts = [];
  for (const row of input.accounts) {
    if (!row || !isAccountId(row.accountId) || !ACCOUNT_ROLES.includes(row.role)
      || !ACCOUNT_STATUSES.includes(row.accountStatus) || typeof row.email !== 'string'
      || !row.email.trim() || [...row.email].length > 254 || /\p{Cc}/u.test(row.email)
      || !accountTimestamp(row.createdAt)) return null;
    accounts.push({ accountId: row.accountId, email: row.email, role: row.role,
      accountStatus: row.accountStatus, createdAt: row.createdAt });
  }
  if (new Set(accounts.map(row => row.accountId)).size !== accounts.length) return null;
  return { accounts, pagination: { page: p.page, pageSize: 20, total: p.total } };
}
export function accountPages(p) { return Math.max(1, Math.ceil(p.total / 20)); }
export function accountApprovalError(error) {
  if (error?.code === 'OBSOLETE_APPROVAL') return { kind: 'obsolete', message: '' };
  const status = error?.response?.status;
  const code = error?.response?.data?.error?.code;
  if (status === 409 && code === 'ACCOUNT_APPROVAL_CONFLICT') return { kind: 'conflict',
    message: 'This account changed before approval. The queue is being refreshed; no approval by you is confirmed.' };
  if (error?.code === 'APPROVAL_OUTCOME_UNKNOWN' || (error?.approvalDispatched
    && (!error.response || status >= 500 || code === 'TRANSACTION_OUTCOME_UNKNOWN'))) return { kind: 'uncertain',
    message: 'The approval outcome could not be confirmed. Check the refreshed queue before deciding what to do next. Do not submit the approval again without checking.' };
  if (status === 401) return { kind: 'error', message: 'Your sign-in must be checked again.' };
  if (status === 403) return { kind: 'error', message: 'Approval was not authorized. Check your Admin access and try again with a fresh confirmation.' };
  if (status === 400 || status === 404) return { kind: 'error', message: 'The account or approval input was not accepted. Refresh the queue and review the selected account.' };
  return { kind: 'error', message: 'Approval could not be submitted. Refresh the queue and try again with a fresh confirmation.' };
}
