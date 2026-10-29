import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createBookingService } from '../src/modules/booking/service.js';
import { withAccountLocks } from '../src/modules/accounts/transaction.js';
import { testAuthorization, testSessionRow } from './helpers/session-context.mjs';

const later = '2026-11-01T10:00:00+05:30';
const end = '2026-11-01T11:00:00+05:30';
const clock = () => Date.parse('2026-10-27T00:00:00Z');
function fixture({ capacity = 1, history = { lastCollectedDate: null, decision: null }, bookings = [],
  windows = {}, onLockSlot = () => {}, slotOverride = {}, donorStatus = 'ACTIVE', donorRole = 'DONOR', hasDonation = false, latestDecision = null,
  missingDonorAccount = false, currentTime = clock() } = {}) {
  const records = [...bookings];
  const slot = { slotId: '40', startsAt: later, endsAt: end, capacity, slotStatus: 'OPEN', ...slotOverride };
  let now = currentTime; let currentDonorStatus = donorStatus;
  const writes = []; const events = [];
  const authorizations = new Map([['10', testAuthorization('10', 'DONOR', 'ACTIVE')],
    ['11', testAuthorization('11', 'DONOR', 'ACTIVE')], ['1', testAuthorization('1', 'ADMIN', 'ACTIVE')]]);
  const connection = { async execute(sql, params) {
    assert.match(sql, /FROM app_session/u);
    assert.equal(params.length, 1);
    const account = [...authorizations.values()].find(item => item.sessionId === params[0]);
    return [account ? [testSessionRow(account)] : []];
  } };
  let chain = Promise.resolve();
  const repository = {
    transaction(actorId, work, targetAccountIds = []) {
      const prior = chain;
      let release;
      chain = new Promise(resolve => { release = resolve; });
      return prior.then(async () => {
        try { return await work(connection, new Map([...new Set([actorId, ...targetAccountIds])].map(id => [id,
          id === '10' && missingDonorAccount ? null : { accountId: id,
            role: id === '1' ? 'ADMIN' : id === '10' ? donorRole : 'DONOR', accountStatus: id === '10' ? currentDonorStatus : 'ACTIVE' }]))); }
        finally { release(); }
      });
    },
    async donorExists() { return true; },
    async history() { return history; },
    async lockSlot(_, slotId) { await onLockSlot(() => { now = Date.parse(later); }); return slotId === '40' ? { ...slot } : null; },
    async slotBookings(_, slotId) { return records.filter(row => row.slotId === slotId).map(row => ({ ...row })); },
    async donorActiveBookings(_, id) { return records.filter(row => row.donorAccountId === id && row.bookingStatus === 'BOOKED').map(row =>
      ({ slotId: row.slotId, ...(windows[row.slotId] ?? { startsAt: later, endsAt: end }) })); },
    async insertBooking(_, donorId, slotId) {
      if (records.some(row => row.donorAccountId === donorId && row.slotId === slotId)) throw Object.assign(new Error('duplicate'), { code: 'ER_DUP_ENTRY' });
      const bookingId = String(records.length + 1);
      records.push({ bookingId, donorAccountId: donorId, slotId, bookingStatus: 'BOOKED' }); writes.push('booking');
      return bookingId;
    },
    async insertSlot() { return '41'; },
    async updateSlot(_, __, patch) { slot.slotStatus = patch.status ?? slot.slotStatus; slot.capacity = patch.capacity ?? slot.capacity; writes.push('slot'); return 1; },
    async updateBooking(_, id, status, reason) { const row = records.find(item => item.bookingId === id); if (!row || row.bookingStatus !== 'BOOKED') return 0; row.bookingStatus = status; row.cancellationReason = reason; writes.push('cancel'); return 1; },
    async bookingSlotId(_, id, donor) { return records.find(row => row.bookingId === id && row.donorAccountId === donor)?.slotId ?? null; },
    async lockBooking(_, id, donor) { return records.find(row => row.bookingId === id && row.donorAccountId === donor) ?? null; },
    async bookingOwnerHint(id) { const row = records.find(value => value.bookingId === id); return row && { donorAccountId: row.donorAccountId, slotId: row.slotId }; },
    async lockAdminBooking(_, id) { const row = records.find(value => value.bookingId === id); return row && { ...row }; },
    async bookingHasDonation() { return hasDonation; },
    async latestBookingDecision() { return latestDecision; },
    async insertEligibilityDecision(_, donorId, bookingId, actorId, decision, reasonCode, deferredUntil) {
      const row = { eligibilityDecisionId: String(events.length + 1), donorId, bookingId, actorId, decision, reasonCode, deferredUntil };
      writes.push('eligibility'); return row.eligibilityDecisionId;
    },
  };
  const service = createBookingService({ repository, clock: () => now, operationId: () => '00000000-0000-4000-8000-000000000001',
    auditWriter: { async write(_, event) { events.push(event); return '1'; } } });
  return { service, repository, slot, records, writes, events, authorizations,
    setDonorStatus(value) { currentDonorStatus = value; } };
}
const safe = code => error => { assert.equal(error.code, code); assert.doesNotMatch(String(error), /duplicate|session_data/u); return true; };

