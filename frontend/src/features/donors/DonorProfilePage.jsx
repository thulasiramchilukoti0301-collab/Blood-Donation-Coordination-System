import { useEffect, useRef, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { api } from '../../services/api';
import AuthLayout from '../auth/AuthLayout';
import { useAuth } from '../auth/AuthProvider';
import { reportedBloodGroupChoices } from './bloodGroups';
import { changedFields, draftErrors, draftFrom } from './profileDraft';

function StatusNotice({ status }) {
  if (status === 'PENDING') return <div className="notice notice-pending"><strong>Pending staff review</strong><span>You can edit your contact profile and reported blood group. Donation booking and other operational actions are not available yet.</span></div>;
  return <div className="notice notice-success"><strong>Active account</strong><span>Your account is active. You can review and edit your contact profile and reported blood group.</span></div>;
}

function Detail({ label, children }) {
  return <div className="profile-detail"><dt>{label}</dt><dd>{children || 'Not provided'}</dd></div>;
}

export default function DonorProfilePage() {
  const { user, loading, restoreError, updateDonorProfile } = useAuth();
  const [profile, setProfile] = useState(null);
  const [state, setState] = useState('loading');
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [fieldErrors, setFieldErrors] = useState({});
  const [success, setSuccess] = useState('');
  const saveController = useRef(null);
  const savingRef = useRef(false);
  const generation = useRef(0);
  const identity = user?.role === 'DONOR' ? String(user.accountId) : null;
  const identityRef = useRef(identity);
  if (identityRef.current !== identity) {
    identityRef.current = identity;
    generation.current += 1;
  }

  useEffect(() => {
    const owner = identity;
    const requestGeneration = generation.current;
    const controller = new AbortController();
    setProfile(null);
    setError('');
    setEditing(false);
    setDraft(null);
    setFormError('');
    setFieldErrors({});
    setSuccess('');
    setSaving(false);
    savingRef.current = false;
    saveController.current?.abort();
    if (!owner) return () => { generation.current += 1; };
    setState('loading');
    api.get('/donors/me', { signal: controller.signal })
      .then(({ data }) => {
        if (controller.signal.aborted || identityRef.current !== owner || generation.current !== requestGeneration) return;
        setProfile({ owner, data: data.profile });
        setState('ready');
      })
      .catch((failure) => {
        if (controller.signal.aborted || identityRef.current !== owner || generation.current !== requestGeneration) return;
        setError(failure?.response?.data?.error?.message || 'Your profile is temporarily unavailable.');
        setState('error');
      });
    return () => {
      controller.abort();
      saveController.current?.abort();
      generation.current += 1;
    };
  }, [identity]);

  if (loading) return <AuthLayout wide><section className="rose-card" aria-busy="true"><p role="status">Restoring your account…</p></section></AuthLayout>;
  if (!user) return <Navigate to="/login" replace />;
  if (user.role !== 'DONOR') return <Navigate to="/unauthorized" replace />;
  const currentProfile = profile?.owner === identity ? profile.data : null;
  const patch = editing && draft && currentProfile ? changedFields(draft, currentProfile) : {};

  function beginEdit() {
    setDraft(draftFrom(currentProfile));
    setFieldErrors({});
    setFormError('');
    setSuccess('');
    setEditing(true);
  }

  function cancelEdit() {
    if (savingRef.current) return;
    setDraft(null);
    setFieldErrors({});
    setFormError('');
    setEditing(false);
  }

  function change(field, value) {
    setDraft((current) => ({ ...current, [field]: value }));
    setFieldErrors((current) => ({ ...current, [field]: undefined }));
    setFormError('');
  }

  async function save(event) {
    event.preventDefault();
    if (savingRef.current || !currentProfile || !Object.keys(patch).length) return;
    const validation = draftErrors(patch);
    setFieldErrors(validation);
    if (Object.keys(validation).length) return;
    const owner = identity;
    const requestGeneration = generation.current;
    const controller = new AbortController();
    saveController.current = controller;
    savingRef.current = true;
    setSaving(true);
    setFormError('');
    try {
      const saved = await updateDonorProfile(patch, { signal: controller.signal });
      if (controller.signal.aborted || identityRef.current !== owner || generation.current !== requestGeneration) return;
      setProfile({ owner, data: saved });
      setDraft(null);
      setEditing(false);
      setSuccess('Your profile changes were saved.');
    } catch (failure) {
      if (controller.signal.aborted || identityRef.current !== owner || generation.current !== requestGeneration) return;
      setFieldErrors(failure?.response?.data?.error?.fields || {});
      setFormError(failure?.response?.data?.error?.message || 'Could not save your profile. Try again.');
    } finally {
      if (saveController.current === controller) saveController.current = null;
      if (identityRef.current === owner && generation.current === requestGeneration) {
        savingRef.current = false;
        setSaving(false);
      }
    }
  }

  return (
    <AuthLayout wide>
      <section className="auth-intro">
        <p className="rose-eyebrow">Donor account</p>
        <h1>Your profile</h1>
        <p>Review and update your saved contact details and self-reported blood group.</p>
      </section>
      {restoreError && <p className="notice notice-error" role="alert">{restoreError}</p>}
      {state === 'loading' && <section className="rose-card" aria-busy="true"><p role="status">Loading your saved profile…</p></section>}
      {state === 'error' && <section className="rose-card"><p className="notice notice-error" role="alert">{error}</p><button className="rose-secondary-button" onClick={() => window.location.reload()}>Try again</button></section>}
      {state === 'ready' && currentProfile && <section className="rose-card profile-card">
        <StatusNotice status={currentProfile.accountStatus} />
        {success && <p className="notice notice-success" role="status">{success}</p>}
        {editing ? <>
          <form className="profile-edit-form" onSubmit={save} noValidate>
            <fieldset className="profile-edit-fields" disabled={saving}>
              <legend>Edit profile details</legend>
              <label htmlFor="profile-full-name">Full name</label>
              <input id="profile-full-name" name="fullName" autoComplete="name" required value={draft.fullName} aria-invalid={Boolean(fieldErrors.fullName)} aria-describedby={fieldErrors.fullName ? 'profile-full-name-error' : undefined} onChange={(event) => change('fullName', event.target.value)} />
              {fieldErrors.fullName && <span className="field-error" id="profile-full-name-error">{fieldErrors.fullName}</span>}
              <label htmlFor="profile-phone">Phone</label>
              <input id="profile-phone" name="phone" autoComplete="tel" required value={draft.phone} aria-invalid={Boolean(fieldErrors.phone)} aria-describedby={fieldErrors.phone ? 'profile-phone-error' : undefined} onChange={(event) => change('phone', event.target.value)} />
              {fieldErrors.phone && <span className="field-error" id="profile-phone-error">{fieldErrors.phone}</span>}
              <label htmlFor="profile-address">Address</label>
              <textarea id="profile-address" name="address" autoComplete="street-address" required rows={3} value={draft.address} aria-invalid={Boolean(fieldErrors.address)} aria-describedby={fieldErrors.address ? 'profile-address-error' : undefined} onChange={(event) => change('address', event.target.value)} />
              {fieldErrors.address && <span className="field-error" id="profile-address-error">{fieldErrors.address}</span>}
              <label htmlFor="profile-area">Area <span className="optional-label">Optional</span></label>
              <input id="profile-area" name="area" autoComplete="address-level2" value={draft.area} aria-invalid={Boolean(fieldErrors.area)} aria-describedby={fieldErrors.area ? 'profile-area-error' : undefined} onChange={(event) => change('area', event.target.value)} />
              {fieldErrors.area && <span className="field-error" id="profile-area-error">{fieldErrors.area}</span>}
              <label htmlFor="profile-reported-group">Reported blood group — <span className="optional-label">Optional</span></label>
              <select id="profile-reported-group" name="reportedBloodGroupId" value={draft.reportedBloodGroupId} aria-invalid={Boolean(fieldErrors.reportedBloodGroupId)} aria-describedby={fieldErrors.reportedBloodGroupId ? 'profile-reported-group-error profile-reported-group-note' : 'profile-reported-group-note'} onChange={(event) => change('reportedBloodGroupId', event.target.value)}>
                <option value="">I don’t know / Not provided</option>
                {reportedBloodGroupChoices.map((group) => <option key={group.id} value={group.id}>{group.code} — {group.displayName}</option>)}
              </select>
              {fieldErrors.reportedBloodGroupId && <span className="field-error" id="profile-reported-group-error">{fieldErrors.reportedBloodGroupId}</span>}
              <p className="field-note" id="profile-reported-group-note">This is self-reported and awaits staff confirmation.</p>
            </fieldset>
            {formError && <p className="notice notice-error" role="alert">{formError}</p>}
            <div className="profile-edit-actions">
              <button className="rose-primary-button" type="submit" disabled={saving || !Object.keys(patch).length}>{saving ? 'Saving…' : 'Save'}</button>
              <button className="rose-secondary-button" type="button" disabled={saving} onClick={cancelEdit}>Cancel</button>
            </div>
          </form>
          <dl className="profile-grid" aria-label="Read-only account details">
            <Detail label="Email">{currentProfile.email}</Detail>
            <Detail label="Date of birth">{currentProfile.dateOfBirth}</Detail>
            <Detail label="Confirmed blood group">{currentProfile.confirmedBloodGroup?.displayName || 'Not confirmed'}</Detail>
          </dl>
        </> : <>
          <div className="profile-edit-actions"><button className="rose-secondary-button" type="button" onClick={beginEdit}>Edit profile</button></div>
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
        </>}
      </section>}
    </AuthLayout>
  );
}
