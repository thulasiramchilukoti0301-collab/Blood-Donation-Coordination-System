import RequestList from './RequestList';
import { RequestAccess } from './RequestShared';

export default function AdminRequestsPage() { return <RequestAccess role="ADMIN"><RequestList admin /></RequestAccess>; }
