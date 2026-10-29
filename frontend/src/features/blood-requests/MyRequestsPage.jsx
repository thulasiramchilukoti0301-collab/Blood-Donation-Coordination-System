import RequestList from './RequestList';
import { RequestAccess } from './RequestShared';

export default function MyRequestsPage() { return <RequestAccess role="HOSPITAL"><RequestList /></RequestAccess>; }
