import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createReleaseService } from '../src/modules/release/service.js';
import { releaseInput, inventoryQuery } from '../src/modules/release/rules.js';
import { testAuthorization, testSessionRow } from './helpers/session-context.mjs';

const auth = testAuthorization('1', 'ADMIN', 'ACTIVE');
const instant = Date.parse('2026-10-29T10:00:00+05:30');
const approved = { decision: 'APPROVED', confirmedBloodGroupId: '3' };
const rejected = { decision: 'REJECTED', reasonCode: 'TESTING_NOT_APPROVED' };
const code = expected => error => { assert.equal(error.code, expected); return true; };

function fixture(options = {}) {
  const state = { status: options.status ?? 'PENDING', reason: options.reason ?? null,
    decidedAt: options.status && options.status !== 'PENDING' ? '2026-10-29 10:00:00' : null,
    unit: options.unit ?? null, events: [] };
  let stored = testSessionRow(auth);
  const repository = {
    hint: async () => ({ donorAccountId: '10', slotId: '4', bookingId: '3' }),
    async transaction(actor, donor, work) {
      assert.equal(actor, '1'); assert.equal(donor, '10');
      const before = structuredClone(state);
      const connection = { execute: async (sql) => {
        assert.match(sql, /app_session/u); return [[stored]];
      } };
      try { return await work(connection, new Map([
        ['1', options.actor ?? { accountId: '1', role: 'ADMIN', accountStatus: 'ACTIVE' }],
        ['10', { accountId: '10', role: 'DONOR', accountStatus: 'ACTIVE' }]])); }
      catch (error) { Object.assign(state, before); throw error; }
    },
    donor: async () => ({ accountId: '10', confirmedBloodGroupId: options.profileGroup ?? null }),
    slot: async () => ({ slotId: '4' }),
    booking: async () => ({ bookingId: '3', donorAccountId: '10', slotId: '4', bookingStatus: 'COMPLETED' }),
    donation: async () => ({ donationId: '8', bookingId: '3', outcome: options.outcome ?? 'COLLECTED',
      releaseStatus: state.status, releaseReasonCode: state.reason, releaseDecidedAt: state.decidedAt,
      collectedAt: options.collectedAt ?? '2026-10-28 09:00:00' }),
    group: async (_, id) => {
      if (options.expireDuringGroupWait) stored = { ...stored, expires_at: Date.now() - 1 };
      return options.groupMissing ? null : { bloodGroupId: id, code: 'A-', isActive: options.groupInactive ? 0 : 1 };
    },
    unit: async () => state.unit,
    async decide(_, id, actor, input, now) {
      assert.equal(id, '8'); assert.equal(actor, '1');
      if (options.affectedRows === 0) return 0;
      state.status = input.decision; state.reason = input.reasonCode; state.decidedAt = now; return 1;
    },
    async insertUnit(_, donationId, groupId, expiryDate, unitStatus) {
      if (options.duplicateInsert) throw Object.assign(new Error('synthetic duplicate'), { code: 'ER_DUP_ENTRY' });
      state.unit = { bloodUnitId: '17', donationId, bloodGroupId: groupId, expiryDate, unitStatus };
      return '17';
    },
    list: async () => ({ units: [], pagination: { page: 1, pageSize: 20, total: 0 } }),
    detail: async () => ({ bloodUnitId: '17' }),
  };
  const service = createReleaseService({ repository, clock: () => options.now ?? instant,
    operationId: () => '00000000-0000-4000-8000-000000000001',
    auditWriter: { async write(_, event) {
      if (options.auditFailure && state.events.length === 1) throw new Error('synthetic audit failure');
      state.events.push(event);
    } } });
  return { service, state };
}

