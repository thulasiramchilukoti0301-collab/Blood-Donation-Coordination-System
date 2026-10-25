import { useEffect, useRef, useState } from 'react';
import { Navigate } from 'react-router-dom';
import AuthLayout from '../auth/AuthLayout';
import { useAuth } from '../auth/AuthProvider';
import { getHospitalProfile, updateHospitalProfile } from '../../services/hospitals';
import {
  createHospitalContactPatch, formatHospitalTimestamp, hospitalContactValues,
  hospitalProfileError, isHospitalProfile, validateHospitalContact,
} from './profile';

function ProfileFeedback({ title, message, retry, busy = false }) {
  return <section className="mint-card mint-feedback-card" aria-busy={busy}>
    <h2>{title}</h2>
    <p role={busy ? 'status' : 'alert'}>{message}</p>
    {retry && <button className="mint-button mint-button-secondary" type="button" onClick={retry}>Try again</button>}
  </section>;
}

function Detail({ label, children }) {
  return <div className="mint-detail"><dt>{label}</dt><dd>{children}</dd></div>;
}

export function HospitalOrganizationDetails({ profile }) {
  return <section className="mint-card mint-organization-card" aria-labelledby="hospital-organization-title">
    <div className="mint-card-heading"><div><p className="mint-eyebrow">Your organization</p><h2 id="hospital-organization-title">Organization details</h2></div><span className="mint-readonly-label">Read-only</span></div>
    <dl className="mint-details">
      <Detail label="Organization name">{profile.organizationName}</Detail>
      <Detail label="Registration number">{profile.registrationNumber || <span className="mint-muted">Not provided</span>}</Detail>
      <Detail label="Account status"><span className={`mint-status-pill mint-status-${profile.accountStatus.toLowerCase()}`}>{profile.accountStatus}</span></Detail>
      <Detail label="Created"><time dateTime={profile.createdAt}>{formatHospitalTimestamp(profile.createdAt)}</time></Detail>
      <Detail label="Last updated"><time dateTime={profile.updatedAt}>{formatHospitalTimestamp(profile.updatedAt)}</time></Detail>
    </dl>
    <p className="mint-field-note">Organization and registration information cannot be changed through this profile.</p>
  </section>;
}

