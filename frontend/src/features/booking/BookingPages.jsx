import { useEffect, useRef, useState } from 'react';
import { Navigate } from 'react-router-dom';
import AuthLayout from '../auth/AuthLayout';
import { useAuth } from '../auth/AuthProvider';
import { bookingMutationMessage } from '../../services/bookingApi';
import { bookingApi, sendBookingMutation } from '../../services/bookingServices';
import './booking.css';

const statusNames = ['BOOKED', 'CANCELLED_BY_DONOR', 'CANCELLED_BY_STAFF', 'CHECKED_IN', 'NO_SHOW', 'COMPLETED'];
const formatTime = value => new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
const timestamp = value => value ? `${formatTime(value)} IST` : 'Not recorded';
const localInput = value => value?.slice(0, 19) ?? '';
const apiTime = value => `${value}${value.length === 16 ? ':00' : ''}+05:30`;
const validLocal = value => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/u.test(value);
const positiveId = value => /^[1-9][0-9]{0,19}$/u.test(value);
const copy = value => JSON.parse(JSON.stringify(value));
const todayIst = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

function Shell({ role, theme, children }) {
  const auth = useAuth();
  if (auth.loading) return <AuthLayout theme={theme} wide><p role="status">Restoring your account…</p></AuthLayout>;
  if (!auth.user) return <Navigate to="/login" replace />;
  if (auth.user.role !== role || auth.user.accountStatus !== 'ACTIVE') return <Navigate to="/unauthorized" replace />;
  return <AuthLayout theme={theme} wide>{children(auth)}</AuthLayout>;
}
function Notice({ value }) {
  if (!value) return null;
  return <p tabIndex={-1} className={`booking-notice ${value.kind}`} role={value.kind === 'success' ? 'status' : 'alert'}>{value.text}</p>;
}
function PageState({ state, error, retry, saved }) {
  if (state === 'loading') return <p role="status" aria-busy="true">Loading saved information…</p>;
  if (state === 'error') return <div className="booking-panel"><p role="alert">{saved ? 'The action was saved, but the list could not be refreshed.' : error}</p><button type="button" onClick={retry}>Reload list</button></div>;
  return null;
}
function Pagination({ pagination, change }) {
  if (!pagination) return null;
  const pages = Math.max(1, Math.ceil(pagination.total / pagination.pageSize));
  return <nav className="booking-pages" aria-label="Result pages"><span>Page {pagination.page} of {pages}</span>
    <button type="button" disabled={pagination.page <= 1} onClick={() => change(pagination.page - 1)}>Previous</button>
    <button type="button" disabled={pagination.page >= pages} onClick={() => change(pagination.page + 1)}>Next</button></nav>;
}

function useList(loader, initial, auth) {
  const [query, setQuery] = useState(initial);
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState('loading');
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const scope = useRef('');
  const saveRef = useRef(false);
  const key = JSON.stringify({ query, revision });
  scope.current = key;
  useEffect(() => {
    const controller = new AbortController();
    const start = auth.getAuthLifecycle();
    setState('loading');
    loader(query, controller.signal).then(result => {
      if (controller.signal.aborted || scope.current !== key || auth.getAuthLifecycle() !== start) return;
      if (result?.success !== true || !result.pagination || !Array.isArray(result.slots ?? result.bookings)) throw new Error('Invalid response');
      setData(result); setState('ready'); setSaved(false); saveRef.current = false;
    }).catch(() => {
      if (controller.signal.aborted || scope.current !== key || auth.getAuthLifecycle() !== start) return;
      setError('Saved information could not be loaded.'); setSaved(saveRef.current); setState('error');
    });
    return () => controller.abort();
  }, [key]);
  return { query, key, scope, state, data, error, saved,
    change(next) { scope.current = ''; saveRef.current = false; setQuery(next); },
    reload(wasSaved = false) { scope.current = ''; saveRef.current = wasSaved; setRevision(value => value + 1); } };
}