test('capacity-one contenders serialize and only one booking succeeds', async () => {
  const f = fixture();
  const results = await Promise.allSettled(['10', '11'].map(id => f.service.createBooking(id, { slotId: '40' }, f.authorizations.get(id))));
  assert.deepEqual(results.map(item => item.status), ['fulfilled', 'rejected']);
  assert.equal(results[1].reason.code, 'SLOT_CONFLICT');
  assert.equal(f.records.length, 1); assert.equal(f.events.length, 1);
  assert.equal(f.events[0].actionCode, 'BOOKING_CREATED');
});

test('same donor cannot rebook a cancelled slot; profile and client owner are not accepted', async () => {
  const f = fixture({ bookings: [{ bookingId: '1', donorAccountId: '10', slotId: '40', bookingStatus: 'CANCELLED_BY_DONOR' }] });
  await assert.rejects(f.service.createBooking('10', { slotId: '40' }, f.authorizations.get('10')), safe('BOOKING_CONFLICT'));
  await assert.rejects(f.service.createBooking('10', { slotId: '40', donorAccountId: '11' }, f.authorizations.get('10')), safe('VALIDATION_ERROR'));
  assert.equal(f.events.length, 0);
});

test('a revoked or missing stored SID cannot authorize a booking mutation', async () => {
  const f = fixture();
  const authorization = { ...f.authorizations.get('10'), sessionId: 'revoked-sid' };
  await assert.rejects(f.service.createBooking('10', { slotId: '40' }, authorization), safe('ACCOUNT_UNAVAILABLE'));
  assert.deepEqual(f.writes, []); assert.deepEqual(f.events, []);
});

test('staff review and 55-day history block booking; collection release is not used', async () => {
  for (const history of [{ lastCollectedDate: null, decision: { decision: 'REVIEW_REQUIRED' } },
    { lastCollectedDate: '2026-09-07', decision: { decision: 'ACCEPTED' } }]) {
    const f = fixture({ history });
    await assert.rejects(f.service.createBooking('10', { slotId: '40' }, f.authorizations.get('10')), safe('DONOR_NOT_ELIGIBLE'));
    assert.equal(f.writes.length, 0);
  }
});

test('capacity reduction and checked-in slot cancellation refuse before writes or audit', async () => {
  const f = fixture({ capacity: 2, bookings: [{ bookingId: '1', donorAccountId: '10', slotId: '40', bookingStatus: 'CHECKED_IN' },
    { bookingId: '2', donorAccountId: '11', slotId: '40', bookingStatus: 'BOOKED' }] });
  await assert.rejects(f.service.updateSlot('1', '40', { capacity: 1 }, f.authorizations.get('1')), safe('CAPACITY_OCCUPIED'));
  await assert.rejects(f.service.updateSlot('1', '40', { slotStatus: 'CANCELLED', reason: 'STAFF_CANCELLED' }, f.authorizations.get('1')), safe('CHECKED_IN_BOOKINGS'));
  await assert.rejects(f.service.updateSlot('1', '40', { startsAt: '2026-11-02T10:00:00+05:30' }, f.authorizations.get('1')), safe('SLOT_CONFLICT'));
  assert.deepEqual(f.writes, []); assert.deepEqual(f.events, []);
});

