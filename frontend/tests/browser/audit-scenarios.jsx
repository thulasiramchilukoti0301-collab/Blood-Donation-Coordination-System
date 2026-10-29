import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from '../../src/App';
import { api } from '../../src/services/api';
import '../../src/styles/global.css';

const container = document.getElementById('audit-test-app'); const report = document.getElementById('audit-test-result');
let checks = 0; const results = []; let calls = []; let failNext = false; let holdNext = false; let releaseAudit = null; let emptyMode = false;
let currentUser = { accountId: '8', role: 'ADMIN', accountStatus: 'ACTIVE' };
const assert = (value, message) => { checks++; if (!value) throw new Error(message); };
const wait = (ms = 15) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(fn) { for (let i = 0; i < 400; i++) { if (fn()) return; await wait(10); } throw new Error(`Timed out at ${location.pathname}: ${container.textContent.slice(0, 500)}`); }
const event = { eventId: '91', actorAccountId: '7', actionCode: 'ACCOUNT_APPROVED', subjectType: 'Account', subjectId: '80', occurredAt: '2026-10-28T14:25:00+05:30', reasonCode: 'REGISTRATION_REVIEWED', changeSummary: 'PENDING -> ACTIVE' };
api.defaults.adapter = async (config) => {
  calls.push(config); const base = { config, status: 200, statusText: '200', headers: {} };
  if (config.url === '/auth/me') return { ...base, data: { success: true, user: currentUser } };
  if (config.url === '/admin/audit-events') {
    if (holdNext) { holdNext = false; await new Promise((resolve) => { releaseAudit = resolve; }); }
    if (failNext) { failNext = false; throw Object.assign(new Error('fixture outage'), { config, response: { status: 503, data: { error: { code: 'AUDIT_READ_UNAVAILABLE' } } } }); }
    const p = config.params || {}; return { ...base, data: { success: true, events: emptyMode ? [] : [event], pagination: { page: p.page, pageSize: p.pageSize, total: emptyMode ? 0 : 51 } } };
  }
  throw new Error(`Unexpected request ${config.url}`);
};
let root = createRoot(container); root.render(<BrowserRouter><App /></BrowserRouter>);
async function scenario(name, work) { try { await work(); results.push({ name, passed: true }); } catch (error) { results.push({ name, passed: false, error: error.message }); } }
async function click(label) { const target = [...container.querySelectorAll('button')].find((button) => button.textContent.trim() === label); assert(target && !target.disabled, `${label} is available`); target.click(); await wait(); }
function fill(id, value) { const field = container.querySelector(`#${id}`); assert(field, `${id} exists`); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(field, value); field.dispatchEvent(new Event('input', { bubbles: true })); field.dispatchEvent(new Event('change', { bubbles: true })); }
await scenario('ACTIVE Admin sees saved audit rows and retries safe unavailable state', async () => {
  history.replaceState({}, '', '/admin/audit'); window.dispatchEvent(new PopStateEvent('popstate')); failNext = true; holdNext = true;
  await until(() => releaseAudit && container.textContent.includes('Loading saved audit events'));
  assert(container.querySelector('[role="status"]'), 'Loading state is announced'); releaseAudit();
  await until(() => container.textContent.includes('Audit history unavailable'));
  assert(!container.textContent.includes('fixture outage'), 'Raw storage details are not shown');
  await click('Retry'); await until(() => container.textContent.includes('ACCOUNT_APPROVED'));
  assert(container.textContent.includes('Account #7') && container.textContent.includes('PENDING -> ACTIVE'), 'Real fixture actor and stored summary display');
  assert(container.textContent.includes('REGISTRATION_REVIEWED'), 'Stored reason displays');
  assert(!calls.some((call) => ['post', 'patch', 'delete'].includes(call.method)), 'Audit page issues no mutation requests');
  for (const field of container.querySelectorAll('input,select')) assert(field.labels?.length, `${field.id} has an accessible label`);
});
await scenario('filter, reset, page controls and empty state use only structured API parameters', async () => {
  fill('audit-action', 'ACCOUNT_APPROVED'); await click('Search records');
  await until(() => calls.some((call) => call.url === '/admin/audit-events' && call.params?.actionCode === 'ACCOUNT_APPROVED'));
  assert(calls.at(-1).params.page === 1, 'New filter resets to first page');
  await click('Next'); await until(() => calls.at(-1)?.params?.page === 2);
  assert(calls.at(-1).params.actionCode === 'ACCOUNT_APPROVED', 'Pagination retains filters');
  await click('Reset filters'); await until(() => calls.at(-1)?.params?.page === 1 && !calls.at(-1)?.params?.actionCode);
  emptyMode = true; await click('Search records'); await until(() => container.textContent.includes('No audit events found'));
  assert(container.textContent.includes('0 matching events'), 'Empty state uses real zero total');
});
await scenario('responsive layout and keyboard focus remain usable', async () => {
  assert(document.documentElement.scrollWidth <= innerWidth + 1, 'No horizontal page overflow');
  const control = container.querySelector('#audit-actor'); control.focus();
  assert(document.activeElement === control && getComputedStyle(control).outlineStyle !== 'none', 'Keyboard focus is visible on a labelled filter');
  assert(getComputedStyle(container.querySelector('.audit-app-shell')).backgroundColor === 'rgb(244, 247, 250)', 'Scoped Cobalt Ledger theme is active');
});
await scenario('non-Admin account cannot load audit data', async () => {
  root.unmount(); calls = []; currentUser = { accountId: '12', role: 'HOSPITAL', accountStatus: 'ACTIVE' };
  history.replaceState({}, '', '/admin/audit'); root = createRoot(container); root.render(<BrowserRouter><App /></BrowserRouter>);
  await until(() => location.pathname === '/unauthorized');
  assert(!calls.some((call) => call.url === '/admin/audit-events'), 'Non-Admin never requests audit events');
});
report.textContent = JSON.stringify({ done: true, passed: results.every((item) => item.passed), checks, results, width: innerWidth });
