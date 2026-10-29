import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createDonationService } from '../src/modules/donations/service.js';
import { donationInput, donationQuery } from '../src/modules/donations/rules.js';
import { testAuthorization, testSessionRow } from './helpers/session-context.mjs';

const day = '2026-10-28';
const at = time => `${day}T${time}+05:30`;
const now = () => Date.parse(at('10:30:00'));
const auth = testAuthorization('1', 'ADMIN', 'ACTIVE');
const collected = { bookingId: '3', outcome: 'COLLECTED', collectedAt: at('10:00:01'), collectionReference: 'REF-001' };
const failed = code => error => { assert.equal(error.code, code); return true; };

function fixture(options = {}) {
  const state = { bookingStatus: options.bookingStatus ?? 'CHECKED_IN', donation: null, events: [] };
  const visit = { bookingId: '3', donorAccountId: '10', decision: options.visitDecision ?? 'ACCEPTED',
    decidedAt: options.visitAt ?? `${day} 09:10:00` };
  const authorizations = new Map([['1', auth]]);
  let stored = { ...testSessionRow(auth), ...(options.revokedActor ? { revoked_at: Date.now() } : {}) };
  const repository = {
    bookingHint: async () => options.noHint ? null : { donorAccountId: options.owner ?? '10', slotId: '4' },
    async transaction(actor, donor, work) {
      assert.equal(actor, '1');
      const before = structuredClone(state);
      const connection = { execute: async (sql, parameters) => {
        assert.match(sql, /FROM app_session/u); assert.deepEqual(parameters, [auth.sessionId]);
        return [[stored]];
      } };
      try { return await work(connection, new Map([['1', { accountId: '1', role: 'ADMIN', accountStatus: 'ACTIVE' }],
        [donor, options.missingTarget ? null : { accountId: donor, role: options.targetRole ?? 'DONOR',
          accountStatus: options.targetStatus ?? 'ACTIVE' }]])); }
      catch (error) { Object.assign(state, before); throw error; }
    },
    donorExists: async () => !options.missingProfile,
    async lockSlot() {
      if (options.expireDuringDomainWait) stored = { ...stored, expires_at: Date.now() - 1 };
      return { startsAt: options.slotStartsAt ?? at('09:00:00'), slotStatus: options.slotStatus ?? 'OPEN' };
    },
    lockBooking: async () => ({ bookingId: '3', donorAccountId: options.actualOwner ?? '10', slotId: '4',
      bookingStatus: state.bookingStatus, statusChangedAt: `${day} 09:05:00` }),
    bookingHasDonation: async () => Boolean(state.donation),
    latestVisitDecision: async () => options.noVisit ? null : visit,
    latestDonorDecision: async () => ({ decision: options.donorDecision ?? 'ACCEPTED', deferredUntil: options.deferredUntil ?? null }),
    latestCollected: async () => options.lastCollectedDate ?? null,
    async insertDonation(_, actor, input) {
      assert.equal(actor, '1');
      if (options.insertError) throw options.insertError;
      if (state.donation) throw Object.assign(new Error('synthetic duplicate'), { code: 'ER_DUP_ENTRY' });
      state.donation = { donationId: '8', ...input }; return '8';
    },
    async completeBooking() { if (options.affectedRows === 0) return 0; state.bookingStatus = 'COMPLETED'; return 1; },
    async donationSummary() { return { donationId: '8', bookingId: '3', donorAccountId: '10',
      bookingStatus: state.bookingStatus, outcome: state.donation.outcome,
      releaseStatus: state.donation.releaseStatus, collectedAt: state.donation.collectedAt?.iso ?? null,
      collectionReference: state.donation.collectionReference, createdAt: at('10:30:00') }; },
    list: async () => ({ donations: [], pagination: { page: 1, pageSize: 20, total: 0 } }),
    donorLastCollected: async () => options.lastCollectedDate ?? null,
  };
  const service = createDonationService({ repository, clock: now, operationId: () => '00000000-0000-4000-8000-000000000001',
    auditWriter: { async write(_, event) {
      if (options.failAudit && state.events.length === 1) throw new Error('synthetic audit failure');
      state.events.push(event); return String(state.events.length);
    } } });
  return { service, state, repository };
}

test('strict outcome bodies and inclusive recording date query', () => {
  assert.equal(donationInput(collected).collectedAt.iso, at('10:00:01'));
  assert.equal(donationInput({ bookingId: '3', outcome: 'INCOMPLETE' }).releaseStatus, 'NOT_REQUIRED');
  assert.equal(donationInput({ bookingId: '3', outcome: 'DEFERRED' }).collectedAt, null);
  for (const bad of [{ ...collected, actorAccountId: '1' }, { ...collected, bookingId: 3 },
    { ...collected, collectedAt: '2026-10-28T10:00:01Z' }, { ...collected, collectionReference: ' ' },
    { bookingId: '3', outcome: 'DEFERRED', collectedAt: null },
    { bookingId: '3', outcome: 'INCOMPLETE', collectionReference: null }]) {
    assert.throws(() => donationInput(bad), failed('VALIDATION_ERROR'));
  }
  assert.deepEqual(donationQuery({ from: day, to: day, page: '2' }, false),
    { donorAccountId: undefined, outcome: undefined, releaseStatus: undefined, from: day, to: day, page: 2 });
  assert.throws(() => donationQuery({ donorAccountId: '10' }, false), failed('VALIDATION_ERROR'));
});