test('slot cancellation cancels only BOOKED rows with controlled audit records', async () => {
  const f = fixture({ capacity: 2, bookings: [{ bookingId: '1', donorAccountId: '10', slotId: '40', bookingStatus: 'BOOKED' },
    { bookingId: '2', donorAccountId: '11', slotId: '40', bookingStatus: 'CANCELLED_BY_DONOR' }] });
  const result = await f.service.updateSlot('1', '40', { slotStatus: 'CANCELLED', reason: 'STAFF_CANCELLED' }, f.authorizations.get('1'));
  assert.equal(result.slotStatus, 'CANCELLED'); assert.equal(f.records[0].bookingStatus, 'CANCELLED_BY_STAFF');
  assert.equal(f.records[1].bookingStatus, 'CANCELLED_BY_DONOR');
  assert.deepEqual(f.events.map(event => event.actionCode), ['BOOKING_CANCELLED_BY_STAFF', 'DONATION_SLOT_CANCELLED']);
  await assert.rejects(f.service.updateSlot('1', '40', { capacity: 3 }, f.authorizations.get('1')), safe('SLOT_CONFLICT'));
});

test('own cancellation preserves history and refuses repeats', async () => {
  const f = fixture({ bookings: [{ bookingId: '1', donorAccountId: '10', slotId: '40', bookingStatus: 'BOOKED' }] });
  const first = await f.service.cancelBooking('10', '1', { reasonCode: 'DONOR_REQUESTED' }, f.authorizations.get('10'));
  assert.equal(first.bookingStatus, 'CANCELLED_BY_DONOR');
  assert.equal(f.events[0].reasonCode, 'DONOR_REQUESTED');
  await assert.rejects(f.service.cancelBooking('10', '1', {}, f.authorizations.get('10')), safe('BOOKING_CONFLICT'));
  assert.equal(f.events.length, 1);
});

test('same donor cannot book overlapping slots, while adjacent windows remain available', async () => {
  const row = { bookingId: '1', donorAccountId: '10', slotId: '41', bookingStatus: 'BOOKED' };
  const overlap = fixture({ bookings: [row], windows: { 41: { startsAt: '2026-11-01T09:30:00+05:30',
    endsAt: '2026-11-01T10:30:00+05:30' } } });
  await assert.rejects(overlap.service.createBooking('10', { slotId: '40' }, overlap.authorizations.get('10')), safe('BOOKING_CONFLICT'));
  assert.equal(overlap.writes.length, 0);
  const adjacent = fixture({ bookings: [{ ...row }], windows: { 41: { startsAt: '2026-11-01T09:00:00+05:30',
    endsAt: '2026-11-01T10:00:00+05:30' } } });
  const result = await adjacent.service.createBooking('10', { slotId: '40' }, adjacent.authorizations.get('10'));
  assert.equal(result.bookingStatus, 'BOOKED');
  assert.equal(adjacent.records.length, 2);
});

test('a future slot cannot be booked, cancelled, or edited after time advances during its lock wait', async () => {
  const onLockSlot = advance => advance();
  const book = fixture({ onLockSlot });
  await assert.rejects(book.service.createBooking('10', { slotId: '40' }, book.authorizations.get('10')), safe('SLOT_CONFLICT'));
  const cancel = fixture({ onLockSlot, bookings: [{ bookingId: '1', donorAccountId: '10', slotId: '40', bookingStatus: 'BOOKED' }] });
  await assert.rejects(cancel.service.cancelBooking('10', '1', {}, cancel.authorizations.get('10')), safe('BOOKING_CONFLICT'));
  const edit = fixture({ onLockSlot });
  await assert.rejects(edit.service.updateSlot('1', '40', { capacity: 2 }, edit.authorizations.get('1')), safe('SLOT_CONFLICT'));
  for (const f of [book, cancel, edit]) { assert.equal(f.writes.length, 0); assert.equal(f.events.length, 0); }
});

