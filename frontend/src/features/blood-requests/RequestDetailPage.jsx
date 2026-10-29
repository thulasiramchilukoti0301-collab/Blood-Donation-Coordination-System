import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { bloodRequests } from '../../services/bloodRequests';
import { requestAvailability, requestId } from './model';
import { Feedback, RequestAccess, RequestLayout, ResourceFeedback, useRequestResource } from './RequestShared';
import { RequestOverview } from './RequestOverview';

export function RequestDetail({ client = bloodRequests, availability = requestAvailability }) {
  const { requestId: id } = useParams();
  const [revision, setRevision] = useState(0);
  const [confirming, setConfirming] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [actionError, setActionError] = useState('');
  const [actionMessage, setActionMessage] = useState('');
  let valid = true;
  try { requestId(id); } catch { valid = false; }
  const resource = useRequestResource(`${id}:${revision}`, availability.reads === true && valid,
    (signal) => client.detail(id, { signal }));
  const request = resource.state === 'ready' ? resource.data : null;
  const canCancel = request && ['SUBMITTED', 'UNDER_REVIEW', 'AWAITING_INVENTORY', 'PARTIALLY_FULFILLED'].includes(request.requestStatus);
  async function cancel() {
    setSubmitting(true); setActionError(''); setActionMessage('');
    try {
      await client.cancel(id);
      setConfirming(false);
      setActionMessage('Request cancelled. The recorded history has been refreshed.');
      setRevision((value) => value + 1);
    } catch (error) {
      setActionError(error?.response?.data?.error?.message || error.message || 'The request could not be cancelled. Reload its status before trying again.');
    } finally { setSubmitting(false); }
  }
  return <RequestLayout title="Request details" number="14" description="View your hospital's saved request and recorded lifecycle.">
    <Link className="sky-text-link sky-back" to="/hospital/requests">Back to my requests</Link>
    {!valid ? <Feedback title="Invalid request" message="Choose a request from your hospital's request list." /> : <>
      <ResourceFeedback resource={resource} />
      {request && <section className="sky-card">
        <RequestOverview request={request} />
        {canCancel && <section className="sky-actions" aria-label="Request actions">
          <button type="button" className="sky-button sky-button-secondary" disabled={submitting} onClick={() => { setConfirming(true); setActionError(''); }}>Cancel request</button>
          <p className="sky-muted">Cancellation is permitted before any unit has been reserved or issued.</p>
        </section>}
        {confirming && <section className="sky-request-note" aria-labelledby="cancel-confirm-title">
          <h3 id="cancel-confirm-title">Cancel request #{id}?</h3>
          <p>This closes the request and records the change in its history and audit log.</p>
          <div className="sky-actions">
            <button type="button" className="sky-button" disabled={submitting} onClick={cancel}>{submitting ? 'Cancelling...' : 'Confirm cancellation'}</button>
            <button type="button" className="sky-button sky-button-secondary" disabled={submitting} onClick={() => setConfirming(false)}>Keep request</button>
          </div>
        </section>}
        {actionError && <p role="alert" className="sky-error">{actionError}</p>}
        {actionMessage && <p role="status" className="sky-success">{actionMessage}</p>}
      </section>}
    </>}
  </RequestLayout>;
}
export default function RequestDetailPage() { return <RequestAccess role="HOSPITAL"><RequestDetail /></RequestAccess>; }
