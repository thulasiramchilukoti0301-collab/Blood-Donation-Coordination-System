import { useEffect, useRef, useState } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import AuthLayout from '../auth/AuthLayout';
import { useAuth } from '../auth/AuthProvider';
import { reportedBloodGroupChoices } from './bloodGroups';
import { adminDonorError, canManageDonors, DEFAULT_DONOR_FILTERS, DONOR_STATUSES, validateAdminDonorFilters } from './adminDonors';
import { getAdminDonor, listAdminDonors, updateAdminDonor } from '../../services/adminDonors';
import { bookingMutationMessage } from '../../services/bookingApi';
import './adminDonors.css';

const pendingDonorMutations = new Map();
function reserveDonorMutation(donorId, token) {
  if (pendingDonorMutations.has(donorId)) return null;
  let settle;
  const settled = new Promise(resolve => { settle = resolve; });
  pendingDonorMutations.set(donorId, { token, settled, settle });
  return token;
}
function finishDonorMutation(donorId, token) {
  const pending = pendingDonorMutations.get(donorId);
  if (pending?.token !== token) return;
  pendingDonorMutations.delete(donorId);
  pending.settle();
}

function Feedback({ title, message, retry, children }) {
  return <section className="mint-card mint-feedback-card mint-admin-feedback"><h2>{title}</h2><p role={retry ? 'alert' : 'status'}>{message}</p>
    {retry && <button className="mint-button mint-button-secondary" type="button" onClick={retry}>Try again</button>}{children}</section>;
}
function Group({ value }) { return value ? <>{value.code}{value.displayName ? ` — ${value.displayName}` : ''}</> : <>Not provided</>; }
function Status({ value }) { return <span className={`mint-status-pill mint-status-${value.toLowerCase()}`}>{value}</span>; }
function timestamp(value) { return value ? new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value.includes('+') ? value : `${value.replace(' ', 'T')}+05:30`)) : 'Not recorded'; }
const draftFrom = donor => ({ fullName: donor.fullName, dateOfBirth: donor.dateOfBirth, phone: donor.phone,
  address: donor.address, area: donor.area ?? '', confirmedBloodGroupId: donor.confirmedBloodGroup?.bloodGroupId ?? '' });

export default function AdminDonorManagement() {
  const { donorId } = useParams();
  const { user, loading, restoreError, restore, authLifecycle, getAuthLifecycle } = useAuth();
  const permitted = canManageDonors(user);
  if (loading) return <AuthLayout theme="mint" wide><Feedback title="Restoring your account" message="Checking your sign-in status…" /></AuthLayout>;
  if (!user && restoreError) return <AuthLayout theme="mint" wide><Feedback title="Could not check your account" message={restoreError} retry={() => void restore()} /></AuthLayout>;
  if (!user) return <Navigate to="/login" replace />;
  if (!permitted) return <Navigate to="/unauthorized" replace />;
  return <DonorWorkspace key={`${authLifecycle}:${user.accountId}:${donorId ?? 'list'}`} donorId={donorId}
    lifecycle={authLifecycle} getAuthLifecycle={getAuthLifecycle} />;
}

function DonorWorkspace({ donorId, lifecycle, getAuthLifecycle }) {
  return donorId ? <DonorDetail donorId={donorId} lifecycle={lifecycle} getAuthLifecycle={getAuthLifecycle} />
    : <DonorList lifecycle={lifecycle} getAuthLifecycle={getAuthLifecycle} />;
}

