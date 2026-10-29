import { useEffect, useRef, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { api } from '../../services/api';
import AuthLayout from '../auth/AuthLayout';
import { useAuth } from '../auth/AuthProvider';
import './donorDashboard.css';

const resources = [
  ['profile', '/donors/me', 'profile'],
  ['eligibility', '/donors/me/eligibility', 'eligibility'],
  ['activity', '/donors/me/reports/activity', 'activity'],
];
const empty = () => ({ profile: null, eligibility: null, activity: null, errors: [], loading: true });
function valid(name, value) {
  if (!value || typeof value !== 'object') return false;
  if (name === 'profile') return typeof value.fullName === 'string' && ['ACTIVE', 'PENDING'].includes(value.accountStatus);
  if (name === 'eligibility') return ['ELIGIBLE', 'INELIGIBLE_UNTIL_DATE', 'STAFF_REVIEW_REQUIRED'].includes(value.result)
    && typeof value.evaluationDate === 'string';
  const entries = [...(value.bookingCounts ?? []), ...(value.donationCounts ?? [])];
  return Array.isArray(value.bookingCounts) && Array.isArray(value.donationCounts)
    && entries.every(row => Number.isSafeInteger(row.count) && row.count >= 0);
}

export default function DonorDashboardPage() {
  const auth = useAuth();
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState(empty);
  const request = useRef(0);
  useEffect(() => {
    if (auth.user?.role !== 'DONOR' || auth.user.accountStatus !== 'ACTIVE') return undefined;
    const controller = new AbortController();
    const number = ++request.current;
    const version = auth.getAuthLifecycle();
    setState(empty());
    void Promise.allSettled(resources.map(async ([name, path, key]) => {
      const response = await api.get(path, { signal: controller.signal });
      if (response.status !== 200 || response.data?.success !== true || !valid(name, response.data[key])) throw new Error('Invalid response');
      return [name, response.data[key]];
    })).then(results => {
      if (controller.signal.aborted || request.current !== number || auth.getAuthLifecycle() !== version) return;
      const next = empty(); next.loading = false;
      results.forEach((result, index) => {
        if (result.status === 'fulfilled') next[result.value[0]] = result.value[1];
        else next.errors.push(resources[index][0]);
      });
      setState(next);
    });
    return () => { controller.abort(); request.current += 1; };
  }, [auth.user?.accountId, auth.user?.accountStatus, auth.authLifecycle, revision]);
  if (auth.loading) return <AuthLayout><p role="status">Checking your account…</p></AuthLayout>;
  if (!auth.user) return <Navigate to="/login" replace />;
  if (auth.user.role !== 'DONOR' || auth.user.accountStatus !== 'ACTIVE') return <Navigate to="/unauthorized" replace />;
  const total = rows => Array.isArray(rows) ? rows.reduce((sum, row) => sum + row.count, 0) : null;
  const bookingTotal = total(state.activity?.bookingCounts);
  const donationTotal = total(state.activity?.donationCounts);
  return <AuthLayout wide><header className="auth-intro"><p className="rose-eyebrow">Donor workspace</p><h1>Donor dashboard</h1>
    <p>Your own profile, advisory eligibility and recorded activity.</p><button type="button" onClick={() => setRevision(value => value + 1)} disabled={state.loading}>Refresh dashboard</button></header>
    {state.loading && <p role="status" aria-busy="true">Loading your dashboard…</p>}
    {!state.loading && state.errors.length > 0 && <p role="alert" className="notice notice-error">{state.errors.length === resources.length
      ? 'The dashboard could not be loaded. Try a read-only refresh.'
      : 'Some dashboard information is unavailable. The sections below show what could be loaded.'}</p>}
    {!state.loading && <div className="donor-dashboard-grid">
      <section className="rose-card"><h2>My profile</h2>{state.profile
        ? <><p>{state.profile.fullName}</p><p>Account status: {state.profile.accountStatus}</p></>
        : <p>{state.errors.includes('profile') ? 'Profile unavailable.' : 'No profile recorded.'}</p>}<Link to="/donor/profile">View profile</Link></section>
      <section className="rose-card"><h2>Eligibility preview</h2>{state.eligibility
        ? <><p>{state.eligibility.result.replaceAll('_', ' ')}</p><p>Advisory for {state.eligibility.evaluationDate}. Booking checks the appointment date again.</p></>
        : <p>{state.errors.includes('eligibility') ? 'Eligibility preview unavailable.' : 'No eligibility preview recorded.'}</p>}<Link to="/donor/eligibility">View eligibility</Link></section>
      <section className="rose-card"><h2>My activity</h2>{state.activity
        ? <><p>{bookingTotal === 0 && donationTotal === 0 ? 'No bookings or donations recorded yet.' : `${bookingTotal} bookings and ${donationTotal} donations recorded.`}</p>
          <ul>{state.activity.bookingCounts.filter(row => row.count > 0).map(row => <li key={row.bookingStatus}>{row.bookingStatus.replaceAll('_', ' ')}: {row.count}</li>)}
            {state.activity.donationCounts.filter(row => row.count > 0).map(row => <li key={row.outcome}>{row.outcome}: {row.count}</li>)}</ul></>
        : <p>{state.errors.includes('activity') ? 'Activity summary unavailable.' : 'No activity recorded.'}</p>}
        <nav aria-label="Donor activity links"><Link to="/donor/bookings">My bookings</Link> <Link to="/donor/donations">Donation history</Link> <Link to="/donor/slots">Available slots</Link></nav></section>
    </div>}</AuthLayout>;
}
