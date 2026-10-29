// Test-only network fixtures. These records are never imported by production.
import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import App from '../../src/App';
import { AuthProvider, useAuth } from '../../src/features/auth/AuthProvider';
import { api } from '../../src/services/api';
import { createBloodRequestApi } from '../../src/services/bloodRequestApi';
import { RequestAccess } from '../../src/features/blood-requests/RequestShared';
import { CreateRequest } from '../../src/features/blood-requests/CreateRequestPage';
import RequestList from '../../src/features/blood-requests/RequestList';
import { RequestDetail } from '../../src/features/blood-requests/RequestDetailPage';
import '../../src/styles/global.css';

const container = document.getElementById('request-test-app');
const report = document.getElementById('request-test-result');
let root, fixture, auth;
let checks = 0;
const results = [];
const wait = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));
function assert(condition, message) { checks++; if (!condition) throw new Error(message); }
async function until(fn, message) { for (let n = 0; n < 600; n++) { if (fn()) return; await wait(5); } throw new Error(`Timeout: ${message}. ${container.textContent.slice(-400)}`); }
const content = () => container.textContent;
const user = (role = 'HOSPITAL', accountStatus = 'ACTIVE') => ({ accountId: role === 'ADMIN' ? '31' : '12', role, accountStatus });
const rows = () => Array.from({ length: 21 }, (_, i) => ({ requestId: String(90 + i), recipientGroupId: '4', recipientBloodGroupCode: 'A+', recipientBloodGroupName: 'A Positive',
  quantityRequested: 3, priority: i === 0 ? 'EMERGENCY' : i % 2 ? 'NORMAL' : 'URGENT', requestStatus: 'SUBMITTED',
  neededBy: '2035-10-28T14:30:00+05:30', createdAt: '2026-10-27T10:00:00+05:30', updatedAt: '2026-10-27T10:00:00+05:30',
  hospital: { hospitalId: '12', organizationName: 'Isolated Hospital' }, passwordHash: 'SECRET_FIXTURE', donorId: 'SECRET_FIXTURE' }));