test('strict release allowlist and inventory filters', () => {
  assert.deepEqual(releaseInput(approved), { decision: 'APPROVED', groupId: '3', reasonCode: 'STAFF_RELEASE_APPROVED' });
  assert.deepEqual(releaseInput(rejected), { decision: 'REJECTED', groupId: null, reasonCode: 'TESTING_NOT_APPROVED' });
  for (const body of [{ ...approved, decidedAt: '2026-10-29' }, { ...approved, reasonCode: 'x' },
    { decision: 'APPROVED' }, { ...rejected, confirmedBloodGroupId: '3' }, { decision: 'REJECTED', reasonCode: 'MEDICAL_DATA' },
    { decision: 'APPROVED', confirmedBloodGroupId: 3 }]) assert.throws(() => releaseInput(body), code('VALIDATION_ERROR'));
  assert.equal(inventoryQuery({ availableOnly: 'true', page: '2' }).page, 2);
  assert.throws(() => inventoryQuery({ availableOnly: 'true', unitStatus: 'EXPIRED' }), code('VALIDATION_ERROR'));
});

test('approval creates one unit and two linked audit events; exact replay does not write again', async () => {
  const f = fixture();
  const result = await f.service.decide('8', '1', approved, auth);
  assert.equal(result.unit.expiryDate, '2026-12-09');
  assert.equal(result.unit.unitStatus, 'AVAILABLE');
  assert.equal(result.reasonCode, 'STAFF_RELEASE_APPROVED');
  assert.deepEqual(f.state.events.map(event => event.actionCode), ['DONATION_RELEASE_DECIDED', 'BLOOD_UNIT_CREATED']);
  assert.equal(f.state.events[0].operationId, f.state.events[1].operationId);
  assert.equal((await f.service.decide('8', '1', approved, auth)).replayed, true);
  assert.equal(f.state.events.length, 2);
  await assert.rejects(f.service.decide('8', '1', { ...approved, confirmedBloodGroupId: '4' }, auth), code('RELEASE_CONFLICT'));
  await assert.rejects(f.service.decide('8', '1', rejected, auth), code('RELEASE_CONFLICT'));
});

test('rejection creates no unit; identical reason replay is idempotent', async () => {
  const f = fixture();
  const result = await f.service.decide('8', '1', rejected, auth);
  assert.equal(result.unit, null); assert.equal(f.state.events.length, 1);
  assert.equal((await f.service.decide('8', '1', rejected, auth)).replayed, true);
  assert.equal(f.state.events.length, 1);
  await assert.rejects(f.service.decide('8', '1', { ...rejected, reasonCode: 'PROCESSING_ISSUE' }, auth), code('RELEASE_CONFLICT'));
});

test('profile mismatch, inactive/missing group, non-collected, stale SID and duplicate insert make no durable writes', async () => {
  for (const options of [{ profileGroup: '4' }, { groupInactive: true }, { groupMissing: true },
    { outcome: 'INCOMPLETE' }, { expireDuringGroupWait: true }, { duplicateInsert: true }, { affectedRows: 0 },
    { auditFailure: true }]) {
    const f = fixture(options);
    await assert.rejects(f.service.decide('8', '1', approved, auth), code(options.expireDuringGroupWait ? 'ACCOUNT_UNAVAILABLE'
      : options.auditFailure ? 'DATABASE_UNAVAILABLE' : 'RELEASE_CONFLICT'));
    assert.equal(f.state.status, 'PENDING'); assert.equal(f.state.unit, null); assert.equal(f.state.events.length, 0);
  }
});

test('expiry on current IST date creates EXPIRED unit; prior date remains AVAILABLE', async () => {
  const onDate = fixture({ collectedAt: '2026-09-17 09:00:00' });
  assert.equal((await onDate.service.decide('8', '1', approved, auth)).unit.unitStatus, 'EXPIRED');
  const before = fixture({ collectedAt: '2026-09-18 09:00:00' });
  assert.equal((await before.service.decide('8', '1', approved, auth)).unit.unitStatus, 'AVAILABLE');
});