test('staff check-in uses active donor, current appointment interval and fixed audit mapping', async () => {
  const today = { startsAt: '2026-10-27T10:00:00+05:30', endsAt: '2026-10-27T11:00:00+05:30' };
  const f = fixture({ slotOverride: { ...today, slotStatus: 'CLOSED' }, bookings: [
    { bookingId: '1', donorAccountId: '10', slotId: '40', bookingStatus: 'BOOKED' }], currentTime: Date.parse('2026-10-27T04:30:00Z') });
  const result = await f.service.checkIn('1', '1', { bookingStatus: 'CHECKED_IN', reason: 'STAFF_CHECKED_IN' }, f.authorizations.get('1'));
  assert.equal(result.bookingStatus, 'CHECKED_IN'); assert.equal(f.records[0].bookingStatus, 'CHECKED_IN');
  assert.deepEqual(f.events.map(event => [event.actionCode, event.reasonCode]), [['BOOKING_CHECKED_IN', 'STAFF_CHECKED_IN']]);
  assert.deepEqual(f.writes, ['cancel']);
  const inactive = fixture({ donorStatus: 'SUSPENDED', slotOverride: today, bookings: [
    { bookingId: '1', donorAccountId: '10', slotId: '40', bookingStatus: 'BOOKED' }] });
  await assert.rejects(inactive.service.checkIn('1', '1', { bookingStatus: 'CHECKED_IN', reason: 'STAFF_CHECKED_IN' }, inactive.authorizations.get('1')), safe('DONOR_UNAVAILABLE'));
  assert.deepEqual(inactive.writes, []);
  const wrongTargetRole = fixture({ donorRole: 'HOSPITAL', slotOverride: today, bookings: [
    { bookingId: '1', donorAccountId: '10', slotId: '40', bookingStatus: 'BOOKED' }] });
  await assert.rejects(wrongTargetRole.service.checkIn('1', '1', { bookingStatus: 'CHECKED_IN', reason: 'STAFF_CHECKED_IN' }, wrongTargetRole.authorizations.get('1')), safe('DONOR_NOT_FOUND'));
  assert.deepEqual(wrongTargetRole.writes, []);
});

test('individual staff cancellation and no-show use narrow BOOKED-only time windows and fixed audit mappings', async () => {
  const appointment = { startsAt: '2026-10-27T10:00:00+05:30', endsAt: '2026-10-27T11:00:00+05:30' };
  const run = (bookingStatus, reason, currentTime) => {
    const f = fixture({ slotOverride: appointment, currentTime, bookings: [
      { bookingId: '1', donorAccountId: '10', slotId: '40', bookingStatus: 'BOOKED' }] });
    return { f, pending: f.service.updateAdminBookingStatus('1', '1', { bookingStatus, reason }, f.authorizations.get('1')) };
  };
  const cancelled = run('CANCELLED_BY_STAFF', 'STAFF_CANCELLED', Date.parse('2026-10-27T04:29:59Z'));
  const cancelResult = await cancelled.pending;
  assert.equal(cancelResult.bookingStatus, 'CANCELLED_BY_STAFF');
  assert.equal(cancelled.f.records[0].cancellationReason, 'STAFF_CANCELLED');
  assert.deepEqual(cancelled.f.events.map(e => [e.actionCode, e.reasonCode]), [['BOOKING_CANCELLED_BY_STAFF', 'STAFF_CANCELLED']]);
  const noShow = run('NO_SHOW', 'STAFF_NO_SHOW', Date.parse('2026-10-27T05:30:00Z'));
  const noShowResult = await noShow.pending;
  assert.equal(noShowResult.bookingStatus, 'NO_SHOW');
  assert.equal(noShow.f.records[0].cancellationReason, null);
  assert.deepEqual(noShow.f.events.map(e => [e.actionCode, e.reasonCode]), [['BOOKING_MARKED_NO_SHOW', 'STAFF_NO_SHOW']]);

  for (const [status, reason, time, hasDonation, slotStatus] of [
    ['CANCELLED_BY_STAFF', 'STAFF_CANCELLED', Date.parse('2026-10-27T04:30:00Z'), false, 'OPEN'],
    ['CANCELLED_BY_STAFF', 'STAFF_CANCELLED', Date.parse('2026-10-27T04:00:00Z'), false, 'CANCELLED'],
    ['CANCELLED_BY_STAFF', 'STAFF_CANCELLED', Date.parse('2026-10-27T04:00:00Z'), true, 'OPEN'],
    ['NO_SHOW', 'STAFF_NO_SHOW', Date.parse('2026-10-27T05:29:59Z'), false, 'OPEN'],
    ['NO_SHOW', 'STAFF_NO_SHOW', Date.parse('2026-10-27T05:30:00Z'), true, 'OPEN'],
  ]) {
    const f = fixture({ slotOverride: { ...appointment, slotStatus }, currentTime: time, hasDonation, bookings: [
      { bookingId: '1', donorAccountId: '10', slotId: '40', bookingStatus: 'BOOKED' }] });
    await assert.rejects(f.service.updateAdminBookingStatus('1', '1', { bookingStatus: status, reason }, f.authorizations.get('1')), safe('BOOKING_CONFLICT'));
    assert.deepEqual(f.writes, []); assert.deepEqual(f.events, []);
  }
  for (const status of ['CHECKED_IN', 'COMPLETED', 'CANCELLED_BY_DONOR', 'CANCELLED_BY_STAFF', 'NO_SHOW']) {
    const f = fixture({ slotOverride: appointment, currentTime: Date.parse('2026-10-27T05:30:00Z'), bookings: [
      { bookingId: '1', donorAccountId: '10', slotId: '40', bookingStatus: status }] });
    await assert.rejects(f.service.updateAdminBookingStatus('1', '1', { bookingStatus: 'NO_SHOW', reason: 'STAFF_NO_SHOW' }, f.authorizations.get('1')), safe('BOOKING_CONFLICT'));
    assert.deepEqual(f.writes, []); assert.deepEqual(f.events, []);
  }
  const invalid = fixture({ slotOverride: appointment, bookings: [{ bookingId: '1', donorAccountId: '10', slotId: '40', bookingStatus: 'BOOKED' }] });
  await assert.rejects(invalid.service.updateAdminBookingStatus('1', '1', { bookingStatus: 'NO_SHOW', reason: 'free text' }, invalid.authorizations.get('1')), safe('VALIDATION_ERROR'));
  assert.deepEqual(invalid.writes, []); assert.deepEqual(invalid.events, []);

  const suspended = fixture({ donorStatus: 'SUSPENDED', slotOverride: appointment,
    currentTime: Date.parse('2026-10-27T04:00:00Z'), bookings: [{ bookingId: '1', donorAccountId: '10', slotId: '40', bookingStatus: 'BOOKED' }] });
  await assert.rejects(suspended.service.updateAdminBookingStatus('1', '1', { bookingStatus: 'CANCELLED_BY_STAFF', reason: 'STAFF_CANCELLED' }, suspended.authorizations.get('1')), safe('DONOR_UNAVAILABLE'));
  assert.deepEqual(suspended.writes, []); assert.deepEqual(suspended.events, []);

  const competing = fixture({ slotOverride: appointment, currentTime: Date.parse('2026-10-27T04:00:00Z'), bookings: [
    { bookingId: '1', donorAccountId: '10', slotId: '40', bookingStatus: 'BOOKED' }] });
  const results = await Promise.allSettled([1, 2].map(() => competing.service.updateAdminBookingStatus('1', '1',
    { bookingStatus: 'CANCELLED_BY_STAFF', reason: 'STAFF_CANCELLED' }, competing.authorizations.get('1'))));
  assert.deepEqual(results.map(result => result.status), ['fulfilled', 'rejected']);
  assert.equal(results[1].reason.code, 'BOOKING_CONFLICT');
  assert.equal(competing.events.length, 1);
  assert.equal(competing.records[0].bookingStatus, 'CANCELLED_BY_STAFF');
});

