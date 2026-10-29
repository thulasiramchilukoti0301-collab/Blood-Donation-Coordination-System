import { useEffect, useMemo, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import AuthLayout from '../auth/AuthLayout';
import { useAuth } from '../auth/AuthProvider';
import { allocationReads } from '../../services/allocationReads';
import './indigo.css';

const codes = ['O-', 'O+', 'A-', 'A+', 'B-', 'B+', 'AB-', 'AB+'];
function permitted(user) { return user?.role === 'ADMIN' && user.accountStatus === 'ACTIVE'; }
function Access({ children }) {
  const { user, loading, restoreError, restore } = useAuth();
  if (loading) return <AuthLayout theme="indigo"><p role="status" className="indigo-feedback">Checking your Admin session…</p></AuthLayout>;
  if (restoreError) return <AuthLayout theme="indigo"><section className="indigo-feedback" role="alert"><h1>Could not check your session</h1><button className="indigo-button secondary" type="button" onClick={() => void restore()}>Try again</button></section></AuthLayout>;
  if (!user) return <Navigate to="/login" replace />;
  if (!permitted(user)) return <Navigate to="/unauthorized" replace />;
  return <div key={`${user.accountId}:${user.role}:${user.accountStatus}`}>{children}</div>;
}
function readError(error) {
  if ([401, 403].includes(error?.response?.status)) return 'Your Admin access changed. Check your sign-in status.';
  if (error?.response?.data?.error?.code === 'ALLOCATION_READ_UNAVAILABLE') return 'Compatibility data is unavailable. Check that migration 009 is installed and readable.';
  return 'The compatibility service could not load the stored mapping. Try again.';
}
export function CompatibilityWorkspace() {
  const { getAuthLifecycle } = useAuth();
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState({ state: 'loading', data: null, message: '' });
  const [donor, setDonor] = useState('O-');
  const [recipient, setRecipient] = useState('O-');
  const lifecycle = getAuthLifecycle();
  useEffect(() => {
    const controller = new AbortController(); const version = lifecycle;
    setResult({ state: 'loading', data: null, message: '' });
    allocationReads.compatibility({ signal: controller.signal }).then((data) => {
      if (!controller.signal.aborted && version === getAuthLifecycle()) setResult({ state: 'ready', data, message: '' });
    }).catch((error) => { if (!controller.signal.aborted && version === getAuthLifecycle()) setResult({ state: 'error', data: null, message: readError(error) }); });
    return () => controller.abort();
  }, [revision, lifecycle, getAuthLifecycle]);
  const pairMap = useMemo(() => new Map((result.data?.pairs || []).map((pair) => [`${pair.donorGroupCode}>${pair.recipientGroupCode}`, pair.isCompatible])), [result.data]);
  const value = pairMap.get(`${donor}>${recipient}`);
  return <AuthLayout theme="indigo" wide>
    <div className="indigo-breadcrumb"><Link to="/admin/allocations">Request allocation</Link><span aria-hidden="true">/</span><span>Compatibility</span></div>
    <header className="indigo-heading"><div><p className="indigo-eyebrow">Admin · Feature 8</p><h1>Compatibility management</h1><p>Inspect the stored red-cell mapping in donor-to-recipient direction. This screen is read-only.</p></div><span className="indigo-mark" aria-hidden="true">↗</span></header>
    <nav className="indigo-tabs" aria-label="Feature 8 navigation"><Link to="/admin/allocations">Request allocation</Link><Link to="/admin/compatibility" aria-current="page">Compatibility</Link><span>Read-only workspace</span></nav>
    <div className="indigo-callout"><strong>Clinical note</strong><span>This educational red-cell compatibility model does not replace blood-bank testing or crossmatch.</span></div>
    {result.state === 'loading' && <section className="indigo-card indigo-feedback" role="status" aria-busy="true">Loading the stored compatibility matrix…</section>}
    {result.state === 'error' && <section className="indigo-card indigo-feedback" role="alert"><h2>Compatibility data unavailable</h2><p>{result.message}</p><button className="indigo-button secondary" type="button" onClick={() => setRevision((value) => value + 1)}>Retry</button></section>}
    {result.data && <>
      <section className="indigo-card" aria-labelledby="compatibility-pair-heading"><p className="indigo-eyebrow">Directed pair</p><h2 id="compatibility-pair-heading">Check a donor and recipient group</h2>
        <div className="indigo-pair-controls"><div className="indigo-field"><label htmlFor="compatibility-donor">Donor unit group</label><select id="compatibility-donor" value={donor} onChange={(event) => setDonor(event.target.value)}>{result.data.groups.map((group) => <option key={group.bloodGroupId} value={group.code}>{group.code} · {group.displayName}</option>)}</select></div>
          <span className="indigo-direction" aria-hidden="true">→</span><div className="indigo-field"><label htmlFor="compatibility-recipient">Recipient group</label><select id="compatibility-recipient" value={recipient} onChange={(event) => setRecipient(event.target.value)}>{result.data.groups.map((group) => <option key={group.bloodGroupId} value={group.code}>{group.code} · {group.displayName}</option>)}</select></div>
          <p className={`indigo-pair-result ${value ? 'compatible' : 'incompatible'}`} role="status">{value ? 'Compatible' : 'Not compatible'}</p>
        </div><p className="indigo-help">The direction is always donor unit → recipient. The saved mapping contains 64 directed pairs, of which {result.data.pairs.filter((pair) => pair.isCompatible).length} are marked compatible.</p>
      </section>
      <section className="indigo-card" aria-labelledby="compatibility-matrix-heading"><div className="indigo-section-heading"><div><p className="indigo-eyebrow">Stored reference data</p><h2 id="compatibility-matrix-heading">Red-cell compatibility matrix</h2></div><span className="indigo-meta">27 compatible mappings</span></div>
        <div className="indigo-matrix-scroll" role="region" aria-label="Donor-to-recipient compatibility matrix" tabIndex={0}><table className="indigo-matrix"><caption>Each row is the donor unit group; each column is the recipient group.</caption><thead><tr><th scope="col">Donor ↓ / Recipient →</th>{codes.map((code) => <th scope="col" key={code}>{code}</th>)}</tr></thead><tbody>{codes.map((donorCode) => <tr key={donorCode}><th scope="row">{donorCode}</th>{codes.map((recipientCode) => {
          const compatible = pairMap.get(`${donorCode}>${recipientCode}`);
          return <td key={recipientCode} className={compatible ? 'matrix-yes' : 'matrix-no'}><span>{compatible ? 'Compatible' : 'Not compatible'}</span><b aria-hidden="true">{compatible ? '✓' : '·'}</b></td>;
        })}</tr>)}</tbody></table></div>
        <p className="indigo-help">Read-only: compatibility editing is unavailable until a reviewed, audited administration endpoint exists.</p>
      </section>
    </>}
  </AuthLayout>;
}
export default function CompatibilityManagementPage() { return <Access><CompatibilityWorkspace /></Access>; }
