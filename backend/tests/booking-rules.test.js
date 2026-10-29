import assert from 'node:assert/strict';
import { test } from 'node:test';
import { addDays, bookingQuery, eligibility, localDateTime, overlaps, slotCreate, slotPatch, todayIst } from '../src/modules/booking/rules.js';

test('strict IST timestamps reject impossible dates, timezone ambiguity and invalid ranges', () => {
  assert.equal(localDateTime('2026-10-27T10:30+05:30').local, '2026-10-27 10:30:00');
  for (const value of ['2026-02-30T10:30+05:30', '2026-10-27T25:00+05:30',
    '2026-10-27T10:30Z', '2026-10-27T10:30', '2026-10-27T10:30+00:00']) {
    assert.throws(() => localDateTime(value), { code: 'VALIDATION_ERROR' });
  }
  assert.throws(() => slotCreate({ startsAt: '2026-10-27T10:30+05:30', endsAt: '2026-10-27T10:00+05:30', capacity: 1 }, 0), { code: 'VALIDATION_ERROR' });
  for (const capacity of [0, -1, 65536, '2', 1.5]) assert.throws(() => slotCreate({ startsAt: '2026-10-27T10:30+05:30', endsAt: '2026-10-27T11:30+05:30', capacity }, 0), { code: 'VALIDATION_ERROR' });
  assert.equal(todayIst(Date.parse('2026-10-26T19:00:00Z')), '2026-10-27');
  assert.equal(addDays('2026-01-31', 56), '2026-03-28');
});

test('56-calendar-day booking boundary uses appointment IST date and collected history independent of release', () => {
  const history = { lastCollectedDate: '2026-09-01', decision: { decision: 'ACCEPTED' } };
  assert.equal(eligibility(history, '2026-10-26').result, 'INELIGIBLE_UNTIL_DATE');
  assert.equal(eligibility(history, '2026-10-27').result, 'ELIGIBLE');
  assert.equal(eligibility(history, '2026-10-27').nextEligibleDate, '2026-10-27');
  assert.equal(eligibility({ lastCollectedDate: null, decision: null }, '2026-10-27').result, 'ELIGIBLE');
});

test('review blocks indefinitely until later acceptance; temporary deferral is inclusive', () => {
  assert.equal(eligibility({ lastCollectedDate: null, decision: { decision: 'REVIEW_REQUIRED', deferredUntil: null } }, '2030-01-01').result, 'STAFF_REVIEW_REQUIRED');
  const deferred = { lastCollectedDate: null, decision: { decision: 'TEMPORARILY_DEFERRED', deferredUntil: '2026-10-27' } };
  assert.equal(eligibility(deferred, '2026-10-27').result, 'INELIGIBLE_UNTIL_DATE');
  assert.equal(eligibility(deferred, '2026-10-28').result, 'ELIGIBLE');
  assert.equal(eligibility({ lastCollectedDate: '2026-10-01', decision: { decision: 'ACCEPTED' } }, '2026-10-27').result, 'INELIGIBLE_UNTIL_DATE');
});

test('adjacent windows do not overlap; extra owner fields and unsupported slot transitions fail', () => {
  assert.equal(overlaps(10, 20, 20, 30), false);
  assert.equal(overlaps(10, 21, 20, 30), true);
  assert.throws(() => slotPatch({ slotStatus: 'OPEN', reason: 'STAFF_CLOSED' }), { code: 'VALIDATION_ERROR' });
  assert.throws(() => slotPatch({ slotStatus: 'CANCELLED', reason: 'free text' }), { code: 'VALIDATION_ERROR' });
  assert.throws(() => bookingQuery({ donor: '2' }), { code: 'VALIDATION_ERROR' });
});
