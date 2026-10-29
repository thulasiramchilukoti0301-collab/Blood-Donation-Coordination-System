import assert from 'node:assert/strict';
import { test } from 'node:test';
import { adminDonorPatch, adminDonorQuery, validateAdminDonorId } from '../src/modules/adminDonors/validation.js';
import { createAdminDonorService } from '../src/modules/adminDonors/service.js';
import { sessionAuthorization } from '../src/modules/accounts/sessionAuthorization.js';

const actor = { accountId: '31', role: 'ADMIN', accountStatus: 'ACTIVE' };
const secondAdmin = { accountId: '32', role: 'ADMIN', accountStatus: 'ACTIVE' };
const donorAccount = (accountStatus = 'ACTIVE', role = 'DONOR') => ({ accountId: '41', role, accountStatus });
const correction = (patch, originalValues) => ({ ...patch, originalValues, reasonCode:
  Object.hasOwn(patch, 'confirmedBloodGroupId') ? 'STAFF_GROUP_CONFIRMATION' : 'STAFF_PROFILE_CORRECTION' });
const initial = () => ({ donorId: '41', email: 'safe@example.test', accountStatus: 'ACTIVE', fullName: 'Fixture Donor',
  dateOfBirth: '1990-01-01', phone: '+91 100', address: 'Fixture address', area: null,
  reportedBloodGroup: { bloodGroupId: '2', code: 'O+' }, confirmedBloodGroup: null,
  createdAt: '2026-10-01 10:00:00', updatedAt: '2026-10-01 10:00:00',
  context: { bookingCount: 2, donationCount: 1, latestBooking: { bookingStatus: 'COMPLETED', appointmentAt: '2026-10-02 10:00:00' },
    latestDonation: { outcome: 'COLLECTED', releaseStatus: 'APPROVED', collectedAt: '2026-10-02 11:00:00+05:30' } } });

function harness(overrides = {}) {
  let profile = initial();
  let target = donorAccount();
  let now = 100;
  const events = [];
  const history = [];
  const sessionRow = { session_data: JSON.stringify({ auth: actor }), expires_at: Date.now() + 60_000, revoked_at: null };
  const repo = {
    async actor(id) { return id === '32' ? secondAdmin : actor; },
    async list(query) { events.push(['list', query]); return { donors: [], pagination: { page: query.page, pageSize: 20, total: 0 } }; },
    async detail(_connection, id) { events.push(['detail', id]); return id === '41' ? structuredClone(profile) : null; },
    transaction: async (ids, work) => {
      events.push(['account-locks', [...ids]]);
      const accounts = new Map([['31', actor], ['32', secondAdmin], ['41', overrides.targetMissing ? null : target]]);
      const connection = { execute: async (sql, params) => {
        events.push(['sid-lock']);
        assert.match(sql, /FROM app_session[\s\S]*FOR UPDATE/u);
        return [[params?.[0] === 'second-admin-sid'
          ? { ...sessionRow, session_data: JSON.stringify({ auth: secondAdmin }) } : sessionRow]];
      } };
      const original = structuredClone(profile);
      try { return await work(connection, accounts); }
      catch (error) { profile = original; throw error; }
    },
    async lockDonor() { events.push(['donor-lock']); if (overrides.afterDonorLock) overrides.afterDonorLock(() => { now = 2000; });
      return { ...profile, confirmedBloodGroupId: profile.confirmedBloodGroup?.bloodGroupId ?? null }; },
    async lockGroup(_connection, id) { events.push(['group-lock', id]); return id === '2' ? { bloodGroupId: id } : null; },
    async unitGroupHistory() { events.push(['unit-history']); return overrides.history ?? history; },
    async update(_connection, _id, patch) { events.push(['update', structuredClone(patch)]); if (overrides.updateResult === 0) return 0;
      Object.assign(profile, patch, { updatedAt: '2026-10-29 12:00:00' });
      if (Object.hasOwn(patch, 'confirmedBloodGroupId')) profile.confirmedBloodGroup = { bloodGroupId: patch.confirmedBloodGroupId, code: 'O+', displayName: 'O positive' };
      return 1; },
  };
  const auditWriter = { async write(_connection, value) { events.push(['audit', value]); if (overrides.auditFailure) throw new Error('private audit driver error'); } };
  const service = createAdminDonorService({ repository: repo, auditWriter,
    clock: () => new Date('2026-10-29T12:00:00.000Z'), operationId: () => '00000000-0000-4000-8000-000000000001' });
  return { service, events, setTarget: value => { target = value; }, profile: () => profile, sessionRow,
    setProfile: value => { profile = structuredClone(value); },
    now: () => now, expire: () => { sessionRow.expires_at = 150; }, advance: () => { now = 200; } };
}