const groups = async () => [{ bloodGroupId: '4', code: 'A+', displayName: 'A Positive' }];
const enabled = { reads: true, creation: true };
const client = createBloodRequestApi(api, { creationEnabled: true });
function Monitor() { auth = useAuth(); return null; }
function CustomApp({ options }) {
  return <AuthProvider><Monitor /><Routes>
    <Route path="/hospital/requests/new" element={<RequestAccess role="HOSPITAL"><CreateRequest client={client} availability={enabled} loadGroups={options.groupFailure ? async () => { throw new Error(); } : groups} /></RequestAccess>} />
    <Route path="/hospital/requests" element={<RequestAccess role="HOSPITAL"><RequestList client={client} availability={enabled} /></RequestAccess>} />
    <Route path="/hospital/requests/:requestId" element={<RequestAccess role="HOSPITAL"><RequestDetail client={client} availability={enabled} /></RequestAccess>} />
    <Route path="/admin/requests" element={<RequestAccess role="ADMIN"><RequestList admin client={client} availability={enabled} /></RequestAccess>} />
    <Route path="*" element={<h1>Access boundary</h1>} />
  </Routes></AuthProvider>;
}
async function mount(path, options = {}) {
  root?.unmount(); await wait(); container.replaceChildren(); history.replaceState({}, '', path);
  const f = fixture = { user: user(), rows: rows(), calls: [], failures: 0, ...options };
  api.defaults.adapter = async (config) => {
    f.calls.push(config);
    // HTTP JSON decoding produces new objects, including a same-account login.
    const respond = (data, status = 200) => ({ config, status, statusText: String(status), headers: {}, data: structuredClone(data) });
    const fail = (status, code) => { throw Object.assign(new Error('SECRET_FIXTURE'), { config, response: { status, data: { success: false, error: { code, message: 'SECRET_FIXTURE' } } } }); };
    if (config.url === '/auth/me') return f.user ? respond({ success: true, user: f.user }) : fail(401, 'AUTHENTICATION_REQUIRED');
    if (config.url === '/auth/csrf') return respond({ success: true, csrfToken: 'a'.repeat(64) });
    if (config.url === '/auth/logout') { f.user = null; return respond({ success: true }); }
    if (config.url === '/auth/login') return respond({ success: true, user: f.user });
    if (config.url === '/blood-groups') {
      if (f.unavailable) return fail(503, 'REQUEST_STORAGE_UNAVAILABLE');
      return respond({ success: true, bloodGroups: await groups() });
    }
    if (!config.url.includes('/requests')) throw new Error(`Unexpected fixture request ${config.url}`);
    if (f.expired) return fail(401, 'ACCOUNT_UNAVAILABLE');
    if (f.unavailable) return fail(404, 'NOT_FOUND');
    if (f.failures-- > 0) return fail(503, 'DATABASE_UNAVAILABLE');
    if (config.method === 'post') {
      if (f.uncertain) throw new Error('Transport uncertainty');
      return respond({ success: true, requestId: '111', requestStatus: 'SUBMITTED', outstandingQuantity: 3 }, 201);
    }
    if (config.url.endsWith('/requests')) {
      const p = config.params || {};
      const filtered = f.rows.filter((row) => (!p.priority || p.priority === row.priority) && (!p.requestStatus || p.requestStatus === row.requestStatus));
      const data = { success: true, requests: filtered.slice((p.page - 1) * 20, p.page * 20), pagination: { page: p.page, pageSize: 20, total: filtered.length } };
      if (f.hold) { f.hold = false; await new Promise((resolve) => { f.release = resolve; }); }
      return respond(data);
    }
    const id = config.url.split('/').at(-1);
    if (f.missing) return fail(404, 'REQUEST_NOT_FOUND');
    return respond({ success: true, request: { ...f.rows[0], requestId: id, requestStatus: 'UNDER_REVIEW', note: 'Isolated operational note',
      requestStatusHistory: [{ oldStatus: null, newStatus: 'SUBMITTED', changedAt: '2026-10-27T10:00:00+05:30' }, { oldStatus: 'SUBMITTED', newStatus: 'UNDER_REVIEW', changedAt: '2026-10-27T11:00:00+05:30' }] } });
  };
  root = createRoot(container);
  root.render(<BrowserRouter>{options.custom ? <CustomApp options={options} /> : <App />}</BrowserRouter>);
  await until(() => !content().includes('Restoring your sign-in status') && (container.querySelector('.sky-heading') || location.pathname === '/login' || location.pathname === '/unauthorized'), 'route ready');
  return f;
}
function button(text) { return [...container.querySelectorAll('button')].find((el) => el.textContent.trim() === text); }
async function click(text) { const el = button(text); assert(el && !el.disabled, `Clickable ${text}`); el.click(); await wait(); }
async function fill(id, value) {
  const el = container.querySelector(`#${id}`); assert(el, `Field ${id} exists`);
  const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); await wait();
}
function layoutChecks() {
  assert(document.documentElement.scrollWidth <= innerWidth + 1, 'No horizontal document overflow');
  assert(getComputedStyle(container.querySelector('.sky-app-shell')).backgroundColor === 'rgb(243, 249, 255)', 'Exact sky background');
  for (const el of container.querySelectorAll('input,select,textarea')) assert(el.labels?.length > 0, `Label for ${el.id}`);
  assert(!content().includes('SECRET_FIXTURE'), 'No private fixture data displayed');
  assert(![...container.querySelectorAll('button')].some((el) => /cancel request|fulfill|change priority|reject request/i.test(el.textContent)), 'No unsupported mutation controls');
  const link = container.querySelector('.sky-local-nav a'); link?.focus();
  assert(!link || getComputedStyle(link).outlineStyle !== 'none', 'Keyboard focus is visible');
}
async function scenario(name, fn) { try { await fn(); results.push({ name, passed: true }); } catch (error) { results.push({ name, passed: false, error: error.message }); } }
async function scenarios() {
  for (const [path, role, title] of [['/hospital/requests/new', 'HOSPITAL', 'Create blood request'], ['/hospital/requests', 'HOSPITAL', 'My blood requests'], ['/hospital/requests/90', 'HOSPITAL', 'Request details'], ['/admin/requests', 'ADMIN', 'Blood request management']]) {
    await scenario(`production route ${title}`, async () => {
      const f = await mount(path, { user: user(role), unavailable: true });
      await until(() => /not available|coming soon|unavailable/i.test(content()), 'missing infrastructure state');
      assert(container.querySelector('h1')?.textContent === title, 'Actual App route renders expected screen');
      assert(/not available|coming soon/i.test(content()), 'Unavailable state is explicit');
      assert(!f.calls.some((call) => call.method === 'post'), 'Unavailable service never submits a request');
      if (path.endsWith('/new')) assert(button('Submit request')?.disabled, 'Creation is disabled without a real lookup');
      layoutChecks();
    });
  }
  await scenario('role and status boundaries', async () => {
    for (const [path, identity] of [['/hospital/requests', null], ['/hospital/requests/new', user('HOSPITAL', 'PENDING')], ['/hospital/requests/90', user('HOSPITAL', 'SUSPENDED')], ['/hospital/requests', user('ADMIN')], ['/admin/requests', user('DONOR')], ['/admin/requests', user('HOSPITAL')], ['/admin/requests', user('ADMIN', 'SUSPENDED')]]) {
      const f = await mount(path, { user: identity });
      assert(location.pathname === (identity ? '/unauthorized' : '/login'), 'Unauthorized route redirects');
      assert(!f.calls.some((call) => call.url.includes('/requests')), 'Unauthorized account never loads requests');
    }
  });
  await scenario('enabled production screens use real API clients and the authenticated group lookup', async () => {
    const f = await mount('/hospital/requests/new');
    await until(() => button('Submit request') && !button('Submit request').disabled, 'production lookup');
    assert(f.calls.some((call) => call.url === '/blood-groups'), 'Production form loads the authenticated lookup');
    await fill('create-recipientGroupId', '4'); await fill('create-quantityRequested', '3'); await fill('create-neededBy', '2035-10-28T14:30:00');
    await click('Submit request');
    await until(() => location.pathname === '/hospital/requests/111' && content().includes('Isolated operational note'), 'production persisted detail');
    assert(f.calls.some((call) => call.url === '/auth/csrf'), 'Production create requests CSRF');
    assert(f.calls.filter((call) => call.method === 'post').length === 1, 'Production create sends exactly once');
    await mount('/hospital/requests'); await until(() => content().includes('21 matching requests'), 'production Hospital list');
    await mount('/admin/requests', { user: user('ADMIN') }); await until(() => content().includes('21 matching requests'), 'production Admin queue');
    assert(container.querySelector('button[aria-label="View request 90"]'), 'Production Admin details available');
  });
  await scenario('list loading, fixed pagination, filters and responsive cards', async () => {
    const f = await mount('/hospital/requests', { custom: true, hold: true });
    await until(() => f.release, 'list held');
    assert(content().includes('Retrieving saved request'), 'Loading is announced'); f.release();
    await until(() => content().includes('21 matching requests'), 'list loaded');
    assert(container.querySelectorAll('tbody tr').length === 20, 'First page has 20 records');
    await click('Next'); await until(() => content().includes('Page 2 of 2'), 'page two');
    assert(container.querySelectorAll('tbody tr').length === 1, 'Second page has remaining real row');
    await fill('request-priority', 'EMERGENCY'); await click('Apply filters'); await until(() => content().includes('1 matching requests'), 'filtered');
    assert(f.calls.at(-1).params.priority === 'EMERGENCY' && f.calls.at(-1).params.page === 1, 'Filter resets page and binds priority');
    assert(container.querySelector('a[href="/hospital/requests/90"]'), 'Details navigation'); layoutChecks();
    if (innerWidth < 650) assert(getComputedStyle(container.querySelector('tbody tr')).display === 'block', 'Mobile records use cards');
  });
  await scenario('empty results and safe retry after failure', async () => {
    await mount('/hospital/requests', { custom: true, failures: 1, rows: [] });
    await until(() => content().includes('Could not load blood requests'), 'safe error');
    assert(!content().includes('SECRET_FIXTURE'), 'Driver details stay hidden');
    await click('Try again'); await until(() => content().includes('No requests found'), 'empty results'); layoutChecks();
  });
  await scenario('unavailable API and session expiry fail closed', async () => {
    await mount('/hospital/requests', { custom: true, unavailable: true });
    await until(() => content().includes('Request service coming soon'), 'API unavailable');
    await mount('/hospital/requests', { custom: true, expired: true });
    await until(() => location.pathname === '/login', 'expiry redirect');
    assert(!content().includes('SECRET_FIXTURE'), 'Expired request data hidden');
  });
  await scenario('detail uses only genuine history and no invented totals', async () => {
    await mount('/hospital/requests/90', { custom: true });
    await until(() => content().includes('Isolated operational note'), 'detail ready');
    assert(container.querySelectorAll('.sky-history li').length === 2, 'Only supplied history entries rendered');
    assert(container.querySelector('[aria-current="step"]')?.textContent === 'under review', 'Current stage follows actual status');
    assert(container.querySelectorAll('.sky-totals dd').length === 3 && [...container.querySelectorAll('.sky-totals dd')].every((el) => el.textContent === 'Not available'), 'Missing totals never become zeros');
    assert(content().includes('Cancellation is unavailable'), 'Cancellation stays unavailable'); layoutChecks();
    await mount('/hospital/requests/90', { custom: true, missing: true }); await until(() => content().includes('Request not found'), 'ownership-safe not-found');
    const f = await mount('/hospital/requests/01', { custom: true });
    assert(content().includes('Invalid request'), 'Malformed request ID rejected locally');
    assert(!f.calls.some((call) => call.url.includes('/requests/')), 'Invalid ID never sent to API');
  });
  await scenario('Admin priority queue and accessible inline detail', async () => {
    await mount('/admin/requests', { custom: true, user: user('ADMIN') });
    await until(() => content().includes('21 matching requests'), 'Admin list');
    assert(content().includes('Queue order: emergency'), 'Documented ordering explained');
    container.querySelector('button[aria-label="View request 90"]').click();
    await until(() => container.querySelector('.sky-history li'), 'Admin detail');
    assert(document.activeElement === container.querySelector('#request-selected-detail h2'), 'Opening detail moves keyboard focus');
    assert(content().includes('Isolated Hospital'), 'Safe hospital identity shown'); layoutChecks();
    await click('Close details'); assert(!container.querySelector('#request-selected-detail'), 'Details close');
    assert(document.activeElement === container.querySelector('button[aria-label="View request 90"]'), 'Closing detail restores keyboard focus');
  });
  await scenario('late response cannot restore data after sign-out', async () => {
    const f = await mount('/hospital/requests', { custom: true, hold: true });
    await until(() => f.release, 'request held');
    await click('Sign out'); await until(() => location.pathname === '/login', 'logout redirect');
    f.release(); await wait(20);
    assert(!content().includes('21 matching requests'), 'Late data stays hidden after logout');
  });
  await scenario('same-account fresh login hides responses from the previous auth lifecycle', async () => {
    const f = await mount('/hospital/requests', { custom: true, hold: true });
    await until(() => f.release, 'old lifecycle request held');
    const releaseOld = f.release;
    f.rows = [];
    await auth.login({ email: 'isolated@example.test', password: 'test-only' });
    await until(() => content().includes('No requests found'), 'new lifecycle result');
    releaseOld(); await wait(20);
    assert(!content().includes('21 matching requests'), 'Old same-account response is discarded');
    assert(!container.querySelector('tbody tr'), 'New lifecycle empty state remains authoritative');
  });
  await scenario('create validation, real lookup loader and confirmed submission', async () => {
    const f = await mount('/hospital/requests/new', { custom: true });
    await until(() => !button('Submit request')?.disabled, 'lookup ready');
    await click('Submit request'); assert(container.querySelector('[role="alert"]'), 'Invalid form has accessible errors');
    await fill('create-recipientGroupId', '4'); await fill('create-quantityRequested', '3'); await fill('create-neededBy', '2035-10-28T14:30:00');
    layoutChecks(); await click('Submit request');
    await until(() => location.pathname === '/hospital/requests/111' && content().includes('Isolated operational note'), 'persisted request navigation');
    assert(f.calls.filter((call) => call.method === 'post' && call.url.includes('/requests')).length === 1, 'One confirmed creation request');
    const sent = JSON.parse(f.calls.find((call) => call.method === 'post' && call.url.includes('/requests')).data);
    assert(sent.neededBy.endsWith('+05:30') && !Object.hasOwn(sent, 'hospitalId'), 'Candidate IST timestamp and server ownership');
    assert(!button('Submit request'), 'Confirmed submission leaves the creation form');
  });
  await scenario('uncertain submission never gives fake success or automatic retry', async () => {
    const f = await mount('/hospital/requests/new', { custom: true, uncertain: true });
    await until(() => !button('Submit request')?.disabled, 'lookup ready');
    await fill('create-recipientGroupId', '4'); await fill('create-quantityRequested', '3'); await fill('create-neededBy', '2035-10-28T14:30:00');
    await click('Submit request'); await until(() => content().includes('Submission could not be confirmed'), 'uncertain submission');
    assert(!content().includes('was submitted'), 'No fake success');
    assert(button('Submit request').disabled, 'Uncertain write cannot be blindly retried');
    assert(f.calls.filter((call) => call.method === 'post').length === 1, 'No automatic POST retry');
  });
}

