import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import AuthLayout from '../auth/AuthLayout';
import { useAuth } from '../auth/AuthProvider';
import { allocationReads } from '../../services/allocationReads';
import { allocationMutations } from '../../services/allocationMutations';
import { allocationMutationMessage } from '../../services/allocationMutationApi';
import { bloodRequests } from '../../services/bloodRequests';
import './indigo.css';

function canManage(user) { return user?.role === 'ADMIN' && user.accountStatus === 'ACTIVE'; }
function todayInIndia() {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  return Object.fromEntries(parts.map((part) => [part.type, part.value]));
}
function defaultDate() { const parts = todayInIndia(); return `${parts.year}-${parts.month}-${parts.day}`; }
function formatDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value || '')) return 'Date unavailable';
  return new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeZone: 'Asia/Kolkata' }).format(new Date(`${value}T00:00:00+05:30`));
}
function formatCollected(value) {
  const dateValue = new Date(`${value.replace(' ', 'T')}+05:30`);
  return Number.isFinite(dateValue.getTime()) ? `${new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' }).format(dateValue)} IST` : 'Collection time unavailable';
}
function errorText(error) {
  if ([401, 403].includes(error?.response?.status)) return 'Your Admin access changed. Check your sign-in status.';
  if (error?.response?.data?.error?.code === 'REQUEST_NOT_FOUND') return 'This request is no longer available.';
  if (error?.response?.data?.error?.code === 'ALLOCATION_READ_UNAVAILABLE') return 'Feature 8 read-only data is unavailable. Check that migration 009 is installed and the database account can read its tables.';
  return 'The allocation service could not load data. Try again.';
}
function Access({ children }) {
  const { user, loading, restoreError, restore } = useAuth();
  if (loading) return <AuthLayout theme="indigo"><div className="indigo-feedback" role="status">Checking your Admin session…</div></AuthLayout>;
  if (restoreError) return <AuthLayout theme="indigo"><div className="indigo-feedback" role="alert"><h1>Could not check your session</h1><p>Try again to confirm your current account status.</p><button type="button" className="indigo-button secondary" onClick={() => void restore()}>Try again</button></div></AuthLayout>;
  if (!user) return <Navigate to="/login" replace />;
  if (!canManage(user)) return <Navigate to="/unauthorized" replace />;
  return <div key={`${user.accountId}:${user.role}:${user.accountStatus}`}>{children}</div>;
}
function Layout({ title, children }) {
  return <AuthLayout theme="indigo" wide>
    <div className="indigo-breadcrumb"><Link to="/admin/requests">Blood request management</Link><span aria-hidden="true">/</span><span>{title}</span></div>
    <header className="indigo-heading"><div><p className="indigo-eyebrow">Admin · Feature 8</p><h1>{title}</h1>
      <p>Review real request and inventory data, then reserve the exact compatible units you selected.</p></div><span className="indigo-mark" aria-hidden="true">↗</span></header>
    <nav className="indigo-tabs" aria-label="Feature 8 navigation"><Link to="/admin/allocations" aria-current={title === 'Request allocation' ? 'page' : undefined}>Request allocation</Link><Link to="/admin/compatibility" aria-current={title === 'Compatibility management' ? 'page' : undefined}>Compatibility</Link><span>FEFO inventory</span></nav>
    {children}
  </AuthLayout>;
}
function Feedback({ state, retry }) {
  const messages = { loading: ['Loading request queue', 'Retrieving saved hospital requests…'], error: ['Request queue unavailable', state.message], empty: ['No requests to review', 'No hospital requests are available in this page of the queue.'] };
  if (!messages[state.status]) return null;
  const [title, message] = messages[state.status];
  return <section className="indigo-card indigo-feedback" aria-busy={state.status === 'loading'}><h2>{title}</h2><p role={state.status === 'loading' ? 'status' : 'alert'}>{message}</p>{state.status === 'error' && <button type="button" className="indigo-button secondary" onClick={retry}>Retry</button>}</section>;
}

