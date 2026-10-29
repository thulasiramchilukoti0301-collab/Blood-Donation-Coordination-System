import { useEffect, useRef, useState } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import AuthLayout from '../auth/AuthLayout';
import { useAuth } from '../auth/AuthProvider';
import { reportedBloodGroupChoices } from '../donors/bloodGroups';
import { bookingMutationMessage } from '../../services/bookingApi';
import { inventoryMutation, releaseApi, releaseMutation } from '../../services/releaseApi';
import './donations.css';

const reasons = [
  ['TESTING_NOT_APPROVED', 'Testing not approved'],
  ['PROCESSING_ISSUE', 'Processing issue'],
  ['OTHER_NON_SENSITIVE', 'Other non-sensitive reason'],
];
const displayTime = value => value ? new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) + ' IST' : 'Not recorded';
const validPage = value => value?.success === true && value.pagination?.pageSize === 20
  && Number.isSafeInteger(value.pagination.total);

function AdminShell({ children }) {
  const auth = useAuth();
  if (auth.loading) return <AuthLayout theme="mint" wide><p role="status">Restoring account…</p></AuthLayout>;
  if (!auth.user) return <Navigate to="/login" replace />;
  if (auth.user.role !== 'ADMIN' || auth.user.accountStatus !== 'ACTIVE') return <Navigate to="/unauthorized" replace />;
  return <AuthLayout theme="mint" wide>{children(auth)}</AuthLayout>;
}

function usePage(load, query, auth, expected) {
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState({ status: 'loading', data: null });
  const key = JSON.stringify({ query, revision, life: auth.authLifecycle });
  const current = useRef(key); current.current = key;
  useEffect(() => {
    const controller = new AbortController();
    setState(old => ({ ...old, status: 'loading' }));
    load(query, controller.signal).then(data => {
      if (controller.signal.aborted || current.current !== key || auth.getAuthLifecycle() !== auth.authLifecycle) return;
      if (!validPage(data) || !Array.isArray(data[expected])) throw new Error('Unexpected list');
      setState({ status: 'ready', data });
    }).catch(() => {
      if (!controller.signal.aborted && current.current === key && auth.getAuthLifecycle() === auth.authLifecycle)
        setState(old => ({ ...old, status: 'error' }));
    });
    return () => controller.abort();
  }, [key]);
  return { ...state, key, current, reload: () => { current.current = ''; setRevision(value => value + 1); } };
}

function Pagination({ pagination, onPage }) {
  if (!pagination) return null;
  const pages = Math.max(1, Math.ceil(pagination.total / 20));
  return <nav className="donation-pager" aria-label="Result pages"><span>Page {pagination.page} of {pages}</span>
    <button type="button" disabled={pagination.page <= 1} onClick={() => onPage(pagination.page - 1)}>Previous</button>
    <button type="button" disabled={pagination.page >= pages} onClick={() => onPage(pagination.page + 1)}>Next</button></nav>;
}

