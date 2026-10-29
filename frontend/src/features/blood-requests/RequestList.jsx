import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { bloodRequests } from '../../services/bloodRequests';
import { cleanFilters, requestAvailability, REQUEST_PRIORITIES, REQUEST_STATUSES } from './model';
import { Badge, RequestLayout, RequestTime, ResourceFeedback, useRequestResource } from './RequestShared';
import { RequestOverview } from './RequestOverview';

const emptyFilters = { requestStatus: '', priority: '', recipientGroupId: '', hospitalId: '', submittedFrom: '', submittedTo: '', neededByFrom: '', neededByTo: '' };
function Filters({ admin, draft, setDraft, onSubmit, clear, error, disabled }) {
  const field = (key, caption, type = 'text') => <div className="sky-field"><label htmlFor={`request-${key}`}>{caption}</label><input id={`request-${key}`} name={key} type={type} inputMode={key.endsWith('Id') ? 'numeric' : undefined} value={draft[key]} onChange={(e) => setDraft((old) => ({ ...old, [key]: e.target.value }))} /></div>;
  return <section className="sky-card sky-filter-card"><div className="sky-section-title"><h2>Find requests</h2><span className="sky-muted">Structured filters</span></div><form onSubmit={onSubmit}>
    <fieldset disabled={disabled} className="sky-filter-fields"><legend className="sky-sr-only">Filter blood requests</legend>
      <div className="sky-field"><label htmlFor="request-status">Status</label><select id="request-status" value={draft.requestStatus} onChange={(e) => setDraft((old) => ({ ...old, requestStatus: e.target.value }))}><option value="">All statuses</option>{REQUEST_STATUSES.map((s) => <option key={s}>{s}</option>)}</select></div>
      <div className="sky-field"><label htmlFor="request-priority">Priority</label><select id="request-priority" value={draft.priority} onChange={(e) => setDraft((old) => ({ ...old, priority: e.target.value }))}><option value="">All priorities</option>{REQUEST_PRIORITIES.map((p) => <option key={p}>{p}</option>)}</select></div>
      {field('recipientGroupId', 'Blood group ID')}{admin && field('hospitalId', 'Hospital ID')}
      <details className="sky-date-filters"><summary>Submission and needed-by dates</summary><p className="sky-muted">Filter by calendar days in India Standard Time.</p><div className="sky-filter-fields">{field('submittedFrom', 'Submitted from', 'date')}{field('submittedTo', 'Submitted to', 'date')}{field('neededByFrom', 'Needed from', 'date')}{field('neededByTo', 'Needed to', 'date')}</div></details>
      <div className="sky-actions"><button type="submit" className="sky-button">Apply filters</button><button type="button" className="sky-button sky-button-secondary" onClick={clear}>Clear</button></div>
    </fieldset>{error && <p role="alert" className="sky-error">{error}</p>}
  </form><p className="sky-muted sky-filter-note">Use the blood group ID from the hospital’s saved request records.</p></section>;
}
export default function RequestList({ admin = false, client = bloodRequests, availability = requestAvailability }) {
  const [draft, setDraft] = useState(emptyFilters);
  const [query, setQuery] = useState({ page: 1 });
  const [error, setError] = useState('');
  const [selected, setSelected] = useState(null);
  const detailHeading = useRef(null);
  const opener = useRef(null);
  useEffect(() => { if (selected) detailHeading.current?.focus(); }, [selected]);
  const key = JSON.stringify([admin, query]);
  const resource = useRequestResource(key, availability.reads === true, (signal) => client.list(query, { admin, signal }));
  const detailKey = JSON.stringify([key, selected]);
  const detail = useRequestResource(detailKey, availability.reads === true && !!selected, (signal) => client.detail(selected, { admin, signal }));
  const data = resource.state === 'ready' ? resource.data : null;
  const pages = data ? Math.max(1, Math.ceil(data.pagination.total / 20)) : 1;
  const changePage = (page) => { setSelected(null); setQuery((old) => ({ ...old, page })); };
  return <RequestLayout admin={admin} title={admin ? 'Blood request management' : 'My blood requests'} number={admin ? '25' : '13'} description={admin ? 'Review hospital demand in priority order and open saved request details.' : 'Follow your hospital’s requests, from submission through their recorded status.'}>
    <div className="sky-workspace-note"><span className="sky-note-dot" aria-hidden="true" /><p>{admin ? 'Queue order: emergency → urgent → normal, then earliest needed-by and oldest submission.' : 'Your hospital’s requests only. Most recent submissions appear first.'}</p><span>20 per page</span></div>
    <Filters admin={admin} draft={draft} setDraft={setDraft} disabled={!availability.reads} error={error} onSubmit={(event) => {
      event.preventDefault();
      try { setQuery({ ...cleanFilters(draft, admin), page: 1 }); setError(''); setSelected(null); }
      catch (failure) { setError(failure.message); }
    }} clear={() => { setDraft(emptyFilters); setQuery({ page: 1 }); setSelected(null); setError(''); }} />
    <ResourceFeedback resource={resource} />
    {data && <section className="sky-card sky-results" aria-labelledby="request-results-heading"><div className="sky-section-title"><div><p className="sky-eyebrow">Saved requests</p><h2 id="request-results-heading">{admin ? 'Priority queue' : 'Request activity'}</h2></div><span role="status">{data.pagination.total} matching requests</span></div>
      {data.requests.length ? <div className="sky-table-wrap" role="region" aria-label="Blood request results" tabIndex={0}><table className="sky-table"><caption className="sky-sr-only">Saved blood requests. Open a request to review its recorded details.</caption><thead><tr><th scope="col">Request</th>{admin && <th scope="col">Hospital</th>}<th scope="col">Blood group</th><th scope="col">Quantity</th><th scope="col">Priority</th><th scope="col">Status</th><th scope="col">Needed by</th><th scope="col">Details</th></tr></thead><tbody>{data.requests.map((row) => <tr key={row.requestId}><th scope="row" data-label="Request">#{row.requestId}</th>{admin && <td data-label="Hospital">{row.hospital?.organizationName || 'Hospital information unavailable'}</td>}<td data-label="Blood group"><span className="sky-group-small">{row.recipientBloodGroupCode}</span></td><td data-label="Quantity">{row.quantityRequested} units</td><td data-label="Priority"><Badge value={row.priority} priority /></td><td data-label="Status"><Badge value={row.requestStatus} /></td><td data-label="Needed by"><RequestTime value={row.neededBy} /></td><td data-label="Details">{admin ? <button className="sky-button sky-button-secondary" aria-label={`View request ${row.requestId}`} aria-expanded={selected === row.requestId} aria-controls={selected === row.requestId ? 'request-selected-detail' : undefined} onClick={(event) => { opener.current = event.currentTarget; setSelected(row.requestId); }}>View details</button> : <Link className="sky-text-link" to={`/hospital/requests/${row.requestId}`}>View request <span aria-hidden="true">↗</span></Link>}</td></tr>)}</tbody></table></div>
        : <div className="sky-empty"><span aria-hidden="true">↗</span><h3>No requests {query.page > 1 ? 'on this page' : 'found'}</h3><p>{data.pagination.total ? 'Return to an earlier page to view matching requests.' : 'Saved requests matching your filters will appear here.'}</p>{query.page > 1 && <button className="sky-button sky-button-secondary" onClick={() => changePage(1)}>Go to first page</button>}</div>}
      <nav className="sky-pagination" aria-label="Blood request pages"><span>Page {query.page} of {pages} · 20 rows per page</span><div className="sky-actions"><button className="sky-button sky-button-secondary" disabled={query.page <= 1} onClick={() => changePage(query.page - 1)}>Previous</button><button className="sky-button sky-button-secondary" disabled={query.page >= pages} onClick={() => changePage(query.page + 1)}>Next</button></div></nav>
    </section>}
    {admin && selected && <section className="sky-card" id="request-selected-detail" aria-label="Selected request details"><div className="sky-section-title"><h2 ref={detailHeading} tabIndex={-1}>Request #{selected}</h2><button type="button" className="sky-button sky-button-secondary" onClick={() => { setSelected(null); opener.current?.focus(); }}>Close details</button></div><ResourceFeedback resource={detail} />{detail.state === 'ready' && <RequestOverview request={detail.data} />}</section>}
    <p className="sky-footnote">{admin ? 'Review, priority changes, allocation and issue actions are not available in this workspace yet.' : 'Fulfillment values appear only when supplied by the operational request service.'}</p>
  </RequestLayout>;
}
