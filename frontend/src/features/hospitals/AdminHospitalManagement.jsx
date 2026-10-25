import { useEffect, useRef, useState } from 'react';
import { Navigate } from 'react-router-dom';
import AuthLayout from '../auth/AuthLayout';
import { useAuth } from '../auth/AuthProvider';
import { getAdminHospitalProfile, listAdminHospitals } from '../../services/hospitals';
import { formatHospitalTimestamp } from './profile';
import {
  adminHospitalError, adminHospitalPageSummary, canManageHospitals, HOSPITAL_ACCOUNT_STATUSES,
  readAdminHospitalPage, readAdminHospitalProfile, validateAdminHospitalFilters,
} from './adminHospitals';

function Feedback({ title, message, retry, busy = false }) {
  return <section className="mint-card mint-feedback-card mint-admin-feedback" aria-busy={busy}>
    <h2>{title}</h2><p role={busy ? 'status' : 'alert'}>{message}</p>
    {retry && <button className="mint-button mint-button-secondary" type="button" onClick={retry}>Try again</button>}
  </section>;
}

function Status({ value }) {
  return <span className={`mint-status-pill mint-status-${value.toLowerCase()}`}>{value}</span>;
}

function Detail({ label, children }) {
  return <div className="mint-detail"><dt>{label}</dt><dd>{children}</dd></div>;
}

