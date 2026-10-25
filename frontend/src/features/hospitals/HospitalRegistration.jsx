import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import AuthLayout from '../auth/AuthLayout';
import { registerHospital } from '../../services/hospitals';
import { emptyHospitalRegistration, hospitalRegistrationError, validateHospitalRegistration } from './registration';

export default function HospitalRegistration() {
  const [values, setValues] = useState(emptyHospitalRegistration);
  const [fieldErrors, setFieldErrors] = useState({});
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);
  const [registered, setRegistered] = useState(null);
  const [errorVersion, setErrorVersion] = useState(0);
  const submitting = useRef(false);
  const mounted = useRef(true);
  const formRef = useRef(null);
  const errorRef = useRef(null);
  const successRef = useRef(null);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  useEffect(() => {
    if (errorVersion > 0) (formRef.current?.querySelector('[aria-invalid="true"]') ?? errorRef.current)?.focus();
  }, [errorVersion]);
  useEffect(() => { if (registered) successRef.current?.focus(); }, [registered]);

  const update = (field) => (event) => {
    setValues((current) => ({ ...current, [field]: event.target.value }));
    setFieldErrors((current) => ({ ...current, [field]: undefined }));
    setFormError('');
  };
  const submit = async (event) => {
    event.preventDefault();
    if (submitting.current) return;
    const checked = validateHospitalRegistration(values);
    setFieldErrors(checked.errors);
    setFormError('');
    if (!checked.valid) {
      setFormError('Check the highlighted fields before registering.');
      setErrorVersion((current) => current + 1);
      return;
    }
    submitting.current = true;
    setBusy(true);
    try {
      const result = await registerHospital(checked.values);
      if (result?.success !== true || result.accountStatus !== 'PENDING' || !result.profile?.organizationName) {
        throw new Error('Unexpected registration response.');
      }
      if (!mounted.current) return;
      setValues(emptyHospitalRegistration());
      setRegistered(result);
    } catch (error) {
      if (!mounted.current) return;
      const detail = hospitalRegistrationError(error);
      setFieldErrors(detail.fields);
      setFormError(detail.message);
      setErrorVersion((current) => current + 1);
    } finally {
      submitting.current = false;
      if (mounted.current) setBusy(false);
    }
  };

  const field = (name, label, { optional = false, type = 'text', autoComplete, hint, textarea = false, full = false } = {}) => {
    const id = `hospital-registration-${name}`;
    const hintId = hint ? `${id}-hint` : undefined;
    const errorId = fieldErrors[name] ? `${id}-error` : undefined;
    const props = { id, name, value: values[name], onChange: update(name), autoComplete,
      required: !optional, 'aria-invalid': Boolean(fieldErrors[name]),
      'aria-describedby': [hintId, errorId].filter(Boolean).join(' ') || undefined };
    return <div className={`mint-field${full ? ' mint-field-full' : ''}`}>
      <label htmlFor={id}>{label} <span className={optional ? 'mint-optional' : 'mint-required'}>{optional ? 'Optional' : 'Required'}</span></label>
      {textarea ? <textarea {...props} rows={3} /> : <input {...props} type={type} />}
      {hint && <p className="mint-field-hint" id={hintId}>{hint}</p>}
      {fieldErrors[name] && <p className="mint-field-error" id={errorId}>{fieldErrors[name]}</p>}
    </div>;
  };

  if (registered) return <AuthLayout theme="mint" wide>
    <section className="mint-card mint-registration-success" aria-labelledby="hospital-registration-success-title">
      <span className="mint-success-mark" aria-hidden="true">✓</span>
      <p className="mint-eyebrow">Registration received</p>
      <h1 id="hospital-registration-success-title" ref={successRef} tabIndex={-1}>Your Hospital account is ready to sign in</h1>
      <p><strong>{registered.profile.organizationName}</strong> has been registered.</p>
      <div className="mint-notice mint-notice-success" role="status" aria-live="polite">
        <span className="mint-status-pill mint-status-pending">Pending approval</span>
        <p>Your account is awaiting review. You can sign in to view your Hospital Profile and update contact information. Operational features remain unavailable while your account is pending.</p>
      </div>
      <p>You have not been signed in automatically.</p>
      <Link className="mint-primary-button" to="/login">Continue to sign in</Link>
    </section>
  </AuthLayout>;

  return <AuthLayout theme="mint" wide>
    <header className="mint-registration-header">
      <p className="mint-eyebrow">Hospital access</p>
      <h1>Register your hospital</h1>
      <p>Create your account to keep your organization and contact information together.</p>
    </header>
    <section className="mint-card mint-registration-card" aria-labelledby="hospital-registration-form-title">
      <div className="mint-section-heading"><h2 id="hospital-registration-form-title">Hospital registration</h2><p>Fields marked Required must be completed.</p></div>
      {formError && <div className="mint-notice mint-notice-error" role="alert" ref={errorRef} tabIndex={-1}>{formError}</div>}
      <form className="mint-form" onSubmit={submit} noValidate ref={formRef} aria-busy={busy}>
        <fieldset className="mint-form-section" disabled={busy}>
          <legend>Organization details</legend>
          <div className="mint-form-grid">
            {field('organizationName', 'Organization name', { autoComplete: 'organization', hint: 'Up to 180 characters.' })}
            {field('registrationNumber', 'Registration number', { optional: true, autoComplete: 'off', hint: 'Leave blank if your organization does not have one. Up to 80 characters.' })}
          </div>
        </fieldset>
        <fieldset className="mint-form-section" disabled={busy}>
          <legend>Contact information</legend>
          <div className="mint-form-grid">
            {field('contactName', 'Contact name', { autoComplete: 'name', hint: 'Up to 120 characters.' })}
            {field('phone', 'Phone', { type: 'tel', autoComplete: 'tel', hint: 'Local and international formats are accepted. Up to 30 characters.' })}
            {field('address', 'Hospital address', { autoComplete: 'street-address', hint: 'Up to 255 characters.', textarea: true, full: true })}
          </div>
        </fieldset>
        <fieldset className="mint-form-section" disabled={busy}>
          <legend>Login details</legend>
          <div className="mint-form-grid">
            {field('email', 'Email address', { type: 'email', autoComplete: 'email' })}
            {field('password', 'Password', { type: 'password', autoComplete: 'new-password', hint: 'At least 8 characters, including a number and punctuation or symbol. Maximum 72 UTF-8 bytes. Spaces are preserved.' })}
          </div>
        </fieldset>
        <div className="mint-form-actions">
          <p className="mint-field-hint">New Hospital accounts start pending review.</p>
          <button className="mint-primary-button" type="submit" disabled={busy}>{busy ? 'Registering…' : 'Register hospital'}</button>
        </div>
      </form>
      <p className="mint-field-hint">Already have an account? <Link className="mint-text-link" to="/login">Sign in</Link></p>
    </section>
  </AuthLayout>;
}
