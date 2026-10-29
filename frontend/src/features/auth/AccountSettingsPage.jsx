import { useRef, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import AuthLayout from './AuthLayout';
import { useAuth } from './AuthProvider';

export default function AccountSettingsPage() {
  const auth = useAuth();
  const navigate = useNavigate();
  const [current, setCurrent] = useState('');
  const [replacement, setReplacement] = useState('');
  const [repeat, setRepeat] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const pending = useRef(false);
  if (auth.loading) return <AuthLayout><p role="status">Checking your account…</p></AuthLayout>;
  if (!auth.user) return <Navigate to="/login" replace />;
  const submit = async event => {
    event.preventDefault();
    if (pending.current) return;
    if (!current || !replacement || replacement !== repeat) { setNotice('Enter your current password and matching new passwords.'); return; }
    pending.current = true; setBusy(true); setNotice('');
    try {
      const result = await auth.changePassword(current, replacement);
      if (result?.success) { setCurrent(''); setReplacement(''); setRepeat(''); navigate('/login', { replace: true, state: { passwordChanged: true } }); }
    } catch (error) {
      const code = error?.response?.data?.error?.code ?? error?.code;
      setNotice(code === 'INVALID_CURRENT_PASSWORD' ? 'Current password is incorrect.'
        : code === 'VALIDATION_ERROR' ? 'Check the new password requirements.'
          : code === 'PASSWORD_OUTCOME_UNKNOWN' || code === 'TRANSACTION_OUTCOME_UNKNOWN'
            ? 'The outcome is uncertain. Check your sign-in status before trying again.'
            : 'Password change could not be confirmed. Check your sign-in status before trying again.');
    } finally { pending.current = false; setBusy(false); }
  };
  return <AuthLayout><section className="auth-intro"><p className="rose-eyebrow">Account settings</p><h1>Change password</h1>
    <p>Account status: <strong>{auth.user.accountStatus}</strong>. A successful change signs out every session, including this one.</p></section>
    <section className="rose-card"><form onSubmit={submit} aria-busy={busy}>
      <div className="field"><label htmlFor="settings-current-password">Current password</label><input id="settings-current-password" name="currentPassword" type="password" autoComplete="current-password" value={current} onChange={event => setCurrent(event.target.value)} disabled={busy} required /></div>
      <div className="field"><label htmlFor="settings-new-password">New password</label><input id="settings-new-password" name="newPassword" type="password" autoComplete="new-password" value={replacement} onChange={event => setReplacement(event.target.value)} disabled={busy} required /></div>
      <div className="field"><label htmlFor="settings-repeat-password">Confirm new password</label><input id="settings-repeat-password" name="repeatPassword" type="password" autoComplete="new-password" value={repeat} onChange={event => setRepeat(event.target.value)} disabled={busy} required /></div>
      <p>Use at least 8 characters, at most 72 UTF-8 bytes, with a number and a symbol.</p>
      {notice && <p role="alert" className="notice notice-error">{notice}</p>}
      <button type="submit" disabled={busy}>{busy ? 'Changing password…' : 'Change password'}</button>
    </form></section></AuthLayout>;
}