test('target Donor state rejection is separate from Admin authentication for both staff actions', async () => {
  const today = { startsAt: '2026-10-27T10:00:00+05:30', endsAt: '2026-10-27T11:00:00+05:30' };
  const cases = [
    { name: 'check-in', status: 'BOOKED', run: f => f.service.checkIn('1', '1',
      { bookingStatus: 'CHECKED_IN', reason: 'STAFF_CHECKED_IN' }, f.authorizations.get('1')) },
    { name: 'decision', status: 'CHECKED_IN', run: f => f.service.recordEligibilityDecision('1', '10',
      { bookingId: '1', decision: 'REVIEW_REQUIRED' }, f.authorizations.get('1')) },
  ];
  for (const item of cases) {
    const f = fixture({ donorStatus: 'SUSPENDED', slotOverride: today, currentTime: Date.parse('2026-10-27T05:00:00Z'), bookings: [
      { bookingId: '1', donorAccountId: '10', slotId: '40', bookingStatus: item.status }] });
    await assert.rejects(item.run(f), safe('DONOR_UNAVAILABLE'));
    assert.deepEqual(f.writes, [], `${item.name}: no domain writes`);
    assert.deepEqual(f.events, [], `${item.name}: no audit writes`);

    // The same stored Admin SID remains valid after a target-state conflict.
    f.setDonorStatus('ACTIVE');
    await item.run(f);
    assert.equal(f.events.length, 1, `${item.name}: the same Admin can proceed after target becomes active`);

    const revoked = { ...f.authorizations.get('1'), sessionId: 'revoked-admin-sid' };
    await assert.rejects(item.run({ ...f, authorizations: new Map([...f.authorizations, ['1', revoked]]) }), safe('ACCOUNT_UNAVAILABLE'));
  }
  for (const item of cases) {
    for (const options of [{ donorRole: 'HOSPITAL' }, { missingDonorAccount: true }]) {
      const f = fixture({ ...options, slotOverride: today, currentTime: Date.parse('2026-10-27T05:00:00Z'), bookings: [
        { bookingId: '1', donorAccountId: '10', slotId: '40', bookingStatus: item.status }] });
      await assert.rejects(item.run(f), safe('DONOR_NOT_FOUND'));
      assert.deepEqual(f.writes, [], `${item.name}: absent/wrong-role target has no domain writes`);
      assert.deepEqual(f.events, [], `${item.name}: absent/wrong-role target has no audit writes`);
    }
  }
});