function Review({ auth }) {
  const [query, setQuery] = useState({ outcome: 'COLLECTED', releaseStatus: 'PENDING', page: 1 });
  const list = usePage(releaseApi.pending, query, auth, 'donations');
  const [draft, setDraft] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const choice = useRef(null), preflight = useRef(null), busyRef = useRef(false), focus = useRef(null);
  const [busy, setBusy] = useState(false), [notice, setNotice] = useState(null), [saved, setSaved] = useState(false);
  useEffect(() => () => { preflight.current?.abort(); choice.current = null; }, []);
  useEffect(() => { if (confirm) focus.current?.focus(); }, [confirm]);
  const invalidate = () => { choice.current = null; preflight.current?.abort(); setConfirm(null); };
  const select = row => {
    if (busyRef.current) return;
    invalidate(); setNotice(null); setSaved(false);
    setDraft({ donationId: row.donationId, bookingId: row.bookingId, outcome: row.outcome,
      collectedAt: row.collectedAt, decision: 'APPROVED', confirmedBloodGroupId: '',
      reasonCode: reasons[0][0], sourceKey: list.key });
  };
  const review = event => {
    event.preventDefault();
    if (!draft || busyRef.current || list.current.current !== draft.sourceKey) return;
    const row = list.data?.donations.find(item => item.donationId === draft.donationId);
    if (!row || row.outcome !== 'COLLECTED' || row.releaseStatus !== 'PENDING'
      || row.bookingId !== draft.bookingId || row.collectedAt !== draft.collectedAt) return;
    if (draft.decision === 'APPROVED' && !reportedBloodGroupChoices.some(group => group.id === draft.confirmedBloodGroupId)) return;
    const captured = Object.freeze({ donationId: draft.donationId, bookingId: draft.bookingId,
      outcome: draft.outcome, collectedAt: draft.collectedAt, decision: draft.decision,
      confirmedBloodGroupId: draft.decision === 'APPROVED' ? draft.confirmedBloodGroupId : null,
      reasonCode: draft.decision === 'APPROVED' ? 'STAFF_RELEASE_APPROVED' : draft.reasonCode });
    choice.current = { captured, key: list.key, life: auth.authLifecycle };
    setConfirm(choice.current);
  };
  const submit = async event => {
    event.preventDefault();
    const selected = choice.current;
    if (!selected || busyRef.current) return;
    busyRef.current = true; setBusy(true);
    const controller = new AbortController(); preflight.current = controller;
    const current = () => choice.current === selected && list.current.current === selected.key
      && auth.getAuthLifecycle() === selected.life && draft?.donationId === selected.captured.donationId
      && list.data?.donations.some(row => row.donationId === selected.captured.donationId
        && row.bookingId === selected.captured.bookingId && row.releaseStatus === 'PENDING');
    try {
      await releaseMutation(selected.captured, current, controller.signal);
      if (!current()) return;
      invalidate(); setDraft(null); setSaved(true);
      setNotice({ kind: 'success', text: `Donation ${selected.captured.donationId} release decision saved.` });
      list.reload();
    } catch (error) {
      if (!current()) return;
      const report = bookingMutationMessage(error);
      invalidate(); if (report) setNotice(report);
      if (report?.kind === 'uncertain' || report?.kind === 'conflict') list.reload();
    } finally { busyRef.current = false; setBusy(false); }
  };
  return <><header className="donation-heading"><h1>Donation release review</h1>
    <p>Confirm a collected donation's release. Staff select the unit group; a self-reported group is never used automatically.</p></header>
    {notice && <p className={`donation-notice ${notice.kind}`} role={notice.kind === 'success' ? 'status' : 'alert'}>{notice.text}</p>}
    {busy && <p role="status">A decision is in progress. Changing the view does not cancel a dispatched request.</p>}
    <section className="donation-panel"><h2>Pending collected donations</h2>
      {list.status === 'loading' && <p role="status">Loading pending donations…</p>}
      {list.status === 'error' && <p role="alert">{saved ? 'The decision was saved, but the list could not be refreshed.' : 'Pending donations could not be loaded.'} <button type="button" onClick={list.reload}>Reload</button></p>}
      {list.status === 'ready' && <>{!list.data.donations.length && <p>No pending collected donations on this page.</p>}
        <div className="donation-grid">{list.data.donations.map(row => <article className="donation-item" key={row.donationId}>
          <h3>Donation {row.donationId}</h3><p>Booking {row.bookingId}</p><p>Collected {displayTime(row.collectedAt)}</p>
          <button type="button" disabled={busy} onClick={() => select(row)}>Review release</button></article>)}</div>
        <Pagination pagination={list.data.pagination} onPage={page => { invalidate(); setDraft(null); setQuery(old => ({ ...old, page })); }} /></>}
    </section>
    {draft && <section className="donation-panel"><h2>Decision for Donation {draft.donationId}</h2>
      <p>Booking {draft.bookingId}; collected {displayTime(draft.collectedAt)}.</p>
      <form className="donation-form" onSubmit={review}>
        <label>Decision<select name="releaseDecision" value={draft.decision} onChange={event => { invalidate(); setDraft(old => ({ ...old, decision: event.target.value })); }}>
          <option value="APPROVED">Approve</option><option value="REJECTED">Reject</option></select></label>
        {draft.decision === 'APPROVED' ? <label>Staff-confirmed unit blood group<select name="confirmedBloodGroupId" required value={draft.confirmedBloodGroupId}
          onChange={event => { invalidate(); setDraft(old => ({ ...old, confirmedBloodGroupId: event.target.value })); }}>
          <option value="">Choose a group</option>{reportedBloodGroupChoices.map(group => <option value={group.id} key={group.id}>{group.code} — {group.displayName}</option>)}</select></label>
          : <label>Non-sensitive rejection reason<select name="reasonCode" value={draft.reasonCode}
            onChange={event => { invalidate(); setDraft(old => ({ ...old, reasonCode: event.target.value })); }}>
            {reasons.map(([code, label]) => <option value={code} key={code}>{label}</option>)}</select></label>}
        <button type="submit" disabled={busy}>Review decision</button>
        <button type="button" disabled={busy} onClick={() => { invalidate(); setDraft(null); }}>Discard draft</button>
      </form></section>}
    {confirm && <section className="donation-panel" aria-labelledby="release-confirm-title" onKeyDown={event => { if (event.key === 'Escape' && !busy) invalidate(); }}>
      <h2 id="release-confirm-title" ref={focus} tabIndex={-1}>Confirm {confirm.captured.decision.toLowerCase()} release</h2>
      <p>Donation {confirm.captured.donationId}, Booking {confirm.captured.bookingId}, outcome COLLECTED,
        collected {displayTime(confirm.captured.collectedAt)}. Decision: {confirm.captured.decision}.
        {confirm.captured.decision === 'APPROVED'
          ? ` Staff-confirmed group ${reportedBloodGroupChoices.find(group => group.id === confirm.captured.confirmedBloodGroupId)?.code}. Approval creates exactly one BloodUnit; an expired collection creates an EXPIRED unit.`
          : ` Reason: ${reasons.find(([code]) => code === confirm.captured.reasonCode)?.[1]}. Rejection creates no BloodUnit.`}</p>
      <form onSubmit={submit}><button type="submit" disabled={busy}>{busy ? 'Submitting…' : 'Confirm decision'}</button>
        <button type="button" disabled={busy} onClick={invalidate}>Cancel</button></form></section>}
  </>;
}