const parameters = new URLSearchParams(location.search);
const frame = Number(parameters.get('frame'));
const preview = parameters.get('preview');
if (frame >= 320 && frame <= 1000 && window.parent === window) {
  const iframe = document.createElement('iframe'); iframe.title = 'Sky Pipeline responsive checks'; iframe.style.cssText = `display:block;width:${frame}px;height:1600px;border:0`;
  const url = new URL('/tests/browser/requests.html', location.origin); if (preview) url.searchParams.set('preview', preview); iframe.src = url.href;
  window.addEventListener('message', (event) => { if (event.source === iframe.contentWindow && event.origin === location.origin && event.data?.type === 'request-browser-result') report.textContent = JSON.stringify(event.data.result); });
  document.body.style.margin = '0'; container.replaceChildren(iframe);
} else if (preview) {
  report.hidden = true;
  await mount(preview === 'admin' ? '/admin/requests' : preview === 'detail' ? '/hospital/requests/90' : preview === 'list' ? '/hospital/requests' : '/hospital/requests/new', { custom: true, user: user(preview === 'admin' ? 'ADMIN' : 'HOSPITAL') });
} else {
  try { await scenarios(); } catch (error) { results.push({ name: 'harness', passed: false, error: error.message }); }
  const result = { done: true, width: innerWidth, checks, results, passed: results.every((item) => item.passed) };
  report.textContent = JSON.stringify(result);
  if (window.parent !== window) window.parent.postMessage({ type: 'request-browser-result', result }, location.origin);
}
