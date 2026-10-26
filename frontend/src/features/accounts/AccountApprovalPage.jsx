import { useEffect, useRef, useState } from 'react';
import { Navigate } from 'react-router-dom';
import AuthLayout from '../auth/AuthLayout';
import { useAuth } from '../auth/AuthProvider';
import { approveAccount, listAccounts } from '../../services/accounts';
import {
  ACCOUNT_ROLES, ACCOUNT_STATUSES, DEFAULT_FILTERS, accountApprovalError, accountPages,
  accountTimestamp, canApproveAccounts, validateAccountFilters,
} from './accountApprovals';
import './accounts.css';

function Feedback({ title, message, retry, busy = false }) {
  return <section className="mint-card mint-admin-feedback" aria-busy={busy}>
    <h2>{title}</h2><p role={busy ? 'status' : 'alert'}>{message}</p>
    {retry && <button className="mint-button mint-button-secondary" onClick={retry}>Try again</button>}
  </section>;
}

export default function AccountApprovalPage() {
  const { user, loading, restoreError, restore, authLifecycle, getAuthLifecycle } = useAuth();
  if (loading) return <AuthLayout theme="mint" wide><Feedback title="Restoring your account" message="Checking your sign-in status…" busy /></AuthLayout>;
  if (!user && restoreError) return <AuthLayout theme="mint" wide><Feedback title="Could not check your account" message={restoreError} retry={() => void restore()} /></AuthLayout>;
  if (!user) return <Navigate to="/login" replace />;
  if (!canApproveAccounts(user)) return <Navigate to="/unauthorized" replace />;
  // A fresh same-ID login gets a new workspace, not an old directory/confirmation.
  return <AccountWorkspace key={`${authLifecycle}:${user.accountId}:${user.role}:${user.accountStatus}`}
    version={authLifecycle} getAuthLifecycle={getAuthLifecycle} />;
}

