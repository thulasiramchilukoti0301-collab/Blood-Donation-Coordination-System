import { useEffect, useRef, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import AuthLayout from '../auth/AuthLayout';
import { useAuth } from '../auth/AuthProvider';
import { canUseRequests, label, requestFailure, timestamp } from './model';
import './requests.css';

export function Feedback({ title, message, retry, busy = false }) {
  return <section className="sky-card sky-feedback" aria-busy={busy}><span className="sky-feedback-symbol" aria-hidden="true">{busy ? '…' : '↗'}</span><h2>{title}</h2><p role={busy ? 'status' : 'alert'}>{message}</p>{retry && <button type="button" className="sky-button sky-button-secondary" onClick={retry}>Try again</button>}</section>;
}
export function RequestAccess({ role, children }) {
  const { user, loading, restoreError, restore, authLifecycle } = useAuth();
  if (loading) return <AuthLayout theme="sky" wide><Feedback title="Checking your account" message="Restoring your sign-in status…" busy /></AuthLayout>;
  if (restoreError) return <AuthLayout theme="sky" wide><Feedback title="Could not check your account" message="Check your connection and try again." retry={() => void restore()} /></AuthLayout>;
  if (!user) return <Navigate to="/login" replace />;
  if (!canUseRequests(user, role)) return <Navigate to="/unauthorized" replace />;
  return <div key={`${user.accountId}:${user.role}:${user.accountStatus}:${authLifecycle}`}>{children}</div>;
}
export function RequestLayout({ admin = false, title, description, number, children }) {
  return <AuthLayout theme="sky" wide>
    <div className="sky-workspace-nav"><Link to={admin ? '/admin/requests' : '/hospital/requests'}>Blood requests</Link><span aria-hidden="true">/</span><span>{title}</span><span className="sky-screen-number">{number}</span></div>
    <header className="sky-heading"><div><p className="sky-eyebrow">{admin ? 'Blood bank workspace' : 'Hospital workspace'} <span aria-hidden="true">/</span> Request coordination</p><h1>{title}</h1><p>{description}</p></div><span className="sky-heading-mark" aria-hidden="true">↗</span></header>
    <nav className="sky-local-nav" aria-label="Blood request navigation"><Link to={admin ? '/admin/requests' : '/hospital/requests'}>{admin ? 'Request queue' : 'My requests'}</Link>{!admin && <Link to="/hospital/requests/new">Create request</Link>}<span>India Standard Time · IST</span></nav>
    {children}
  </AuthLayout>;
}
export function Badge({ value, priority = false }) { return <span className={`sky-badge sky-${value.toLowerCase()}${priority ? ' sky-priority' : ''}`}>{label(value)}</span>; }
export function RequestTime({ value }) { return <time dateTime={value}>{timestamp(value)}</time>; }
export function useRequestResource(key, available, load) {
  const { getAuthLifecycle } = useAuth();
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState({ key: null, state: 'loading', data: null });
  const loadRef = useRef(load);
  const active = useRef(key);
  active.current = key;
  loadRef.current = load;
  useEffect(() => {
    if (!available) return undefined;
    const controller = new AbortController();
    const lifecycle = getAuthLifecycle();
    setResult({ key, state: 'loading', data: null });
    const current = () => !controller.signal.aborted && active.current === key && getAuthLifecycle() === lifecycle;
    Promise.resolve().then(() => loadRef.current(controller.signal)).then((data) => {
      if (current()) setResult({ key, state: 'ready', data });
    }).catch((error) => {
      if (current()) setResult({ key, ...requestFailure(error), data: null });
    });
    return () => controller.abort();
  }, [key, available, revision, getAuthLifecycle]);
  return { ...(available ? result.key === key ? result : { state: 'loading', data: null } : { state: 'unavailable', data: null }), retry: () => setRevision((value) => value + 1) };
}
export function ResourceFeedback({ resource }) {
  if (resource.state === 'ready') return null;
  const titles = { loading: 'Loading requests', unavailable: 'Request service coming soon', missing: 'Request not found', denied: 'Access has changed', error: 'Could not load requests' };
  return <Feedback title={titles[resource.state]} busy={resource.state === 'loading'} message={resource.state === 'loading' ? 'Retrieving saved request information…' : resource.message || 'Blood requests are not available yet. No request records have been loaded.'} retry={['error', 'missing'].includes(resource.state) ? resource.retry : undefined} />;
}
