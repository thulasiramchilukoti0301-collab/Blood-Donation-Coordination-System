import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createBookingRepository } from '../src/modules/booking/repository.js';

test('history reads only collected donations and orders equal-time decisions by ID', async () => {
  const calls = [];
  const connection = { async execute(sql, params) {
    calls.push({ sql, params });
    return calls.length === 1 ? [[{ lastCollectedDate: '2026-09-01' }]]
      : [[{ decision: 'ACCEPTED', deferredUntil: null, decisionId: '9007199254740993' }]];
  } };
  const repository = createBookingRepository({});
  const result = await repository.history('9007199254740993', connection);
  assert.equal(result.lastCollectedDate, '2026-09-01');
  assert.equal(result.decision.decisionId, '9007199254740993');
  assert.match(calls[0].sql, /d\.outcome = 'COLLECTED'/u);
  assert.match(calls[0].sql, /ORDER BY d\.collected_at DESC, d\.donation_id DESC/u);
  assert.match(calls[1].sql, /ORDER BY decided_at DESC, eligibility_decision_id DESC/u);
  assert.deepEqual(calls.map(call => call.params), [['9007199254740993'], ['9007199254740993']]);
});

test('slot capacity list uses occupied statuses and bounded deterministic paging without exposing owner data', async () => {
  const calls = [];
  const database = { async execute(sql, params) {
    calls.push({ sql, params });
    if (sql.includes('COUNT(*) AS total')) return [[{ total: '1' }]];
    return [[{ slotId: '9007199254740993', startsAt: '2026-11-01 10:00:00', endsAt: '2026-11-01 11:00:00',
      capacity: 2, occupied: '1', slotStatus: 'OPEN' }]];
  } };
  const result = await createBookingRepository(database).listSlots({ page: 2 }, false);
  assert.deepEqual(result, { slots: [{ slotId: '9007199254740993', startsAt: '2026-11-01T10:00:00+05:30',
    endsAt: '2026-11-01T11:00:00+05:30', capacity: 2, occupied: 1, remaining: 1, slotStatus: 'OPEN' }],
  pagination: { page: 2, pageSize: 20, total: 1 } });
  assert.match(calls[1].sql, /booking_status IN \('BOOKED','CHECKED_IN'\)/u);
  assert.match(calls[1].sql, /ORDER BY s\.starts_at, s\.slot_id LIMIT \? OFFSET \?/u);
  assert.deepEqual(calls[1].params, [20, 20]);
});

test('inserted unsigned BIGINT IDs stay exact strings and unsafe driver numbers are refused', async () => {
  const connection = { async execute(sql) { return [{ insertId: sql.includes('DonationSlot') ? '9007199254740993' : '18446744073709551615' }]; } };
  const repository = createBookingRepository({});
  assert.equal(await repository.insertSlot(connection, '1', { start: { local: '2026-11-01 10:00:00' },
    end: { local: '2026-11-01 11:00:00' }, capacity: 1 }), '9007199254740993');
  assert.equal(await repository.insertBooking(connection, '10', '40'), '18446744073709551615');
  const unsafe = { async execute() { return [{ insertId: Number.MAX_SAFE_INTEGER + 1 }]; } };
  await assert.rejects(repository.insertBooking(unsafe, '10', '40'), /Invalid inserted identifier/u);
});

test('booking lists expose only safe status/decision context and use deterministic latest-decision ordering', async () => {
  const calls = [];
  const database = { async execute(sql, params) {
    calls.push({ sql, params });
    if (sql.includes('COUNT(*) AS total')) return [[{ total: 1 }]];
    return [[{ bookingId: '42', donorAccountId: '10', donorName: 'Fixture Donor', donorAccountStatus: 'ACTIVE',
      slotId: '40', bookingStatus: 'CHECKED_IN', bookedAt: '2026-10-27 09:00:00', statusChangedAt: '2026-10-27 10:00:00',
      cancellationReason: null, startsAt: '2026-10-27 10:00:00', endsAt: '2026-10-27 11:00:00', slotStatus: 'CLOSED',
      hasDonation: '0', latestDecision: 'REVIEW_REQUIRED', latestDeferredUntil: null, latestDecisionAt: '2026-10-27 10:15:00' }]];
  } };
  const repository = createBookingRepository(database);
  const admin = await repository.listBookings({ page: 1 }, null);
  const donor = await repository.listBookings({ page: 1 }, '10');
  assert.equal(admin.bookings[0].donorAccountStatus, 'ACTIVE');
  assert.equal(admin.bookings[0].donorName, 'Fixture Donor');
  assert.equal(admin.bookings[0].hasDonation, false);
  assert.equal(admin.bookings[0].latestDecision, 'REVIEW_REQUIRED');
  assert.equal(admin.bookings[0].latestDecisionAt, '2026-10-27T10:15:00+05:30');
  assert.equal(Object.hasOwn(donor.bookings[0], 'donorName'), false);
  assert.equal(Object.hasOwn(donor.bookings[0], 'donorAccountId'), false);
  assert.equal(donor.bookings[0].latestDecision, 'REVIEW_REQUIRED');
  assert.match(calls[1].sql, /EXISTS \(SELECT 1 FROM Donation/u);
  assert.match(calls[1].sql, /ORDER BY ed\.decided_at DESC, ed\.eligibility_decision_id DESC LIMIT 1/u);
  assert.match(calls[1].sql, /JOIN Account a ON a\.account_id = b\.donor_account_id/u);
  assert.deepEqual(calls[1].params, [20, 0]);
});
