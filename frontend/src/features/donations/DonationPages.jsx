import { useEffect, useRef, useState } from 'react';
import { Navigate } from 'react-router-dom';
import AuthLayout from '../auth/AuthLayout';
import { useAuth } from '../auth/AuthProvider';
import { bookingApi } from '../../services/bookingServices';
import { donationApi, donationMutation, bookingMutationMessage } from '../../services/donationApi';
import './donations.css';

const todayIst = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const showTime = value => value ? new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) + ' IST' : 'Not recorded';
const params = value => Object.fromEntries(Object.entries(value).filter(([, item]) => item !== ''));
const message = value => value?.replaceAll('_', ' ') ?? 'Not recorded';

function Shell({ role, theme, children }) {
  const auth = useAuth();
  if (auth.loading) return <AuthLayout theme={theme} wide><p role="status">Restoring your account…</p></AuthLayout>;
  if (!auth.user) return <Navigate to="/login" replace />;
  if (auth.user.role !== role || auth.user.accountStatus !== 'ACTIVE') return <Navigate to="/unauthorized" replace />;
  return <AuthLayout theme={theme} wide>{children(auth)}</AuthLayout>;
}

function useList(loader, query, life, auth, items) {
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState('loading');
  const [data, setData] = useState(null);
  const key = JSON.stringify({ query, revision, life });
  const current = useRef(key);
  current.current = key;
  useEffect(() => {
    const controller = new AbortController();
    setState('loading');
    const { refresh: _refresh, ...requestQuery } = query;
    loader(params(requestQuery), controller.signal).then(result => {
      if (controller.signal.aborted || current.current !== key || auth.getAuthLifecycle() !== life) return;
      if (result?.success !== true || !Array.isArray(result[items])
        || !result.pagination) throw new Error('Invalid list');
      setData(result); setState('ready');
    }).catch(() => {
      if (!controller.signal.aborted && current.current === key && auth.getAuthLifecycle() === life) setState('error');
    });
    return () => controller.abort();
  }, [key]);
  return { state, data, key, current, reload: () => { current.current = ''; setRevision(value => value + 1); } };
}

function Pager({ pagination, page }) {
  if (!pagination) return null;
  const pages = Math.max(1, Math.ceil(pagination.total / pagination.pageSize));
  return <nav className="donation-pager" aria-label="Result pages"><span>Page {pagination.page} of {pages}</span>
    <button type="button" disabled={pagination.page <= 1} onClick={() => page(pagination.page - 1)}>Previous</button>
    <button type="button" disabled={pagination.page >= pages} onClick={() => page(pagination.page + 1)}>Next</button></nav>;
}

function History({ auth, admin, refresh, saved = false }) {
  const [draft, setDraft] = useState({ donorAccountId: '', outcome: '', releaseStatus: '', from: '', to: '' });
  const [query, setQuery] = useState({ page: 1 });
  const list = useList(admin ? donationApi.adminHistory : donationApi.ownHistory, { ...query, refresh }, auth.authLifecycle, auth, 'donations');
  const rows = list.data?.donations ?? [];
  return <section className="donation-panel"><h2>{admin ? 'Recorded donations' : 'My donation history'}</h2>
    <p>Dates filter the IST recording date. Collected with PENDING release is not approved inventory.</p>
    <form className="donation-filters" onSubmit={event => { event.preventDefault(); setQuery({ ...params(draft), page: 1 }); }}>
      {admin && <><label>Donor Account ID<input name="donorAccountId" inputMode="numeric" value={draft.donorAccountId} onChange={event => setDraft(old => ({ ...old, donorAccountId: event.target.value }))} /></label>
        <label>Outcome<select name="outcomeFilter" value={draft.outcome} onChange={event => setDraft(old => ({ ...old, outcome: event.target.value }))}><option value="">All outcomes</option>{['COLLECTED', 'INCOMPLETE', 'DEFERRED'].map(value => <option key={value}>{value}</option>)}</select></label>
        <label>Release status<select name="releaseStatus" value={draft.releaseStatus} onChange={event => setDraft(old => ({ ...old, releaseStatus: event.target.value }))}><option value="">All release states</option>{['PENDING', 'APPROVED', 'REJECTED', 'NOT_REQUIRED'].map(value => <option key={value}>{value}</option>)}</select></label></>}
      <label>From date (IST)<input name="from" type="date" value={draft.from} onChange={event => setDraft(old => ({ ...old, from: event.target.value }))} /></label>
      <label>To date (IST)<input name="to" type="date" value={draft.to} onChange={event => setDraft(old => ({ ...old, to: event.target.value }))} /></label>
      <button type="submit">Search</button></form>
    {list.state === 'loading' && <p role="status">Loading donation history…</p>}
    {list.state === 'error' && <p role="alert">{saved ? 'The outcome was saved, but donation history could not be refreshed.' : 'Donation history could not be loaded.'} <button type="button" onClick={list.reload}>Reload</button></p>}
    {list.state === 'ready' && <>{!rows.length && <p>No donations match these filters.</p>}
      {!admin && <p>Next 56-day interval date: {list.data.nextEligibleDate ?? 'No collected donation recorded'}. Staff still make the day-of decision.</p>}
      <div className="donation-grid">{rows.map(row => <article className="donation-item" key={row.donationId}>
        <h3>Donation {row.donationId}</h3>{admin && <p>Donor: {row.donorName} (Account {row.donorAccountId})</p>}
        <p>Booking {row.bookingId} · Slot {row.slotId}</p><p>Outcome: {message(row.outcome)}</p>
        <p>Release: {message(row.releaseStatus)}</p><p>Recorded: {showTime(row.createdAt)}</p>
        {row.collectedAt && <p>Collected: {showTime(row.collectedAt)}</p>}</article>)}</div>
      <Pager pagination={list.data.pagination} page={page => setQuery(old => ({ ...old, page }))} /></>}
  </section>;
}