test('Admin Donor query validation bounds search, status/group filters and 20-row pages', () => {
  assert.deepEqual(adminDonorQuery(), { search: '', accountStatus: 'ANY', bloodGroupId: undefined, groupMatch: 'EITHER', page: 1 });
  assert.deepEqual(adminDonorQuery({ search: ' O+ ', accountStatus: 'SUSPENDED', bloodGroupId: '8', groupMatch: 'CONFIRMED', page: '2' }),
    { search: 'O+', accountStatus: 'SUSPENDED', bloodGroupId: '8', groupMatch: 'CONFIRMED', page: 2 });
  for (const query of [{ role: 'ADMIN' }, { search: 'x'.repeat(121) }, { search: 'bad\n' }, { accountStatus: 'active' },
    { bloodGroupId: '01' }, { bloodGroupId: '8', groupMatch: 'ANY' }, { page: '01' }, { page: 0 }]) assert.throws(() => adminDonorQuery(query));
  assert.equal(validateAdminDonorId('18446744073709551615'), '18446744073709551615');
  for (const id of ['0', '01', '18446744073709551616', 1, null]) assert.throws(() => validateAdminDonorId(id));
});

test('Admin Donor PATCH accepts separate exact profile-correction and confirmed-group contracts only', () => {
  assert.deepEqual(adminDonorPatch(correction({ fullName: ' Corrected ', area: null }, { fullName: 'Fixture Donor', area: null })).patch,
    { fullName: 'Corrected', area: null });
  assert.deepEqual(adminDonorPatch(correction({ area: '   ' }, { area: 'Old area' })).patch, { area: null });
  assert.deepEqual(adminDonorPatch(correction({ confirmedBloodGroupId: '2' }, { confirmedBloodGroupId: null })).patch,
    { confirmedBloodGroupId: '2' });
  for (const originalValues of [undefined, {}, { fullName: null }, { fullName: 'Fixture Donor', area: null },
    { fullName: 'Fixture Donor\n' }, { fullName: 2 }]) {
    assert.throws(() => adminDonorPatch(correction({ fullName: 'Changed' }, originalValues)));
  }
  for (const originalValues of [{ confirmedBloodGroupId: '' }, { confirmedBloodGroupId: '01' },
    { confirmedBloodGroupId: '2', phone: 'old' }]) {
    assert.throws(() => adminDonorPatch(correction({ confirmedBloodGroupId: '3' }, originalValues)));
  }
  for (const body of [null, {}, { area: 'x' }, { email: 'x', reasonCode: 'STAFF_PROFILE_CORRECTION' },
    { reportedBloodGroupId: '2', reasonCode: 'STAFF_PROFILE_CORRECTION' },
    { confirmedBloodGroupId: null, reasonCode: 'STAFF_GROUP_CONFIRMATION' },
    { confirmedBloodGroupId: '2', fullName: 'Mixed', reasonCode: 'STAFF_GROUP_CONFIRMATION' },
    { fullName: 'x', reasonCode: 'free text' }, { dateOfBirth: '2099-01-01', reasonCode: 'STAFF_PROFILE_CORRECTION' },
    { fullName: 'x', reasonCode: 'STAFF_PROFILE_CORRECTION', actorAccountId: '31' }]) assert.throws(() => adminDonorPatch(body));
});

test('ACTIVE Admin can search and read the safe Donor profile with reported and confirmed groups separate', async () => {
  const f = harness();
  const page = await f.service.list('31', { accountStatus: 'ACTIVE', bloodGroupId: '2', groupMatch: 'REPORTED' });
  assert.deepEqual(page.pagination, { page: 1, pageSize: 20, total: 0 });
  assert.equal(f.events.at(-1)[1].groupMatch, 'REPORTED');
  const donor = await f.service.detail('31', '41');
  assert.equal(donor.reportedBloodGroup.code, 'O+'); assert.equal(donor.confirmedBloodGroup, null);
  assert.deepEqual(donor.context, f.profile().context);
  assert.equal(JSON.stringify(donor).includes('password'), false);
});