test('check-in rejects exact start/end boundary violations, cancelled slots, stale status and unsupported actions', async () => {
  const appointment = { startsAt: '2026-10-27T10:00:00+05:30', endsAt: '2026-10-27T11:00:00+05:30' };
  for (const [now, status, slotStatus, body, code] of [
    [Date.parse('2026-10-27T04:29:59Z'), 'BOOKED', 'OPEN', { bookingStatus: 'CHECKED_IN', reason: 'STAFF_CHECKED_IN' }, 'BOOKING_CONFLICT'],
    [Date.parse('2026-10-27T06:30:00Z'), 'BOOKED', 'OPEN', { bookingStatus: 'CHECKED_IN', reason: 'STAFF_CHECKED_IN' }, 'BOOKING_CONFLICT'],
    [Date.parse('2026-10-27T05:30:00Z'), 'BOOKED', 'OPEN', { bookingStatus: 'CHECKED_IN', reason: 'STAFF_CHECKED_IN' }, 'BOOKING_CONFLICT'],
    [clock(), 'BOOKED', 'CANCELLED', { bookingStatus: 'CHECKED_IN', reason: 'STAFF_CHECKED_IN' }, 'BOOKING_CONFLICT'],
    [clock(), 'CHECKED_IN', 'OPEN', { bookingStatus: 'CHECKED_IN', reason: 'STAFF_CHECKED_IN' }, 'BOOKING_CONFLICT'],
    [clock(), 'BOOKED', 'OPEN', { bookingStatus: 'NO_SHOW', reason: 'STAFF_CHECKED_IN' }, 'VALIDATION_ERROR'],
  ]) {
    const f = fixture({ slotOverride: { ...appointment, slotStatus }, bookings: [{ bookingId: '1', donorAccountId: '10', slotId: '40', bookingStatus: status }] });
    f.service = createBookingService({ repository: f.repository, clock: () => now, auditWriter: { async write(_, event) { f.events.push(event); } } });
    await assert.rejects(f.service.checkIn('1', '1', body, f.authorizations.get('1')), safe(code));
    assert.deepEqual(f.events, []); assert.deepEqual(f.writes, []);
  }
});