export default function HospitalProfilePage() {
  const { user, loading, restoreError, restore } = useAuth();
  const permitted = user?.role === 'HOSPITAL' && ['PENDING', 'ACTIVE'].includes(user.accountStatus);
  const owner = permitted ? `${user.accountId}:${user.accountStatus}` : null;
  const currentOwner = useRef(owner);
  currentOwner.current = owner;
  const generation = useRef(0);
  const saveRequest = useRef(null);
  const savingRef = useRef(false);
  const formRef = useRef(null);
  const headingRef = useRef(null);
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState({ owner: null, state: 'loading', profile: null, message: '' });
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(hospitalContactValues(null));
  const [fieldErrors, setFieldErrors] = useState({});
  const [formError, setFormError] = useState('');
  const [success, setSuccess] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const version = ++generation.current;
    saveRequest.current?.abort();
    savingRef.current = false;
    setSaving(false);
    setEditing(false);
    setDraft(hospitalContactValues(null));
    setFieldErrors({});
    setFormError('');
    setSuccess('');
    setResult({ owner, state: 'loading', profile: null, message: '' });
    if (!owner || loading) return undefined;
    const controller = new AbortController();
    getHospitalProfile({ signal: controller.signal })
      .then((profile) => {
        if (controller.signal.aborted || currentOwner.current !== owner || generation.current !== version) return;
        if (!profile) {
          setResult({ owner, state: 'empty', profile: null, message: 'No Hospital profile is available for this account.' });
        } else if (!isHospitalProfile(profile, user.accountId)) {
          setResult({ owner, state: 'error', profile: null, message: 'The saved Hospital profile could not be read safely. Please try again.' });
        } else {
          setResult({ owner, state: 'ready', profile, message: '' });
        }
      })
      .catch((failure) => {
        if (controller.signal.aborted || currentOwner.current !== owner || generation.current !== version) return;
        const detail = hospitalProfileError(failure);
        setResult({ owner, state: detail.missing ? 'empty' : 'error', profile: null, message: detail.message });
      });
    return () => {
      controller.abort();
      saveRequest.current?.abort();
      generation.current += 1;
    };
  }, [owner, loading, revision, restore, user?.accountId]);

  const profile = result.owner === owner && result.state === 'ready' ? result.profile : null;
  const state = result.owner === owner ? result.state : 'loading';
  const beginEdit = () => {
    if (!profile) return;
    setDraft(hospitalContactValues(profile));
    setFieldErrors({});
    setFormError('');
    setSuccess('');
    setEditing(true);
  };
  const cancelEdit = () => {
    if (savingRef.current) return;
    setEditing(false);
    setDraft(hospitalContactValues(null));
    setFieldErrors({});
    setFormError('');
    headingRef.current?.focus();
  };
  const update = (field) => (event) => {
    setDraft((values) => ({ ...values, [field]: event.target.value }));
    setFieldErrors((errors) => ({ ...errors, [field]: '' }));
    setFormError('');
  };
  const submit = async (event) => {
    event.preventDefault();
    if (savingRef.current || !profile || !owner) return;
    const validation = validateHospitalContact(draft);
    setFieldErrors(validation.errors);
    setFormError('');
    setSuccess('');
    if (!validation.valid) {
      formRef.current?.elements.namedItem(Object.keys(validation.errors)[0])?.focus();
      return;
    }
    const patch = createHospitalContactPatch(validation.values, profile);
    if (!Object.keys(patch).length) {
      setSuccess('Your contact information is already up to date.');
      setEditing(false);
      return;
    }
    const startedOwner = owner;
    const version = generation.current;
    const controller = new AbortController();
    saveRequest.current = controller;
    savingRef.current = true;
    setSaving(true);
    try {
      const saved = await updateHospitalProfile(patch, { signal: controller.signal });
      if (controller.signal.aborted || currentOwner.current !== startedOwner || generation.current !== version) return;
      if (!isHospitalProfile(saved, user.accountId)) throw new Error('Invalid saved profile response.');
      setResult({ owner: startedOwner, state: 'ready', profile: saved, message: '' });
      setDraft(hospitalContactValues(null));
      setEditing(false);
      setSuccess('Your contact information has been saved.');
      headingRef.current?.focus();
    } catch (failure) {
      if (controller.signal.aborted || currentOwner.current !== startedOwner || generation.current !== version) return;
      const detail = hospitalProfileError(failure);
      setFieldErrors(detail.fields);
      setFormError(detail.message);
      if (detail.accessDenied || detail.missing) {
        setEditing(false);
        setDraft(hospitalContactValues(null));
        setResult({ owner: startedOwner, state: detail.missing ? 'empty' : 'error', profile: null, message: detail.message });
      } else if (Object.keys(detail.fields).length) {
        formRef.current?.elements.namedItem(Object.keys(detail.fields)[0])?.focus();
      }
    } finally {
      if (saveRequest.current === controller && currentOwner.current === startedOwner && generation.current === version) {
        savingRef.current = false;
        setSaving(false);
      }
    }
  };

  if (loading) return <AuthLayout theme="mint" wide><ProfileFeedback title="Restoring your account" message="Checking your sign-in status…" busy /></AuthLayout>;
  if (!user && restoreError) return <AuthLayout theme="mint" wide><ProfileFeedback title="Could not check your account" message={restoreError} retry={() => void restore()} /></AuthLayout>;
  if (!user) return <Navigate to="/login" replace />;
  if (!permitted) return <Navigate to="/unauthorized" replace />;

  return <AuthLayout theme="mint" wide>
    <header className="mint-page-heading">
      <div><p className="mint-eyebrow">Hospital account</p><h1>Hospital Profile</h1><p className="mint-page-subtitle">{profile ? profile.organizationName : 'Your organization and contact information'}</p></div>
      {profile && <span className={`mint-status-pill mint-status-${profile.accountStatus.toLowerCase()}`} aria-label={`Account status: ${profile.accountStatus}`}>{profile.accountStatus}</span>}
    </header>
    {restoreError && <p className="mint-notice mint-notice-warning" role="alert">{restoreError}</p>}
    {state === 'loading' && <ProfileFeedback title="Loading your profile" message="Retrieving your saved Hospital information…" busy />}
    {(state === 'error' || state === 'empty') && <ProfileFeedback title={state === 'empty' ? 'Profile unavailable' : 'Could not load your profile'} message={result.message} retry={() => setRevision((value) => value + 1)} />}
    {profile && <>
      <div className={`mint-notice ${profile.accountStatus === 'PENDING' ? 'mint-notice-warning' : 'mint-notice-success'}`} role="status">
        <strong>{profile.accountStatus === 'PENDING' ? 'Awaiting approval' : 'Active account'}</strong>
        <span>{profile.accountStatus === 'PENDING' ? 'You can review and update your contact information while your account is pending. Operational features are not available.' : 'You can review your saved profile and keep your contact information up to date.'}</span>
      </div>
      {success && <p className="mint-notice mint-notice-success" role="status">{success}</p>}
      <div className="mint-profile-grid">
        <HospitalOrganizationDetails profile={profile} />
        <section className="mint-card mint-contact-card" aria-labelledby="hospital-contact-title">
          <div className="mint-card-heading"><div><p className="mint-eyebrow">Stay connected</p><h2 id="hospital-contact-title" ref={headingRef} tabIndex={-1}>Contact information</h2></div>{!editing && <button className="mint-button mint-button-secondary" type="button" onClick={beginEdit}>Edit contact information</button>}</div>
          {editing ? <form className="mint-form" ref={formRef} onSubmit={submit} noValidate aria-busy={saving}>
            <p className="mint-field-note">All three contact fields are required. Only changed contact details will be saved.</p>
            {formError && <p className="mint-notice mint-notice-error" role="alert">{formError}</p>}
            <fieldset disabled={saving} className="mint-fieldset"><legend className="mint-sr-only">Edit contact information</legend>
              <div className="mint-field"><label htmlFor="hospital-contactName">Contact name <span className="mint-required">(required)</span></label><input id="hospital-contactName" name="contactName" autoComplete="name" required value={draft.contactName} onChange={update('contactName')} aria-invalid={Boolean(fieldErrors.contactName)} aria-describedby={fieldErrors.contactName ? 'hospital-contactName-error' : undefined} autoFocus />{fieldErrors.contactName && <span id="hospital-contactName-error" className="mint-field-error" role="alert">{fieldErrors.contactName}</span>}</div>
              <div className="mint-field"><label htmlFor="hospital-phone">Phone <span className="mint-required">(required)</span></label><input id="hospital-phone" name="phone" type="tel" autoComplete="tel" required maxLength={30} value={draft.phone} onChange={update('phone')} aria-invalid={Boolean(fieldErrors.phone)} aria-describedby={`hospital-phone-hint${fieldErrors.phone ? ' hospital-phone-error' : ''}`} /><span id="hospital-phone-hint" className="mint-field-note">Digits, spaces, +, parentheses, dots and hyphens are accepted.</span>{fieldErrors.phone && <span id="hospital-phone-error" className="mint-field-error" role="alert">{fieldErrors.phone}</span>}</div>
              <div className="mint-field"><label htmlFor="hospital-address">Address <span className="mint-required">(required)</span></label><textarea id="hospital-address" name="address" autoComplete="street-address" required rows={4} value={draft.address} onChange={update('address')} aria-invalid={Boolean(fieldErrors.address)} aria-describedby={fieldErrors.address ? 'hospital-address-error' : undefined} />{fieldErrors.address && <span id="hospital-address-error" className="mint-field-error" role="alert">{fieldErrors.address}</span>}</div>
            </fieldset>
            <div className="mint-form-actions"><button className="mint-button mint-button-primary" type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save changes'}</button><button className="mint-button mint-button-secondary" type="button" disabled={saving} onClick={cancelEdit}>Cancel</button></div>
          </form> : <dl className="mint-details">
            <Detail label="Contact name">{profile.contactName}</Detail>
            <Detail label="Phone">{profile.phone}</Detail>
            <Detail label="Address"><span className="mint-address">{profile.address}</span></Detail>
          </dl>}
        </section>
      </div>
      <p className="mint-profile-caption">Times are shown in India Standard Time.</p>
    </>}
  </AuthLayout>;
}
