import { Link, useLocation } from 'react-router-dom';
import { useState } from 'react';
import { useAuth } from './AuthProvider';
import '../hospitals/hospital.css';

export default function AuthLayout({ children, wide = false, theme = 'rose' }) {
  const { user, logout } = useAuth();
  const { pathname } = useLocation();
  const [logoutError, setLogoutError] = useState('');
  const [logoutBusy, setLogoutBusy] = useState(false);
  const mint = theme === 'mint';
  const sky = theme === 'sky';
  const indigo = theme === 'indigo';
  const audit = theme === 'audit';
  const prefix = audit ? 'audit' : indigo ? 'indigo' : sky ? 'sky' : mint ? 'mint' : 'rose';
  const signOut = async () => {
    setLogoutBusy(true);
    setLogoutError('');
    try { await logout(); }
    catch (error) { setLogoutError(error?.response?.data?.error?.message || 'Could not sign out. Try again.'); }
    finally { setLogoutBusy(false); }
  };
  return (
    <div className={`${prefix}-app-shell`}>
      {mint && <link rel="stylesheet" precedence="hospital-fonts" href="https://fonts.googleapis.com/css2?family=Nunito+Sans:wght@400;500;600;700;800&family=Sora:wght@400;500;600;700&display=swap" />}
      {sky && <link rel="stylesheet" precedence="request-fonts" href="https://fonts.googleapis.com/css2?family=Lexend:wght@400;500;600;700&family=Mulish:wght@400;500;600;700;800&display=swap" />}
      {indigo && <link rel="stylesheet" precedence="allocation-fonts" href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=Manrope:wght@400;500;600;700;800&display=swap" />}
      {audit && <link rel="stylesheet" precedence="audit-fonts" href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=Manrope:wght@400;500;600;700;800&display=swap" />}
      <header className={`${prefix}-header`}>
        <div className={`${prefix}-header-inner`}>
          <Link className={`${prefix}-brand`} to="/" aria-label="Blood Donation Coordination System home">
            <span className={`${prefix}-brand-mark`} aria-hidden="true">+</span>
            <span>Blood Donation<br />Coordination System</span>
          </Link>
          <nav className={`${prefix}-nav`} aria-label="Account navigation">
            {user ? <>
              {user.role === 'ADMIN' && user.accountStatus === 'ACTIVE'
                ? <><Link to="/admin/hospitals" aria-current={pathname === '/admin/hospitals' ? 'page' : undefined}>Hospital management</Link><Link to="/admin/accounts" aria-current={pathname === '/admin/accounts' ? 'page' : undefined}>Account management</Link><Link to="/account/status" aria-current={pathname === '/account/status' ? 'page' : undefined}>Account status</Link><Link to="/admin/allocations" aria-current={pathname.startsWith('/admin/allocations') ? 'page' : undefined}>Request allocation</Link><Link to="/admin/compatibility" aria-current={pathname === '/admin/compatibility' ? 'page' : undefined}>Compatibility</Link><Link to="/admin/audit" aria-current={pathname === '/admin/audit' ? 'page' : undefined}>Audit log</Link></>
                : user.role === 'HOSPITAL' ? <Link to="/hospital/profile" aria-current={pathname === '/hospital/profile' ? 'page' : undefined}>Hospital Profile</Link> : user.role === 'DONOR'
                ? <Link to="/donor/profile">My profile</Link>
                : <Link to="/account/status">Account status</Link>}
              {user.accountStatus === 'ACTIVE' && ['ADMIN', 'HOSPITAL'].includes(user.role) && <Link to={user.role === 'ADMIN' ? '/admin/requests' : '/hospital/requests'} aria-current={pathname.startsWith(user.role === 'ADMIN' ? '/admin/requests' : '/hospital/requests') ? 'page' : undefined}>Blood requests</Link>}
          <button className={`${prefix}-link-button`} type="button" onClick={() => void signOut()} disabled={logoutBusy}>{logoutBusy ? 'Signing out…' : 'Sign out'}</button>
            </> : <Link to="/login">Sign in</Link>}
          </nav>
        </div>
      </header>
      <main className={`${prefix}-main${wide ? ` ${prefix}-main-wide` : ''}`}>{logoutError && <p className={sky ? 'sky-error' : mint ? 'mint-notice mint-notice-error' : indigo ? 'indigo-error' : audit ? 'audit-validation' : 'notice notice-error'} role="alert">{logoutError}</p>}{children}</main>
      <footer className={`${prefix}-footer`}><div className={`${prefix}-footer-inner`}>Academic DBMS Laboratory Project <span>Private account access</span></div></footer>
    </div>
  );
}