function Inventory({ auth }) {
  const [draft, setDraft] = useState({ bloodGroupId: '', unitStatus: '', availableOnly: '', collectedFrom: '', collectedTo: '', expiresFrom: '', expiresTo: '' });
  const [query, setQuery] = useState({ page: 1 });
  const list = usePage(releaseApi.inventory, query, auth, 'units');
  const [confirm, setConfirm] = useState(null), [notice, setNotice] = useState(null), [busy, setBusy] = useState(false), [saved, setSaved] = useState(false);
  const busyRef = useRef(false), confirmationRef = useRef(null), focus = useRef(null), preflight = useRef(null);
  useEffect(() => () => preflight.current?.abort(), []);
  useEffect(() => { if (confirm) focus.current?.focus(); }, [confirm]);
  useEffect(() => {
    if (confirm && confirm.key !== list.key && !busyRef.current) { confirmationRef.current = null; setConfirm(null); }
  }, [list.key, confirm]);
  const begin = (kind, unit = null) => {
    if (busyRef.current || list.status !== 'ready') return;
    const captured = Object.freeze(kind === 'discard'
      ? { kind, bloodUnitId: unit.bloodUnitId, unitStatus: unit.unitStatus, expiryDate: unit.expiryDate, reasonCode: 'OTHER_NON_SENSITIVE' }
      : { kind, queryKey: list.key });
    confirmationRef.current = { captured, key: list.key, life: auth.authLifecycle };
    setNotice(null); setSaved(false); setConfirm(confirmationRef.current);
  };
  const submit = async event => {
    event.preventDefault(); const selected = confirmationRef.current;
    if (!selected || busyRef.current) return;
    const isCurrent = () => confirmationRef.current === selected && list.current.current === selected.key
      && auth.getAuthLifecycle() === selected.life;
    if (!isCurrent()) return;
    busyRef.current = true; setBusy(true);
    const controller = new AbortController(); preflight.current = controller;
    try {
      const response = await inventoryMutation(selected.captured.kind, selected.captured, isCurrent, controller.signal);
      if (!isCurrent()) return;
      confirmationRef.current = null; setConfirm(null);
      setSaved(true);
      setNotice({ kind: 'success', text: selected.captured.kind === 'discard'
        ? `Unit ${selected.captured.bloodUnitId} discard saved.`
        : `${response.result.expiredCount} due available unit(s) expired on ${response.result.runDate}.` });
      list.reload();
    } catch (error) {
      if (!isCurrent()) return;
      const report = bookingMutationMessage(error);
      confirmationRef.current = null; setConfirm(null);
      if (report) setNotice(report);
      if (report?.kind === 'uncertain' || report?.kind === 'conflict') list.reload();
    } finally { busyRef.current = false; setBusy(false); }
  };
  const search = event => { event.preventDefault(); setQuery({ ...Object.fromEntries(Object.entries(draft).filter(([, value]) => value)), page: 1 }); };
  return <><header className="donation-heading"><h1>Blood inventory</h1><p>Persisted AVAILABLE status can remain after expiry until reconciliation. Effective availability requires an approved, unexpired unit; allocation and issuing are separate.</p></header>
    {notice && <p className={`donation-notice ${notice.kind}`} role={notice.kind === 'success' ? 'status' : 'alert'}>{notice.text}</p>}
    {busy && <p role="status">Inventory action is in progress. A dispatched request cannot be cancelled.</p>}
    <div className="donation-panel"><button type="button" disabled={busy || list.status !== 'ready'} onClick={() => begin('expiry')}>Run expiry reconciliation</button></div>
    {confirm && <section className="donation-panel" aria-labelledby="inventory-confirm-title" onKeyDown={event => { if (event.key === 'Escape' && !busy) { confirmationRef.current = null; setConfirm(null); } }}>
      <h2 id="inventory-confirm-title" tabIndex={-1} ref={focus}>{confirm.captured.kind === 'discard' ? 'Confirm unit discard' : 'Confirm expiry reconciliation'}</h2>
      <p>{confirm.captured.kind === 'discard'
        ? `Unit ${confirm.captured.bloodUnitId}, persisted status ${confirm.captured.unitStatus}, expiry ${confirm.captured.expiryDate}. This records a non-sensitive discard reason. Allocated, issued, expired or discarded units cannot be changed.`
        : 'Due AVAILABLE units will become EXPIRED with an audit record. If a due ALLOCATED unit exists, the entire run is refused until Allocation cancellation and request status can be coordinated.'}</p>
      {confirm.captured.kind === 'discard' && <label>Reason<select value={confirm.captured.reasonCode} onChange={event => {
        const next = Object.freeze({ ...confirm, captured: Object.freeze({ ...confirm.captured, reasonCode: event.target.value }) });
        confirmationRef.current = next; setConfirm(next);
      }}><option value="DAMAGED">Damaged</option><option value="PACKAGING_COMPROMISED">Packaging compromised</option><option value="TEMPERATURE_EXCURSION">Temperature excursion</option><option value="OTHER_NON_SENSITIVE">Other non-sensitive reason</option></select></label>}
      <form onSubmit={submit}><button type="submit" disabled={busy}>{busy ? 'Working…' : 'Confirm'}</button><button type="button" disabled={busy} onClick={() => { confirmationRef.current = null; setConfirm(null); }}>Cancel</button></form>
    </section>}
    <section className="donation-panel"><h2>Find units</h2><form className="donation-filters" onSubmit={search}>
      <label>Blood group<select name="bloodGroupId" value={draft.bloodGroupId} onChange={event => setDraft(old => ({ ...old, bloodGroupId: event.target.value }))}><option value="">All groups</option>{reportedBloodGroupChoices.map(group => <option key={group.id} value={group.id}>{group.code}</option>)}</select></label>
      <label>Unit status<select name="unitStatus" value={draft.unitStatus} onChange={event => setDraft(old => ({ ...old, unitStatus: event.target.value,
        availableOnly: event.target.value && event.target.value !== 'AVAILABLE' ? '' : old.availableOnly }))}><option value="">All statuses</option>{['AVAILABLE', 'ALLOCATED', 'ISSUED', 'EXPIRED', 'DISCARDED'].map(status => <option key={status}>{status}</option>)}</select></label>
      <label>Available only<select name="availableOnly" value={draft.availableOnly} onChange={event => setDraft(old => ({ ...old,
        availableOnly: event.target.value, unitStatus: event.target.value === 'true' ? 'AVAILABLE' : old.unitStatus }))}><option value="">No</option><option value="true">Yes</option></select></label>
      <label>Collected from<input name="collectedFrom" type="date" value={draft.collectedFrom} onChange={event => setDraft(old => ({ ...old, collectedFrom: event.target.value }))} /></label>
      <label>Collected to<input name="collectedTo" type="date" value={draft.collectedTo} onChange={event => setDraft(old => ({ ...old, collectedTo: event.target.value }))} /></label>
      <label>Expires from<input name="expiresFrom" type="date" value={draft.expiresFrom} onChange={event => setDraft(old => ({ ...old, expiresFrom: event.target.value }))} /></label>
      <label>Expires to<input name="expiresTo" type="date" value={draft.expiresTo} onChange={event => setDraft(old => ({ ...old, expiresTo: event.target.value }))} /></label>
      <button type="submit">Search</button></form>
      {list.status === 'loading' && <p role="status">Loading inventory…</p>}
      {list.status === 'error' && <p role="alert">{saved ? 'The inventory action was saved, but the list could not be refreshed.' : 'Inventory could not be loaded.'} <button type="button" onClick={list.reload}>Reload</button></p>}
      {list.status === 'ready' && <>{!list.data.units.length && <p>No units match these filters.</p>}
        <div className="donation-grid">{list.data.units.map(unit => <article className="donation-item" key={unit.bloodUnitId}>
          <h3>Unit {unit.bloodUnitId}</h3><p>Group: {unit.bloodGroupCode}</p><p>Status: {unit.unitStatus}</p>
          <p>Expiry: {unit.expiryDate}</p><p>Persisted status: {unit.unitStatus}</p><p>Effective availability: {unit.effectiveAvailability ? 'Yes' : 'No'}</p><p>Source Donation {unit.donationId}</p>
          {unit.unitStatus === 'AVAILABLE' && <button type="button" disabled={busy} onClick={() => begin('discard', unit)}>Discard unallocated unit</button>}
          <Link to={`/admin/inventory/${unit.bloodUnitId}`}>View unit</Link></article>)}</div>
        <Pagination pagination={list.data.pagination} onPage={page => setQuery(old => ({ ...old, page }))} /></>}
    </section></>;
}