test('collected, incomplete and deferred each resolve a visit with two fixed audit events', async () => {
  for (const [input, decision, release] of [[collected, 'ACCEPTED', 'PENDING'],
    [{ bookingId: '3', outcome: 'INCOMPLETE' }, 'ACCEPTED', 'NOT_REQUIRED'],
    [{ bookingId: '3', outcome: 'DEFERRED' }, 'TEMPORARILY_DEFERRED', 'NOT_REQUIRED']]) {
    const f = fixture({ visitDecision: decision, donorDecision: decision });
    const result = await f.service.record('1', input, auth);
    assert.equal(result.bookingStatus, 'COMPLETED'); assert.equal(result.releaseStatus, release);
    assert.equal(f.state.events.length, 2);
    assert.deepEqual(f.state.events.map(value => value.actionCode), ['DONATION_RECORDED', 'BOOKING_COMPLETED']);
    assert.deepEqual(f.state.events.map(value => value.subjectType), ['Donation', 'Booking']);
    assert.equal(f.state.events[1].changeSummary, 'CHECKED_IN -> COMPLETED');
    await assert.rejects(f.service.record('1', input, auth), failed('DONATION_CONFLICT'));
    assert.equal(f.state.events.length, 2);
  }
});

test('target state, visit decision, owner, slot and actor session reject without writes', async () => {
  for (const [options, code] of [[{ targetStatus: 'SUSPENDED' }, 'DONOR_UNAVAILABLE'],
    [{ targetRole: 'HOSPITAL' }, 'DONOR_NOT_FOUND'], [{ missingTarget: true }, 'DONOR_NOT_FOUND'],
    [{ actualOwner: '11' }, 'DONATION_CONFLICT'], [{ slotStatus: 'CANCELLED' }, 'DONATION_CONFLICT'],
    [{ visitDecision: 'REVIEW_REQUIRED' }, 'DONATION_CONFLICT'], [{ noVisit: true }, 'DONATION_CONFLICT'],
    [{ visitAt: '2026-10-27 09:10:00' }, 'DONATION_CONFLICT'],
    [{ slotStartsAt: '2026-10-27T09:00:00+05:30' }, 'DONATION_CONFLICT'],
    [{ donorDecision: 'REVIEW_REQUIRED' }, 'DONATION_CONFLICT'],
    [{ donorDecision: 'TEMPORARILY_DEFERRED', deferredUntil: day }, 'DONATION_CONFLICT'],
    [{ lastCollectedDate: '2026-09-03' }, 'DONATION_CONFLICT'],
    [{ expireDuringDomainWait: true }, 'ACCOUNT_UNAVAILABLE'],
    [{ revokedActor: true }, 'ACCOUNT_UNAVAILABLE']]) {
    const f = fixture(options);
    await assert.rejects(f.service.record('1', collected, auth), failed(code));
    assert.equal(f.state.donation, null); assert.equal(f.state.bookingStatus, 'CHECKED_IN');
    assert.equal(f.state.events.length, 0);
  }
});

test('56th day and collection timestamp boundaries', async () => {
  const f = fixture({ lastCollectedDate: '2026-09-02' });
  assert.equal((await f.service.record('1', collected, auth)).outcome, 'COLLECTED');
  for (const time of ['08:59:59', '09:04:59', '09:09:59', '10:30:01']) {
    const bad = fixture();
    await assert.rejects(bad.service.record('1', { ...collected, collectedAt: at(time) }, auth), failed('DONATION_CONFLICT'));
  }
});

test('affected count and audit failure roll back both domain rows and audit; donor interval excludes non-collection', async () => {
  for (const options of [{ affectedRows: 0 }, { failAudit: true }]) {
    const f = fixture(options);
    await assert.rejects(f.service.record('1', collected, auth));
    assert.equal(f.state.donation, null); assert.equal(f.state.bookingStatus, 'CHECKED_IN');
    assert.equal(f.state.events.length, 0);
  }
  const f = fixture({ lastCollectedDate: '2026-09-02' });
  assert.equal((await f.service.list({}, { donorId: '10' })).nextEligibleDate, '2026-10-28');
});

test('DEFERRED resolves without collection eligibility; duplicate reference stays a safe conflict', async () => {
  const deferred = fixture({ visitDecision: 'TEMPORARILY_DEFERRED', donorDecision: 'REVIEW_REQUIRED',
    lastCollectedDate: day });
  assert.equal((await deferred.service.record('1', { bookingId: '3', outcome: 'DEFERRED' }, auth)).outcome, 'DEFERRED');
  const duplicate = fixture({ insertError: Object.assign(new Error('synthetic database value'), { code: 'ER_DUP_ENTRY' }) });
  await assert.rejects(duplicate.service.record('1', collected, auth), failed('DONATION_CONFLICT'));
  assert.equal(duplicate.state.donation, null); assert.equal(duplicate.state.events.length, 0);
});
