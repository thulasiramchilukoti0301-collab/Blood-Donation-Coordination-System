import { useCallback, useEffect, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import AuthLayout from '../auth/AuthLayout';
import { useAuth } from '../auth/AuthProvider';
import { reportsApi } from '../../services/reports';
import { auditApi } from '../../services/audit';
import './dashboards.css';

function Access({ role, children }) {
  const { user, loading, restoreError, restore } = useAuth();
  if (loading) return <AuthLayout theme="dashboard"><p className="dash-feedback" role="status">Checking your session…</p></AuthLayout>;
  if (restoreError) return <AuthLayout theme="dashboard"><section className="dash-feedback" role="alert"><h1>Could not check your session</h1><button onClick={() => void restore()}>Try again</button></section></AuthLayout>;
  if (!user) return <Navigate to="/login" replace />;
  if (user.role !== role || (role === 'ADMIN' && user.accountStatus !== 'ACTIVE')) return <Navigate to="/unauthorized" replace />;
  return children;
}
const count = (value) => Number(value ?? 0).toLocaleString('en-IN');
function useLoad(loader, deps = []) {
  const [result, setResult] = useState({ state: 'loading', data: null, error: '' });
  const [retry, setRetry] = useState(0);
  const refresh = useCallback(() => setRetry((n) => n + 1), []);
  useEffect(() => { const controller = new AbortController(); setResult({ state: 'loading', data: null, error: '' });
    loader({ signal: controller.signal }).then((data) => !controller.signal.aborted && setResult({ state: 'ready', data, error: '' }))
      .catch(() => !controller.signal.aborted && setResult({ state: 'error', data: null, error: 'We could not load this data. Check the connection and try again.' }));
    return () => controller.abort();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, retry]);
  return { ...result, refresh };
}
function Status({ result, onRetry }) {
  if (result.state === 'loading') return <p className="dash-feedback" role="status">Loading report data…</p>;
  if (result.state === 'error') return <div className="dash-feedback" role="alert"><p>{result.error}</p><button onClick={onRetry}>Try again</button></div>;
  return null;
}
function Cards({ items }) { return <div className="dash-cards">{items.map(([label, value, detail]) => <article className="dash-card" key={label}><p>{label}</p><strong>{count(value)}</strong><span>{detail}</span></article>)}</div>; }
function Bars({ title, rows, labelKey, valueKey = 'total' }) {
  const maximum = Math.max(1, ...rows.map((row) => Number(row[valueKey] || 0)));
  return <section className="dash-panel"><h2>{title}</h2>{rows.length ? <div className="dash-bars" role="img" aria-label={title}>{rows.map((row, i) => <div className="dash-bar-row" key={`${row[labelKey]}-${i}`}><span>{row[labelKey]}</span><div><i style={{ width: `${Math.max(2, Number(row[valueKey] || 0) / maximum * 100)}%` }} /></div><b>{count(row[valueKey])}</b></div>)}</div> : <p className="dash-empty">No records in this period.</p>}</section>;
}
function Table({ headers, rows, render }) { return rows.length ? <div className="dash-table-wrap"><table className="dash-table"><thead><tr>{headers.map((h) => <th key={h}>{h}</th>)}</tr></thead><tbody>{rows.map((row, i) => <tr key={row.requestId ?? `${i}-${row.status ?? row.period ?? row.bloodGroup ?? row.hospital ?? ''}`}>{render(row)}</tr>)}</tbody></table></div> : <p className="dash-empty">No records to show yet.</p>; }
function AdminDashboardBody() {
  const data = useLoad(reportsApi.adminDashboard);
  const activity = useLoad((options) => auditApi.list({ page: 1, pageSize: 25 }, options));
  const result = data.data;
  const inv = result?.inventory ?? [];
  const grouped = Object.values(inv.reduce((acc, row) => { const item = acc[row.bloodGroup] ?? { bloodGroup: row.bloodGroup, total: 0 }; item.total += Number(row.total); acc[row.bloodGroup] = item; return acc; }, {}));
  const donationTotal = (result?.donations ?? []).reduce((n, row) => n + Number(row.total), 0);
  const requestTotal = (result?.requests ?? []).reduce((n, row) => n + Number(row.total), 0);
  return <AuthLayout theme="dashboard" wide><div className="dash-shell"><p className="dash-crumb">Admin workspace / Overview</p><header className="dash-heading"><div><p className="dash-kicker">Operational overview</p><h1>Admin dashboard</h1><p>Live counts from registered profiles, recorded donations, inventory and submitted requests.</p></div><Link className="dash-primary" to="/admin/reports">Open reports</Link></header>
    <Status result={data} onRetry={data.refresh} />{result && <><Cards items={[["Registered donors", result.counts.donors, 'Donor profiles'], ['Hospitals', result.counts.hospitals, 'Hospital profiles'], ['Pending approvals', result.counts.pendingAccounts, `${count(result.counts.pendingHospitals)} Hospitals`], ['Recorded donations', donationTotal, 'All stored outcomes'], ['Stored blood units', inv.reduce((n, row) => n + Number(row.total), 0), 'All stored statuses'], ['Hospital requests', requestTotal, 'All stored statuses']]} />
      <div className="dash-grid"><Bars title="Inventory by blood group" rows={grouped} labelKey="bloodGroup" /><Bars title="Requests by status" rows={result.requests} labelKey="status" /><section className="dash-panel"><h2>Inventory by stored status</h2><Table headers={['Blood group', 'Status', 'Units']} rows={inv} render={(r) => <><td>{r.bloodGroup}</td><td>{r.status}</td><td>{count(r.total)}</td></>} /></section><section className="dash-panel"><h2>Recent operational activity</h2><p className="dash-muted">Persisted AuditEvent records only.</p><Table headers={['When', 'Action', 'Subject']} rows={activity.data?.events ?? []} render={(e) => <><td>{e.occurredAt}</td><td>{e.actionCode}</td><td>{e.subjectType} {e.subjectId ?? ''}</td></>} />{activity.state === 'error' && <><p className="dash-muted">Audit history is not available right now.</p><button type="button" className="dash-secondary" onClick={activity.refresh}>Retry activity</button></>}<Link to="/admin/audit">Review audit log →</Link></section></div></>}
    <Status result={data} onRetry={data.refresh} /><nav className="dash-links" aria-label="Admin tools"><Link to="/admin/hospitals">Hospital management</Link><Link to="/admin/accounts">Account approvals</Link><Link to="/admin/requests">Blood requests</Link><Link to="/admin/allocations">Request allocation preview</Link><Link to="/admin/audit">Audit log</Link></nav></div></AuthLayout>;
}
export function AdminDashboardPage() { return <Access role="ADMIN"><AdminDashboardBody /></Access>; }

function HospitalDashboardBody() {
  const data = useLoad(reportsApi.hospitalDashboard); const result = data.data;
  const total = (result?.requests ?? []).reduce((n, row) => n + Number(row.total), 0);
  return <AuthLayout theme="dashboard" wide><div className="dash-shell"><p className="dash-crumb">Hospital workspace / Overview</p><header className="dash-heading"><div><p className="dash-kicker">Your request activity</p><h1>{result?.profile?.organizationName || 'Hospital dashboard'}</h1><p>Request summaries are scoped to the signed-in hospital account.</p></div>{result?.profile?.accountStatus === 'ACTIVE' && <Link className="dash-primary" to="/hospital/requests/new">Create request</Link>}</header>
    <Status result={data} onRetry={data.refresh} />{result && <><div className="dash-status">Account status <strong>{result.profile?.accountStatus ?? 'PROFILE UNAVAILABLE'}</strong></div>{result.profile?.accountStatus === 'PENDING' && <p className="dash-muted" role="status">Your account is awaiting approval. Request actions become available after approval.</p>}<Cards items={[["Submitted requests", total, 'Your requests'], ['Requested units', result.requests.reduce((n, row) => n + Number(row.quantity), 0), 'Original requested quantities'], ['Open requests', result.requests.filter((row) => !['FULFILLED', 'REJECTED', 'CANCELLED'].includes(row.status)).reduce((n, row) => n + Number(row.total), 0), 'Based on current request status']]} /><div className="dash-grid"><Bars title="Your requests by status" rows={result.requests} labelKey="status" /><section className="dash-panel"><h2>Recent requests</h2><Table headers={['Request', 'Blood group', 'Quantity', 'Priority', 'Status', 'Created']} rows={result.recent} render={(r) => <><td>{result.profile?.accountStatus === 'ACTIVE' ? <Link to={`/hospital/requests/${r.requestId}`}>#{r.requestId}</Link> : `#${r.requestId}`}</td><td>{r.bloodGroup}</td><td>{count(r.quantity)} units</td><td>{r.priority}</td><td>{r.status}</td><td>{r.createdAt}</td></>} />{result.profile?.accountStatus === 'ACTIVE' && <Link to="/hospital/requests">View all requests →</Link>}</section></div></>}
    <Status result={data} onRetry={data.refresh} /><nav className="dash-links"><Link to="/hospital/profile">Hospital profile</Link>{result?.profile?.accountStatus === 'ACTIVE' && <><Link to="/hospital/requests">View requests</Link><Link to="/hospital/requests/new">Create a request</Link></>}</nav></div></AuthLayout>;
}
export function HospitalDashboardPage() { return <Access role="HOSPITAL"><HospitalDashboardBody /></Access>; }

function AdminReportsBody() {
  const [draft, setDraft] = useState({ from: '', to: '', interval: 'DAY' });
  const [filters, setFilters] = useState(draft);
  const inventory = useLoad(reportsApi.inventory);
  const donations = useLoad((options) => reportsApi.donations(filters, options), [JSON.stringify(filters)]);
  const requests = useLoad((options) => reportsApi.requests(filters, options), [JSON.stringify(filters)]);
  const [validation, setValidation] = useState('');
  const submit = (event) => { event.preventDefault(); if (draft.from && draft.to && draft.from > draft.to) { setValidation('The start date must be on or before the end date.'); return; } setValidation(''); setFilters(draft); };
  const donationRows = donations.data?.donations ?? [];
  const donationTrend = Object.values(donationRows.reduce((acc, row) => { const item = acc[row.period] ?? { period: row.period, total: 0 }; item.total += Number(row.total); acc[row.period] = item; return acc; }, {}));
  return <AuthLayout theme="dashboard" wide><div className="dash-shell"><p className="dash-crumb">Admin workspace / Reports</p><header className="dash-heading"><div><p className="dash-kicker">Read-only analytics</p><h1>Reports &amp; analytics</h1><p>Aggregates are derived from recorded database rows. Date filters apply to donation and request reports.</p></div></header>
    <form className="dash-filter" onSubmit={submit}><label>From<input type="date" value={draft.from} onChange={(e) => setDraft({ ...draft, from: e.target.value })} /></label><label>To<input type="date" value={draft.to} onChange={(e) => setDraft({ ...draft, to: e.target.value })} /></label><label>Trend interval<select value={draft.interval} onChange={(e) => setDraft({ ...draft, interval: e.target.value })}><option value="DAY">Day</option><option value="WEEK">Week</option><option value="MONTH">Month</option></select></label><button className="dash-primary">Apply filters</button><button type="button" className="dash-secondary" onClick={() => { setDraft({ from: '', to: '', interval: 'DAY' }); setFilters({ from: '', to: '', interval: 'DAY' }); setValidation(''); }}>Clear</button></form>{validation && <p className="dash-validation" role="alert">{validation}</p>}
    <div className="dash-grid"><section className="dash-panel"><h2>Blood inventory by group and stored status</h2><Status result={inventory} onRetry={inventory.refresh} />{inventory.data && <Table headers={['Blood group', 'Stored unit status', 'Units']} rows={inventory.data.inventory} render={(r) => <><td>{r.bloodGroup}</td><td>{r.status}</td><td>{count(r.total)}</td></>} />}<p className="dash-muted">Status counts reflect stored BloodUnit rows. Allocation and issue lifecycle reporting is not enabled.</p></section>
      <section className="dash-panel"><h2>Donation outcomes over time</h2><Status result={donations} onRetry={donations.refresh} />{donations.data && <><Bars title="Donation count by period" rows={donationTrend} labelKey="period" /><Table headers={['Period', 'Outcome', 'Donations']} rows={donationRows} render={(r) => <><td>{r.period}</td><td>{r.outcome}</td><td>{count(r.total)}</td></>} /></>}</section>
      <section className="dash-panel"><h2>Requests by status</h2><Status result={requests} onRetry={requests.refresh} />{requests.data && <Table headers={['Status', 'Requests', 'Requested units']} rows={requests.data.statuses} render={(r) => <><td>{r.status}</td><td>{count(r.total)}</td><td>{count(r.quantity)}</td></>} />}</section>
      <section className="dash-panel"><h2>Hospital request activity</h2>{requests.data && <Table headers={['Hospital', 'Status', 'Requests', 'Requested units']} rows={requests.data.hospitals} render={(r) => <><td>#{r.hospitalAccountId} · {r.hospital}</td><td>{r.status}</td><td>{count(r.total)}</td><td>{count(r.quantity)}</td></>} />}</section>
      {requests.data && <Bars title="Request activity by day" rows={requests.data.trend} labelKey="period" />}</div><p className="dash-muted">Reports do not include patient details, donor identity, allocations or issued-unit fulfillment.</p></div></AuthLayout>;
}
export function AdminReportsPage() { return <Access role="ADMIN"><AdminReportsBody /></Access>; }