function UnitDiscardAction({ unit, auth, onUpdated }) {
  const [reasonCode, setReasonCode] = useState('OTHER_NON_SENSITIVE'), [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false), [notice, setNotice] = useState(null);
  const busyRef = useRef(false), life = auth.authLifecycle, unitRef = useRef(unit), focus = useRef(null);
  unitRef.current = unit;
  useEffect(() => { if (confirm) focus.current?.focus(); }, [confirm]);
  const submit = async event => {
    event.preventDefault(); if (busyRef.current || !confirm || unitRef.current.unitStatus !== 'AVAILABLE') return;
    const captured = Object.freeze({ kind: 'discard', bloodUnitId: unit.bloodUnitId, unitStatus: unit.unitStatus,
      expiryDate: unit.expiryDate, reasonCode });
    const current = () => auth.getAuthLifecycle() === life && unitRef.current.bloodUnitId === captured.bloodUnitId
      && unitRef.current.unitStatus === captured.unitStatus && unitRef.current.expiryDate === captured.expiryDate && confirm;
    if (!current()) return;
    busyRef.current = true; setBusy(true); const controller = new AbortController();
    try {
      await inventoryMutation('discard', captured, current, controller.signal);
      if (!current()) return;
      setConfirm(false); setNotice({ kind: 'success', text: `Unit ${unit.bloodUnitId} discard saved.` }); onUpdated();
    } catch (error) {
      if (!current()) return;
      const report = bookingMutationMessage(error); setConfirm(false); if (report) setNotice(report);
      if (report?.kind === 'uncertain' || report?.kind === 'conflict') onUpdated();
    } finally { busyRef.current = false; setBusy(false); }
  };
  if (unit.unitStatus !== 'AVAILABLE') return null;
  return <div className="donation-panel"><h3>Discard unit</h3><p>Only an unallocated, unexpired AVAILABLE unit can be discarded. The source Donation and unit history are retained.</p>
    {notice && <p role={notice.kind === 'success' ? 'status' : 'alert'}>{notice.text}</p>}
    {!confirm ? <button type="button" disabled={busy} onClick={() => { setNotice(null); setConfirm(true); }}>Discard unallocated unit</button>
      : <form onSubmit={submit} onKeyDown={event => { if (event.key === 'Escape' && !busy) setConfirm(false); }}>
        <h4 tabIndex={-1} ref={focus}>Confirm discard of Unit {unit.bloodUnitId}</h4><p>Expiry {unit.expiryDate}.</p>
        <label>Reason<select value={reasonCode} onChange={event => setReasonCode(event.target.value)}><option value="DAMAGED">Damaged</option>
          <option value="PACKAGING_COMPROMISED">Packaging compromised</option><option value="TEMPERATURE_EXCURSION">Temperature excursion</option>
          <option value="OTHER_NON_SENSITIVE">Other non-sensitive reason</option></select></label>
        <button type="submit" disabled={busy}>{busy ? 'Working…' : 'Confirm discard'}</button>
        <button type="button" disabled={busy} onClick={() => setConfirm(false)}>Cancel</button></form>}
  </div>;
}