function AdminContent({ auth }) {
  const [bookingQuery, setBookingQuery] = useState({ bookingStatus: 'CHECKED_IN', page: 1 });
  const [refresh, setRefresh] = useState(0);
  const bookings = useList(bookingApi.adminBookings, { ...bookingQuery, refresh }, auth.authLifecycle, auth, 'bookings');
  const [draft, setDraft] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const choiceRef = useRef(null);
  const preflight = useRef(null);
  const [notice, setNotice] = useState(null);
  const heading = useRef(null);
  const confirmHeading = useRef(null);
  useEffect(() => () => { preflight.current?.abort(); choiceRef.current = null; }, []);
  useEffect(() => { if (confirm) confirmHeading.current?.focus(); }, [confirm]);
  const invalidate = () => { choiceRef.current = null; preflight.current?.abort(); setConfirm(null); };
  const choose = row => {
    if (busyRef.current) return;
    invalidate(); setNotice(null);
    setDraft({ bookingId: row.bookingId, donorAccountId: row.donorAccountId, donorName: row.donorName,
      slotId: row.slotId, startsAt: row.startsAt, outcome: row.latestDecision === 'TEMPORARILY_DEFERRED' ? 'DEFERRED' : 'COLLECTED',
      collectedAt: '', collectionReference: '', sourceKey: bookings.key });
  };
  const review = event => {
    event.preventDefault();
    if (!draft || busyRef.current || bookings.current.current !== draft.sourceKey) return;
    const row = bookings.data?.bookings.find(item => item.bookingId === draft.bookingId);
    if (!row || row.bookingStatus !== 'CHECKED_IN' || row.hasDonation || row.donorAccountStatus !== 'ACTIVE') return;
    if (draft.outcome === 'DEFERRED' ? row.latestDecision !== 'TEMPORARILY_DEFERRED' : row.latestDecision !== 'ACCEPTED') return;
    const captured = Object.freeze({ bookingId: draft.bookingId, donorAccountId: draft.donorAccountId,
      donorName: draft.donorName, startsAt: draft.startsAt, outcome: draft.outcome,
      ...(draft.outcome === 'COLLECTED' ? { collectedAt: `${draft.collectedAt}${draft.collectedAt.length === 16 ? ':00' : ''}+05:30`,
        collectionReference: draft.collectionReference.trim() } : {}) });
    if (captured.outcome === 'COLLECTED' && (!draft.collectedAt || !captured.collectionReference)) return;
    choiceRef.current = { captured, key: bookings.key, life: auth.authLifecycle };
    setConfirm(choiceRef.current);
  };
  const submit = async event => {
    event.preventDefault();
    const choice = choiceRef.current;
    if (!choice || busyRef.current) return;
    busyRef.current = true; setBusy(true);
    const controller = new AbortController(); preflight.current = controller;
    const current = () => choiceRef.current === choice && bookings.current.current === choice.key
      && auth.getAuthLifecycle() === choice.life && draft?.bookingId === choice.captured.bookingId
      && bookings.data?.bookings.some(row => row.bookingId === choice.captured.bookingId && row.bookingStatus === 'CHECKED_IN'
        && row.donorAccountId === choice.captured.donorAccountId && !row.hasDonation);
    try {
      await donationMutation(choice.captured, current, controller.signal);
      if (!current()) return;
      invalidate(); setDraft(null); setNotice({ kind: 'success', text: 'Donation outcome saved. Booking completed.' });
      setRefresh(value => value + 1);
    } catch (error) {
      if (!current()) return;
      const report = bookingMutationMessage(error);
      invalidate(); if (report) setNotice(report);
      if (report?.kind === 'conflict' || report?.kind === 'uncertain') setRefresh(value => value + 1);
    } finally { busyRef.current = false; setBusy(false); }
  };
  const eligible = bookings.data?.bookings.filter(row => row.bookingStatus === 'CHECKED_IN' && !row.hasDonation
    && row.donorAccountStatus === 'ACTIVE' && row.slotStatus !== 'CANCELLED'
    && row.startsAt?.slice(0, 10) === todayIst() && ['ACCEPTED', 'TEMPORARILY_DEFERRED'].includes(row.latestDecision)
    && row.latestDecisionAt?.slice(0, 10) === todayIst()) ?? [];
  return <><header className="donation-heading"><h1 ref={heading} tabIndex={-1}>Donation processing</h1>
    <p>Record one outcome for a checked-in visit. Recording does not create an inventory unit.</p></header>
    {notice && <p className={`donation-notice ${notice.kind}`} role={notice.kind === 'success' ? 'status' : 'alert'}>{notice.text}</p>}
    {busy && <p role="status">An action is still in progress. Changing the view does not cancel it.</p>}
    <section className="donation-panel"><h2>Checked-in visits</h2>
      {bookings.state === 'loading' && <p role="status">Loading checked-in bookings…</p>}
      {bookings.state === 'error' && <p role="alert">{notice?.kind === 'success' ? 'The outcome was saved, but checked-in bookings could not be refreshed.' : 'Bookings could not be loaded.'} <button type="button" onClick={bookings.reload}>Reload</button></p>}
      {bookings.state === 'ready' && <>{!eligible.length && <p>No eligible same-day checked-in visits on this page.</p>}
        <div className="donation-grid">{eligible.map(row => <article className="donation-item" key={row.bookingId}>
          <h3>Booking {row.bookingId}</h3><p>{row.donorName} (Account {row.donorAccountId})</p>
          <p>Slot {row.slotId}: {showTime(row.startsAt)}</p><p>Decision: {message(row.latestDecision)}</p>
          <button type="button" disabled={busy} onClick={() => choose(row)}>Record outcome</button></article>)}</div>
        <Pager pagination={bookings.data.pagination} page={page => { invalidate(); setDraft(null); setBookingQuery({ bookingStatus: 'CHECKED_IN', page }); }} /></>}
    </section>
    {draft && <section className="donation-panel"><h2>Record outcome for booking {draft.bookingId}</h2>
      <p>{draft.donorName} (Account {draft.donorAccountId}), Slot {draft.slotId}, {showTime(draft.startsAt)}.</p>
      <form className="donation-form" onSubmit={review}>
        <label>Outcome<select name="recordOutcome" value={draft.outcome} onChange={event => { invalidate(); setDraft(old => ({ ...old, outcome: event.target.value })); }}>
          {bookings.data?.bookings.find(row => row.bookingId === draft.bookingId)?.latestDecision === 'ACCEPTED'
            ? <><option value="COLLECTED">Collected</option><option value="INCOMPLETE">Incomplete</option></>
            : <option value="DEFERRED">Deferred</option>}
        </select></label>
        {draft.outcome === 'COLLECTED' && <><label>Collected at (IST)<input name="collectedAt" type="datetime-local" step="1" required value={draft.collectedAt}
          onChange={event => { invalidate(); setDraft(old => ({ ...old, collectedAt: event.target.value })); }} /></label>
          <label>Collection reference<input name="collectionReference" required maxLength={80} value={draft.collectionReference}
            onChange={event => { invalidate(); setDraft(old => ({ ...old, collectionReference: event.target.value })); }} /></label></>}
        <button type="submit" disabled={busy}>Review outcome</button>
        <button type="button" disabled={busy} onClick={() => { invalidate(); setDraft(null); }}>Discard draft</button>
      </form></section>}
    {confirm && <section className="donation-panel" onKeyDown={event => { if (event.key === 'Escape' && !busy) invalidate(); }} aria-labelledby="donation-confirm-title">
      <h2 ref={confirmHeading} tabIndex={-1} id="donation-confirm-title">Confirm donation outcome</h2>
      <p>{confirm.captured.donorName} (Account {confirm.captured.donorAccountId}), booking {confirm.captured.bookingId},
        appointment {showTime(confirm.captured.startsAt)}: {message(confirm.captured.outcome)}.
        {confirm.captured.outcome === 'COLLECTED' && ` Collection at ${showTime(confirm.captured.collectedAt)}, reference ${confirm.captured.collectionReference}.`}
        {' '}The booking becomes COMPLETED. This does not create an inventory unit.</p>
      <form onSubmit={submit}><button type="submit" disabled={busy}>{busy ? 'Submitting…' : 'Confirm outcome'}</button>
        <button type="button" disabled={busy} onClick={invalidate}>Cancel</button></form></section>}
    <History auth={auth} admin refresh={refresh} saved={notice?.kind === 'success'} />
  </>;
}

export function AdminDonationPage() { return <Shell role="ADMIN" theme="mint">{auth => <AdminContent key={auth.authLifecycle} auth={auth} />}</Shell>; }
export function DonorDonationPage() { return <Shell role="DONOR" theme="rose">{auth => <><header className="donation-heading"><h1>Donation history</h1>
  <p>Your recorded outcomes are read-only. A collected donation with PENDING release is not approved stock.</p></header>
  <History key={auth.authLifecycle} auth={auth} admin={false} refresh={0} /></>}</Shell>; }