function useConfirmation(list, auth) {
  const [selected, setSelected] = useState(null);
  const selectedRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [notice, setNotice] = useState(null);
  const preflight = useRef(null);
  const trigger = useRef(null);
  const title = useRef(null);
  const heading = useRef(null);
  const life = auth.authLifecycle;
  useEffect(() => () => { preflight.current?.abort(); selectedRef.current = null; }, []);
  useEffect(() => { if (selected) title.current?.focus(); }, [selected]);
  function clear(focus = false) {
    selectedRef.current = null; preflight.current?.abort(); setSelected(null);
    if (focus) (trigger.current?.isConnected ? trigger.current : heading.current)?.focus();
  }
  function select(event, action) {
    if (busyRef.current) return;
    trigger.current = event.nativeEvent?.submitter ?? event.currentTarget;
    const value = Object.freeze({ ...action, captured: copy(action.captured), key: list.key, life });
    selectedRef.current = value; setSelected(value); setNotice(null);
  }
  function change(next) { clear(); setNotice(null); list.change(next); }
  async function confirm(event) {
    event.preventDefault();
    const choice = selectedRef.current;
    if (!choice || busyRef.current || list.scope.current !== choice.key || auth.getAuthLifecycle() !== choice.life) return;
    busyRef.current = true; setBusy(true);
    const controller = new AbortController(); preflight.current = controller;
    const isCurrent = () => selectedRef.current === choice && list.scope.current === choice.key
      && auth.getAuthLifecycle() === choice.life && choice.matches();
    try {
      await sendBookingMutation({ ...choice.request, signal: controller.signal, isCurrent });
      if (!isCurrent()) return;
      setNotice({ kind: 'success', text: `${choice.label} was saved.` });
      clear(); list.reload(true);
    } catch (error) {
      if (!isCurrent()) { if (selectedRef.current === choice) clear(); return; }
      const message = bookingMutationMessage(error);
      if (!message) return;
      setNotice(message); clear();
      if (['conflict', 'uncertain'].includes(message.kind)) list.reload();
    } finally {
      busyRef.current = false; setBusy(false);
    }
  }
  const visible = selected?.key === list.key && selectedRef.current === selected ? selected : null;
  const confirmation = visible && <section className="booking-panel booking-confirm" role="region" aria-labelledby="booking-confirm-heading"
    onKeyDown={event => { if (event.key === 'Escape' && !busy) { event.preventDefault(); clear(true); } }}>
    <h2 ref={title} tabIndex={-1} id="booking-confirm-heading">Confirm {visible.label.toLowerCase()}</h2>
    <p>{visible.description}</p><form onSubmit={confirm} aria-busy={busy}>
      <button type="submit" disabled={busy}>{busy ? 'Submitting…' : `Confirm ${visible.label.toLowerCase()}`}</button>
      <button type="button" disabled={busy} onClick={() => clear(true)}>Cancel</button>
    </form>{busy && <p role="status">Submitting. Please wait.</p>}</section>;
  return { select, clear, change, busy, notice, confirmation, heading, reload: list.reload,
    invalidate() { clear(); setNotice(null); } };
}

function EligibilityContent({ auth }) {
  const [value, setValue] = useState(null);
  const [state, setState] = useState('loading');
  useEffect(() => {
    const controller = new AbortController(); const life = auth.authLifecycle;
    bookingApi.eligibility(controller.signal).then(result => {
      if (!controller.signal.aborted && auth.getAuthLifecycle() === life) { setValue(result); setState('ready'); }
    }).catch(() => { if (!controller.signal.aborted && auth.getAuthLifecycle() === life) setState('error'); });
    return () => controller.abort();
  }, [auth.authLifecycle]);
  return <><header className="booking-heading"><h1>Eligibility status</h1><p>This preview uses today’s India Standard Time date. Each booking is checked again against its appointment date.</p></header>
    {state === 'loading' && <p role="status">Checking advisory eligibility…</p>}
    {state === 'error' && <p role="alert">Eligibility could not be loaded. Refresh to try again.</p>}
    {value && state === 'ready' && <section className="booking-panel"><h2>{value.result.replaceAll('_', ' ')}</h2>
      <dl><dt>Evaluation date (IST)</dt><dd>{value.evaluationDate}</dd><dt>Reason</dt><dd>{value.reasonCode.replaceAll('_', ' ')}</dd>
        <dt>Next interval date</dt><dd>{value.nextEligibleDate ?? 'No collected donation recorded'}</dd>
        <dt>Latest staff decision</dt><dd>{value.latestDecision ?? 'None recorded'}</dd>
        {value.deferredUntil && <><dt>Deferral through</dt><dd>{value.deferredUntil} (inclusive)</dd></>}
      </dl><p>Advisory only. Staff assess eligibility again on the donation day.</p></section>}</>;
}
export function EligibilityPage() { return <Shell role="DONOR" theme="rose">{auth => <EligibilityContent key={auth.authLifecycle} auth={auth} />}</Shell>; }

