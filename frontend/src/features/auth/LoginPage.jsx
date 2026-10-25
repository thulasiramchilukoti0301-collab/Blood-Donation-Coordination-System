import { useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import AuthLayout from './AuthLayout';
import { useAuth } from './AuthProvider';

function apiError(error) {
  return error?.response?.data?.error;
}

function FieldError({ children }) {
  return children ? <span className="field-error" role="alert">{children}</span> : null;
}

export default function LoginPage() {
  const { user, loading, restoreError, login, registerDonor } = useAuth();
  const navigate = useNavigate();
  const [registerMode, setRegisterMode] = useState(false);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState('');
  const [success, setSuccess] = useState('');
  const [fieldErrors, setFieldErrors] = useState({});
  const [values, setValues] = useState({
    fullName: '', email: '', password: '', dateOfBirth: '', phone: '', address: '', area: '',
  });

  if (loading) return <AuthLayout><section className="rose-card" aria-busy="true"><p role="status">Checking your sign-in status…</p></section></AuthLayout>;
  if (user) return <Navigate to={user.role === 'DONOR' ? '/donor/profile' : '/account/status'} replace />;

  const update = (field) => (event) => setValues((current) => ({ ...current, [field]: event.target.value }));
  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setFormError('');
    setSuccess('');
    setFieldErrors({});
    try {
      if (registerMode) {
        const { password, ...profile } = values;
        await registerDonor({ ...profile, password });
        setValues((current) => ({ ...current, password: '' }));
        setRegisterMode(false);
        setSuccess('Your Donor account is registered and pending review. Sign in to view its status.');
      } else {
        const identity = await login({ email: values.email, password: values.password });
        setValues((current) => ({ ...current, password: '' }));
        navigate(identity.role === 'DONOR' ? '/donor/profile' : '/account/status', { replace: true });
      }
    } catch (error) {
      const detail = apiError(error);
      setFieldErrors(detail?.fields || {});
      setFormError(detail?.message || 'The service is unavailable. Try again shortly.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout>
      <section className="auth-intro">
        <p className="rose-eyebrow">Donor access</p>
        <h1>{registerMode ? 'Create your account' : 'Welcome back'}</h1>
        <p>{registerMode
          ? 'Register as a donor. Your account will remain pending until reviewed by staff.'
          : 'Sign in to view your account and donor profile.'}</p>
      </section>
      <section className="rose-card auth-card" aria-labelledby="auth-form-title">
        <h2 id="auth-form-title">{registerMode ? 'Donor registration' : 'Sign in'}</h2>
        {restoreError && <p className="notice notice-error" role="alert">{restoreError}</p>}
        {success && <p className="notice notice-success" role="status">{success}</p>}
        {formError && <p className="notice notice-error" role="alert">{formError}</p>}
        <form onSubmit={submit} noValidate>
          {registerMode && <>
            <label htmlFor="fullName">Full name</label>
            <input id="fullName" name="fullName" autoComplete="name" maxLength={120} required value={values.fullName} onChange={update('fullName')} />
            <FieldError>{fieldErrors.fullName}</FieldError>
          </>}
          <label htmlFor="email">Email address</label>
          <input id="email" name="email" type="email" autoComplete="email" maxLength={254} required value={values.email} onChange={update('email')} />
          <FieldError>{fieldErrors.email}</FieldError>
          {registerMode && <>
            <p className="password-hint">Use at least 8 characters with a number and punctuation or symbol. Maximum 72 UTF-8 bytes; spaces are allowed.</p>
            <label htmlFor="dateOfBirth">Date of birth</label>
            <input id="dateOfBirth" name="dateOfBirth" type="date" autoComplete="bday" required value={values.dateOfBirth} onChange={update('dateOfBirth')} />
            <FieldError>{fieldErrors.dateOfBirth}</FieldError>
            <label htmlFor="phone">Phone</label>
            <input id="phone" name="phone" autoComplete="tel" maxLength={30} required value={values.phone} onChange={update('phone')} />
            <FieldError>{fieldErrors.phone}</FieldError>
            <label htmlFor="address">Address</label>
            <textarea id="address" name="address" autoComplete="street-address" maxLength={255} required rows={3} value={values.address} onChange={update('address')} />
            <FieldError>{fieldErrors.address}</FieldError>
            <label htmlFor="area">Area <span className="optional-label">Optional</span></label>
            <input id="area" name="area" autoComplete="address-level2" maxLength={100} value={values.area} onChange={update('area')} />
            <FieldError>{fieldErrors.area}</FieldError>
            <p className="field-note">Reported blood group is optional and can be left unset during registration.</p>
          </>}
          <label htmlFor="password">Password</label>
          <input id="password" name="password" type="password" autoComplete={registerMode ? 'new-password' : 'current-password'} required value={values.password} onChange={update('password')} />
          <FieldError>{fieldErrors.password}</FieldError>
          <button className="rose-primary-button" type="submit" disabled={busy}>
            {busy ? 'Please wait…' : registerMode ? 'Register as donor' : 'Sign in'}
          </button>
        </form>
        <div className="auth-switch">
          {registerMode ? 'Already registered?' : 'New donor?'}{' '}
          <button type="button" className="text-button" onClick={() => { setRegisterMode(!registerMode); setFormError(''); setFieldErrors({}); }}>
            {registerMode ? 'Sign in' : 'Create a donor account'}
          </button>
        </div>
        <p className="auth-footnote"><Link to="/">Service connectivity</Link> · Password recovery is not available.</p>
      </section>
    </AuthLayout>
  );
}
