import { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { api } from '../../services/api';
import AuthLayout from '../auth/AuthLayout';
import { useAuth } from '../auth/AuthProvider';

function StatusNotice({ status }) {
  if (status === 'PENDING') return <div className="notice notice-pending"><strong>Pending staff review</strong><span>You can view your account and profile. Donation booking and other operational actions are not available yet.</span></div>;
  return <div className="notice notice-success"><strong>Active account</strong><span>Your account is active. This milestone provides profile viewing only.</span></div>;
}

function Detail({ label, children }) {
  return <div className="profile-detail"><dt>{label}</dt><dd>{children || 'Not provided'}</dd></div>;
}

export default function DonorProfilePage() {
  const { user, loading, restoreError } = useAuth();
  const [profile, setProfile] = useState(null);
  const [state, setState] = useState('loading');
  const [error, setError] = useState('');

  useEffect(() => {
    setProfile(null);
    setError('');
    if (!user || user.role !== 'DONOR') return undefined;
    const controller = new AbortController();
    setState('loading');
    api.get('/donors/me', { signal: controller.signal })
      .then(({ data }) => {
        if (controller.signal.aborted) return;
        setProfile({ owner: user.accountId, data: data.profile });
        setState('ready');
      })
      .catch((failure) => {
        if (controller.signal.aborted) return;
        setError(failure?.response?.data?.error?.message || 'Your profile is temporarily unavailable.');
        setState('error');
      });
    return () => controller.abort();
  }, [user]);

  if (loading) return <AuthLayout wide><section className="rose-card" aria-busy="true"><p role="status">Restoring your account…</p></section></AuthLayout>;
  if (!user) return <Navigate to="/login" replace />;
  if (user.role !== 'DONOR') return <Navigate to="/unauthorized" replace />;
  const currentProfile = profile?.owner === user.accountId ? profile.data : null;

  return (
    <AuthLayout wide>
      <section className="auth-intro">
        <p className="rose-eyebrow">Donor account</p>
        <h1>Your profile</h1>
        <p>Review the profile information saved with your account.</p>
      </section>
      {restoreError && <p className="notice notice-error" role="alert">{restoreError}</p>}
      {state === 'loading' && <section className="rose-card" aria-busy="true"><p role="status">Loading your saved profile…</p></section>}
      {state === 'error' && <section className="rose-card"><p className="notice notice-error" role="alert">{error}</p><button className="rose-secondary-button" onClick={() => window.location.reload()}>Try again</button></section>}
      {state === 'ready' && currentProfile && <section className="rose-card profile-card">
        <StatusNotice status={currentProfile.accountStatus} />
        <dl className="profile-grid">
          <Detail label="Full name">{currentProfile.fullName}</Detail>
          <Detail label="Email">{currentProfile.email}</Detail>
          <Detail label="Date of birth">{currentProfile.dateOfBirth}</Detail>
          <Detail label="Phone">{currentProfile.phone}</Detail>
          <Detail label="Address">{currentProfile.address}</Detail>
          <Detail label="Area">{currentProfile.area}</Detail>
          <Detail label="Reported blood group">{currentProfile.reportedBloodGroup?.displayName}</Detail>
          <Detail label="Confirmed blood group">{currentProfile.confirmedBloodGroup?.displayName || 'Not confirmed'}</Detail>
        </dl>
        <p className="field-note">Profile editing is not part of this milestone. Contact staff if a saved detail needs correction.</p>
      </section>}
    </AuthLayout>
  );
}
