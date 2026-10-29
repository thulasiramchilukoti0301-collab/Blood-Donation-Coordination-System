import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from '../../src/App';
import { api } from '../../src/services/api';
import '../../src/styles/global.css';

const container = document.getElementById('reports-test-app'); const report = document.getElementById('reports-test-result');
let checks = 0; const results = []; const hospitalMode = new URLSearchParams(location.search).get('role') === 'hospital'; let currentUser = hospitalMode ? { accountId: '52', role: 'HOSPITAL', accountStatus: 'PENDING' } : { accountId: '8', role: 'ADMIN', accountStatus: 'ACTIVE' }; const calls = [];
const assert = (value, message) => { checks++; if (!value) throw new Error(message); };
const wait = (ms = 25) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(fn) { for (let i = 0; i < 400; i++) { if (fn()) return; await wait(10); } throw new Error(`Timed out at ${location.pathname}: ${container.textContent.slice(0, 400)}`); }
api.defaults.adapter = async (config) => {
  calls.push(config); const base = { config, status: 200, statusText: '200', headers: {} };
  if (config.url === '/auth/me') return { ...base, data: { success: true, user: currentUser } };
  if (config.url === '/admin/dashboard') return { ...base, data: { success: true, counts: { donors: '4', hospitals: '2', pendingAccounts: '1', pendingHospitals: '1' }, donations: [{ outcome: 'COLLECTED', total: '3' }], inventory: [{ bloodGroup: 'O-', status: 'AVAILABLE', total: '2' }], requests: [{ status: 'SUBMITTED', total: '2', quantity: '5' }], donationTrend: [] } };
  if (config.url === '/admin/audit-events') return { ...base, data: { success: true, events: [{ eventId: '4', actorAccountId: '1', actionCode: 'ACCOUNT_APPROVED', subjectType: 'Account', subjectId: '2', occurredAt: '2026-10-29T10:00:00+05:30', reasonCode: null, changeSummary: null }], pagination: { page: 1, pageSize: 25, total: 1 } } };
  if (config.url === '/admin/reports/inventory') return { ...base, data: { success: true, inventory: [{ bloodGroup: 'O-', status: 'AVAILABLE', total: '2' }] } };
  if (config.url === '/admin/reports/donations') return { ...base, data: { success: true, donations: [{ period: '2026-10-29', outcome: 'COLLECTED', total: '3' }] } };
  if (config.url === '/admin/reports/requests') return { ...base, data: { success: true, statuses: [{ status: 'SUBMITTED', total: '2', quantity: '5' }], trend: [{ period: '2026-10-29', total: '2' }], hospitals: [{ hospital: 'Fixture Hospital', status: 'SUBMITTED', total: '2', quantity: '5' }] } };
  if (config.url === '/hospitals/me/dashboard') return { ...base, data: { success: true, profile: { organizationName: 'Own Hospital', accountStatus: currentUser.accountStatus }, requests: [{ status: 'SUBMITTED', total: '1', quantity: '2' }], recent: [{ requestId: '12', bloodGroup: 'A+', quantity: '2', priority: 'NORMAL', status: 'SUBMITTED', createdAt: '2026-10-29 10:00:00' }] } };
  throw new Error(`Unexpected feature10 fixture request: ${config.url}`);
};
createRoot(container).render(<BrowserRouter><App /></BrowserRouter>);
async function scenario(name, work) { try { await work(); results.push({ name, passed: true }); } catch (error) { results.push({ name, passed: false, error: error.message }); } }
if (!hospitalMode) await scenario('Admin dashboard loads database metrics and audit activity', async () => {
  history.replaceState({}, '', '/admin'); window.dispatchEvent(new PopStateEvent('popstate'));
  await until(() => container.textContent.includes('Admin dashboard') && container.textContent.includes('ACCOUNT_APPROVED'));
  assert(container.textContent.includes('Registered donors') && container.textContent.includes('4'), 'Donor metric rendered');
  assert(container.textContent.includes('AVAILABLE') && container.textContent.includes('SUBMITTED'), 'Stored state and request status rendered');
  assert(container.textContent.includes('Open reports'), 'Reports navigation is available');
});
if (!hospitalMode) await scenario('Admin reports render aggregates and submit date filters', async () => {
  history.replaceState({}, '', '/admin/reports'); window.dispatchEvent(new PopStateEvent('popstate'));
  await until(() => container.textContent.includes('Fixture Hospital'));
  assert(container.textContent.includes('Donation outcomes over time') && container.textContent.includes('Request activity by day'), 'Trend displays render');
  const from = container.querySelector('input[type="date"]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(from, '2026-10-01'); from.dispatchEvent(new Event('input', { bubbles: true })); from.dispatchEvent(new Event('change', { bubbles: true }));
  [...container.querySelectorAll('button')].find((button) => button.textContent.includes('Apply filters')).click(); await wait();
  assert(calls.filter((call) => call.url === '/admin/reports/donations').some((call) => call.params?.from === '2026-10-01'), 'Date filter reaches API');
});
if (hospitalMode) await scenario('Hospital dashboard shows session-scoped data and no hospital selector', async () => {
  history.replaceState({}, '', '/hospital'); window.dispatchEvent(new PopStateEvent('popstate'));
  await until(() => container.textContent.includes('Own Hospital'));
  assert(container.textContent.includes('PENDING') && container.textContent.includes('A+'), 'Pending own request summary renders');
  assert(!container.textContent.includes('Create request'), 'Pending Hospital does not see active request actions');
  assert(!container.querySelector('input[name="hospitalId"]'), 'Client hospital selector is absent');
  assert(calls.some((call) => call.url === '/hospitals/me/dashboard' && !call.params?.hospitalId), 'Hospital API call sends no identity selector');
});
await wait(); report.textContent = JSON.stringify({ done: true, passed: results.every((item) => item.passed), checks, width: innerWidth, results });