test('day-of decisions append fixed mapped history and enforce ownership, appointment day, Donation and latest duplicate', async () => {
  const todaySlot = { startsAt: '2026-10-27T10:00:00+05:30', endsAt: '2026-10-27T11:00:00+05:30' };
  for (const [decision, extra, reason] of [['ACCEPTED', {}, 'STAFF_ACCEPTED'],
    ['TEMPORARILY_DEFERRED', { deferredUntil: '2026-10-27' }, 'STAFF_TEMPORARY_DEFERRAL'],
    ['REVIEW_REQUIRED', {}, 'STAFF_REVIEW_REQUIRED']]) {
    const f = fixture({ slotOverride: todaySlot, bookings: [{ bookingId: '1', donorAccountId: '10', slotId: '40', bookingStatus: 'CHECKED_IN' }] });
    const result = await f.service.recordEligibilityDecision('1', '10', { bookingId: '1', decision, ...extra }, f.authorizations.get('1'));
    assert.equal(result.reasonCode, reason); assert.equal(result.decision, decision);
    assert.match(result.eligibilityDecisionId, /^[1-9][0-9]*$/u);
    assert.deepEqual(f.events.map(event => [event.actionCode, event.reasonCode]), [['ELIGIBILITY_DECISION_RECORDED', reason]]);
    assert.deepEqual(f.writes, ['eligibility']);
  }
  const wrongOwner = fixture({ bookings: [{ bookingId: '1', donorAccountId: '11', slotId: '40', bookingStatus: 'CHECKED_IN' }] });
  await assert.rejects(wrongOwner.service.recordEligibilityDecision('1', '10', { bookingId: '1', decision: 'ACCEPTED' }, wrongOwner.authorizations.get('1')), safe('BOOKING_NOT_FOUND'));
  const donated = fixture({ slotOverride: todaySlot, hasDonation: true, bookings: [{ bookingId: '1', donorAccountId: '10', slotId: '40', bookingStatus: 'CHECKED_IN' }] });
  await assert.rejects(donated.service.recordEligibilityDecision('1', '10', { bookingId: '1', decision: 'ACCEPTED' }, donated.authorizations.get('1')), safe('ELIGIBILITY_DECISION_CONFLICT'));
  const wrongDay = fixture({ slotOverride: { startsAt: '2026-10-28T10:00:00+05:30', endsAt: '2026-10-28T11:00:00+05:30' },
    bookings: [{ bookingId: '1', donorAccountId: '10', slotId: '40', bookingStatus: 'CHECKED_IN' }] });
  await assert.rejects(wrongDay.service.recordEligibilityDecision('1', '10', { bookingId: '1', decision: 'ACCEPTED' }, wrongDay.authorizations.get('1')), safe('ELIGIBILITY_DECISION_CONFLICT'));
  const duplicate = fixture({ slotOverride: todaySlot, latestDecision: { decision: 'REVIEW_REQUIRED', deferredUntil: null }, bookings: [{ bookingId: '1', donorAccountId: '10', slotId: '40', bookingStatus: 'CHECKED_IN' }] });
  await assert.rejects(duplicate.service.recordEligibilityDecision('1', '10', { bookingId: '1', decision: 'REVIEW_REQUIRED' }, duplicate.authorizations.get('1')), safe('ELIGIBILITY_DECISION_CONFLICT'));
  for (const body of [{ bookingId: '1', decision: 'ACCEPTED', deferredUntil: '2026-10-27' },
    { bookingId: '1', decision: 'TEMPORARILY_DEFERRED' }, { bookingId: '1', decision: 'ACCEPTED', safeNote: 'not allowed' }]) {
    const f = fixture(); await assert.rejects(f.service.recordEligibilityDecision('1', '10', body, f.authorizations.get('1')), safe('VALIDATION_ERROR'));
  }
  const pastDeferral = fixture({ slotOverride: todaySlot, bookings: [{ bookingId: '1', donorAccountId: '10', slotId: '40', bookingStatus: 'CHECKED_IN' }] });
  await assert.rejects(pastDeferral.service.recordEligibilityDecision('1', '10',
    { bookingId: '1', decision: 'TEMPORARILY_DEFERRED', deferredUntil: '2026-10-26' }, pastDeferral.authorizations.get('1')), safe('VALIDATION_ERROR'));
});

test('day-of acceptance independently checks the 56-day interval and may supersede review or deferral', async () => {
  const appointment = { startsAt: '2026-10-27T10:00:00+05:30', endsAt: '2026-10-27T11:00:00+05:30' };
  const make = history => fixture({ slotOverride: appointment, history, latestDecision: { decision: 'REVIEW_REQUIRED' },
    bookings: [{ bookingId: '1', donorAccountId: '10', slotId: '40', bookingStatus: 'CHECKED_IN' }] });
  const blocked = make({ lastCollectedDate: '2026-09-02', decision: null });
  await assert.rejects(blocked.service.recordEligibilityDecision('1', '10', { bookingId: '1', decision: 'ACCEPTED' }, blocked.authorizations.get('1')), safe('DONOR_NOT_ELIGIBLE'));
  assert.deepEqual(blocked.writes, []);
  const allowed = make({ lastCollectedDate: '2026-09-01', decision: null });
  await allowed.service.recordEligibilityDecision('1', '10', { bookingId: '1', decision: 'ACCEPTED' }, allowed.authorizations.get('1'));
  assert.deepEqual(allowed.writes, ['eligibility']);
});

