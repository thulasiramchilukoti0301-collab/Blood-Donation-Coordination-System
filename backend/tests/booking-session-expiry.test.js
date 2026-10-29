import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createBookingService } from '../src/modules/booking/service.js';
import { withAccountLocks } from '../src/modules/accounts/transaction.js';
import { testAuthorization } from './helpers/session-context.mjs';

const operations = ['book', 'cancel-booking', 'capacity', 'close-slot', 'cancel-slot', 'check-in', 'no-show', 'staff-cancel', 'day-of-decision'];
for (const operation of operations) {
  for (const expired of [true, false]) {
    test(`${operation}: session ${expired ? 'expiring' : 'remaining valid'} during domain wait is rechecked before writes`, async t => {
      const dayOf = ['check-in', 'day-of-decision'].includes(operation);
      let now = Date.parse(operation === 'no-show' ? '2026-10-27T06:00:00Z'
        : operation === 'staff-cancel' ? '2026-10-27T04:00:00Z'
          : dayOf ? '2026-10-27T05:00:00Z' : '2026-10-27T00:00:00Z');
      const expires = now + 1000;
      t.mock.method(Date, 'now', () => now);
      const admin = !['book', 'cancel-booking'].includes(operation);
      const actor = admin ? '1' : '10';
      const auth = testAuthorization(actor, admin ? 'ADMIN' : 'DONOR', 'ACTIVE');
      const slot = { slotId: '40', startsAt: operation === 'no-show' ? '2026-10-27T09:00:00+05:30'
        : dayOf ? '2026-10-27T10:00:00+05:30' : operation === 'staff-cancel' ? '2026-10-27T10:30:00+05:30' : '2026-11-01T10:00:00+05:30',
        endsAt: operation === 'no-show' ? '2026-10-27T09:30:00+05:30' : dayOf ? '2026-10-27T11:00:00+05:30'
          : operation === 'staff-cancel' ? '2026-10-27T11:30:00+05:30' : '2026-11-01T11:00:00+05:30', capacity: 1, slotStatus: 'OPEN' };
      const row = { bookingId: '2', slotId: '40', donorAccountId: '10', bookingStatus: operation === 'day-of-decision' ? 'CHECKED_IN' : 'BOOKED' };
      const initial = structuredClone({ slot, row });
      const writes = []; const events = []; const calls = [];
      let arrived; let resume;
      const waiting = new Promise(resolve => { arrived = resolve; });
      const gate = new Promise(resolve => { resume = resolve; });
      async function domainWait() { calls.push('domain-wait'); arrived(); await gate; }
      const connection = {
        async beginTransaction() { calls.push('begin'); },
        async execute(sql, values) {
          if (sql.includes('FROM Account')) { calls.push(`account:${values[0]}`); return [[values[0] === actor ? auth.principal : { accountId: values[0], role: 'DONOR', accountStatus: 'ACTIVE' }]]; }
          assert.match(sql, /FROM app_session[\s\S]*FOR UPDATE/u);
          calls.push('session');
          return [[{ session_data: JSON.stringify({ auth: auth.principal }), expires_at: expires, revoked_at: null }]];
        },
        async commit() { calls.push('commit'); },
        async rollback() { Object.assign(slot, initial.slot); Object.assign(row, initial.row); events.length = 0; calls.push('rollback'); },
        release() { calls.push('release'); },
        destroy() { calls.push('destroy'); },
      };
      const repository = {
        transaction(id, work, targetAccountIds = []) { return withAccountLocks({ getConnection: async () => connection }, [id, ...targetAccountIds], work); },
        async bookingOwnerHint() { return { donorAccountId: '10', slotId: '40' }; },
        async donorExists() { return true; },
        async lockSlot() { calls.push('slot-lock'); return { ...slot }; },
        async slotBookings() {
          calls.push('booking-locks');
          if (admin) await domainWait();
          return operation === 'book' ? [] : [{ ...row }];
        },
        async donorActiveBookings() { return []; },
        async history() { await domainWait(); return { lastCollectedDate: null, decision: null }; },
        async bookingSlotId() { return '40'; },
        async lockBooking() { calls.push('booking-lock'); await domainWait(); return { ...row }; },
        async lockAdminBooking() { calls.push('booking-lock'); await domainWait(); return { ...row }; },
        async bookingHasDonation() { return false; },
        async latestBookingDecision() { return null; },
        async insertBooking(target) { assert.equal(target, connection); calls.push('write'); writes.push('book'); return '3'; },
        async insertEligibilityDecision(target) { assert.equal(target, connection); calls.push('write'); writes.push('decision'); return '4'; },
        async updateBooking(target, id, status) { assert.equal(target, connection); calls.push('write'); writes.push('booking'); row.bookingStatus = status; return 1; },
        async updateSlot(target, id, patch) { assert.equal(target, connection); calls.push('write'); writes.push('slot');
          slot.capacity = patch.capacity ?? slot.capacity; slot.slotStatus = patch.status ?? slot.slotStatus; return 1; },
      };
      const service = createBookingService({ repository, clock: () => now, auditWriter: { async write(target, event) {
        assert.equal(target, connection); events.push(event); return '1';
      } } });
      const pending = operation === 'book' ? service.createBooking(actor, { slotId: '40' }, auth)
        : operation === 'cancel-booking' ? service.cancelBooking(actor, '2', {}, auth)
          : operation === 'check-in' ? service.checkIn(actor, '2', { bookingStatus: 'CHECKED_IN', reason: 'STAFF_CHECKED_IN' }, auth)
            : operation === 'no-show' ? service.updateAdminBookingStatus(actor, '2', { bookingStatus: 'NO_SHOW', reason: 'STAFF_NO_SHOW' }, auth)
              : operation === 'staff-cancel' ? service.updateAdminBookingStatus(actor, '2', { bookingStatus: 'CANCELLED_BY_STAFF', reason: 'STAFF_CANCELLED' }, auth)
            : operation === 'day-of-decision' ? service.recordEligibilityDecision(actor, '10', { bookingId: '2', decision: 'ACCEPTED' }, auth)
              : service.updateSlot(actor, '40', operation === 'capacity' ? { capacity: 2 }
            : { slotStatus: operation === 'close-slot' ? 'CLOSED' : 'CANCELLED',
              reason: operation === 'close-slot' ? 'STAFF_CLOSED' : 'STAFF_CANCELLED' }, auth);
      await waiting;
      now += expired ? 1000 : 500;
      resume();
      if (expired) {
        await assert.rejects(pending, { code: 'ACCOUNT_UNAVAILABLE', status: 401 });
        assert.deepEqual(writes, []);
        assert.deepEqual(events, []);
        assert.deepEqual({ slot, row }, initial);
        assert.ok(calls.includes('rollback'));
        assert.ok(!calls.includes('commit'));
      } else {
        await pending;
        assert.ok(writes.length > 0);
        assert.ok(events.length > 0);
        assert.ok(calls.includes('commit'));
        assert.equal(calls[calls.indexOf('write') - 1], 'session', 'Final SID check immediately precedes first mutation');
      }
      assert.equal(calls.filter(value => value === 'session').length, 2);
      assert.deepEqual(calls.filter(value => value.startsWith('account:')), admin && ['check-in', 'no-show', 'staff-cancel', 'day-of-decision'].includes(operation)
        ? ['account:1', 'account:10'] : [`account:${actor}`]);
      assert.ok(calls.lastIndexOf('account:10') < calls.indexOf('session'));
      assert.ok(calls.indexOf('session') < calls.indexOf('slot-lock'));
      assert.ok(calls.lastIndexOf('session') > calls.indexOf('domain-wait'));
      assert.equal(calls.at(-1), 'release');
    });
  }
}