function lifecycleFixture({ rows = [], unit = null, auditFailure = false, expireSidAfterLocks = false, competingChange = false } = {}) {
  const state = { rows: structuredClone(rows), unit: structuredClone(unit), events: [] };
  const stored = { ...testSessionRow(auth) };
  const repository = {
    async lifecycleTransaction(actorId, work) {
      assert.equal(actorId, '1'); const before = structuredClone(state);
      const connection = { execute: async sql => { assert.match(sql, /app_session/u); return [[stored]]; } };
      const accounts = new Map([['1', { accountId: '1', role: 'ADMIN', accountStatus: 'ACTIVE' }]]);
      try { return await work(connection, accounts); } catch (error) { Object.assign(state, before); throw error; }
    },
    async lockDueUnits() { if (expireSidAfterLocks) stored.expires_at = Date.now() - 1; return state.rows; },
    async lockLifecycleUnit() { if (expireSidAfterLocks) stored.expires_at = Date.now() - 1; return state.unit; },
    async expireUnit(_connection, id, today, at) {
      if (competingChange) return 0;
      const row = state.rows.find(item => item.bloodUnitId === id);
      if (!row || row.unitStatus !== 'AVAILABLE' || row.expiryDate > today) return 0;
      row.unitStatus = 'EXPIRED'; row.expiredAt = at; return 1;
    },
    async discardUnit(_connection, id, reasonCode, at, today) {
      if (competingChange) return 0;
      const row = state.unit;
      if (!row || row.bloodUnitId !== id || row.unitStatus !== 'AVAILABLE' || row.expiryDate <= today) return 0;
      Object.assign(row, { unitStatus: 'DISCARDED', discardedAt: at, discardReasonCode: reasonCode }); return 1;
    },
  };
  const service = createReleaseService({ repository, clock: () => instant, operationId: () => '00000000-0000-4000-8000-000000000001',
    auditWriter: { async write(_connection, event) { if (auditFailure) throw new Error('private synthetic failure'); state.events.push(event); } } });
  return { service, state };
}

test('expiry reconciliation expires due AVAILABLE rows once and is safe to repeat', async () => {
  const f = lifecycleFixture({ rows: [
    { bloodUnitId: '1', unitStatus: 'AVAILABLE', expiryDate: '2026-10-29' },
    { bloodUnitId: '2', unitStatus: 'AVAILABLE', expiryDate: '2026-10-30' },
    { bloodUnitId: '3', unitStatus: 'ISSUED', expiryDate: '2026-10-01' },
  ] });
  const first = await f.service.reconcileExpiry('1', {}, auth);
  assert.equal(first.expiredCount, 1); assert.equal(f.state.rows[0].unitStatus, 'EXPIRED');
  assert.equal(f.state.rows[1].unitStatus, 'AVAILABLE'); assert.equal(f.state.rows[2].unitStatus, 'ISSUED');
  assert.deepEqual(f.state.events.map(event => [event.actionCode, event.reasonCode]), [['BLOOD_UNIT_EXPIRED', 'EXPIRY_RECONCILIATION']]);
  assert.equal((await f.service.reconcileExpiry('1', {}, auth)).expiredCount, 0);
  assert.equal(f.state.events.length, 1);
});

test('due allocated units conflict atomically; issued units are never changed', async () => {
  for (const status of ['ALLOCATED']) {
    const rows = [{ bloodUnitId: '1', unitStatus: status, expiryDate: '2026-10-01' },
      { bloodUnitId: '2', unitStatus: 'AVAILABLE', expiryDate: '2026-10-01' }];
    const f = lifecycleFixture({ rows });
    await assert.rejects(f.service.reconcileExpiry('1', {}, auth), code('ALLOCATION_COORDINATION_REQUIRED'));
  }
  const f = lifecycleFixture({ rows: [{ bloodUnitId: '1', unitStatus: 'ISSUED', expiryDate: '2026-10-01' }] });
  assert.equal((await f.service.reconcileExpiry('1', {}, auth)).expiredCount, 0);
  assert.equal(f.state.rows[0].unitStatus, 'ISSUED');
});

