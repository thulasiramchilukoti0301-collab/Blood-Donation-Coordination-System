import { Navigate } from 'react-router-dom';
import AuthLayout from './AuthLayout';
import { useAuth } from './AuthProvider';

export default function AccountStatusPage() {
  const { user, loading, restoreError } = useAuth();
  if (loading) return <AuthLayout><section className="rose-card"><p role="status">Checking your account…</p></section></AuthLayout>;
  if (!user) return <Navigate to="/login" replace />;
  if (user.role === 'DONOR') return <Navigate to="/donor/profile" replace />;
  if (user.role === 'HOSPITAL') return <Navigate to="/hospital/profile" replace />;
  const statusText = user.accountStatus === 'PENDING'
    ? 'Your account is pending staff review. Operational features are not available.'
    : 'Your account is active. Hospital management is available from the account navigation.';
  return <AuthLayout><section className="auth-intro"><p className="rose-eyebrow">Account access</p><h1>Account status</h1><p>This is a safe account-status surface. It does not open an unimplemented dashboard.</p></section>{restoreError && <p className="notice notice-error" role="alert">{restoreError}</p>}<section className="rose-card status-card"><p className="status-role">{user.role === 'HOSPITAL' ? 'Hospital account' : 'Admin account'}</p><span className={`account-status status-${user.accountStatus.toLowerCase()}`}>{user.accountStatus}</span><p>{statusText}</p></section></AuthLayout>;
}