export default function AdminHospitalManagement() {
  const { user, loading, restoreError, restore } = useAuth();
  const permitted = canManageHospitals(user);
  const owner = permitted ? `${user.accountId}:${user.role}:${user.accountStatus}` : null;
  const [draft, setDraft] = useState({ search: '', accountStatus: '' });
  const [filterErrors, setFilterErrors] = useState({});
  const [query, setQuery] = useState({ search: '', accountStatus: '', page: 1 });
  const [listRevision, setListRevision] = useState(0);
  const [list, setList] = useState({ key: null, state: 'loading', data: null, message: '' });
  const [selection, setSelection] = useState(null);
  const [detailRevision, setDetailRevision] = useState(0);
  const [detail, setDetail] = useState({ key: null, state: 'loading', profile: null, message: '' });
  const formRef = useRef(null);
  const detailHeadingRef = useRef(null);
  const selectedButtonRef = useRef(null);
  const listKey = JSON.stringify([owner, loading, query, listRevision]);
  const selectedId = selection?.listKey === listKey ? selection.hospitalId : null;
  const detailKey = JSON.stringify([listKey, selectedId, detailRevision]);
  const currentListKey = useRef(listKey);
  const currentDetailKey = useRef(detailKey);
  currentListKey.current = listKey;
  currentDetailKey.current = detailKey;

  useEffect(() => {
    setSelection(null);
    setDetail({ key: null, state: 'loading', profile: null, message: '' });
    setList({ key: listKey, state: 'loading', data: null, message: '' });
    if (!owner || loading) return undefined;
    const controller = new AbortController();
    const request = { page: query.page };
    if (query.search) request.search = query.search;
    if (query.accountStatus) request.accountStatus = query.accountStatus;
    listAdminHospitals(request, { signal: controller.signal }).then((response) => {
      if (controller.signal.aborted || currentListKey.current !== listKey) return;
      const data = readAdminHospitalPage(response, query.page);
      if (!data) throw new Error('Invalid Hospital list response.');
      setList({ key: listKey, state: 'ready', data, message: '' });
    }).catch((failure) => {
      if (controller.signal.aborted || currentListKey.current !== listKey) return;
      setList({ key: listKey, state: 'error', data: null, message: adminHospitalError(failure).message });
    });
    return () => controller.abort();
  }, [listKey, loading, owner, query.accountStatus, query.page, query.search]);

  useEffect(() => {
    setDetail({ key: detailKey, state: 'loading', profile: null, message: '' });
    if (!owner || loading || !selectedId) return undefined;
    const controller = new AbortController();
    detailHeadingRef.current?.focus();
    getAdminHospitalProfile(selectedId, { signal: controller.signal }).then((response) => {
      if (controller.signal.aborted || currentDetailKey.current !== detailKey) return;
      const profile = readAdminHospitalProfile(response, selectedId);
      if (!profile) throw new Error('Invalid Hospital detail response.');
      setDetail({ key: detailKey, state: 'ready', profile, message: '' });
    }).catch((failure) => {
      if (controller.signal.aborted || currentDetailKey.current !== detailKey) return;
      const error = adminHospitalError(failure, 'detail');
      setDetail({ key: detailKey, state: error.missing ? 'empty' : 'error', profile: null, message: error.message });
      if (error.accessDenied) {
        setSelection(null);
        setList({ key: listKey, state: 'error', data: null, message: error.message });
      }
    });
    return () => controller.abort();
  }, [detailKey, listKey, loading, owner, selectedId]);

  const clearSelection = () => {
    setSelection(null);
    if (selectedButtonRef.current?.isConnected) selectedButtonRef.current.focus();
  };
  const applyFilters = (event) => {
    event.preventDefault();
    const validation = validateAdminHospitalFilters(draft);
    setFilterErrors(validation.errors);
    if (!validation.valid) {
      formRef.current?.elements.namedItem(Object.keys(validation.errors)[0])?.focus();
      return;
    }
    setDraft(validation.values);
    setQuery({ ...validation.values, page: 1 });
    setSelection(null);
    setListRevision((value) => value + 1);
  };
  const clearFilters = () => {
    setDraft({ search: '', accountStatus: '' });
    setFilterErrors({});
    setQuery({ search: '', accountStatus: '', page: 1 });
    setSelection(null);
    setListRevision((value) => value + 1);
  };
  const changePage = (page) => { setSelection(null); setQuery((previous) => ({ ...previous, page })); };
  const state = list.key === listKey ? list.state : 'loading';
  const data = state === 'ready' ? list.data : null;
  const summary = data ? adminHospitalPageSummary(data.pagination, data.hospitals.length) : null;
  const detailState = detail.key === detailKey ? detail.state : 'loading';
  const profile = detailState === 'ready' ? detail.profile : null;

  if (loading) return <AuthLayout theme="mint" wide><Feedback title="Restoring your account" message="Checking your sign-in status…" busy /></AuthLayout>;
  if (!user && restoreError) return <AuthLayout theme="mint" wide><Feedback title="Could not check your account" message={restoreError} retry={() => void restore()} /></AuthLayout>;
  if (!user) return <Navigate to="/login" replace />;
  if (!permitted) return <Navigate to="/unauthorized" replace />;

  return <AuthLayout theme="mint" wide>
    <header className="mint-page-heading"><div><p className="mint-eyebrow">Admin workspace</p><h1>Hospital Management</h1><p className="mint-page-subtitle">Search registered Hospitals and review their saved organization and contact information.</p></div></header>
    {restoreError && <p className="mint-notice mint-notice-warning" role="alert">{restoreError}</p>}
    <section className="mint-card" aria-labelledby="admin-hospital-search-heading">
      <h2 id="admin-hospital-search-heading">Find Hospitals</h2>
      <form className="mint-admin-filters" ref={formRef} onSubmit={applyFilters} noValidate>
        <div className="mint-field"><label htmlFor="admin-hospital-search">Search Hospitals</label><input id="admin-hospital-search" name="search" type="search" value={draft.search} placeholder="Organization, registration, contact or phone" onChange={(event) => { setDraft((value) => ({ ...value, search: event.target.value })); setFilterErrors((value) => ({ ...value, search: '' })); }} aria-invalid={Boolean(filterErrors.search)} aria-describedby={`admin-hospital-search-hint${filterErrors.search ? ' admin-hospital-search-error' : ''}`} /><span id="admin-hospital-search-hint" className="mint-field-note">Search organization name, registration number, contact name or phone.</span>{filterErrors.search && <span id="admin-hospital-search-error" className="mint-field-error" role="alert">{filterErrors.search}</span>}</div>
        <div className="mint-field"><label htmlFor="admin-hospital-status">Account status</label><select id="admin-hospital-status" name="accountStatus" value={draft.accountStatus} onChange={(event) => { setDraft((value) => ({ ...value, accountStatus: event.target.value })); setFilterErrors((value) => ({ ...value, accountStatus: '' })); }} aria-invalid={Boolean(filterErrors.accountStatus)} aria-describedby={filterErrors.accountStatus ? 'admin-hospital-status-error' : undefined}><option value="">All statuses</option>{HOSPITAL_ACCOUNT_STATUSES.map((status) => <option key={status} value={status}>{status}</option>)}</select>{filterErrors.accountStatus && <span id="admin-hospital-status-error" className="mint-field-error" role="alert">{filterErrors.accountStatus}</span>}</div>
        <div className="mint-admin-filter-actions"><button className="mint-button mint-button-primary" type="submit">Search</button><button className="mint-button mint-button-secondary" type="button" onClick={clearFilters}>Clear filters</button></div>
      </form>
    </section>
    {state === 'loading' && <Feedback title="Loading Hospitals" message="Retrieving saved Hospital records…" busy />}
    {state === 'error' && <Feedback title="Could not load Hospitals" message={list.message} retry={() => setListRevision((value) => value + 1)} />}
    {data && <section className="mint-card mint-admin-results" aria-labelledby="admin-hospitals-heading">
      <div className="mint-admin-results-heading"><h2 id="admin-hospitals-heading">Hospitals</h2><p className="mint-muted" role="status">{data.hospitals.length ? `${summary.first}–${summary.last} of ${data.pagination.total} Hospitals` : `${data.pagination.total} Hospitals match these filters`}</p></div>
      {data.hospitals.length ? <div className="mint-admin-table-wrap" tabIndex={0} role="region" aria-label="Hospital results"><table className="mint-admin-table"><caption className="mint-sr-only">Registered Hospital accounts and saved contact information. Open details to review a complete profile.</caption><thead><tr><th scope="col">Organization</th><th scope="col">Contact</th><th scope="col">Account status</th><th scope="col"><span className="mint-sr-only">Details</span></th></tr></thead><tbody>{data.hospitals.map((hospital) => <tr key={hospital.hospitalId} className={selectedId === hospital.hospitalId ? 'mint-admin-row-selected' : undefined}><th scope="row" data-label="Organization"><span className="mint-admin-organization">{hospital.organizationName}</span><span className="mint-admin-registration">{hospital.registrationNumber || 'Registration not provided'}</span></th><td data-label="Contact"><span className="mint-admin-organization">{hospital.contactName}</span><span className="mint-admin-registration">{hospital.phone}</span></td><td data-label="Account status"><Status value={hospital.accountStatus} /></td><td data-label="Details"><button className="mint-button mint-button-secondary" type="button" aria-label={`View details for ${hospital.organizationName}`} aria-expanded={selectedId === hospital.hospitalId} aria-controls={selectedId === hospital.hospitalId ? 'admin-hospital-detail' : undefined} onClick={(event) => { selectedButtonRef.current = event.currentTarget; setSelection({ hospitalId: hospital.hospitalId, listKey }); setDetailRevision((value) => value + 1); }}>View details</button></td></tr>)}</tbody></table></div>
        : <div className="mint-feedback-card"><h3>{data.pagination.total && query.page > 1 ? 'No Hospitals on this page' : 'No Hospitals found'}</h3><p>{query.search || query.accountStatus ? 'Try another search or clear the filters to review all registered Hospitals.' : 'Registered Hospital profiles will appear here when they are available.'}</p>{query.page > 1 && <button className="mint-button mint-button-secondary" type="button" onClick={() => changePage(1)}>Go to first page</button>}</div>}
      <nav className="mint-admin-pagination" aria-label="Hospital result pages"><p>Page {data.pagination.page} of {summary.pages}</p><div className="mint-admin-filter-actions"><button className="mint-button mint-button-secondary" type="button" disabled={!summary.previous} onClick={() => changePage(query.page - 1)}>Previous</button><button className="mint-button mint-button-secondary" type="button" disabled={!summary.next} onClick={() => changePage(query.page + 1)}>Next</button></div></nav>
    </section>}
    {selectedId && <section id="admin-hospital-detail" className="mint-card mint-admin-detail" aria-labelledby="admin-hospital-detail-heading" aria-busy={detailState === 'loading'}>
      <div className="mint-admin-detail-heading"><div><p className="mint-eyebrow">Saved profile</p><h2 id="admin-hospital-detail-heading" ref={detailHeadingRef} tabIndex={-1}>Hospital details</h2></div><button className="mint-button mint-button-secondary" type="button" onClick={clearSelection}>Close details</button></div>
      {detailState === 'loading' && <p role="status">Loading Hospital details…</p>}
      {(detailState === 'error' || detailState === 'empty') && <div className="mint-feedback-card"><p role="alert">{detail.message}</p><button className="mint-button mint-button-secondary" type="button" onClick={() => setDetailRevision((value) => value + 1)}>Try again</button></div>}
      {profile && <><dl className="mint-details mint-admin-details-grid">
        <Detail label="Hospital ID">{profile.hospitalId}</Detail><Detail label="Account status"><Status value={profile.accountStatus} /></Detail>
        <Detail label="Organization name">{profile.organizationName}</Detail><Detail label="Registration number">{profile.registrationNumber || <span className="mint-muted">Not provided</span>}</Detail>
        <Detail label="Contact name">{profile.contactName}</Detail><Detail label="Phone">{profile.phone}</Detail>
        <Detail label="Address"><span className="mint-address">{profile.address}</span></Detail>
        <Detail label="Created"><time dateTime={profile.createdAt}>{formatHospitalTimestamp(profile.createdAt)}</time></Detail>
        <Detail label="Last updated"><time dateTime={profile.updatedAt}>{formatHospitalTimestamp(profile.updatedAt)}</time></Detail>
      </dl><p className="mint-field-note">Account status is read-only on this screen. Times are shown in India Standard Time.</p></>}
    </section>}
  </AuthLayout>;
}