test('staff booking and day-of audit failures roll their domain writes back safely', async () => {
  const appointment = { startsAt: '2026-10-27T10:00:00+05:30', endsAt: '2026-10-27T11:00:00+05:30' };
  for (const operation of ['check-in', 'staff-cancel', 'no-show', 'decision']) {
    const currentTime = operation === 'staff-cancel' ? Date.parse('2026-10-27T04:00:00Z')
      : operation === 'no-show' ? Date.parse('2026-10-27T05:30:00Z') : Date.parse('2026-10-27T05:00:00Z');
    const f = fixture({ slotOverride: appointment, bookings: [{ bookingId: '1', donorAccountId: '10', slotId: '40',
      bookingStatus: operation === 'decision' ? 'CHECKED_IN' : 'BOOKED' }], currentTime });
    const transaction = f.repository.transaction.bind(f.repository);
    f.repository.transaction = (actor, work, targets) => {
      const beforeRecords = structuredClone(f.records); const beforeWrites = f.writes.length; const beforeEvents = f.events.length;
      return transaction(actor, work, targets).catch(error => {
        f.records.splice(0, f.records.length, ...beforeRecords); f.writes.length = beforeWrites; f.events.length = beforeEvents;
        throw error;
      });
    };
    f.service = createBookingService({ repository: f.repository, clock: () => currentTime,
      auditWriter: { async write() { throw new Error('Controlled audit failure'); } } });
    if (operation === 'check-in') {
      await assert.rejects(f.service.checkIn('1', '1', { bookingStatus: 'CHECKED_IN', reason: 'STAFF_CHECKED_IN' }, f.authorizations.get('1')), safe('DATABASE_UNAVAILABLE'));
      assert.equal(f.records[0].bookingStatus, 'BOOKED');
    } else if (operation === 'staff-cancel') {
      await assert.rejects(f.service.updateAdminBookingStatus('1', '1', { bookingStatus: 'CANCELLED_BY_STAFF', reason: 'STAFF_CANCELLED' }, f.authorizations.get('1')), safe('DATABASE_UNAVAILABLE'));
      assert.equal(f.records[0].bookingStatus, 'BOOKED');
    } else if (operation === 'no-show') {
      await assert.rejects(f.service.updateAdminBookingStatus('1', '1', { bookingStatus: 'NO_SHOW', reason: 'STAFF_NO_SHOW' }, f.authorizations.get('1')), safe('DATABASE_UNAVAILABLE'));
      assert.equal(f.records[0].bookingStatus, 'BOOKED');
    } else {
      await assert.rejects(f.service.recordEligibilityDecision('1', '10', { bookingId: '1', decision: 'ACCEPTED' }, f.authorizations.get('1')), safe('DATABASE_UNAVAILABLE'));
      assert.deepEqual(f.records[0].bookingStatus, 'CHECKED_IN');
    }
    assert.deepEqual(f.writes, []); assert.deepEqual(f.events, []);
  }
});

test('audit failure rolls back the booking on the caller transaction connection', async () => {
  const auth = testAuthorization('10', 'DONOR', 'ACTIVE');
  const rows = []; const calls = [];
  const connection = {
    async beginTransaction() { calls.push('begin'); },
    async execute(sql, params) {
      if (sql.includes('FROM Account')) return [[{ accountId: '10', role: 'DONOR', accountStatus: 'ACTIVE' }]];
      if (sql.includes('FROM app_session')) return [[testSessionRow(auth)]];
      throw new Error('Unexpected query');
    },
    async commit() { calls.push('commit'); },
    async rollback() { rows.length = 0; calls.push('rollback'); },
    release() { calls.push('release'); },
    destroy() { calls.push('destroy'); },
  };
  const repository = {
    transaction(actor, work) { return withAccountLocks({ getConnection: async () => connection }, [actor], work); },
    async donorExists() { return true; },
    async lockSlot() { return { slotId: '40', startsAt: later, endsAt: end, capacity: 1, slotStatus: 'OPEN' }; },
    async slotBookings() { return []; },
    async donorActiveBookings() { return []; },
    async history() { return { lastCollectedDate: null, decision: null }; },
    async insertBooking(target) { assert.equal(target, connection); rows.push('booking'); return '1'; },
  };
  const service = createBookingService({ repository, clock, auditWriter: { async write(target) {
    assert.equal(target, connection); throw new Error('Controlled audit failure');
  } } });
  await assert.rejects(service.createBooking('10', { slotId: '40' }, auth), safe('DATABASE_UNAVAILABLE'));
  assert.deepEqual(rows, []);
  assert.deepEqual(calls, ['begin', 'rollback', 'release']);
  calls.length = 0;
  connection.rollback = async () => { calls.push('rollback'); throw new Error('Controlled rollback failure'); };
  await assert.rejects(service.createBooking('10', { slotId: '40' }, auth), safe('TRANSACTION_CLEANUP_FAILED'));
  assert.deepEqual(calls, ['begin', 'rollback', 'destroy']);
});