test('discard is limited to unexpired AVAILABLE units and audits atomically', async () => {
  for (const status of ['ALLOCATED', 'ISSUED', 'EXPIRED', 'DISCARDED']) {
    const f = lifecycleFixture({ unit: { bloodUnitId: '9', unitStatus: status, expiryDate: '2026-12-01' } });
    await assert.rejects(f.service.discardUnit('1', '9', { reasonCode: 'DAMAGED' }, auth), code(status === 'ALLOCATED' ? 'ALLOCATION_COORDINATION_REQUIRED' : 'UNIT_STATUS_CONFLICT'));
    assert.equal(f.state.events.length, 0);
  }
  const due = lifecycleFixture({ unit: { bloodUnitId: '9', unitStatus: 'AVAILABLE', expiryDate: '2026-10-29' } });
  await assert.rejects(due.service.discardUnit('1', '9', { reasonCode: 'DAMAGED' }, auth), code('UNIT_EXPIRY_DUE'));
  const good = lifecycleFixture({ unit: { bloodUnitId: '9', unitStatus: 'AVAILABLE', expiryDate: '2026-12-01' } });
  const result = await good.service.discardUnit('1', '9', { reasonCode: 'DAMAGED' }, auth);
  assert.equal(result.unitStatus, 'DISCARDED'); assert.equal(good.state.unit.discardReasonCode, 'DAMAGED');
  assert.equal(good.state.events[0].actionCode, 'BLOOD_UNIT_DISCARDED');
  const rollback = lifecycleFixture({ unit: { bloodUnitId: '9', unitStatus: 'AVAILABLE', expiryDate: '2026-12-01' }, auditFailure: true });
  await assert.rejects(rollback.service.discardUnit('1', '9', { reasonCode: 'DAMAGED' }, auth), code('DATABASE_UNAVAILABLE'));
  assert.equal(rollback.state.unit.unitStatus, 'AVAILABLE');
});

test('Admin SID expiry after inventory domain locks rejects without writes', async () => {
  const expiry = lifecycleFixture({ rows: [{ bloodUnitId: '1', unitStatus: 'AVAILABLE', expiryDate: '2026-10-01' }], expireSidAfterLocks: true });
  await assert.rejects(expiry.service.reconcileExpiry('1', {}, auth), code('ACCOUNT_UNAVAILABLE'));
  assert.equal(expiry.state.rows[0].unitStatus, 'AVAILABLE'); assert.equal(expiry.state.events.length, 0);
  const discard = lifecycleFixture({ unit: { bloodUnitId: '9', unitStatus: 'AVAILABLE', expiryDate: '2026-12-01' }, expireSidAfterLocks: true });
  await assert.rejects(discard.service.discardUnit('1', '9', { reasonCode: 'DAMAGED' }, auth), code('ACCOUNT_UNAVAILABLE'));
  assert.equal(discard.state.unit.unitStatus, 'AVAILABLE'); assert.equal(discard.state.events.length, 0);
});

test('conditional lifecycle updates detect competing transitions and audit failure rolls back expiry', async () => {
  const today = lifecycleFixture({ rows: [{ bloodUnitId: '1', unitStatus: 'AVAILABLE', expiryDate: '2026-10-01' }], competingChange: true });
  await assert.rejects(today.service.reconcileExpiry('1', {}, auth), code('RELEASE_CONFLICT'));
  assert.equal(today.state.events.length, 0); assert.equal(today.state.rows[0].unitStatus, 'AVAILABLE');
  const discard = lifecycleFixture({ unit: { bloodUnitId: '9', unitStatus: 'AVAILABLE', expiryDate: '2026-12-01' }, competingChange: true });
  await assert.rejects(discard.service.discardUnit('1', '9', { reasonCode: 'DAMAGED' }, auth), code('RELEASE_CONFLICT'));
  assert.equal(discard.state.events.length, 0);
  const audit = lifecycleFixture({ rows: [{ bloodUnitId: '1', unitStatus: 'AVAILABLE', expiryDate: '2026-10-01' }], auditFailure: true });
  await assert.rejects(audit.service.reconcileExpiry('1', {}, auth), code('DATABASE_UNAVAILABLE'));
  assert.equal(audit.state.rows[0].unitStatus, 'AVAILABLE'); assert.equal(audit.state.events.length, 0);
});