function DonorList({ lifecycle, getAuthLifecycle }) {
  const [draft, setDraft] = useState({ ...DEFAULT_DONOR_FILTERS });
  const [filters, setFilters] = useState({ ...DEFAULT_DONOR_FILTERS });
  const [page, setPage] = useState(1);
  const [revision, setRevision] = useState(0);
  const [errors, setErrors] = useState({});
  const [result, setResult] = useState({ key: '', state: 'loading', data: null, message: '' });
  const form = useRef(null);
  const key = JSON.stringify([filters, page, revision, lifecycle]);
  const currentKey = useRef(key); currentKey.current = key;
  useEffect(() => {
    const controller = new AbortController();
    setResult({ key, state: 'loading', data: null, message: '' });
    listAdminDonors(filters, page, { signal: controller.signal }).then(data => {
      if (controller.signal.aborted || currentKey.current !== key || getAuthLifecycle() !== lifecycle) return;
      setResult({ key, state: 'ready', data, message: '' });
    }).catch(error => {
      if (controller.signal.aborted || currentKey.current !== key || getAuthLifecycle() !== lifecycle) return;
      setResult({ key, state: 'error', data: null, message: adminDonorError(error).message });
    });
    return () => controller.abort();
  }, [key, filters, page, revision, lifecycle, getAuthLifecycle]);
  const apply = event => {
    event.preventDefault(); const checked = validateAdminDonorFilters(draft); setErrors(checked.errors);
    if (!checked.valid) { form.current?.elements.namedItem(Object.keys(checked.errors)[0])?.focus(); return; }
    setFilters(checked.values); setDraft(checked.values); setPage(1);
  };
  const clear = () => { setErrors({}); setDraft({ ...DEFAULT_DONOR_FILTERS }); setFilters({ ...DEFAULT_DONOR_FILTERS }); setPage(1); };
  const data = result.key === key && result.state === 'ready' ? result.data : null;
  const pages = data ? Math.max(1, Math.ceil(data.pagination.total / 20)) : 1;
  return <AuthLayout theme="mint" wide>
    <header className="mint-page-heading"><div><p className="mint-eyebrow">Admin workspace · Screen 16</p><h1>Donor management</h1><p className="mint-page-subtitle">Search Donor records and open a profile to review reported and staff-confirmed information.</p></div></header>
    <section className="mint-card" aria-labelledby="admin-donor-filter-title"><h2 id="admin-donor-filter-title">Find Donors</h2>
      <form className="mint-admin-filters mint-admin-donor-filters" ref={form} onSubmit={apply} noValidate>
        <div className="mint-field"><label htmlFor="donor-search">Search</label><input id="donor-search" name="search" type="search" value={draft.search} maxLength={120}
          onChange={event => setDraft(old => ({ ...old, search: event.target.value }))} aria-invalid={Boolean(errors.search)} aria-describedby="donor-search-note donor-search-error" />
          <span id="donor-search-note" className="mint-field-note">Name, phone, area or Donor ID; up to 120 characters.</span><span id="donor-search-error" className="mint-field-error" role={errors.search ? 'alert' : undefined}>{errors.search}</span></div>
        <div className="mint-field"><label htmlFor="donor-status">Account status</label><select id="donor-status" name="accountStatus" value={draft.accountStatus} onChange={event => setDraft(old => ({ ...old, accountStatus: event.target.value }))}>
          <option value="ANY">All statuses</option>{DONOR_STATUSES.map(status => <option key={status}>{status}</option>)}</select></div>
        <div className="mint-field"><label htmlFor="donor-group">Blood group</label><select id="donor-group" name="bloodGroupId" value={draft.bloodGroupId} onChange={event => setDraft(old => ({ ...old, bloodGroupId: event.target.value }))}>
          <option value="">All groups</option>{reportedBloodGroupChoices.map(group => <option key={group.id} value={group.id}>{group.code}</option>)}</select></div>
        <div className="mint-field"><label htmlFor="donor-group-match">Group field</label><select id="donor-group-match" name="groupMatch" value={draft.groupMatch} onChange={event => setDraft(old => ({ ...old, groupMatch: event.target.value }))}>
          <option value="EITHER">Reported or confirmed</option><option value="REPORTED">Reported only</option><option value="CONFIRMED">Confirmed only</option></select></div>
        <div className="mint-admin-filter-actions"><button className="mint-button mint-button-primary" type="submit">Search</button><button className="mint-button mint-button-secondary" type="button" onClick={clear}>Clear filters</button></div>
      </form>
    </section>
    {result.key === key && result.state === 'loading' && <Feedback title="Loading Donors" message="Retrieving Donor records…" />}
    {result.key === key && result.state === 'error' && <Feedback title="Could not load Donors" message={result.message} retry={() => setRevision(value => value + 1)} />}
    {data && <section className="mint-card mint-admin-results" aria-labelledby="donor-results-title"><div className="mint-admin-results-heading"><h2 id="donor-results-title">Donor records</h2><p role="status">{data.pagination.total} matching Donors</p></div>
      {data.donors.length ? <div className="mint-admin-table-wrap" tabIndex={0} role="region" aria-label="Donor results"><table className="mint-admin-table"><caption className="mint-sr-only">Donor identity, account status and separate reported and confirmed blood groups.</caption>
        <thead><tr><th scope="col">Donor</th><th scope="col">Phone / area</th><th scope="col">Reported group</th><th scope="col">Confirmed group</th><th scope="col">Account status</th><th scope="col">Details</th></tr></thead>
        <tbody>{data.donors.map(donor => <tr key={donor.donorId}><th scope="row" data-label="Donor">{donor.fullName}<span className="mint-admin-registration">ID {donor.donorId}</span></th>
          <td data-label="Phone / area">{donor.phone}<br />{donor.area || 'Area not provided'}</td><td data-label="Reported group"><Group value={donor.reportedBloodGroup} /></td>
          <td data-label="Confirmed group"><Group value={donor.confirmedBloodGroup} /></td><td data-label="Account status"><Status value={donor.accountStatus} /></td>
          <td data-label="Details"><Link className="mint-text-link" to={`/admin/donors/${encodeURIComponent(donor.donorId)}`}>View details</Link></td></tr>)}</tbody></table></div>
        : <div className="mint-feedback-card"><h3>No Donors found</h3><p>Try different filters or clear them to see all Donor records.</p></div>}
      <nav className="mint-admin-pagination" aria-label="Donor result pages"><p>Page {page} of {pages}</p><div><button type="button" className="mint-button mint-button-secondary" disabled={page <= 1} onClick={() => setPage(value => value - 1)}>Previous</button>
        <button type="button" className="mint-button mint-button-secondary" disabled={page >= pages} onClick={() => setPage(value => value + 1)}>Next</button></div></nav>
      <p className="mint-field-note">Results use a stable name and Donor ID order, with 20 records per page. Reported and staff-confirmed groups are distinct.</p>
    </section>}
  </AuthLayout>;
}