function AccountWorkspace({ version, getAuthLifecycle }) {
  const [draft, setDraft] = useState({ ...DEFAULT_FILTERS });
  const [errors, setErrors] = useState({});
  const [request, setRequest] = useState({ filters: { ...DEFAULT_FILTERS }, page: 1, revision: 0, outcome: null });
  const [list, setList] = useState({ key: null, state: 'loading', data: null, message: '' });
  const [selection, setSelection] = useState(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);
  const alive = useRef(true);
  const key = JSON.stringify(request);
  const scope = useRef(key);
  const selected = useRef(null);
  const operation = useRef(null);
  const preflight = useRef(null);
  const form = useRef(null);
  const heading = useRef(null);
  const confirmationHeading = useRef(null);
  const noticeElement = useRef(null);
  const trigger = useRef(null);
  scope.current = key;
  const currentSelection = selection?.key === key ? selection : null;
  selected.current = currentSelection;
  const current = (expectedKey) => alive.current && scope.current === expectedKey && getAuthLifecycle() === version;

  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; preflight.current?.abort(); };
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    setList({ key, state: 'loading', data: null, message: '' });
    listAccounts(request.filters, request.page, { signal: controller.signal }).then((data) => {
      if (controller.signal.aborted || !current(key)) return;
      const lastPage = accountPages(data.pagination);
      if (!data.accounts.length && request.page > lastPage) {
        // A last approval can remove the only row of the last pending page.
        scope.current = null;
        setRequest(previous => ({ ...previous, page: lastPage, revision: previous.revision + 1 }));
        return;
      }
      setList({ key, state: 'ready', data, message: '' });
    }).catch((error) => {
      if (controller.signal.aborted || !current(key)) return;
      const message = request.outcome === 'saved'
        ? 'Approval was saved, but the queue could not be refreshed. Try again to reload the queue; do not resubmit the approval.'
        : error?.response?.status === 403 ? 'An active Admin account is required to read this queue. Check your sign-in status.'
          : 'The account queue is temporarily unavailable. Try again to reload it.';
      setList({ key, state: 'error', data: null, message });
    });
    return () => controller.abort();
  }, [key]); // key contains the complete applied query, page, outcome and revision.
  useEffect(() => { if (currentSelection) confirmationHeading.current?.focus(); }, [currentSelection]);
  useEffect(() => { if (notice) noticeElement.current?.focus(); }, [notice]);

  function clearSelection(restoreFocus = false) {
    selected.current = null;
    preflight.current?.abort();
    setSelection(null);
    // An obsolete confirmation is not cancellation of a dispatched PATCH.
    // Keep its submission guard until the request's finally block settles.
    if (restoreFocus) (trigger.current?.isConnected ? trigger.current : heading.current)?.focus();
  }
  function changeRequest(update, { keepNotice = false } = {}) {
    scope.current = null; // Invalidate synchronously, before React's next render.
    clearSelection();
    if (!keepNotice) setNotice(null);
    setRequest(previous => ({ ...previous, ...update, revision: previous.revision + 1 }));
  }
  function search(event) {
    event.preventDefault();
    const validation = validateAccountFilters(draft);
    setErrors(validation.errors);
    if (!validation.valid) { form.current?.elements.namedItem(Object.keys(validation.errors)[0])?.focus(); return; }
    setDraft(validation.values);
    changeRequest({ filters: validation.values, page: 1, outcome: null });
  }
  async function confirm(event) {
    event.preventDefault();
    const choice = selected.current;
    if (!choice || operation.current || !current(choice.key)) return;
    const token = Symbol('approval');
    operation.current = token;
    setBusy(true);
    const controller = new AbortController();
    preflight.current = controller;
    const isCurrent = () => current(choice.key) && selected.current === choice && operation.current === token;
    try {
      await approveAccount(choice.account.accountId, { signal: controller.signal, isCurrent });
      if (!isCurrent()) return;
      setNotice({ kind: 'success', message: `Account ${choice.account.accountId} was approved. It is ACTIVE and requires fresh sign-in.` });
      changeRequest({ outcome: 'saved' }, { keepNotice: true });
    } catch (error) {
      if (!isCurrent()) return;
      const result = accountApprovalError(error);
      if (result.kind === 'obsolete') return;
      setNotice(result);
      clearSelection();
      // GET may be retried. PATCH is never retried automatically, even when
      // its outcome is uncertain or the visible row still looks pending.
      if (['conflict', 'uncertain'].includes(result.kind)) changeRequest({ outcome: result.kind }, { keepNotice: true });
    } finally {
      if (operation.current === token) { operation.current = null; if (alive.current) setBusy(false); }
    }
  }
  const state = list.key === key ? list.state : 'loading';
  const data = state === 'ready' ? list.data : null;
  const pages = data ? accountPages(data.pagination) : 1;
  const updateDraft = (field, value) => { setDraft(old => ({ ...old, [field]: value })); setErrors(old => ({ ...old, [field]: '' })); };

  return <AuthLayout theme="mint" wide>
    <header className="mint-page-heading"><div><p className="mint-eyebrow">Admin workspace</p>
      <h1 ref={heading} tabIndex={-1}>Account approvals</h1>
      <p className="mint-page-subtitle">Review Donor and Hospital registrations. Only pending accounts can be approved here.</p></div></header>
    {notice && <div ref={noticeElement} tabIndex={-1} className={`mint-notice mint-notice-${notice.kind === 'success' ? 'success' : notice.kind === 'error' ? 'error' : 'warning'}`}
      role={notice.kind === 'success' ? 'status' : 'alert'}>{notice.message}</div>}
    {busy && !currentSelection && <p className="mint-notice" role="status">An approval request is still in progress. Changing filters does not cancel it.</p>}
    <section className="mint-card" aria-labelledby="account-filter-heading">
      <h2 id="account-filter-heading">Find accounts</h2>
      <form className="mint-admin-filters mint-account-filters" onSubmit={search} ref={form} noValidate>
        <div className="mint-field"><label htmlFor="account-search">Search by email</label>
          <input id="account-search" name="search" type="search" value={draft.search} onChange={e => updateDraft('search', e.target.value)}
            aria-invalid={Boolean(errors.search)} aria-describedby="account-search-note account-search-error" />
          <span id="account-search-note" className="mint-field-note">Up to 254 characters. Search symbols are treated literally.</span>
          <span id="account-search-error" className="mint-field-error" role={errors.search ? 'alert' : undefined}>{errors.search}</span></div>
        <div className="mint-field"><label htmlFor="account-role">Role</label>
          <select id="account-role" name="role" value={draft.role} onChange={e => updateDraft('role', e.target.value)} aria-invalid={Boolean(errors.role)} aria-describedby="account-role-error">
            <option value="">Both roles</option>{ACCOUNT_ROLES.map(role => <option key={role}>{role}</option>)}</select>
          <span id="account-role-error" className="mint-field-error">{errors.role}</span></div>
        <div className="mint-field"><label htmlFor="account-status">Account status</label>
          <select id="account-status" name="accountStatus" value={draft.accountStatus} onChange={e => updateDraft('accountStatus', e.target.value)} aria-invalid={Boolean(errors.accountStatus)} aria-describedby="account-status-error">
            {ACCOUNT_STATUSES.map(status => <option key={status}>{status}</option>)}</select>
          <span id="account-status-error" className="mint-field-error">{errors.accountStatus}</span></div>
        <div className="mint-admin-filter-actions"><button className="mint-button mint-button-primary" type="submit">Search</button>
          <button className="mint-button mint-button-secondary" type="button" onClick={() => {
            setDraft({ ...DEFAULT_FILTERS }); setErrors({}); changeRequest({ filters: { ...DEFAULT_FILTERS }, page: 1, outcome: null });
          }}>Clear filters</button></div>
      </form>
    </section>
    {currentSelection && <section className="mint-card mint-account-confirm" role="region" aria-labelledby="approval-confirm-heading"
      onKeyDown={event => { if (event.key === 'Escape' && !busy) { event.preventDefault(); clearSelection(true); } }}>
      <h2 id="approval-confirm-heading" ref={confirmationHeading} tabIndex={-1}>Confirm account approval</h2>
      <dl className="mint-details"><div className="mint-detail"><dt>Account ID</dt><dd>{currentSelection.account.accountId}</dd></div>
        <div className="mint-detail"><dt>Email</dt><dd>{currentSelection.account.email}</dd></div>
        <div className="mint-detail"><dt>Role</dt><dd>{currentSelection.account.role}</dd></div></dl>
      <p>Approval activates this account and requires the user to sign in again.</p>
      <p><strong>Reason:</strong> Registration reviewed</p>
      <form onSubmit={confirm} aria-busy={busy}>
        <div className="mint-admin-filter-actions"><button className="mint-button mint-button-primary" type="submit" disabled={busy}>{busy ? 'Approving…' : 'Confirm approval'}</button>
          <button className="mint-button mint-button-secondary" type="button" disabled={busy} onClick={() => clearSelection(true)}>Cancel</button></div>
        {busy && <p role="status">Submitting approval. Please wait; do not submit again.</p>}
      </form>
    </section>}
    {state === 'loading' && <Feedback title="Loading accounts" message="Retrieving the account queue…" busy />}
    {state === 'error' && <Feedback title="Could not load accounts" message={list.message} retry={() => changeRequest({ outcome: request.outcome }, { keepNotice: true })} />}
    {data && <section className="mint-card mint-admin-results" aria-labelledby="account-results-heading">
      <div className="mint-admin-results-heading"><h2 id="account-results-heading">Accounts</h2><p role="status">{data.accounts.length
        ? `${(request.page - 1) * 20 + 1}–${(request.page - 1) * 20 + data.accounts.length} of ${data.pagination.total} accounts`
        : `${data.pagination.total} accounts match these filters`}</p></div>
      {data.accounts.length ? <div className="mint-admin-table-wrap" tabIndex={0} role="region" aria-label="Account results">
        <table className="mint-admin-table mint-account-table"><caption className="mint-sr-only">Donor and Hospital account approvals. Created times are India Standard Time.</caption>
          <thead><tr>{['Account ID', 'Email', 'Role', 'Account status', 'Created (IST)', 'Action'].map(label => <th scope="col" key={label}>{label}</th>)}</tr></thead>
          <tbody>{data.accounts.map(account => <tr key={account.accountId}>
            <th scope="row" data-label="Account ID">{account.accountId}</th><td data-label="Email">{account.email}</td><td data-label="Role">{account.role}</td>
            <td data-label="Account status"><span className={`mint-status-pill mint-status-${account.accountStatus.toLowerCase()}`}>{account.accountStatus}</span></td>
            <td data-label="Created (IST)"><time dateTime={accountTimestamp(account.createdAt).iso}>{accountTimestamp(account.createdAt).label}</time></td>
            <td data-label="Action">{account.accountStatus === 'PENDING' ? <button className="mint-button mint-button-secondary" type="button" disabled={busy}
              aria-label={`Approve account ${account.accountId}`} onClick={event => {
                trigger.current = event.currentTarget; const choice = { account, key }; selected.current = choice; setSelection(choice); setNotice(null);
              }}>Approve</button> : <span className="mint-muted">Read-only</span>}</td>
          </tr>)}</tbody></table></div> : <div className="mint-feedback-card"><h3>No accounts found</h3><p>Try another email, role or status, or clear the filters.</p></div>}
      <nav className="mint-admin-pagination" aria-label="Account result pages"><p>Page {request.page} of {pages}</p><div>
        <button className="mint-button mint-button-secondary" disabled={request.page <= 1} onClick={() => changeRequest({ page: request.page - 1, outcome: null })}>Previous</button>
        <button className="mint-button mint-button-secondary" disabled={request.page >= pages} onClick={() => changeRequest({ page: request.page + 1, outcome: null })}>Next</button>
      </div></nav>
      <p className="mint-field-note">Created times are shown in India Standard Time (Asia/Kolkata). ACTIVE and SUSPENDED accounts are read-only.</p>
    </section>}
  </AuthLayout>;
}