function SlotList({ auth, admin }) {
  const list = useList((query, signal) => bookingApi.slots(query, signal), { page: 1 }, auth);
  const action = useConfirmation(list, auth);
  const [filters, setFilters] = useState({ from: '', to: '', slotStatus: '' });
  const [form, setForm] = useState({ startsAt: '', endsAt: '', capacity: 1 });
  const [editing, setEditing] = useState(null);
  const [validation, setValidation] = useState('');
  const rows = list.state === 'ready' ? list.data.slots : [];
  const params = { ...filters, page: 1 };
  Object.keys(params).forEach(key => { if (params[key] === '') delete params[key]; });
  const title = admin ? 'Donation slot management' : 'Available donation slots';
  function updateDraft(key, value) {
    action.invalidate();
    setForm(previous => ({ ...previous, [key]: value }));
  }
  const input = () => {
    if (!validLocal(form.startsAt) || !validLocal(form.endsAt) || !Number.isInteger(Number(form.capacity))
      || Number(form.capacity) < 1 || Number(form.capacity) > 65535) { setValidation('Enter valid IST start/end times and capacity from 1 to 65535.'); return null; }
    setValidation('');
    return { startsAt: apiTime(form.startsAt), endsAt: apiTime(form.endsAt), capacity: Number(form.capacity) };
  };
  function offer(event, label, description, path, method, body, expected, captured) {
    action.select(event, { label, description, request: { path, method, body, expected }, captured,
      matches: () => list.scope.current === list.key });
  }
  return <><header className="booking-heading"><h1 ref={action.heading} tabIndex={-1}>{title}</h1>
    <p>{admin ? 'Schedule future appointments and manage capacity. Times are India Standard Time.'
      : 'These are future OPEN slots. Eligibility shown here uses each appointment date and is rechecked when booking.'}</p></header>
    <Notice value={action.notice} />{action.busy && <p role="status">An action is still in progress. Changing filters does not cancel it.</p>}
    {admin && <section className="booking-panel"><h2>{editing ? `Edit slot ${editing.slotId}` : 'Create a slot'}</h2>
      <form className="booking-form" onSubmit={event => {
        event.preventDefault(); const body = input(); if (!body) return;
        const capture = editing ? copy(editing) : copy(body);
        const payload = editing ? Object.fromEntries(Object.entries(body).filter(([key, value]) => key === 'capacity' ? value !== editing.capacity : value !== editing[key])) : body;
        if (editing && !Object.keys(payload).length) { setValidation('Change at least one field.'); return; }
        offer(event, editing ? 'Update slot' : 'Create slot',
          `${editing ? `Slot ${editing.slotId}` : 'New slot'}: ${body.startsAt} to ${body.endsAt}; capacity ${body.capacity}.`,
          editing ? `/admin/donation-slots/${editing.slotId}` : '/admin/donation-slots', editing ? 'PATCH' : 'POST', payload,
          result => editing ? result.slot?.slotId === editing.slotId && result.slot?.slotStatus === editing.slotStatus
            && result.slot?.capacity === body.capacity : positiveId(result.slot?.slotId) && result.slot?.slotStatus === 'OPEN'
              && result.slot?.capacity === body.capacity, capture);
      }}>
        <label>Starts at (IST)<input name="startsAt" type="datetime-local" step="1" value={form.startsAt} onChange={event => updateDraft('startsAt', event.target.value)} required /></label>
        <label>Ends at (IST)<input name="endsAt" type="datetime-local" step="1" value={form.endsAt} onChange={event => updateDraft('endsAt', event.target.value)} required /></label>
        <label>Capacity<input name="capacity" type="number" min="1" max="65535" value={form.capacity} onChange={event => updateDraft('capacity', event.target.value)} required /></label>
        {validation && <p role="alert">{validation}</p>}
        <div className="booking-actions"><button type="submit" disabled={action.busy}>{editing ? 'Review update' : 'Review creation'}</button>
          {editing && <button type="button" onClick={() => { action.invalidate(); setEditing(null); setForm({ startsAt: '', endsAt: '', capacity: 1 }); }}>Discard edit</button>}</div>
      </form></section>}
    <section className="booking-panel"><h2>Find slots</h2><form className="booking-filters" onSubmit={event => { event.preventDefault(); action.change(params); }}>
      <label>From date (IST)<input name="from" type="date" value={filters.from} onChange={event => setFilters(old => ({ ...old, from: event.target.value }))} /></label>
      <label>To date (IST)<input name="to" type="date" value={filters.to} onChange={event => setFilters(old => ({ ...old, to: event.target.value }))} /></label>
      {admin && <label>Status<select name="slotStatus" value={filters.slotStatus} onChange={event => setFilters(old => ({ ...old, slotStatus: event.target.value }))}>
        <option value="">All statuses</option>{['OPEN', 'CLOSED', 'CANCELLED'].map(value => <option key={value}>{value}</option>)}</select></label>}
      <button type="submit">Search</button></form></section>
    {action.confirmation}
    <PageState state={list.state} error={list.error} saved={list.saved} retry={() => list.reload(list.saved)} />
    {list.state === 'ready' && <section className="booking-panel"><h2>{admin ? 'Slots' : 'Future slots'}</h2>
      {!rows.length && <p>No slots match these filters.</p>}
      <div className="booking-grid">{rows.map(slot => <article className="booking-item" key={slot.slotId}>
        <h3>Slot {slot.slotId}</h3><p>{timestamp(slot.startsAt)} to {timestamp(slot.endsAt)}</p>
        <p>Status: {slot.slotStatus}. Occupied: {slot.occupied} / {slot.capacity}. Remaining: {slot.remaining}.</p>
        {!admin && <p>Appointment-date eligibility: {slot.eligibility?.result?.replaceAll('_', ' ')} ({slot.eligibility?.reasonCode?.replaceAll('_', ' ')})</p>}
        <div className="booking-actions">{admin ? <>
          <button type="button" disabled={action.busy || slot.slotStatus === 'CANCELLED'} onClick={() => {
            action.invalidate(); setEditing(slot); setForm({ startsAt: localInput(slot.startsAt), endsAt: localInput(slot.endsAt), capacity: slot.capacity });
          }}>Edit</button>
          {slot.slotStatus === 'OPEN' && <button type="button" disabled={action.busy} onClick={event => offer(event, 'Close slot',
            `Close slot ${slot.slotId}. Existing bookings remain; new booking stops.`, `/admin/donation-slots/${slot.slotId}`, 'PATCH',
            { slotStatus: 'CLOSED', reason: 'STAFF_CLOSED' }, result => result.slot?.slotId === slot.slotId && result.slot?.slotStatus === 'CLOSED', slot)}>Close</button>}
          {slot.slotStatus !== 'CANCELLED' && <button type="button" disabled={action.busy} onClick={event => offer(event, 'Cancel slot',
            `Cancel slot ${slot.slotId}. Still-booked reservations will be cancelled with the staff reason and audited. Checked-in attendance must be resolved first.`,
            `/admin/donation-slots/${slot.slotId}`, 'PATCH', { slotStatus: 'CANCELLED', reason: 'STAFF_CANCELLED' },
            result => result.slot?.slotId === slot.slotId && result.slot?.slotStatus === 'CANCELLED', slot)}>Cancel slot</button>}
        </> : <button type="button" disabled={action.busy || !slot.bookable} onClick={event => offer(event, 'Book slot',
          `Book slot ${slot.slotId} on ${timestamp(slot.startsAt)}. Eligibility and capacity will be checked again. This same slot cannot be rebooked after cancellation.`,
          '/donors/me/bookings', 'POST', { slotId: slot.slotId },
          result => positiveId(result.booking?.bookingId) && result.booking?.slot?.slotId === slot.slotId && result.booking?.bookingStatus === 'BOOKED', slot)}>Book</button>}</div>
      </article>)}</div><Pagination pagination={list.data.pagination} change={page => action.change({ ...list.query, page })} /></section>}</>;
}
export function DonorSlotsPage() { return <Shell role="DONOR" theme="rose">{auth => <SlotList key={auth.authLifecycle} auth={auth} admin={false} />}</Shell>; }
export function AdminSlotsPage() { return <Shell role="ADMIN" theme="mint">{auth => <SlotList key={auth.authLifecycle} auth={auth} admin />}</Shell>; }

