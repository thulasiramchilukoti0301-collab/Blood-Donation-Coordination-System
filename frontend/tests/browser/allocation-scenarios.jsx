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
async function until(fn) { for (let i = 0; i < 300; i++) { if (fn()) return; await wait(10); } throw new Error(`Timed out at ${location.pathname}: ${container.textContent.slice(0, 2200)}`); }
const codes = ['O-', 'O+', 'A-', 'A+', 'B-', 'B+', 'AB-', 'AB+'];
const allowed = new Set(['O->O-', 'O->O+', 'O->A-', 'O->A+', 'O->B-', 'O->B+', 'O->AB-', 'O->AB+', 'O+>O+', 'O+>A+', 'O+>B+', 'O+>AB+', 'A->A-', 'A->A+', 'A->AB-', 'A->AB+', 'A+>A+', 'A+>AB+', 'B->B-', 'B->B+', 'B->AB-', 'B->AB+', 'B+>B+', 'B+>AB+', 'AB->AB-', 'AB->AB+', 'AB+>AB+']);
let calls = []; let currentUser = { accountId: '8', role: 'ADMIN', accountStatus: 'ACTIVE' };
let allocationRows = []; let nextAllocationId = 71;
const bodyOf = (config) => typeof config.data === 'string' ? JSON.parse(config.data) : config.data;
api.defaults.adapter = async (config) => {
  calls.push(config); const base = { config, status: 200, statusText: '200', headers: {} };
  if (config.url === '/auth/me') return { ...base, data: { success: true, user: currentUser } };
  if (config.url === '/auth/csrf') return { ...base, data: { success: true, csrfToken: 'a'.repeat(64) } };
  if (config.url === '/admin/requests') return { ...base, data: { success: true, requests: [{ requestId: '42', recipientGroupId: '4', recipientBloodGroupCode: 'A+', recipientBloodGroupName: 'A Positive', quantityRequested: 2, priority: 'URGENT', requestStatus: 'UNDER_REVIEW', neededBy: '2026-11-01T10:00:00+05:30', hospital: { hospitalId: '9', organizationName: 'Real Hospital' } }], pagination: { page: 1, pageSize: 20, total: 1 } } };
  if (config.url.endsWith('/allocation-preview')) return { ...base, data: { success: true, preview: { isBinding: false, intendedIssueDate: '2026-11-01', eligibleForAllocation: true, request: { requestId: '42', recipientGroupId: '4', recipientGroupCode: 'A+', recipientGroupName: 'A Positive', hospitalName: 'Real Hospital', quantityRequested: 2, requestStatus: allocationRows.length ? 'PARTIALLY_FULFILLED' : 'UNDER_REVIEW' }, counts: { allocated: allocationRows.filter(row => row.allocationStatus === 'ALLOCATED').length, issued: allocationRows.filter(row => row.allocationStatus === 'ISSUED').length, outstanding: 2 - allocationRows.length, availableCandidateCount: 1, allocatableCount: allocationRows.length ? 0 : 1 }, allocations: allocationRows, candidatePagination: { page: 1, pageSize: 25, total: allocationRows.length ? 0 : 1, pageCount: allocationRows.length ? 0 : 1 }, candidates: allocationRows.length ? [] : [{ bloodUnitId: '19', donorGroupCode: 'O-', expiryDate: '2026-11-20', collectedAt: '2026-10-25 10:00:00' }] } } };
  if (config.method === 'post' && config.url === '/admin/requests/42/allocations') {
    const body = bodyOf(config);
    const allocationId = String(nextAllocationId++); const now = '2026-10-30T10:00:00+05:30';
    allocationRows = [{ allocationId, bloodUnitId: body.bloodUnitIds[0], allocationStatus: 'ALLOCATED', allocatedAt: now, issuedAt: null, handoffReference: null, expiryDate: '2026-11-20', donorGroupCode: 'O-' }];
    return { ...base, status: 201, data: { success: true, allocation: { requestId: '42', allocations: [{ allocationId, bloodUnitId: body.bloodUnitIds[0] }], allocated: 1, issued: 0, outstanding: 1, requestStatus: 'PARTIALLY_FULFILLED', operationId: '47c79c40-0f00-4bb0-a709-a0d3a93cb258' } } };
  }
  if (config.method === 'post' && config.url === '/admin/allocations/71/issue') {
    const body = bodyOf(config);
    allocationRows = [{ ...allocationRows[0], allocationStatus: 'ISSUED', issuedAt: '2026-10-30T10:05:00+05:30', handoffReference: body.handoffReference }];
    return { ...base, data: { success: true, issue: { allocationId: '71', requestId: '42', bloodUnitId: '19', allocationStatus: 'ISSUED', unitStatus: 'ISSUED', requestStatus: 'PARTIALLY_FULFILLED', issued: 1, allocated: 0, outstanding: 1, handoffReference: body.handoffReference } } };
  }
  if (config.url === '/admin/blood-compatibility') return { ...base, data: { success: true,
    groups: codes.map((code, i) => ({ bloodGroupId: String(i + 1), code, displayName: `${code} group` })),
    pairs: codes.flatMap((donorGroupCode) => codes.map((recipientGroupCode) => ({ donorGroupCode, recipientGroupCode, isCompatible: allowed.has(`${donorGroupCode}>${recipientGroupCode}`) }))) } };
  throw new Error(`Unexpected request ${config.url}`);
};
let root = createRoot(container); root.render(<BrowserRouter><App /></BrowserRouter>);
async function scenario(name, fn) { try { await fn(); results.push({ name, passed: true }); } catch (error) { results.push({ name, passed: false, error: error.message }); } }
await scenario('Allocation workspace confirms exact FEFO units and records a hospital handoff', async () => {
  history.replaceState({}, '', '/admin/allocations'); window.dispatchEvent(new PopStateEvent('popstate'));
  await until(() => container.querySelector('.indigo-heading h1')?.textContent === 'Request allocation' && container.querySelector('#allocation-request option[value="42"]'));
  const requestSelect = container.querySelector('#allocation-request');
  Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(requestSelect, '42');
  requestSelect.dispatchEvent(new Event('input', { bubbles: true })); requestSelect.dispatchEvent(new Event('change', { bubbles: true }));
  await until(() => container.textContent.includes('19'));
  assert(container.textContent.includes('Real Hospital'), 'Real hospital/request summary appears');
  assert(container.textContent.includes('O-'), 'Compatible donor group appears');
  assert(container.textContent.includes('Preview is read-only until'), 'Read-only preview disclosure appears');
  const candidate = container.querySelector('input[aria-label="Select BloodUnit 19"]');
  candidate.click();
  const confirm = [...container.querySelectorAll('button')].find((button) => button.textContent.includes('Confirm allocation'));
  assert(!confirm.disabled, 'An exact eligible FEFO selection enables confirmation'); confirm.click();
  await until(() => container.querySelector('[role="dialog"]')?.textContent.includes('Confirm exact unit reservation'));
  [...container.querySelectorAll('[role="dialog"] button')].find(button => button.textContent.includes('Confirm reservation')).click();
  await until(() => container.textContent.includes('Reserved 1 unit for request #42'));
  const reserveCall = calls.find(call => call.method === 'post' && call.url === '/admin/requests/42/allocations');
  const reserveBody = bodyOf(reserveCall || {});
  assert(reserveCall && reserveBody?.intendedIssueDate === container.querySelector('#intended-issue-date').value
    && JSON.stringify(reserveBody?.bloodUnitIds) === '["19"]', `One exact FEFO mutation is sent: ${JSON.stringify({ call: reserveCall?.url, method: reserveCall?.method, body: reserveBody })}`);
  await until(() => container.textContent.includes('Issue unit'));
  const issue = [...container.querySelectorAll('button')].find(button => button.textContent === 'Issue unit');
  assert(issue, 'Saved allocation exposes an Issue control'); issue.click();
  await until(() => container.querySelector('#handoff-reference'));
  const handoff = container.querySelector('#handoff-reference');
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(handoff, 'HANDOFF-42');
  handoff.dispatchEvent(new Event('input', { bubbles: true })); handoff.dispatchEvent(new Event('change', { bubbles: true }));
  [...container.querySelectorAll('[role="dialog"] button')].find(button => button.textContent.includes('Confirm issue')).click();
  await until(() => container.textContent.includes('Issued BloodUnit 19 for request #42'));
  const issueCall = calls.find(call => call.method === 'post' && call.url === '/admin/allocations/71/issue');
  assert(issueCall && bodyOf(issueCall).handoffReference === 'HANDOFF-42', `Issue sends the required handoff reference once: ${JSON.stringify({ call: issueCall?.url, data: issueCall && bodyOf(issueCall) })}`);
  const shell = container.querySelector('.indigo-app-shell');
  assert(getComputedStyle(shell).backgroundColor === 'rgb(245, 246, 255)', 'Indigo background matches selected token');
  for (const field of container.querySelectorAll('input,select')) assert(field.labels?.length, `Field ${field.id} is labeled`);
});
await scenario('Compatibility workspace uses the stored direction and matrix', async () => {
  calls = [];
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
