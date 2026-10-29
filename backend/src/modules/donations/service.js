import { randomUUID } from 'node:crypto';
import { HttpError } from '../../utils/httpError.js';
import { safeAccountError } from '../accounts/transaction.js';
import { requireStoredSession } from '../accounts/sessionAuthorization.js';
import { createAuditWriter } from '../audit/writer.js';
import { addDays, eligibility, id, storedTime, todayIst } from '../booking/rules.js';
import { donationInput, donationQuery } from './rules.js';

const conflict = () => new HttpError(409, 'DONATION_CONFLICT', 'This visit or its eligibility changed. Refresh before another action.');
const missing = () => new HttpError(404, 'BOOKING_NOT_FOUND', 'The booking was not found.');
const activeDonor = account => {
  if (!account || account.role !== 'DONOR') throw new HttpError(404, 'DONOR_NOT_FOUND', 'The Donor was not found.');
  if (account.accountStatus !== 'ACTIVE') throw new HttpError(409, 'DONOR_UNAVAILABLE', 'This Donor is not active for this action.');
};

export function createDonationService({ repository,
  auditWriter = createAuditWriter({ allowedActionCodes: ['DONATION_RECORDED', 'BOOKING_COMPLETED'] }),
  clock = () => Date.now(), operationId = randomUUID }) {
  if (!repository) throw new TypeError('A donation repository is required.');
  return {
    async record(actorIdValue, body, authorization) {
      const actorId = id(actorIdValue);
      const input = donationInput(body);
      try {
        const hint = await repository.bookingHint(input.bookingId);
        if (!hint) throw missing();
        return await repository.transaction(actorId, hint.donorAccountId, async (connection, accounts) => {
          const actor = accounts.get(actorId);
          if (!actor || actor.accountStatus !== 'ACTIVE') {
            throw new HttpError(401, 'ACCOUNT_UNAVAILABLE', 'Sign in with an active account.');
          }
          if (actor.role !== 'ADMIN') throw new HttpError(403, 'FORBIDDEN', 'Admin access is required.');
          await requireStoredSession(connection, authorization, actor);
          activeDonor(accounts.get(hint.donorAccountId));
          if (!await repository.donorExists(hint.donorAccountId, connection)) throw missing();
          // Account/SID -> Donor -> slot -> Booking -> decision/history is the
          // same lock order as the existing booking writers. The hint is never
          // authoritative: verify both owner and slot after acquiring locks.
          const slot = await repository.lockSlot(connection, hint.slotId);
          const booking = await repository.lockBooking(connection, input.bookingId);
          if (!slot || !booking || booking.donorAccountId !== hint.donorAccountId
            || booking.slotId !== hint.slotId || booking.bookingStatus !== 'CHECKED_IN'
            || slot.slotStatus === 'CANCELLED') throw conflict();
          if (await repository.bookingHasDonation(connection, input.bookingId)) throw conflict();
          const visit = await repository.latestVisitDecision(connection, input.bookingId);
          const donorDecision = input.outcome === 'DEFERRED' ? null
            : await repository.latestDonorDecision(connection, hint.donorAccountId);
          const lastCollectedDate = input.outcome === 'DEFERRED' ? null
            : await repository.latestCollected(connection, hint.donorAccountId);
          // The SID is checked again after every domain-row wait, immediately
          // before the first mutation. Time-sensitive conditions use fresh time.
          await requireStoredSession(connection, authorization, actor);
          const now = clock();
          const today = todayIst(now);
          if (storedTime(slot.startsAt).date !== today || !visit
            || visit.bookingId !== input.bookingId || visit.donorAccountId !== hint.donorAccountId
            || storedTime(visit.decidedAt).date !== today) throw conflict();
          if (input.outcome === 'DEFERRED') {
            if (visit.decision !== 'TEMPORARILY_DEFERRED') throw conflict();
          } else {
            if (visit.decision !== 'ACCEPTED'
              || eligibility({ decision: donorDecision, lastCollectedDate }, today).result !== 'ELIGIBLE') throw conflict();
            if (input.outcome === 'COLLECTED' && (input.collectedAt.date !== today
              || input.collectedAt.utc > now || input.collectedAt.utc < storedTime(slot.startsAt).utc
              || input.collectedAt.utc < storedTime(booking.statusChangedAt).utc
              || input.collectedAt.utc < storedTime(visit.decidedAt).utc)) throw conflict();
          }
          let donationId;
          try { donationId = await repository.insertDonation(connection, actorId, input); }
          catch (error) { if (error?.code === 'ER_DUP_ENTRY') throw conflict(); throw error; }
          if (await repository.completeBooking(connection, input.bookingId) !== 1) throw conflict();
          const sharedOperation = operationId();
          const reasons = { COLLECTED: 'COLLECTION_RECORDED', INCOMPLETE: 'INCOMPLETE_ATTEMPT_RECORDED',
            DEFERRED: 'DEFERRED_VISIT_RECORDED' };
          const summaries = { COLLECTED: 'Successful collection recorded', INCOMPLETE: 'Incomplete collection attempt recorded',
            DEFERRED: 'Deferred visit recorded without collection' };
          await auditWriter.write(connection, { actorAccountId: actorId, actionCode: 'DONATION_RECORDED',
            subjectType: 'Donation', subjectId: donationId, reasonCode: reasons[input.outcome],
            changeSummary: summaries[input.outcome], operationId: sharedOperation });
          await auditWriter.write(connection, { actorAccountId: actorId, actionCode: 'BOOKING_COMPLETED',
            subjectType: 'Booking', subjectId: input.bookingId, reasonCode: 'DONATION_OUTCOME_RECORDED',
            changeSummary: 'CHECKED_IN -> COMPLETED', operationId: sharedOperation });
          const summary = await repository.donationSummary(connection, donationId);
          if (!summary || summary.bookingStatus !== 'COMPLETED') throw new Error('Donation summary unavailable');
          return summary;
        });
      } catch (error) { throw safeAccountError(error); }
    },
    async list(query, { admin = false, donorId = null } = {}) {
      try {
        const input = donationQuery(query, admin);
        const owner = admin ? null : id(donorId);
        const result = await repository.list(input, owner);
        if (admin) return result;
        const lastCollectedDate = await repository.donorLastCollected(owner);
        return { ...result, nextEligibleDate: lastCollectedDate ? addDays(lastCollectedDate, 56) : null };
      } catch (error) { throw safeAccountError(error); }
    },
  };
}