function BookingList({ auth, admin }) {
  const list = useList((query, signal) => admin ? bookingApi.adminBookings(query, signal) : bookingApi.ownBookings(query, signal), { page: 1 }, auth);
  const action = useConfirmation(list, auth);
  const [filters, setFilters] = useState({ bookingStatus: '', donor: '', from: '', to: '' });
  const [decisionDrafts, setDecisionDrafts] = useState({});
  const rows = list.state === 'ready' ? list.data.bookings : [];
  const params = { ...filters, page: 1 }; Object.keys(params).forEach(key => { if (!params[key]) delete params[key]; });
  return <><header className="booking-heading"><h1 ref={action.heading} tabIndex={-1}>{admin ? 'Bookings management' : 'My bookings'}</h1>
    <p>{admin ? 'Filter bookings. Check-in and day-of decisions are available for eligible appointments.' : 'Review your saved bookings and cancel a BOOKED reservation before its start time.'}</p></header>
    <Notice value={action.notice} />{action.busy && <p role="status">An action is still in progress. Filters do not cancel it.</p>}
    <section className="booking-panel"><h2>Find bookings</h2><form className="booking-filters" onSubmit={event => { event.preventDefault(); action.change(params); }}>
      {admin && <label>Donor Account ID<input name="donor" inputMode="numeric" value={filters.donor} onChange={event => setFilters(old => ({ ...old, donor: event.target.value }))} /></label>}
      <label>Status<select name="bookingStatus" value={filters.bookingStatus} onChange={event => setFilters(old => ({ ...old, bookingStatus: event.target.value }))}>
        <option value="">All statuses</option>{statusNames.map(value => <option key={value}>{value}</option>)}</select></label>
      <label>From date (IST)<input name="from" type="date" value={filters.from} onChange={event => setFilters(old => ({ ...old, from: event.target.value }))} /></label>
      <label>To date (IST)<input name="to" type="date" value={filters.to} onChange={event => setFilters(old => ({ ...old, to: event.target.value }))} /></label>
      <button type="submit">Search</button></form></section>
    {action.confirmation}<PageState state={list.state} error={list.error} saved={list.saved} retry={() => list.reload(list.saved)} />
    {list.state === 'ready' && <section className="booking-panel"><h2>Bookings</h2>{!rows.length && <p>No bookings match these filters.</p>}
      <div className="booking-grid">{rows.map(row => <article className="booking-item" key={row.bookingId}>
        <h3>Booking {row.bookingId}</h3>{admin && <p>Donor: {row.donorName} (Account {row.donorAccountId})</p>}
        <p>Slot {row.slotId}: {timestamp(row.startsAt)} to {timestamp(row.endsAt)}</p>
        <p>Status: {row.bookingStatus}. Changed: {timestamp(row.statusChangedAt)}</p>
        {row.cancellationReason && <p>Cancellation: {row.cancellationReason.replaceAll('_', ' ')}</p>}
        {row.latestDecision && <p>Latest staff decision: {row.latestDecision.replaceAll('_', ' ')}{row.latestDeferredUntil ? ` through ${row.latestDeferredUntil} (IST)` : ''}.</p>}
        {admin && row.bookingStatus === 'BOOKED' && row.donorAccountStatus === 'ACTIVE'
          && row.slotStatus !== 'CANCELLED' && Date.now() >= new Date(row.startsAt).getTime()
          && Date.now() < new Date(row.endsAt).getTime() && <button type="button" disabled={action.busy}
            onClick={event => action.select(event, { label: 'Check in', captured: copy(row),
              description: `Check in ${row.donorName} (Account ${row.donorAccountId}) for booking ${row.bookingId}, ${timestamp(row.startsAt)}. This changes BOOKED to CHECKED_IN and does not create a donation.`,
              request: { method: 'PATCH', path: `/admin/bookings/${row.bookingId}/status`,
                body: { bookingStatus: 'CHECKED_IN', reason: 'STAFF_CHECKED_IN' },
                expected: result => result.booking?.bookingId === row.bookingId && result.booking?.donorAccountId === row.donorAccountId
                  && result.booking?.bookingStatus === 'CHECKED_IN' },
              matches: () => list.scope.current === list.key && list.data?.bookings.some(current => current.bookingId === row.bookingId
                && current.bookingStatus === 'BOOKED' && current.donorAccountId === row.donorAccountId) })}>Check in</button>}
        {admin && row.bookingStatus === 'CHECKED_IN' && row.donorAccountStatus === 'ACTIVE' && !row.hasDonation
          && new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(row.startsAt)) === todayIst()
          && <form className="booking-actions" onSubmit={event => {
            event.preventDefault();
            const draft = decisionDrafts[row.bookingId] ?? { decision: 'ACCEPTED', deferredUntil: todayIst() };
            const body = { bookingId: row.bookingId, decision: draft.decision,
              ...(draft.decision === 'TEMPORARILY_DEFERRED' ? { deferredUntil: draft.deferredUntil } : {}) };
            if (body.decision === 'TEMPORARILY_DEFERRED' && (!body.deferredUntil || body.deferredUntil < todayIst())) return;
            const reason = { ACCEPTED: 'STAFF_ACCEPTED', TEMPORARILY_DEFERRED: 'STAFF_TEMPORARY_DEFERRAL', REVIEW_REQUIRED: 'STAFF_REVIEW_REQUIRED' }[draft.decision];
            const deferredUntil = body.deferredUntil ?? null;
            action.select(event, { label: 'Record eligibility decision', captured: copy(row),
              description: `Record ${draft.decision.replaceAll('_', ' ')} for ${row.donorName} (Account ${row.donorAccountId}), booking ${row.bookingId}, appointment ${timestamp(row.startsAt)}.${deferredUntil ? ` The deferral is through ${deferredUntil}, inclusive in India Standard Time.` : ''} This appends a decision to this visit's history.`,
              request: { method: 'POST', path: `/admin/donors/${row.donorAccountId}/eligibility-decisions`, body,
                expected: result => result.eligibilityDecision?.bookingId === row.bookingId
                  && result.eligibilityDecision?.donorAccountId === row.donorAccountId
                  && result.eligibilityDecision?.decision === draft.decision && result.eligibilityDecision?.reasonCode === reason
                  && result.eligibilityDecision?.deferredUntil === deferredUntil
                  && positiveId(result.eligibilityDecision?.eligibilityDecisionId) },
              matches: () => list.scope.current === list.key && list.data?.bookings.some(current => current.bookingId === row.bookingId
                && current.bookingStatus === 'CHECKED_IN' && current.donorAccountId === row.donorAccountId && !current.hasDonation) });
          }}>
            <label>Day-of eligibility decision for booking {row.bookingId}<select name={`decision-${row.bookingId}`} aria-label={`Day-of eligibility decision for booking ${row.bookingId}`}
              value={(decisionDrafts[row.bookingId] ?? { decision: 'ACCEPTED' }).decision}
              onChange={event => { action.invalidate(); setDecisionDrafts(old => ({ ...old, [row.bookingId]: { ...old[row.bookingId], decision: event.target.value,
                ...(event.target.value === 'TEMPORARILY_DEFERRED' ? { deferredUntil: old[row.bookingId]?.deferredUntil ?? todayIst() } : {}) } })); }}>
              <option value="ACCEPTED">Accept</option><option value="TEMPORARILY_DEFERRED">Temporarily defer</option><option value="REVIEW_REQUIRED">Review required</option>
            </select></label>
            {(decisionDrafts[row.bookingId]?.decision ?? 'ACCEPTED') === 'TEMPORARILY_DEFERRED' && <label>Deferred until (IST)
              <input name={`deferredUntil-${row.bookingId}`} type="date" min={todayIst()} required aria-label={`Deferred until for booking ${row.bookingId}`}
                value={decisionDrafts[row.bookingId]?.deferredUntil ?? todayIst()}
                onChange={event => { action.invalidate(); setDecisionDrafts(old => ({ ...old, [row.bookingId]: { ...old[row.bookingId], deferredUntil: event.target.value } })); }} />
            </label>}
            <button type="submit" disabled={action.busy}>Review decision</button>
          </form>}
        {!admin && row.bookingStatus === 'BOOKED' && new Date(row.startsAt).getTime() > Date.now() && <button type="button" disabled={action.busy}
          onClick={event => action.select(event, { label: 'Cancel booking', captured: row,
            description: `Cancel your BOOKED reservation ${row.bookingId} for slot ${row.slotId} on ${timestamp(row.startsAt)}? The same slot cannot be rebooked.`,
            request: { method: 'POST', path: `/donors/me/bookings/${row.bookingId}/cancellation`, body: { reasonCode: 'DONOR_REQUESTED' },
              expected: result => result.booking?.bookingId === row.bookingId && result.booking?.bookingStatus === 'CANCELLED_BY_DONOR' },
            matches: () => list.scope.current === list.key })}>Cancel booking</button>}
      </article>)}</div><Pagination pagination={list.data.pagination} change={page => action.change({ ...list.query, page })} /></section>}</>;
}
export function DonorBookingsPage() { return <Shell role="DONOR" theme="rose">{auth => <BookingList key={auth.authLifecycle} auth={auth} admin={false} />}</Shell>; }
export function AdminBookingsPage() { return <Shell role="ADMIN" theme="mint">{auth => <BookingList key={auth.authLifecycle} auth={auth} admin />}</Shell>; }
