import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { bloodRequests, loadRequestBloodGroups } from '../../services/bloodRequests';
import { useAuth } from '../auth/AuthProvider';
import { requestAvailability, requestId, REQUEST_PRIORITIES, setupMessage, validateDraft, requestFailure } from './model';
import { RequestAccess, RequestLayout } from './RequestShared';

export function CreateRequest({ client = bloodRequests, availability = requestAvailability, loadGroups = loadRequestBloodGroups }) {
  const navigate = useNavigate();
  const { getAuthLifecycle } = useAuth();
  const [draft, setDraft] = useState({ recipientGroupId: '', quantityRequested: '', priority: 'NORMAL', neededBy: '', note: '' });
  const [groups, setGroups] = useState({ state: 'unavailable', rows: [] });
  const [revision, setRevision] = useState(0);
  const [errors, setErrors] = useState({});
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const mutation = useRef(null);
  const form = useRef(null);
  const enabled = availability.creation === true && typeof loadGroups === 'function';
  useEffect(() => {
    if (!enabled) return undefined;
    const controller = new AbortController();
    const lifecycle = getAuthLifecycle();
    setGroups({ state: 'loading', rows: [] });
    Promise.resolve().then(() => loadGroups({ signal: controller.signal })).then((rows) => {
      if (controller.signal.aborted || getAuthLifecycle() !== lifecycle) return;
      if (!Array.isArray(rows) || rows.some((row) => typeof row.code !== 'string' || typeof row.displayName !== 'string')) throw new Error();
      rows.forEach((row) => requestId(row.bloodGroupId));
      setGroups({ state: 'ready', rows });
    }).catch((error) => { if (!controller.signal.aborted && getAuthLifecycle() === lifecycle) setGroups({ state: requestFailure(error).state, rows: [] }); });
    return () => controller.abort();
  }, [enabled, loadGroups, revision, getAuthLifecycle]);
  useEffect(() => () => mutation.current?.abort(), []);
  const change = (event) => { const { name, value } = event.target; setDraft((old) => ({ ...old, [name]: value })); setErrors((old) => ({ ...old, [name]: '' })); };
  const submit = async (event) => {
    event.preventDefault();
    if (!enabled || groups.state !== 'ready' || inFlight.current || result?.saved || result?.uncertain || result?.denied) return;
    const validation = validateDraft(draft);
    if (!groups.rows.some((row) => row.bloodGroupId === draft.recipientGroupId)) validation.errors.recipientGroupId = 'Choose an available blood group.';
    setErrors(validation.errors);
    if (Object.keys(validation.errors).length) { form.current?.elements.namedItem(Object.keys(validation.errors)[0])?.focus(); return; }
    inFlight.current = true;
    setResult(null);
    setBusy(true);
    const controller = new AbortController(); mutation.current = controller;
    const lifecycle = getAuthLifecycle();
    try {
      const saved = await client.create(validation.body, { signal: controller.signal });
      if (!controller.signal.aborted && getAuthLifecycle() === lifecycle) {
        setResult({ saved });
        navigate(`/hospital/requests/${saved.requestId}`, { replace: true });
      }
    } catch (error) {
      if (!controller.signal.aborted && getAuthLifecycle() === lifecycle) {
        const code = error?.response?.data?.error?.code;
        if (error?.response?.status === 400 && code === 'VALIDATION_ERROR') setResult({ rejected: true, message: 'The request was not saved. Check the blood group, quantity, priority and future deadline before trying again.' });
        else if (code === 'REQUEST_CONFLICT') setResult({ rejected: true, message: 'The request was not saved because the data changed. Review your details before trying again.' });
        else if (code === 'REQUEST_STORAGE_UNAVAILABLE') { setGroups({ state: 'unavailable', rows: [] }); setResult(null); }
        else if ([401, 403].includes(error?.response?.status)) setResult({ denied: true, message: 'Your account cannot submit this request. Check your sign-in and account status.' });
        else setResult({ uncertain: true });
      }
    } finally { inFlight.current = false; if (!controller.signal.aborted && getAuthLifecycle() === lifecycle) setBusy(false); }
  };
  const disabled = !enabled || groups.state !== 'ready' || busy || !!(result?.saved || result?.uncertain || result?.denied);
  const field = (name, caption, input) => <div className="sky-field"><label htmlFor={`create-${name}`}>{caption}</label>{input}{errors[name] && <span id={`error-${name}`} className="sky-error" role="alert">{errors[name]}</span>}</div>;
  const props = (name) => ({ id: `create-${name}`, name, value: draft[name], onChange: change, 'aria-invalid': !!errors[name], 'aria-describedby': errors[name] ? `error-${name}` : undefined });
  return <RequestLayout title="Create blood request" number="12" description="Tell the blood bank what your hospital needs. Every submission is linked to your verified hospital account.">
    {!enabled && <div className="sky-unavailable-note" role="status"><strong>Submission is not available yet</strong><p>{setupMessage} Nothing entered here will be saved.</p></div>}
    {enabled && ['unavailable', 'denied'].includes(groups.state) && <div className="sky-unavailable-note" role="status"><strong>Submission is unavailable</strong><p>{groups.state === 'denied' ? 'Your account cannot submit requests. Check your account status.' : setupMessage}</p></div>}
    <div className="sky-create-grid"><section className="sky-card"><div className="sky-section-title"><div><p className="sky-eyebrow">Request information</p><h2>What does your hospital need?</h2></div><span className="sky-step-label">01 / Request</span></div>
      <form ref={form} onSubmit={submit} noValidate><fieldset className="sky-create-fields" disabled={disabled}><legend className="sky-sr-only">Blood request information</legend>
        {field('recipientGroupId', 'Recipient blood group', <select {...props('recipientGroupId')} disabled={disabled || groups.state !== 'ready'} required><option value="">{groups.state === 'loading' ? 'Loading blood groups…' : groups.state === 'ready' ? 'Choose blood group' : 'Blood group lookup unavailable'}</option>{groups.rows.map((group) => <option key={group.bloodGroupId} value={group.bloodGroupId}>{group.code} · {group.displayName}</option>)}</select>)}
        {field('quantityRequested', 'Quantity requested (units)', <input {...props('quantityRequested')} type="number" min="1" max="65535" step="1" placeholder="Enter whole units" required />)}
        {field('priority', 'Priority', <select {...props('priority')} required>{REQUEST_PRIORITIES.map((p) => <option key={p}>{p}</option>)}</select>)}
        {field('neededBy', 'Needed by (India Standard Time)', <input {...props('neededBy')} type="datetime-local" step="1" required />)}
        <div className="sky-field sky-full"><label htmlFor="create-note">Operational note <span className="sky-muted">(optional)</span></label><textarea {...props('note')} rows="3" maxLength="500" placeholder="Keep this brief. Do not include patient or clinical details." />{errors.note && <span id="error-note" className="sky-error" role="alert">{errors.note}</span>}<span className="sky-muted">Up to 500 characters. Quantity cannot be changed after submission.</span></div>
      </fieldset>
      {groups.state === 'error' && <div className="sky-error" role="alert">Could not load blood groups. <button type="button" className="sky-button sky-button-secondary" onClick={() => setRevision((v) => v + 1)}>Try again</button></div>}
      {enabled && groups.state === 'ready' && !groups.rows.length && <p role="status">No requestable blood groups are available.</p>}
      <div className="sky-form-footer"><span>Hospital identity is supplied by your account.</span><button type="submit" className="sky-button" disabled={disabled || groups.state !== 'ready' || !groups.rows.length}>{busy ? 'Submitting…' : enabled ? 'Submit request' : 'Submission unavailable'}</button></div>
      </form>
      {result?.saved && <p role="status" className="sky-success">Request #{result.saved.requestId} was submitted. <Link to={`/hospital/requests/${result.saved.requestId}`}>View saved request</Link></p>}
      {result?.uncertain && <p role="alert" className="sky-error">Submission could not be confirmed. Check <Link to="/hospital/requests">My requests</Link> before submitting again.</p>}
      {(result?.rejected || result?.denied) && <p role="alert" className="sky-error">{result.message}</p>}
    </section><aside className="sky-card sky-guide"><p className="sky-eyebrow">From need to coordination</p><h2>A clear request trail</h2><ol><li><span>01</span><div><h3>Submit</h3><p>Your request begins as submitted only after a successful save.</p></div></li><li><span>02</span><div><h3>Review</h3><p>Blood bank staff review the request and its priority.</p></div></li><li><span>03</span><div><h3>Follow its status</h3><p>View recorded changes from your request details page.</p></div></li></ol><div className="sky-guide-note"><strong>Priority helps staff order their queue.</strong><p>It does not guarantee stock or an issue time.</p></div></aside></div>
  </RequestLayout>;
}
export default function CreateRequestPage() { return <RequestAccess role="HOSPITAL"><CreateRequest /></RequestAccess>; }
