import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import { createAllocationReadRouter } from '../src/modules/allocations/readRouter.js';
import { createAllocationReadService, validateAllocationPreviewQuery } from '../src/modules/allocations/readService.js';
import { createAllocationReadRepository } from '../src/modules/allocations/readRepository.js';

const groups = ['O-', 'O+', 'A-', 'A+', 'B-', 'B+', 'AB-', 'AB+'];
function matrix() {
  const compatible = new Map([['O-', groups], ['O+', ['O+', 'A+', 'B+', 'AB+']], ['A-', ['A-', 'A+', 'AB-', 'AB+']],
    ['A+', ['A+', 'AB+']], ['B-', ['B-', 'B+', 'AB-', 'AB+']], ['B+', ['B+', 'AB+']], ['AB-', ['AB-', 'AB+']], ['AB+', ['AB+']]]);
  return { groups: groups.map((code, i) => ({ bloodGroupId: String(i + 1), code, displayName: code })),
    pairs: groups.flatMap((donorGroupCode) => groups.map((recipientGroupCode) => ({ donorGroupCode, recipientGroupCode,
      isCompatible: compatible.get(donorGroupCode).includes(recipientGroupCode) }))) };
}
const preview = { request: { requestId: '42', recipientGroupId: '8', recipientGroupCode: 'AB+', recipientGroupName: 'AB positive',
  quantityRequested: 3, requestStatus: 'UNDER_REVIEW', hospitalName: 'Real hospital' }, eligibleForAllocation: true,
  intendedIssueDate: '2026-11-01', counts: { allocated: 0, issued: 0, outstanding: 3, availableCandidateCount: 1, allocatableCount: 1 },
  candidates: [{ bloodUnitId: '91', donorGroupCode: 'O-', expiryDate: '2026-12-01', collectedAt: '2026-10-29 10:00:00' }],
  candidatePagination: { page: 1, pageSize: 25, total: 1, pageCount: 1 }, isBinding: false };

test('preview input strictly accepts positive BIGINT request IDs, real dates and bounded candidate pages', () => {
  assert.deepEqual(validateAllocationPreviewQuery({ intendedIssueDate: '2026-11-01' }), { intendedIssueDate: '2026-11-01', candidatePage: 1 });
  for (const query of [{ intendedIssueDate: '2026-02-30' }, { intendedIssueDate: '2026-11-01', q: '1' },
    { intendedIssueDate: '2026-11-01', candidatePage: '01' }, { intendedIssueDate: '2026-11-01', candidatePage: '99999' }]) {
    assert.throws(() => validateAllocationPreviewQuery(query), { code: 'VALIDATION_ERROR' });
  }
});

test('read service fails closed unless it receives the complete canonical directed 64/27 matrix', async () => {
  const service = createAllocationReadService({ assertStorageReady: async () => {}, listCompatibility: async () => matrix() });
  const result = await service.compatibility();
  assert.equal(result.pairs.length, 64);
  assert.equal(result.pairs.filter((pair) => pair.isCompatible).length, 27);
  assert.equal(result.pairs.find((pair) => pair.donorGroupCode === 'O-' && pair.recipientGroupCode === 'AB+').isCompatible, true);
  assert.equal(result.pairs.find((pair) => pair.donorGroupCode === 'AB+' && pair.recipientGroupCode === 'O-').isCompatible, false);
  await assert.rejects(() => createAllocationReadService({ listCompatibility: async () => ({ ...matrix(), pairs: matrix().pairs.slice(1) }) }).compatibility(),
    { code: 'ALLOCATION_READ_UNAVAILABLE' });
});

test('preview preserves genuine counts and reports a 404 only for a missing real request', async () => {
  const service = createAllocationReadService({ readPreview: async () => preview });
  assert.deepEqual(await service.preview('42', { intendedIssueDate: '2026-11-01' }), preview);
  await assert.rejects(() => service.preview('42 OR 1=1', { intendedIssueDate: '2026-11-01' }), { code: 'VALIDATION_ERROR' });
  const missing = createAllocationReadService({ readPreview: async () => null });
  await assert.rejects(() => missing.preview('42', { intendedIssueDate: '2026-11-01' }), { code: 'REQUEST_NOT_FOUND' });
});