test('staff profile correction updates only allowlisted fields and writes a same-transaction non-sensitive audit event', async () => {
  const f = harness(); const auth = sessionAuthorization('fixture-admin-sid', actor);
  const saved = await f.service.update('31', '41', correction({ fullName: 'Corrected Name' }, { fullName: 'Fixture Donor' }), auth);
  assert.equal(saved.fullName, 'Corrected Name');
  const ordered = f.events.map(([kind]) => kind);
  assert.deepEqual(ordered, ['account-locks', 'sid-lock', 'donor-lock', 'sid-lock', 'update', 'audit', 'detail']);
  const audit = f.events.find(([kind]) => kind === 'audit')[1];
  assert.deepEqual(audit, { actorAccountId: '31', actionCode: 'DONOR_PROFILE_CORRECTED', subjectType: 'Donor', subjectId: '41',
    reasonCode: 'STAFF_PROFILE_CORRECTION', changeSummary: 'Staff corrected approved Donor profile fields', operationId: '00000000-0000-4000-8000-000000000001' });
  assert.deepEqual(f.events.find(([kind]) => kind === 'account-locks')[1], ['31', '41']);
});

test('confirmed group selection checks same-transaction reference/history and preserves reported group', async () => {
  const f = harness(); const auth = sessionAuthorization('fixture-admin-sid', actor);
  const saved = await f.service.update('31', '41', correction({ confirmedBloodGroupId: '2' }, { confirmedBloodGroupId: null }), auth);
  assert.equal(saved.confirmedBloodGroup.bloodGroupId, '2'); assert.equal(saved.reportedBloodGroup.code, 'O+');
  assert.ok(f.events.findIndex(([kind]) => kind === 'group-lock') < f.events.findIndex(([kind]) => kind === 'unit-history'));
});

test('missing confirmed-group reference is checked within the transaction and writes neither profile nor audit', async () => {
  const f = harness();
  await assert.rejects(f.service.update('31', '41', correction({ confirmedBloodGroupId: '8' }, { confirmedBloodGroupId: null }),
    sessionAuthorization('fixture-admin-sid', actor)),
  error => error.status === 422 && error.fields.confirmedBloodGroupId === 'Choose an existing blood group.');
  assert.equal(f.events.some(([kind]) => ['update', 'audit'].includes(kind)), false);
  assert.equal(f.profile().confirmedBloodGroup, null);
});

test('suspended, missing and wrong-role targets return target errors without auditing or invalidating the Admin session', async () => {
  for (const mode of ['suspended', 'missing', 'wrong-role']) {
    const f = harness({ targetMissing: mode === 'missing' });
    if (mode === 'suspended') f.setTarget(donorAccount('SUSPENDED'));
    if (mode === 'wrong-role') f.setTarget(donorAccount('ACTIVE', 'ADMIN'));
    await assert.rejects(f.service.update('31', '41', correction({ fullName: 'Changed' }, { fullName: 'Fixture Donor' }), sessionAuthorization('fixture-admin-sid', actor)),
      error => error.code === (mode === 'suspended' ? 'DONOR_STATE_CONFLICT' : 'DONOR_NOT_FOUND'));
    assert.equal(f.events.some(([kind]) => ['update', 'audit'].includes(kind)), false);
    assert.equal(f.sessionRow.revoked_at, null);
  }
});

test('confirmed-group change conflicting with stored BloodUnit history is rejected without rewriting history', async () => {
  const f = harness({ history: ['3'] });
  await assert.rejects(f.service.update('31', '41', correction({ confirmedBloodGroupId: '2' }, { confirmedBloodGroupId: null }), sessionAuthorization('sid', actor)),
    error => error.code === 'DONOR_GROUP_HISTORY_CONFLICT');
  assert.equal(f.events.some(([kind]) => ['update', 'audit'].includes(kind)), false);
});

