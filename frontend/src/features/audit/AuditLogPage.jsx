import { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import AuthLayout from '../auth/AuthLayout';
import { useAuth } from '../auth/AuthProvider';
import { auditApi } from '../../services/audit';
import { cleanAuditFilters } from '../../services/auditApi';
import './audit.css';

const subjects = ['Account', 'Donor', 'Hospital', 'BloodGroup', 'BloodCompatibility', 'DonationSlot', 'Booking', 'EligibilityDecision', 'Donation', 'BloodUnit', 'HospitalRequest', 'RequestStatusHistory', 'Allocation', 'AuditEvent', 'SYSTEM_TASK'];
const empty = { actorAccountId: '', actionCode: '', subjectType: '', subjectId: '', from: '', to: '', page: 1, pageSize: 25 };
const initial = { state: 'loading', data: null, error: '' };
function Access({ children }) {
  const { user, loading, restoreError, restore } = useAuth();
  if (loading) return <AuthLayout theme="audit"><p className="audit-feedback" role="status">Checking your Admin session…</p></AuthLayout>;
  if (restoreError) return <AuthLayout theme="audit"><section className="audit-feedback" role="alert"><h1>Could not check your session</h1><button type="button" onClick={() => void restore()}>Try again</button></section></AuthLayout>;
  if (!user) return <Navigate to="/login" replace />;
  if (user.role !== 'ADMIN' || user.accountStatus !== 'ACTIVE') return <Navigate to="/unauthorized" replace />;
  return <div key={`${user.accountId}:${user.role}:${user.accountStatus}`}>{children}</div>;
}
function displayTime(value) {
  if (typeof value !== 'string') return 'Time unavailable';
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? `${new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' }).format(parsed)} IST` : 'Time unavailable';
}
function failureMessage(error) {
  if ([401, 403].includes(error?.response?.status)) return 'Your Admin access changed. Check your sign-in status.';
  if (error?.response?.data?.error?.code === 'AUDIT_READ_UNAVAILABLE') return 'Audit history is unavailable. Check that the AuditEvent table and required indexes are installed and readable.';
  return 'The audit service could not load these records. Try again.';
}
function AuditWorkspace() {
  const { getAuthLifecycle } = useAuth();
  const [draft, setDraft] = useState(empty);
  const [query, setQuery] = useState(empty);
  const [result, setResult] = useState(initial);
  const [revision, setRevision] = useState(0);
  const [validation, setValidation] = useState('');
  const key = JSON.stringify(query);
  useEffect(() => {
    const controller = new AbortController(); const lifecycle = getAuthLifecycle();
    setResult({ state: 'loading', data: null, error: '' });
    auditApi.list(query, { signal: controller.signal }).then((data) => {
      if (!controller.signal.aborted && lifecycle === getAuthLifecycle()) setResult({ state: data.events.length ? 'ready' : 'empty', data, error: '' });
    }).catch((error) => {
      if (!controller.signal.aborted && lifecycle === getAuthLifecycle()) setResult({ state: 'error', data: null, error: failureMessage(error) });
    });
    return () => controller.abort();
  }, [key, revision, getAuthLifecycle]);
  const pages = result.data ? Math.max(1, Math.ceil(result.data.pagination.total / query.pageSize)) : 1;
  function submit(event) {
    event.preventDefault();
    try { const filters = cleanAuditFilters({ ...draft, page: 1 }); setValidation(''); setQuery(filters); }
    catch { setValidation('Check the actor/subject IDs, action code and date range.'); }
  }
  function reset() { setDraft(empty); setQuery(empty); setValidation(''); }
  return <AuthLayout theme="audit" wide>
    <div className="audit-crumb">Admin workspace <span aria-hidden="true">/</span> Operational traceability</div>
    <header className="audit-heading"><div><p className="audit-kicker">Feature 9 · AuditEvent</p><h1>Admin audit log</h1><p>Review recorded operational events using their stored actor, action, subject and timestamp.</p></div><span className="audit-mark" aria-hidden="true">LOG</span></header>
    <div className="audit-note"><strong>Read-only records</strong><span>Only persisted AuditEvent data is shown. Search does not inspect summary text or other unindexed fields.</span></div>
    <section className="audit-card audit-filter-card" aria-labelledby="audit-filter-title"><div className="audit-section-heading"><div><p className="audit-kicker">Structured search</p><h2 id="audit-filter-title">Filter events</h2></div><span>Up to 100 rows per page</span></div>
      <form onSubmit={submit}><fieldset disabled={result.state === 'loading'}><legend className="audit-sr-only">Audit event filters</legend><div className="audit-filter-grid">
        <div className="audit-field"><label htmlFor="audit-actor">Actor Account ID</label><input id="audit-actor" inputMode="numeric" value={draft.actorAccountId} onChange={(e) => setDraft({ ...draft, actorAccountId: e.target.value })} /></div>
        <div className="audit-field"><label htmlFor="audit-action">Action code</label><input id="audit-action" maxLength="48" value={draft.actionCode} onChange={(e) => setDraft({ ...draft, actionCode: e.target.value })} /></div>
        <div className="audit-field"><label htmlFor="audit-subject-type">Subject type</label><select id="audit-subject-type" value={draft.subjectType} onChange={(e) => setDraft({ ...draft, subjectType: e.target.value })}><option value="">All subject types</option>{subjects.map((value) => <option key={value}>{value}</option>)}</select></div>
        <div className="audit-field"><label htmlFor="audit-subject-id">Subject ID</label><input id="audit-subject-id" inputMode="numeric" value={draft.subjectId} onChange={(e) => setDraft({ ...draft, subjectId: e.target.value })} /></div>
        <div className="audit-field"><label htmlFor="audit-from">From date</label><input id="audit-from" type="date" value={draft.from} onChange={(e) => setDraft({ ...draft, from: e.target.value })} /></div>
        <div className="audit-field"><label htmlFor="audit-to">To date</label><input id="audit-to" type="date" value={draft.to} onChange={(e) => setDraft({ ...draft, to: e.target.value })} /></div>
        <div className="audit-field"><label htmlFor="audit-page-size">Rows per page</label><select id="audit-page-size" value={draft.pageSize} onChange={(e) => setDraft({ ...draft, pageSize: Number(e.target.value) })}><option value={25}>25</option><option value={50}>50</option><option value={100}>100</option></select></div>
      </div><div className="audit-actions"><button className="audit-button" type="submit">Search records</button><button className="audit-button secondary" type="button" onClick={reset}>Reset filters</button></div></fieldset>{validation && <p className="audit-validation" role="alert">{validation}</p>}</form>
    </section>
    {result.state === 'loading' && <section className="audit-card audit-feedback" role="status" aria-busy="true">Loading saved audit events…</section>}
    {result.state === 'error' && <section className="audit-card audit-feedback" role="alert"><h2>Audit history unavailable</h2><p>{result.error}</p><button className="audit-button secondary" type="button" onClick={() => setRevision((n) => n + 1)}>Retry</button></section>}
    {result.data && <section className="audit-card audit-results" aria-labelledby="audit-results-title"><div className="audit-section-heading"><div><p className="audit-kicker">Persisted events</p><h2 id="audit-results-title">Audit events</h2></div><span role="status">{result.data.pagination.total} matching events</span></div>
      {result.state === 'empty' ? <div className="audit-empty"><h3>No audit events found</h3><p>Try changing the filters or reset them to review all available records.</p></div> : <div className="audit-table-scroll" role="region" aria-label="Audit event results" tabIndex={0}><table className="audit-table"><caption className="audit-sr-only">Audit events, newest first. Event summaries are stored change summaries.</caption><thead><tr><th scope="col">Occurred</th><th scope="col">Actor</th><th scope="col">Action</th><th scope="col">Subject</th><th scope="col">Reason</th><th scope="col">Summary</th></tr></thead><tbody>{result.data.events.map((event) => <tr key={event.eventId}><td data-label="Occurred">{displayTime(event.occurredAt)}</td><td data-label="Actor">{event.actorAccountId ? `Account #${event.actorAccountId}` : 'System'}</td><td data-label="Action"><code>{event.actionCode}</code></td><td data-label="Subject"><span>{event.subjectType}</span>{event.subjectId && <small>#{event.subjectId}</small>}</td><td data-label="Reason">{event.reasonCode || '—'}</td><td data-label="Summary">{event.changeSummary || 'No summary recorded'}</td></tr>)}</tbody></table></div>}
      <nav className="audit-pagination" aria-label="Audit event pages"><span>Page {query.page} of {pages} · {query.pageSize} rows per page</span><div className="audit-actions"><button className="audit-button secondary" type="button" disabled={query.page <= 1 || result.state === 'loading'} onClick={() => setQuery({ ...query, page: query.page - 1 })}>Previous</button><button className="audit-button secondary" type="button" disabled={query.page >= pages || result.state === 'loading'} onClick={() => setQuery({ ...query, page: query.page + 1 })}>Next</button></div></nav>
    </section>}
    <p className="audit-footnote">Newest events appear first. Event text is displayed from stored AuditEvent values without reconstructing or inventing activity.</p>
  </AuthLayout>;
}
export default function AuditLogPage() { return <Access><AuditWorkspace /></Access>; }
