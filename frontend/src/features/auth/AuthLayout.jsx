import { Link } from 'react-router-dom';
import { useState } from 'react';
import { useAuth } from './AuthProvider';

export default function AuthLayout({ children, wide = false }) {
  const { user, logout } = useAuth();
  const [logoutError, setLogoutError] = useState('');
  const [logoutBusy, setLogoutBusy] = useState(false);
  const signOut = async () => {
    setLogoutBusy(true);
    setLogoutError('');
    try { await logout(); }
    catch (error) { setLogoutError(error?.response?.data?.error?.message || 'Could not sign out. Try again.'); }
    finally { setLogoutBusy(false); }
  };
  return (
    <div className="rose-app-shell">
      <header className="rose-header">
        <div className="rose-header-inner">
          <Link className="rose-brand" to="/" aria-label="Blood Donation Coordination System home">
            <span className="rose-brand-mark" aria-hidden="true">+</span>
            <span>Blood Donation<br />Coordination System</span>
          </Link>
          <nav className="rose-nav" aria-label="Account navigation">
            {user ? <>
              {user.role === 'DONOR'
                ? <Link to="/donor/profile">My profile</Link>
                : <Link to="/account/status">Account status</Link>}
              <button className="rose-link-button" type="button" onClick={() => void signOut()} disabled={logoutBusy}>{logoutBusy ? 'Signing out…' : 'Sign out'}</button>
            </> : <Link to="/login">Sign in</Link>}
          </nav>
        </div>
      </header>
      <main className={`rose-main${wide ? ' rose-main-wide' : ''}`}>{logoutError && <p className="notice notice-error" role="alert">{logoutError}</p>}{children}</main>
      <footer className="rose-footer"><div className="rose-footer-inner">Academic DBMS Laboratory Project <span>Private account access</span></div></footer>
    </div>
  );
}
