import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from '../../src/App';
import { api } from '../../src/services/api';
import '../../src/styles/global.css';

const container = document.getElementById('allocation-test-app');
const report = document.getElementById('allocation-test-result');
let checks = 0; const results = [];
const assert = (value, message) => { checks++; if (!value) throw new Error(message); };
const wait = (ms = 20) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(fn) { for (let i = 0; i < 300; i++) { if (fn()) return; await wait(10); } throw new Error(`Timed out at ${location.pathname}: ${container.textContent.slice(0, 900)}`); }
const codes = ['O-', 'O+', 'A-', 'A+', 'B-', 'B+', 'AB-', 'AB+'];
const allowed = new Set(['O->O-', 'O->O+', 'O->A-', 'O->A+', 'O->B-', 'O->B+', 'O->AB-', 'O->AB+', 'O+>O+', 'O+>A+', 'O+>B+', 'O+>AB+', 'A->A-', 'A->A+', 'A->AB-', 'A->AB+', 'A+>A+', 'A+>AB+', 'B->B-', 'B->B+', 'B->AB-', 'B->AB+', 'B+>B+', 'B+>AB+', 'AB->AB-', 'AB->AB+', 'AB+>AB+']);
let calls = []; let currentUser = { accountId: '8', role: 'ADMIN', accountStatus: 'ACTIVE' };
api.defaults.adapter = async (config) => {
  calls.push(config); const base = { config, status: 200, statusText: '200', headers: {} };
  if (config.url === '/auth/me') return { ...base, data: { success: true, user: currentUser } };
  if (config.url === '/admin/requests') return { ...base, data: { success: true, requests: [{ requestId: '42', recipientGroupId: '4', recipientBloodGroupCode: 'A+', recipientBloodGroupName: 'A Positive', quantityRequested: 2, priority: 'URGENT', requestStatus: 'UNDER_REVIEW', neededBy: '2026-11-01T10:00:00+05:30', hospital: { hospitalId: '9', organizationName: 'Real Hospital' } }], pagination: { page: 1, pageSize: 20, total: 1 } } };
  if (config.url.endsWith('/allocation-preview')) return { ...base, data: { success: true, preview: { isBinding: false, intendedIssueDate: '2026-11-01', eligibleForAllocation: true, request: { requestId: '42', recipientGroupId: '4', recipientGroupCode: 'A+', recipientGroupName: 'A Positive', hospitalName: 'Real Hospital', quantityRequested: 2, requestStatus: 'UNDER_REVIEW' }, counts: { allocated: 0, issued: 0, outstanding: 2, availableCandidateCount: 1, allocatableCount: 1 }, candidatePagination: { page: 1, pageSize: 25, total: 1, pageCount: 1 }, candidates: [{ bloodUnitId: '19', donorGroupCode: 'O-', expiryDate: '2026-11-20', collectedAt: '2026-10-25 10:00:00' }] } } };
  if (config.url === '/admin/blood-compatibility') return { ...base, data: { success: true,
    groups: codes.map((code, i) => ({ bloodGroupId: String(i + 1), code, displayName: `${code} group` })),
    pairs: codes.flatMap((donorGroupCode) => codes.map((recipientGroupCode) => ({ donorGroupCode, recipientGroupCode, isCompatible: allowed.has(`${donorGroupCode}>${recipientGroupCode}`) }))) } };
  throw new Error(`Unexpected request ${config.url}`);
};
let root = createRoot(container); root.render(<BrowserRouter><App /></BrowserRouter>);
async function scenario(name, fn) { try { await fn(); results.push({ name, passed: true }); } catch (error) { results.push({ name, passed: false, error: error.message }); } }
await scenario('Allocation workspace shows real request, FEFO candidate and disabled confirmation', async () => {
  history.replaceState({}, '', '/admin/allocations'); window.dispatchEvent(new PopStateEvent('popstate'));
  await until(() => container.querySelector('.indigo-heading h1')?.textContent === 'Request allocation' && container.querySelector('#allocation-request option[value="42"]'));
  const requestSelect = container.querySelector('#allocation-request');
  Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(requestSelect, '42');
  requestSelect.dispatchEvent(new Event('input', { bubbles: true })); requestSelect.dispatchEvent(new Event('change', { bubbles: true }));
  await until(() => container.textContent.includes('19'));
  assert(container.textContent.includes('Real Hospital'), 'Real hospital/request summary appears');
  assert(container.textContent.includes('O-'), 'Compatible donor group appears');
  assert(container.textContent.includes('does not reserve'), 'Read-only preview disclosure appears');
  const confirm = [...container.querySelectorAll('button')].find((button) => button.textContent.includes('Confirm allocation'));
  assert(confirm?.disabled, 'Confirmation stays disabled');
  assert(!calls.some((call) => ['post', 'patch', 'delete'].includes(call.method)), 'No mutation request was sent');
  const shell = container.querySelector('.indigo-app-shell');
  assert(getComputedStyle(shell).backgroundColor === 'rgb(245, 246, 255)', 'Indigo background matches selected token');
  for (const field of container.querySelectorAll('input,select')) assert(field.labels?.length, `Field ${field.id} is labeled`);
});
await scenario('Compatibility workspace uses the stored direction and matrix', async () => {
  history.replaceState({}, '', '/admin/compatibility'); window.dispatchEvent(new PopStateEvent('popstate'));
  await until(() => container.querySelector('.indigo-heading h1')?.textContent === 'Compatibility management');
  assert(container.textContent.includes('27 compatible mappings'), 'Stored matrix count shown');
  const donor = container.querySelector('#compatibility-donor'); donor.focus();
  assert(document.activeElement === donor && getComputedStyle(donor).outlineStyle !== 'none', 'Keyboard focus is visible on a labeled select');
  assert(document.documentElement.scrollWidth <= innerWidth + 1, 'No horizontal viewport overflow');
  assert(!calls.some((call) => ['post', 'patch', 'delete'].includes(call.method)), 'Compatibility page remains read-only');
});
await scenario('Inactive or non-Admin role cannot access either Feature 8 page', async () => {
  root.unmount(); calls = []; currentUser = { accountId: '12', role: 'HOSPITAL', accountStatus: 'ACTIVE' };
  history.replaceState({}, '', '/admin/allocations'); root = createRoot(container); root.render(<BrowserRouter><App /></BrowserRouter>);
  await until(() => location.pathname === '/unauthorized');
  assert(location.pathname === '/unauthorized', 'Non-Admin session is redirected before reading the Admin page');
  assert(!calls.some((call) => call.url.includes('allocation-preview')), 'Non-Admin session sends no allocation preview request');
});
report.textContent = JSON.stringify({ done: true, passed: results.every((result) => result.passed), checks, results, width: innerWidth });