export function AllocationWorkspace() {
  const { getAuthLifecycle } = useAuth();
  const [queuePage, setQueuePage] = useState(1);
  const [queueRevision, setQueueRevision] = useState(0);
  const [selectedId, setSelectedId] = useState('');
  const [intendedIssueDate, setIntendedIssueDate] = useState(defaultDate);
  const [candidatePage, setCandidatePage] = useState(1);
  const [queue, setQueue] = useState({ state: 'loading', data: null, message: '' });
  const [preview, setPreview] = useState({ state: 'idle', data: null, message: '' });
  const [previewRevision, setPreviewRevision] = useState(0);
  const [selectedUnitIds, setSelectedUnitIds] = useState([]);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [mutationFeedback, setMutationFeedback] = useState(null);
  const [issueTarget, setIssueTarget] = useState(null);
  const [handoffReference, setHandoffReference] = useState('');
  const queueHeading = useRef(null);
  const key = JSON.stringify([queuePage, queueRevision, getAuthLifecycle()]);
  const previewKey = JSON.stringify([selectedId, intendedIssueDate, candidatePage, previewRevision, getAuthLifecycle()]);
  const requests = queue.data?.requests || [];
  const selected = requests.find((request) => request.requestId === selectedId) || null;

  useEffect(() => {
    const controller = new AbortController(); const lifecycle = getAuthLifecycle();
    setQueue({ state: 'loading', data: null, message: '' });
    bloodRequests.list({ page: queuePage }, { admin: true, signal: controller.signal }).then((data) => {
      if (!controller.signal.aborted && lifecycle === getAuthLifecycle()) {
        setQueue({ state: data.requests.length ? 'ready' : 'empty', data, message: '' });
        if (selectedId && !data.requests.some((request) => request.requestId === selectedId)) setSelectedId('');
      }
    }).catch((error) => { if (!controller.signal.aborted && lifecycle === getAuthLifecycle()) setQueue({ state: 'error', data: null, message: errorText(error) }); });
    return () => controller.abort();
  }, [key]);

  useEffect(() => {
    if (!selectedId) { setPreview({ state: 'idle', data: null, message: '' }); return undefined; }
    const controller = new AbortController(); const lifecycle = getAuthLifecycle();
    setPreview({ state: 'loading', data: null, message: '' });
    allocationReads.preview(selectedId, { intendedIssueDate, candidatePage, signal: controller.signal }).then((data) => {
      if (!controller.signal.aborted && lifecycle === getAuthLifecycle()) setPreview({ state: 'ready', data, message: '' });
    }).catch((error) => { if (!controller.signal.aborted && lifecycle === getAuthLifecycle()) setPreview({ state: 'error', data: null, message: errorText(error) }); });
    return () => controller.abort();
  }, [previewKey]);

  useEffect(() => {
    setSelectedUnitIds([]);
    setConfirmOpen(false);
  }, [selectedId, intendedIssueDate, candidatePage, previewRevision]);

  const data = preview.state === 'ready' ? preview.data : null;
  const queuePages = queue.data ? Math.max(1, Math.ceil(queue.data.pagination.total / queue.data.pagination.pageSize)) : 1;
  const candidatePages = data?.candidatePagination.pageCount || 1;
  const items = useMemo(() => data?.candidates || [], [data]);
  const handleSelectUnit = (index, unitId, checked) => {
    setSelectedUnitIds((prior) => {
      if (checked) return index === prior.length && prior.length < data.counts.outstanding ? [...prior, unitId] : prior;
      return prior[index] === unitId ? prior.slice(0, index) : prior;
    });
  };
  const submitAllocation = async () => {
    if (!data || !selectedId || !selectedUnitIds.length || submitting) return;
    const captured = { requestId: selectedId, unitIds: [...selectedUnitIds], intendedIssueDate };
    const lifecycle = getAuthLifecycle();
    const isCurrent = () => lifecycle === getAuthLifecycle() && selectedId === captured.requestId
      && intendedIssueDate === captured.intendedIssueDate;
    setSubmitting(true);
    setMutationFeedback(null);
    try {
      const result = await allocationMutations.confirm(captured.requestId, {
        bloodUnitIds: captured.unitIds, intendedIssueDate: captured.intendedIssueDate, isCurrent,
      });
      setMutationFeedback({ kind: 'success', text: `Reserved ${result.allocations.length} unit${result.allocations.length === 1 ? '' : 's'} for request #${result.requestId}. Refreshing saved request and inventory data.` });
      setSelectedUnitIds([]);
      setConfirmOpen(false);
      setPreviewRevision((value) => value + 1);
      setQueueRevision((value) => value + 1);
    } catch (error) {
      const message = allocationMutationMessage(error);
      if (!message) return;
      setMutationFeedback(message);
      setSelectedUnitIds([]);
      setConfirmOpen(false);
      if (error?.mutationDispatched || error?.response?.status === 409) {
        setPreviewRevision((value) => value + 1);
        setQueueRevision((value) => value + 1);
      }
    } finally { setSubmitting(false); }
  };
  const submitIssue = async () => {
    if (!issueTarget || submitting) return;
    const captured = issueTarget; const lifecycle = getAuthLifecycle();
    const isCurrent = () => lifecycle === getAuthLifecycle() && selectedId === captured.requestId && issueTarget?.allocationId === captured.allocationId;
    setSubmitting(true); setMutationFeedback(null);
    try {
      const result = await allocationMutations.issue(captured.allocationId, { handoffReference, isCurrent });
      setMutationFeedback({ kind: 'success', text: `Issued BloodUnit ${result.bloodUnitId} for request #${result.requestId}.` });
      setIssueTarget(null); setHandoffReference(''); setPreviewRevision(value => value + 1); setQueueRevision(value => value + 1);
    } catch (error) {
      const message = allocationMutationMessage(error);
      if (message) { setMutationFeedback(message); setIssueTarget(null); setHandoffReference(''); if (error?.mutationDispatched || error?.response?.status === 409) { setPreviewRevision(value => value + 1); setQueueRevision(value => value + 1); } }
    } finally { setSubmitting(false); }
  };
  return <Layout title="Request allocation">
    <div className="indigo-callout"><strong>FEFO reservation</strong><span>Preview is read-only until you select the exact first units in FEFO order and confirm the reservation. Reserved units remain distinct from issued units.</span></div>
    {mutationFeedback && <div className={`indigo-notice ${mutationFeedback.kind === 'success' ? 'success' : 'warning'}`} role={mutationFeedback.kind === 'success' ? 'status' : 'alert'}>{mutationFeedback.text}</div>}
    <section className="indigo-card" aria-labelledby="allocation-request-heading">
      <div className="indigo-section-heading"><div><p className="indigo-eyebrow">Hospital demand</p><h2 id="allocation-request-heading">Select a saved request</h2></div><span className="indigo-meta">Page {queuePage} of {queuePages}</span></div>
      <Feedback state={queue} retry={() => setQueueRevision((value) => value + 1)} />
      {queue.state === 'ready' && <div className="indigo-request-controls">
        <div className="indigo-field"><label htmlFor="allocation-request">Hospital request</label><select id="allocation-request" value={selectedId} onChange={(event) => { setSelectedId(event.target.value); setCandidatePage(1); queueHeading.current?.focus(); }}>
          <option value="">Choose a request from this page</option>{requests.map((request) => <option key={request.requestId} value={request.requestId}>#{request.requestId} · {request.hospital?.organizationName || 'Hospital'} · {request.recipientBloodGroupCode} · {request.quantityRequested} units · {request.requestStatus}</option>)}
        </select><span className="indigo-help">{queue.data.pagination.total} real requests in the Admin queue.</span></div>
        <div className="indigo-page-controls"><button type="button" className="indigo-button secondary" disabled={queuePage <= 1} onClick={() => { setSelectedId(''); setQueuePage((page) => page - 1); }}>Previous requests</button><button type="button" className="indigo-button secondary" disabled={queuePage >= queuePages} onClick={() => { setSelectedId(''); setQueuePage((page) => page + 1); }}>Next requests</button></div>
      </div>}
    </section>
    {selected && <section className="indigo-card" aria-labelledby="allocation-details-heading">
      <div className="indigo-section-heading"><div><p className="indigo-eyebrow">Request #{selected.requestId}</p><h2 id="allocation-details-heading" ref={queueHeading} tabIndex={-1}>Allocation preview</h2></div><span className="indigo-status">{selected.requestStatus.replaceAll('_', ' ')}</span></div>
      <dl className="indigo-summary"><div><dt>Hospital</dt><dd>{selected.hospital?.organizationName || 'Hospital'}</dd></div><div><dt>Recipient group</dt><dd>{selected.recipientBloodGroupCode} · {selected.recipientBloodGroupName}</dd></div><div><dt>Requested</dt><dd>{selected.quantityRequested} units</dd></div><div><dt>Request status</dt><dd>{selected.requestStatus.replaceAll('_', ' ')}</dd></div></dl>
      <div className="indigo-date-field"><div className="indigo-field"><label htmlFor="intended-issue-date">Intended issue date</label><input id="intended-issue-date" type="date" value={intendedIssueDate} onChange={(event) => { setIntendedIssueDate(event.target.value); setCandidatePage(1); }} /></div><p className="indigo-help">Units expiring on or before {formatDate(intendedIssueDate)} are excluded.</p></div>
      {preview.state === 'loading' && <div className="indigo-feedback" role="status" aria-busy="true">Loading real FEFO candidates…</div>}
      {preview.state === 'error' && <div className="indigo-feedback" role="alert"><h3>Preview unavailable</h3><p>{preview.message}</p><button className="indigo-button secondary" type="button" onClick={() => setPreviewRevision((value) => value + 1)}>Retry preview</button></div>}
      {data && <>
        <div className="indigo-section-heading candidate-heading"><div><p className="indigo-eyebrow">Reservation and handoff</p><h3>Allocated units</h3></div></div>
        {data.allocations.length === 0 ? <p className="indigo-empty">No units are reserved for this request.</p> : <div className="indigo-table-wrap" role="region" aria-label="Allocated and issued units" tabIndex={0}><table className="indigo-table"><thead><tr><th scope="col">Unit</th><th scope="col">Group</th><th scope="col">Expires</th><th scope="col">Status</th><th scope="col">Handoff reference</th><th scope="col">Action</th></tr></thead><tbody>{data.allocations.map(row => <tr key={row.allocationId}><th scope="row" data-label="Unit">{row.bloodUnitId}</th><td data-label="Group">{row.donorGroupCode}</td><td data-label="Expires">{formatDate(row.expiryDate)}</td><td data-label="Status">{row.allocationStatus}</td><td data-label="Handoff reference">{row.handoffReference || '—'}</td><td data-label="Action">{row.allocationStatus === 'ALLOCATED' && <button type="button" className="indigo-button secondary" disabled={submitting || !data.request.requestStatus.includes('PARTIALLY_FULFILLED')} onClick={() => { setIssueTarget({ allocationId: row.allocationId, bloodUnitId: row.bloodUnitId, requestId: selectedId }); setHandoffReference(''); }}>Issue unit</button>}</td></tr>)}</tbody></table></div>}
        <div className="indigo-count-grid"><div><span>Already allocated</span><strong>{data.counts.allocated}</strong></div><div><span>Already issued</span><strong>{data.counts.issued}</strong></div><div><span>Still outstanding</span><strong>{data.counts.outstanding}</strong></div><div><span>Eligible inventory</span><strong>{data.counts.availableCandidateCount}</strong></div><div><span>Allocatable for this request</span><strong>{data.counts.allocatableCount}</strong></div></div>
        {!data.eligibleForAllocation && <div className="indigo-notice"><strong>Request is not currently eligible for preview allocation.</strong><span>Requests must be under review, awaiting inventory or partially fulfilled.</span></div>}
        {data.eligibleForAllocation && data.counts.outstanding > 0 && data.counts.availableCandidateCount === 0 && <div className="indigo-notice warning"><strong>No compatible eligible units are available for this date.</strong><span>No inventory has been created or assumed by this preview.</span></div>}
        {data.eligibleForAllocation && data.counts.availableCandidateCount > 0 && data.counts.allocatableCount < data.counts.outstanding && <div className="indigo-notice warning"><strong>Partial availability</strong><span>{data.counts.allocatableCount} of {data.counts.outstanding} outstanding units could be considered from current eligible inventory.</span></div>}
        {data.eligibleForAllocation && data.counts.allocatableCount === data.counts.outstanding && data.counts.outstanding > 0 && <div className="indigo-notice success"><strong>Current inventory can cover the outstanding quantity.</strong><span>This preview is not a reservation; availability may change.</span></div>}
        <div className="indigo-section-heading candidate-heading"><div><p className="indigo-eyebrow">Earliest expiry first</p><h3>Compatible units</h3></div><span className="indigo-meta">Sorted by expiry, collection time, then unit ID</span></div>
        {items.length === 0 ? <p className="indigo-empty">No candidate units are available on this page.</p> : <div className="indigo-table-wrap" role="region" aria-label="FEFO candidate blood units" tabIndex={0}>
          <table className="indigo-table"><caption className="indigo-sr-only">Real candidate BloodUnit records in FEFO order. Select a contiguous prefix to confirm those exact units.</caption><thead><tr><th scope="col">Select</th><th scope="col">Unit ID</th><th scope="col">Donor group</th><th scope="col">Expires</th><th scope="col">Collected</th></tr></thead><tbody>{items.map((unit, index) => <tr key={unit.bloodUnitId}><td data-label="Select"><input type="checkbox" aria-label={`Select BloodUnit ${unit.bloodUnitId}`} checked={selectedUnitIds[index] === unit.bloodUnitId} disabled={!data.eligibleForAllocation || candidatePage !== 1 || submitting || index > selectedUnitIds.length} onChange={(event) => handleSelectUnit(index, unit.bloodUnitId, event.target.checked)} /></td><th scope="row" data-label="Unit ID">{unit.bloodUnitId}</th><td data-label="Donor group">{unit.donorGroupCode}</td><td data-label="Expires">{formatDate(unit.expiryDate)}</td><td data-label="Collected">{formatCollected(unit.collectedAt)}</td></tr>)}</tbody></table>
        </div>}
        {candidatePages > 1 && <nav className="indigo-page-controls" aria-label="Candidate unit pages"><span>Candidate page {candidatePage} of {candidatePages}</span><button type="button" className="indigo-button secondary" disabled={candidatePage <= 1} onClick={() => setCandidatePage((page) => page - 1)}>Previous units</button><button type="button" className="indigo-button secondary" disabled={candidatePage >= candidatePages} onClick={() => setCandidatePage((page) => page + 1)}>Next units</button></nav>}
        <p className="indigo-help" id="allocation-confirm-note">Selected {selectedUnitIds.length} of {data.counts.outstanding} outstanding units. Selection must follow the displayed FEFO order. A changed preview requires a fresh review.</p>
        <button type="button" className="indigo-button primary indigo-confirm-disabled" disabled={!data.eligibleForAllocation || candidatePage !== 1 || selectedUnitIds.length === 0 || submitting} onClick={() => setConfirmOpen(true)}>Confirm allocation</button>
      </>}
    </section>}
    {confirmOpen && data && <div className="indigo-dialog-backdrop"><section className="indigo-dialog" role="dialog" aria-modal="true" aria-labelledby="allocation-confirm-title" aria-describedby="allocation-confirm-description">
      <h2 id="allocation-confirm-title">Confirm exact unit reservation</h2>
      <p id="allocation-confirm-description">Reserve BloodUnit IDs {selectedUnitIds.join(', ')} for request #{selectedId}? The request remains partially fulfilled until units are issued. No replacement units will be selected if this preview is stale.</p>
      <div className="indigo-dialog-actions"><button type="button" className="indigo-button secondary" disabled={submitting} onClick={() => setConfirmOpen(false)}>Review again</button><button type="button" className="indigo-button primary" disabled={submitting} onClick={() => void submitAllocation()}>{submitting ? 'Reserving units…' : 'Confirm reservation'}</button></div>
    </section></div>}
    {issueTarget && <div className="indigo-dialog-backdrop"><section className="indigo-dialog" role="dialog" aria-modal="true" aria-labelledby="issue-confirm-title"><h2 id="issue-confirm-title">Confirm hospital handoff</h2><p>Issue BloodUnit {issueTarget.bloodUnitId} to the hospital for request #{issueTarget.requestId}?</p><div className="indigo-field"><label htmlFor="handoff-reference">Handoff reference (required, max 80 characters)</label><input id="handoff-reference" maxLength={80} required value={handoffReference} onChange={event => setHandoffReference(event.target.value)} /></div><div className="indigo-dialog-actions"><button type="button" className="indigo-button secondary" disabled={submitting} onClick={() => setIssueTarget(null)}>Cancel</button><button type="button" className="indigo-button primary" disabled={submitting || !handoffReference.trim() || handoffReference.trim().length > 80} onClick={() => void submitIssue()}>{submitting ? 'Recording handoff…' : 'Confirm issue'}</button></div></section></div>}
    <p className="indigo-footnote">Inventory, compatibility and saved request state come from the database. After a successful reservation, inventory, request, dashboard and report pages read committed records when opened or refreshed.</p>
  </Layout>;
}

export default function AllocationWorkspacePage() { return <Access><AllocationWorkspace /></Access>; }
