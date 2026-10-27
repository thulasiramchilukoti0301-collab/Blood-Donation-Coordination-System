import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createBookingService } from '../src/modules/booking/service.js';
import { withAccountLocks } from '../src/modules/accounts/transaction.js';
import { testAuthorization, testSessionRow } from './helpers/session-context.mjs';

const later = '2026-11-01T10:00:00+05:30';
const end = '2026-11-01T11:00:00+05:30';
const clock = () => Date.parse('2026-10-27T00:00:00Z');
function fixture({ capacity = 1, history = { lastCollectedDate: null, decision: null }, bookings = [],
  windows = {}, onLockSlot = () => {} } = {}) {
  const records = [...bookings];
  const slot = { slotId: '40', startsAt: later, endsAt: end, capacity, slotStatus: 'OPEN' };
  let now = clock();
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
    transaction(actorId, work) {
      const prior = chain;
      let release;
      chain = new Promise(resolve => { release = resolve; });
      return prior.then(async () => {
        try { return await work(connection, new Map([[actorId, { accountId: actorId,
          role: actorId === '1' ? 'ADMIN' : 'DONOR', accountStatus: 'ACTIVE' }]])); }
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
    async updateBooking(_, id, status) { const row = records.find(item => item.bookingId === id); if (!row || row.bookingStatus !== 'BOOKED') return 0; row.bookingStatus = status; writes.push('cancel'); return 1; },
    async bookingSlotId(_, id, donor) { return records.find(row => row.bookingId === id && row.donorAccountId === donor)?.slotId ?? null; },
    async lockBooking(_, id, donor) { return records.find(row => row.bookingId === id && row.donorAccountId === donor) ?? null; },
  };
  const service = createBookingService({ repository, clock: () => now, operationId: () => '00000000-0000-4000-8000-000000000001',
    auditWriter: { async write(_, event) { events.push(event); return '1'; } } });
  return { service, repository, slot, records, writes, events, authorizations };
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