function UnitDetail({ auth }) {
  const { bloodUnitId } = useParams();
  const [state, setState] = useState({ status: 'loading', unit: null });
  useEffect(() => {
    const controller = new AbortController(); setState({ status: 'loading', unit: null });
    releaseApi.detail(bloodUnitId, controller.signal).then(data => {
      if (!controller.signal.aborted && auth.getAuthLifecycle() === auth.authLifecycle) {
        if (data?.success !== true || data.unit?.bloodUnitId !== bloodUnitId) throw new Error('Unexpected unit');
        setState({ status: 'ready', unit: data.unit });
      }
    }).catch(() => { if (!controller.signal.aborted && auth.getAuthLifecycle() === auth.authLifecycle) setState({ status: 'error', unit: null }); });
    return () => controller.abort();
  }, [bloodUnitId, auth.authLifecycle]);
  const unit = state.unit;
  return <><header className="donation-heading"><h1>Blood unit details</h1><Link to="/admin/inventory">Back to inventory</Link></header>
    <section className="donation-panel">
      {state.status === 'loading' && <p role="status">Loading unit…</p>}
      {state.status === 'error' && <p role="alert">Unit details could not be loaded.</p>}
      {unit && <><h2>Unit {unit.bloodUnitId}</h2><p>Group: {unit.bloodGroupCode}</p><p>Status: {unit.unitStatus}</p>
        <p>Expiry: {unit.expiryDate}</p><p>Source Donation {unit.donationId}: {unit.outcome}</p>
        <p>Collected: {displayTime(unit.collectedAt)}</p><p>Release: {unit.releaseStatus} at {displayTime(unit.releaseDecidedAt)}</p>
        {unit.expiredAt && <p>Expired: {displayTime(unit.expiredAt)}</p>}{unit.discardedAt && <p>Discarded: {displayTime(unit.discardedAt)} ({unit.discardReasonCode})</p>}
        <p>Effective availability: {unit.effectiveAvailability ? 'Yes' : 'No'}</p><p>Allocation history: unavailable until the Allocation module is integrated.</p>
        <UnitDiscardAction key={`${unit.bloodUnitId}:${unit.unitStatus}`} unit={unit} auth={auth} onUpdated={() => {
          const controller = new AbortController(); releaseApi.detail(bloodUnitId, controller.signal).then(data => {
            if (auth.getAuthLifecycle() === auth.authLifecycle && data?.success === true && data.unit?.bloodUnitId === bloodUnitId) setState({ status: 'ready', unit: data.unit });
          }).catch(() => {});
        }} /></>}
    </section></>;
}

export function ReleaseReviewPage() { return <AdminShell>{auth => <Review key={auth.authLifecycle} auth={auth} />}</AdminShell>; }
export function InventoryPage() { return <AdminShell>{auth => <Inventory key={auth.authLifecycle} auth={auth} />}</AdminShell>; }
export function UnitDetailPage() { return <AdminShell>{auth => <UnitDetail key={auth.authLifecycle} auth={auth} />}</AdminShell>; }
