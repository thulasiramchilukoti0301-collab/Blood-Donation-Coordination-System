import { Link, useParams } from 'react-router-dom';
import { bloodRequests } from '../../services/bloodRequests';
import { requestAvailability, requestId } from './model';
import { Feedback, RequestAccess, RequestLayout, ResourceFeedback, useRequestResource } from './RequestShared';
import { RequestOverview } from './RequestOverview';

export function RequestDetail({ client = bloodRequests, availability = requestAvailability }) {
  const { requestId: id } = useParams();
  let valid = true;
  try { requestId(id); } catch { valid = false; }
  const resource = useRequestResource(id, availability.reads === true && valid, (signal) => client.detail(id, { signal }));
  return <RequestLayout title="Request details" number="14" description="A clear view of your hospital’s saved request and its recorded lifecycle."><Link className="sky-text-link sky-back" to="/hospital/requests">← Back to my requests</Link>{!valid ? <Feedback title="Invalid request" message="Choose a request from your hospital’s request list." /> : <><ResourceFeedback resource={resource} />{resource.state === 'ready' && <section className="sky-card"><RequestOverview request={resource.data} /></section>}</>}</RequestLayout>;
}
export default function RequestDetailPage() { return <RequestAccess role="HOSPITAL"><RequestDetail /></RequestAccess>; }