function DonorDetail({ donorId, lifecycle, getAuthLifecycle }) {
  const [detail, setDetail] = useState({ state: 'loading', donor: null, message: '' });
  const [draft, setDraft] = useState(null);
  const [editing, setEditing] = useState(false);
  const [confirmation, setConfirmation] = useState(null);
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  const alive = useRef(true); const operation = useRef(null); const selected = useRef(null); const scope = useRef('');
  const heading = useRef(null); const confirmHeading = useRef(null); const form = useRef(null); const trigger = useRef(null);
  const currentScope = JSON.stringify([donorId, revision, lifecycle]); scope.current = currentScope;
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    const controller = new AbortController(); const token = currentScope;
    setDetail({ state: 'loading', donor: null, message: '' });
    void (async () => {
      try {
        await pendingDonorMutations.get(donorId)?.settled;
        if (controller.signal.aborted) return;
        const donor = await getAdminDonor(donorId, { signal: controller.signal });
        if (controller.signal.aborted || !alive.current || getAuthLifecycle() !== lifecycle || scope.current !== token) return;
        setDetail({ state: 'ready', donor, message: '' }); setDraft(draftFrom(donor)); setEditing(false);
      } catch (error) {
        if (controller.signal.aborted || !alive.current || getAuthLifecycle() !== lifecycle || scope.current !== token) return;
        const issue = adminDonorError(error); setDetail({ state: issue.kind === 'missing' ? 'missing' : 'error', donor: null, message: issue.message });
      }
    })();
    return () => controller.abort();
  }, [donorId, revision, lifecycle, getAuthLifecycle, currentScope]);
  useEffect(() => { if (confirmation) confirmHeading.current?.focus(); }, [confirmation]);
  const donor = detail.donor;
  const matches = confirmation && selected.current === confirmation && donor?.donorId === donorId
    && getAuthLifecycle() === lifecycle && confirmation.snapshot === JSON.stringify(donor) ? confirmation : null;
  function clearConfirmation(restoreFocus = false) {
    selected.current = null; setConfirmation(null);
    if (restoreFocus) (trigger.current?.isConnected ? trigger.current : heading.current)?.focus();
  }
  function beginEdit() { setDraft(draftFrom(donor)); setEditing(true); setNotice(null); }
  function cancelEdit() { setEditing(false); setDraft(draftFrom(donor)); clearConfirmation(); }
  function createConfirmation(event) {
    event.preventDefault();
    if (busy || !donor) return;
    const changed = Object.fromEntries(Object.entries(draft).filter(([field, value]) => value !== (field === 'area' ? donor.area ?? '' : field === 'confirmedBloodGroupId' ? donor.confirmedBloodGroup?.bloodGroupId ?? '' : donor[field])));
    const hasGroup = Object.hasOwn(changed, 'confirmedBloodGroupId');
    const hasOther = Object.keys(changed).some(field => field !== 'confirmedBloodGroupId');
    if (!Object.keys(changed).length) { setNotice({ kind: 'error', text: 'There are no changes to save.' }); return; }
    if (hasGroup && hasOther) { setNotice({ kind: 'error', text: 'Save profile corrections and blood-group confirmation separately.' }); return; }
    if (hasGroup && !changed.confirmedBloodGroupId) { setNotice({ kind: 'error', text: 'A staff-confirmed group must be selected; clearing it is not available here.' }); return; }
    const patch = { ...changed };
    const originalValues = Object.fromEntries(Object.keys(patch).map(field => [field,
      field === 'confirmedBloodGroupId' ? donor.confirmedBloodGroup?.bloodGroupId ?? null : donor[field]]));
    const choice = Object.freeze({ donor, patch: Object.freeze(patch), originalValues: Object.freeze(originalValues),
      reasonCode: hasGroup ? 'STAFF_GROUP_CONFIRMATION' : 'STAFF_PROFILE_CORRECTION', snapshot: JSON.stringify(donor), scope: currentScope });
    selected.current = choice; setConfirmation(choice); setNotice(null);
  }
  async function refreshAfterUncertain(choice, status) {
    try {
      const fresh = await getAdminDonor(donorId);
      if (!alive.current || selected.current !== choice || getAuthLifecycle() !== lifecycle || scope.current !== choice.scope) return;
      setDetail({ state: 'ready', donor: fresh, message: '' }); setDraft(draftFrom(fresh)); setEditing(false); clearConfirmation();
      setNotice({ kind: 'warning', text: status === 'conflict'
        ? 'The Donor changed before this correction. Current details were reloaded; review them before editing again.'
        : 'The request outcome could not be confirmed. Current details were reloaded; review them before taking another action.' });
    } catch {
      if (!alive.current || selected.current !== choice || getAuthLifecycle() !== lifecycle || scope.current !== choice.scope) return;
      clearConfirmation(); setNotice({ kind: 'warning', text: 'The request outcome is uncertain and the Donor details could not be reloaded. Return to the list or try a read-only refresh; do not resubmit yet.' });
    }
  }
  async function confirmUpdate(event) {
    event.preventDefault(); const choice = selected.current;
    if (!choice || busy || matches !== choice) return;
    const token = Symbol('donor-update');
    if (!reserveDonorMutation(donorId, token)) {
      setNotice({ kind: 'warning', text: 'A Donor update is still settling. Reload the current details before another correction.' });
      return;
    }
    operation.current = token; setBusy(true);
    const csrfController = new AbortController();
    const isCurrent = () => alive.current && selected.current === choice && operation.current === token
      && getAuthLifecycle() === lifecycle && scope.current === choice.scope;
    try {
      const saved = await updateAdminDonor(choice, { signal: csrfController.signal, isCurrent });
      if (!isCurrent()) return;
      setDetail({ state: 'ready', donor: saved, message: '' }); setDraft(draftFrom(saved)); setEditing(false); clearConfirmation();
      setNotice({ kind: 'success', text: `Donor ${saved.donorId} changes were saved.` });
    } catch (error) {
      if (!isCurrent()) return;
      const outcome = bookingMutationMessage(error);
      if (outcome?.kind === 'conflict' || outcome?.kind === 'uncertain') { await refreshAfterUncertain(choice, outcome.kind); return; }
      clearConfirmation(); setNotice({ kind: 'error', text: outcome?.text || 'The correction could not be prepared. Review the form and try again.' });
    } finally {
      csrfController.abort(); finishDonorMutation(donorId, token);
      if (operation.current === token) { operation.current = null; setBusy(false); }
    }
  }
  if (detail.state === 'loading') return <AuthLayout theme="mint" wide><Feedback title="Loading Donor details" message="Retrieving the saved profile…" /></AuthLayout>;
  if (detail.state === 'missing') return <AuthLayout theme="mint" wide><Feedback title="Donor not found" message={detail.message}><Link to="/admin/donors">Return to Donor management</Link></Feedback></AuthLayout>;
  if (detail.state === 'error' || !donor) return <AuthLayout theme="mint" wide><Feedback title="Could not load Donor details" message={detail.message} retry={() => setRevision(value => value + 1)} /></AuthLayout>;
  const disabled = busy || Boolean(matches);
  const update = field => event => { setDraft(old => ({ ...old, [field]: event.target.value })); setNotice(null); if (selected.current) clearConfirmation(); };
  return <AuthLayout theme="mint" wide>
    <header className="mint-page-heading"><div><p className="mint-eyebrow">Admin workspace · Screen 17</p><h1 ref={heading} tabIndex={-1}>Donor details</h1><p className="mint-page-subtitle">Review this Donor’s profile and high-level visit context. Account status changes remain in Account management.</p></div>
      <Link className="mint-button mint-button-secondary" to="/admin/donors">Back to Donor management</Link></header>
    {notice && <p className={`mint-notice mint-notice-${notice.kind}`} role={notice.kind === 'success' ? 'status' : 'alert'}>{notice.text}</p>}
    <section className="mint-card"><div className="mint-admin-detail-heading"><div><p className="mint-eyebrow">Donor {donor.donorId}</p><h2>{donor.fullName}</h2></div><div className="mint-donor-detail-actions"><Status value={donor.accountStatus} />
      {!editing && <button className="mint-button mint-button-primary" type="button" onClick={event => { trigger.current = event.currentTarget; beginEdit(); }}>Edit profile</button>}</div></div>
      {editing ? <form ref={form} className="mint-admin-donor-edit" onSubmit={createConfirmation}>
        <div className="mint-form-grid"><Field label="Full name" id="staff-donor-full-name"><input id="staff-donor-full-name" name="fullName" value={draft.fullName} maxLength={120} disabled={disabled} onChange={update('fullName')} /></Field>
          <Field label="Date of birth" id="staff-donor-dob"><input id="staff-donor-dob" name="dateOfBirth" type="date" value={draft.dateOfBirth} disabled={disabled} onChange={update('dateOfBirth')} /></Field>
          <Field label="Phone" id="staff-donor-phone"><input id="staff-donor-phone" name="phone" value={draft.phone} maxLength={30} disabled={disabled} onChange={update('phone')} /></Field>
          <Field label="Area (optional)" id="staff-donor-area"><input id="staff-donor-area" name="area" value={draft.area} maxLength={100} disabled={disabled} onChange={update('area')} /></Field>
          <Field label="Address" id="staff-donor-address" full><textarea id="staff-donor-address" name="address" value={draft.address} maxLength={255} disabled={disabled} onChange={update('address')} /></Field>
          <Field label="Staff-confirmed blood group" id="staff-donor-confirmed-group" full><select id="staff-donor-confirmed-group" name="confirmedBloodGroupId" value={draft.confirmedBloodGroupId} disabled={disabled} onChange={update('confirmedBloodGroupId')}>
            <option value="" disabled>No confirmed group</option>{reportedBloodGroupChoices.map(group => <option key={group.id} value={group.id}>{group.code} — {group.displayName}</option>)}</select>
            <span className="mint-field-note">This staff-controlled value remains distinct from the Donor’s self-reported group. Existing BloodUnit history is preserved and may block a conflicting change.</span></Field></div>
        <div className="mint-form-actions"><button className="mint-button mint-button-primary" type="submit" disabled={disabled}>{busy ? 'Saving…' : 'Review changes'}</button><button className="mint-button mint-button-secondary" type="button" disabled={busy || Boolean(matches)} onClick={cancelEdit}>Cancel</button></div>
      </form> : <dl className="mint-admin-details-grid">
        <Detail label="Email">{donor.email}</Detail><Detail label="Date of birth">{donor.dateOfBirth}</Detail><Detail label="Phone">{donor.phone}</Detail>
        <Detail label="Area">{donor.area || 'Not provided'}</Detail><Detail label="Address">{donor.address}</Detail>
        <Detail label="Reported blood group"><Group value={donor.reportedBloodGroup} /><small>Self-reported; not staff-confirmed.</small></Detail>
        <Detail label="Staff-confirmed blood group"><Group value={donor.confirmedBloodGroup} /></Detail><Detail label="Account status"><Status value={donor.accountStatus} /> <span>Manage status in <Link to="/admin/accounts">Account management</Link>.</span></Detail>
      </dl>}
    </section>
    <section className="mint-card mint-admin-results" aria-labelledby="donor-context-title"><h2 id="donor-context-title">Visit context</h2><dl className="mint-admin-details-grid">
      <Detail label="Bookings recorded">{donor.context.bookingCount}</Detail><Detail label="Donations recorded">{donor.context.donationCount}</Detail>
      <Detail label="Latest booking">{donor.context.latestBooking ? `${donor.context.latestBooking.bookingStatus} · ${timestamp(donor.context.latestBooking.appointmentAt)} IST` : 'None recorded'}</Detail>
      <Detail label="Latest donation">{donor.context.latestDonation ? `${donor.context.latestDonation.outcome} · release ${donor.context.latestDonation.releaseStatus} · ${timestamp(donor.context.latestDonation.collectedAt)} IST` : 'None recorded'}</Detail>
    </dl><p className="mint-field-note">This summary omits eligibility answers, medical details, collection references and staff notes.</p></section>
    {matches && <section className="mint-card mint-donor-confirmation" role="region" aria-labelledby="donor-confirm-title" onKeyDown={event => { if (event.key === 'Escape' && !busy) { event.preventDefault(); clearConfirmation(true); } }}>
      <h2 id="donor-confirm-title" ref={confirmHeading} tabIndex={-1}>Confirm Donor correction</h2><p><strong>{matches.donor.fullName}</strong> · Donor {matches.donor.donorId} · {matches.donor.accountStatus}</p>
      <p>Review the exact changes below. The saved profile and audit entry are written together.</p><ul>{Object.entries(matches.patch).map(([field, value]) => {
        const group = field === 'confirmedBloodGroupId' ? reportedBloodGroupChoices.find(item => item.id === value) : null;
        const label = { fullName: 'Full name', dateOfBirth: 'Date of birth', phone: 'Phone', address: 'Address', area: 'Area', confirmedBloodGroupId: 'Staff-confirmed blood group' }[field] || field;
        return <li key={field}><strong>{label}:</strong> {group ? `${group.code} — ${group.displayName}` : value || 'Not provided'}</li>;
      })}</ul>
      <p><strong>Audit reason:</strong> {matches.reasonCode === 'STAFF_GROUP_CONFIRMATION' ? 'Staff blood-group confirmation' : 'Staff profile correction'} ({matches.reasonCode})</p>
      <form onSubmit={confirmUpdate} aria-busy={busy}><div className="mint-form-actions"><button className="mint-button mint-button-primary" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Confirm and save'}</button><button className="mint-button mint-button-secondary" type="button" disabled={busy} onClick={() => clearConfirmation(true)}>Cancel</button></div>
        {busy && <p role="status">Saving this correction. Do not submit it again.</p>}</form>
    </section>}
  </AuthLayout>;
}
function Field({ label, id, full, children }) { return <div className={`mint-field${full ? ' mint-field-full' : ''}`}><label htmlFor={id}>{label}</label>{children}</div>; }
function Detail({ label, children }) { return <div className="mint-detail"><dt>{label}</dt><dd>{children}</dd></div>; }