test('two Admins editing the same reviewed field cannot overwrite a same-second correction', async () => {
  const f = harness();
  const reviewed = await f.service.detail('31', '41');
  const oldTimestamp = reviewed.updatedAt;
  await f.service.update('31', '41', correction({ phone: '+91 111' }, { phone: reviewed.phone }), sessionAuthorization('first-admin-sid', actor));
  f.setProfile({ ...f.profile(), updatedAt: oldTimestamp }); // DATETIME can retain the same second.
  const auditsBefore = f.events.filter(([kind]) => kind === 'audit').length;
  await assert.rejects(f.service.update('32', '41', correction({ phone: '+91 222' }, { phone: reviewed.phone }),
    sessionAuthorization('second-admin-sid', secondAdmin)), error => error.status === 409 && error.code === 'DONOR_EDIT_CONFLICT');
  assert.equal(f.profile().phone, '+91 111');
  assert.equal(f.events.filter(([kind]) => kind === 'audit').length, auditsBefore);
  assert.equal(f.events.filter(([kind]) => kind === 'update').length, 1);
});

test('multi-field preconditions reject any changed field while unrelated changes remain independent', async () => {
  const f = harness(); const reviewed = await f.service.detail('31', '41');
  const authA = sessionAuthorization('first-admin-sid', actor);
  const authB = sessionAuthorization('second-admin-sid', secondAdmin);
  await f.service.update('31', '41', correction({ area: 'West' }, { area: reviewed.area }), authA);
  const independent = await f.service.update('32', '41', correction({ phone: '+91 222' }, { phone: reviewed.phone }), authB);
  assert.equal(independent.area, 'West'); assert.equal(independent.phone, '+91 222');
  const auditsBefore = f.events.filter(([kind]) => kind === 'audit').length;
  await assert.rejects(f.service.update('32', '41', correction({ fullName: 'New name', phone: '+91 333' },
    { fullName: reviewed.fullName, phone: reviewed.phone }), authB), error => error.code === 'DONOR_EDIT_CONFLICT');
  assert.equal(f.profile().fullName, reviewed.fullName); assert.equal(f.profile().phone, '+91 222');
  assert.equal(f.events.filter(([kind]) => kind === 'audit').length, auditsBefore);
});

test('stale confirmed-group selection rejects before group/history locks and audit', async () => {
  const f = harness(); const reviewed = await f.service.detail('31', '41');
  await f.service.update('31', '41', correction({ confirmedBloodGroupId: '2' }, { confirmedBloodGroupId: null }),
    sessionAuthorization('first-admin-sid', actor));
  const auditsBefore = f.events.filter(([kind]) => kind === 'audit').length;
  await assert.rejects(f.service.update('32', '41', correction({ confirmedBloodGroupId: '2' },
    { confirmedBloodGroupId: reviewed.confirmedBloodGroup?.bloodGroupId ?? null }),
  sessionAuthorization('second-admin-sid', secondAdmin)), error => error.code === 'DONOR_EDIT_CONFLICT');
  assert.equal(f.profile().confirmedBloodGroup.bloodGroupId, '2');
  assert.equal(f.events.filter(([kind]) => kind === 'audit').length, auditsBefore);
  assert.equal(f.events.filter(([kind]) => kind === 'group-lock').length, 1);
});

test('expired Admin SID after Donor lock wait rejects before domain or audit writes', async t => {
  let time = 100; t.mock.method(Date, 'now', () => time);
  const f = harness({ afterDonorLock: advance => { time = 200; advance(); } });
  f.expire();
  await assert.rejects(f.service.update('31', '41', correction({ fullName: 'Changed' }, { fullName: 'Fixture Donor' }), sessionAuthorization('fixture-admin-sid', actor)),
    error => error.code === 'ACCOUNT_UNAVAILABLE');
  assert.equal(f.events.some(([kind]) => ['update', 'audit'].includes(kind)), false);
  assert.equal(f.profile().fullName, 'Fixture Donor');
});

test('audit failure rolls back the Donor correction and concurrent/stale conditional write conflicts safely', async () => {
  const f = harness({ auditFailure: true });
  await assert.rejects(f.service.update('31', '41', correction({ fullName: 'Changed' }, { fullName: 'Fixture Donor' }), sessionAuthorization('sid', actor)),
    error => error.code === 'DATABASE_UNAVAILABLE');
  assert.equal(f.profile().fullName, 'Fixture Donor');
  assert.equal(JSON.stringify(f.events).includes('private audit driver error'), false);
  const stale = harness({ updateResult: 0 });
  await assert.rejects(stale.service.update('31', '41', correction({ fullName: 'Changed' }, { fullName: 'Fixture Donor' }), sessionAuthorization('sid', actor)),
    error => error.code === 'DONOR_EDIT_CONFLICT');
  assert.equal(stale.events.some(([kind]) => kind === 'audit'), false);
});