test('read repository binds request, recipient group, issue date, and page values in SQL', async () => {
  const calls = [];
  const database = { async execute(sql, values) {
    calls.push({ sql, values });
    if (sql.includes('FROM HospitalRequest')) return [[{ requestId: '42', recipientGroupId: '8', recipientGroupCode: 'AB+',
      recipientGroupName: 'AB positive', hospitalName: 'Real hospital', quantityRequested: 3, requestStatus: 'UNDER_REVIEW' }]];
    if (sql.includes('AS allocated')) return [[{ allocated: 0, issued: 0 }]];
    if (sql.includes('COUNT(*)')) return [[{ total: 1 }]];
    return [[{ bloodUnitId: '91', donorGroupCode: 'O-', expiryDate: '2026-12-01', collectedAt: '2026-10-29 10:00:00' }]];
  } };
  const result = await createAllocationReadRepository(database).readPreview('42', '2026-11-01', 1);
  assert.equal(result.counts.availableCandidateCount, 1);
  assert.equal(result.counts.allocatableCount, 1);
  assert.deepEqual(calls.map((call) => call.values), [['42'], ['42'], ['8', '2026-11-01'], ['8', '2026-11-01', 1, 0]]);
  assert.match(calls[3].sql, /ORDER BY u\.expiry_date, d\.collected_at, u\.blood_unit_id/u);
  assert.match(calls[3].sql, /d\.release_status = 'APPROVED'/u);
});

test('routes require a current ACTIVE Admin session, return no-store, and fail closed for missing storage', async (t) => {
  let unavailable = false;
  const service = { async assertStorageReady() { if (unavailable) throw Object.assign(new Error(), { status: 503, code: 'ALLOCATION_READ_UNAVAILABLE' }); },
    async compatibility() { return matrix(); }, async preview() { return preview; } };
  const authService = { async authorizeSession(sessionId, principal) {
    if (principal.accountStatus !== 'ACTIVE') throw Object.assign(new Error(), { status: 401, code: 'ACCOUNT_UNAVAILABLE' });
    return { accountId: principal.accountId, role: principal.role, accountStatus: principal.accountStatus };
  } };
  const app = express();
  app.use((req, _res, next) => {
    const identity = req.headers['x-test-identity'];
    req.sessionID = identity ? 'sid-1' : '';
    req.session = identity ? { auth: { accountId: '7', role: identity, accountStatus: identity === 'ADMIN' ? 'ACTIVE' : 'ACTIVE' }, destroy(callback) { callback(); } } : null;
    next();
  });
  app.use('/api', createAllocationReadRouter({ authService, service }));
  app.use((error, _req, res, _next) => res.status(error.status || 500).json({ error: { code: error.code } }));
  const server = app.listen(0, '127.0.0.1');
  t.after(() => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const unauth = await fetch(`${base}/admin/blood-compatibility`);
  assert.equal(unauth.status, 401);
  const hospital = await fetch(`${base}/admin/blood-compatibility`, { headers: { 'X-Test-Identity': 'HOSPITAL' } });
  assert.equal(hospital.status, 403);
  const admin = await fetch(`${base}/admin/blood-compatibility`, { headers: { 'X-Test-Identity': 'ADMIN' } });
  assert.equal(admin.status, 200); assert.equal(admin.headers.get('cache-control'), 'no-store');
  const invalid = await fetch(`${base}/admin/requests/42/allocation-preview?intendedIssueDate=2026-11-01&x=1`, { headers: { 'X-Test-Identity': 'ADMIN' } });
  assert.equal(invalid.status, 400);
  unavailable = true;
  const missingStorage = await fetch(`${base}/admin/blood-compatibility`, { headers: { 'X-Test-Identity': 'ADMIN' } });
  assert.equal(missingStorage.status, 503);
  assert.equal((await missingStorage.json()).error.code, 'ALLOCATION_READ_UNAVAILABLE');
});
