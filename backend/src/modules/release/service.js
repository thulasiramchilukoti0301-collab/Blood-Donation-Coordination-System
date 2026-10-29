import { randomUUID } from 'node:crypto';
import { HttpError } from '../../utils/httpError.js';
import { safeAccountError } from '../accounts/transaction.js';
import { requireStoredSession } from '../accounts/sessionAuthorization.js';
import { createAuditWriter } from '../audit/writer.js';
import { addDays, id, todayIst, IST_OFFSET_MS, storedTime } from '../booking/rules.js';
import { discardInput, emptyMutationInput, inventoryQuery, releaseInput } from './rules.js';

const conflict = () => new HttpError(409, 'RELEASE_CONFLICT', 'This release decision changed. Refresh before another action.');
const missing = () => new HttpError(404, 'DONATION_NOT_FOUND', 'The donation was not found.');
const localNow = now => new Date(now + IST_OFFSET_MS).toISOString().slice(0, 19).replace('T', ' ');
const asUnit = (row, code) => row && ({ bloodUnitId: row.bloodUnitId, donationId: row.donationId,
  bloodGroupId: row.bloodGroupId, bloodGroupCode: code, expiryDate: row.expiryDate, unitStatus: row.unitStatus });

export function createReleaseService({ repository,
  auditWriter = createAuditWriter({ allowedActionCodes: ['DONATION_RELEASE_DECIDED', 'BLOOD_UNIT_CREATED', 'BLOOD_UNIT_EXPIRED', 'BLOOD_UNIT_DISCARDED'] }),
  clock = () => Date.now(), operationId = randomUUID }) {
  if (!repository) throw new TypeError('A release repository is required.');
  return {
    async decide(donationIdValue, actorIdValue, body, authorization) {
      const donationId = id(donationIdValue), actorId = id(actorIdValue), input = releaseInput(body);
      try {
        const hint = await repository.hint(donationId);
        if (!hint) throw missing();
        return await repository.transaction(actorId, hint.donorAccountId, async (connection, accounts) => {
          const actor = accounts.get(actorId);
          if (!actor || actor.accountStatus !== 'ACTIVE') throw new HttpError(401, 'ACCOUNT_UNAVAILABLE', 'Sign in with an active account.');
          if (actor.role !== 'ADMIN') throw new HttpError(403, 'FORBIDDEN', 'Admin access is required.');
          await requireStoredSession(connection, authorization, actor);
          if (accounts.get(hint.donorAccountId)?.role !== 'DONOR') throw conflict();
          const donor = await repository.donor(connection, hint.donorAccountId);
          const slot = await repository.slot(connection, hint.slotId);
          const booking = await repository.booking(connection, hint.bookingId);
          const donation = await repository.donation(connection, donationId);
          if (!donor || !slot || !booking || !donation || booking.bookingId !== hint.bookingId
            || booking.donorAccountId !== hint.donorAccountId || booking.slotId !== hint.slotId
            || donation.bookingId !== hint.bookingId || booking.bookingStatus !== 'COMPLETED'
            || donation.outcome !== 'COLLECTED' || !donation.collectedAt) throw conflict();
          const group = input.decision === 'APPROVED' ? await repository.group(connection, input.groupId) : null;
          const unit = await repository.unit(connection, donationId);
          // The authoritative SID is checked after all domain locks, including
          // BloodGroup and BloodUnit waits, before any mutation or replay result.
          await requireStoredSession(connection, authorization, actor);
          const now = clock(), decidedAt = localNow(now), today = todayIst(now);
          if (donation.releaseStatus !== 'PENDING') {
            if (donation.releaseStatus === 'APPROVED' && input.decision === 'APPROVED'
              && unit && unit.bloodGroupId === input.groupId && donation.releaseReasonCode === input.reasonCode) {
              return { donationId, decision: 'APPROVED', reasonCode: donation.releaseReasonCode,
                releaseDecidedAt: `${donation.releaseDecidedAt.replace(' ', 'T')}+05:30`,
                unit: asUnit(unit, group?.code ?? null), replayed: true };
            }
            if (donation.releaseStatus === 'REJECTED' && input.decision === 'REJECTED'
              && donation.releaseReasonCode === input.reasonCode && !unit) {
              return { donationId, decision: 'REJECTED', reasonCode: donation.releaseReasonCode,
                releaseDecidedAt: `${donation.releaseDecidedAt.replace(' ', 'T')}+05:30`, unit: null, replayed: true };
            }
            throw conflict();
          }
          if (storedTime(donation.collectedAt).utc > now || unit || (input.decision === 'APPROVED' && (!group || Number(group.isActive) !== 1
            || (donor.confirmedBloodGroupId && donor.confirmedBloodGroupId !== input.groupId)))) throw conflict();
          if (await repository.decide(connection, donationId, actorId, input, decidedAt) !== 1) throw conflict();
          const sharedOperation = operationId();
          let created = null;
          if (input.decision === 'APPROVED') {
            const expiryDate = addDays(donation.collectedAt.slice(0, 10), 42);
            const unitStatus = today < expiryDate ? 'AVAILABLE' : 'EXPIRED';
            let bloodUnitId;
            try { bloodUnitId = await repository.insertUnit(connection, donationId, input.groupId, expiryDate, unitStatus, decidedAt); }
            catch (error) { if (error?.code === 'ER_DUP_ENTRY') throw conflict(); throw error; }
            created = { bloodUnitId, donationId, bloodGroupId: input.groupId, bloodGroupCode: group.code, expiryDate, unitStatus };
          }
          await auditWriter.write(connection, { actorAccountId: actorId, actionCode: 'DONATION_RELEASE_DECIDED',
            subjectType: 'Donation', subjectId: donationId, reasonCode: input.reasonCode,
            changeSummary: `PENDING -> ${input.decision}`, operationId: sharedOperation });
          if (created) await auditWriter.write(connection, { actorAccountId: actorId, actionCode: 'BLOOD_UNIT_CREATED',
            subjectType: 'BloodUnit', subjectId: created.bloodUnitId, reasonCode: 'APPROVED_DONATION',
            changeSummary: `Created ${created.unitStatus} unit from approved donation`, operationId: sharedOperation });
          return { donationId, decision: input.decision, reasonCode: input.reasonCode,
            releaseDecidedAt: `${decidedAt.replace(' ', 'T')}+05:30`, unit: created, replayed: false };
        });
      } catch (error) { if (error?.code === 'ER_DUP_ENTRY') throw conflict(); throw safeAccountError(error); }
    },
    async list(query) {
      try { return await repository.list(inventoryQuery(query), todayIst(clock())); }
      catch (error) { throw safeAccountError(error); }
    },
    async detail(value) {
      try {
        const unit = await repository.detail(id(value));
        if (!unit) throw new HttpError(404, 'BLOOD_UNIT_NOT_FOUND', 'The blood unit was not found.');
        const today = todayIst(clock());
        return { ...unit, effectiveAvailability: unit.unitStatus === 'AVAILABLE' && unit.releaseStatus === 'APPROVED' && unit.expiryDate > today,
          expiryDue: unit.unitStatus === 'AVAILABLE' && unit.expiryDate <= today };
      } catch (error) { throw safeAccountError(error); }
    },
    async reconcileExpiry(actorIdValue, body, authorization) {
      const actorId = id(actorIdValue);
      emptyMutationInput(body);
      try {
        return await repository.lifecycleTransaction(actorId, async (connection, accounts) => {
          const actor = accounts.get(actorId);
          if (!actor || actor.accountStatus !== 'ACTIVE') throw new HttpError(401, 'ACCOUNT_UNAVAILABLE', 'Sign in with an active account.');
          if (actor.role !== 'ADMIN') throw new HttpError(403, 'FORBIDDEN', 'Admin access is required.');
          await requireStoredSession(connection, authorization, actor);
          const rows = await repository.lockDueUnits(connection);
          await requireStoredSession(connection, authorization, actor);
          const now = clock(), today = todayIst(now), expiredAt = localNow(now);
          const due = rows.filter(row => row.expiryDate <= today);
          if (due.some(row => row.unitStatus === 'ALLOCATED')) {
            throw new HttpError(409, 'ALLOCATION_COORDINATION_REQUIRED', 'Due allocated units require coordinated Allocation cancellation. No units were changed.');
          }
          const candidates = due.filter(row => row.unitStatus === 'AVAILABLE');
          const operation = operationId();
          let expiredCount = 0;
          for (const row of candidates) {
            await requireStoredSession(connection, authorization, actor);
            if (await repository.expireUnit(connection, row.bloodUnitId, today, expiredAt) !== 1) throw conflict();
            await auditWriter.write(connection, { actorAccountId: actorId, actionCode: 'BLOOD_UNIT_EXPIRED',
              subjectType: 'BloodUnit', subjectId: row.bloodUnitId, reasonCode: 'EXPIRY_RECONCILIATION',
              changeSummary: 'AVAILABLE -> EXPIRED', operationId: operation });
            expiredCount += 1;
          }
          return { runDate: today, runAt: `${expiredAt.replace(' ', 'T')}+05:30`, checkedCount: rows.length,
            expiredCount, operationId: operation };
        });
      } catch (error) { throw safeAccountError(error); }
    },
    async discardUnit(actorIdValue, bloodUnitIdValue, body, authorization) {
      const actorId = id(actorIdValue), bloodUnitId = id(bloodUnitIdValue), input = discardInput(body);
      try {
        return await repository.lifecycleTransaction(actorId, async (connection, accounts) => {
          const actor = accounts.get(actorId);
          if (!actor || actor.accountStatus !== 'ACTIVE') throw new HttpError(401, 'ACCOUNT_UNAVAILABLE', 'Sign in with an active account.');
          if (actor.role !== 'ADMIN') throw new HttpError(403, 'FORBIDDEN', 'Admin access is required.');
          await requireStoredSession(connection, authorization, actor);
          const unit = await repository.lockLifecycleUnit(connection, bloodUnitId);
          await requireStoredSession(connection, authorization, actor);
          if (!unit) throw new HttpError(404, 'BLOOD_UNIT_NOT_FOUND', 'The blood unit was not found.');
          const now = clock(), today = todayIst(now), discardedAt = localNow(now);
          if (unit.unitStatus === 'ALLOCATED') throw new HttpError(409, 'ALLOCATION_COORDINATION_REQUIRED', 'Allocated units require coordinated Allocation cancellation.');
          if (unit.unitStatus !== 'AVAILABLE') throw new HttpError(409, 'UNIT_STATUS_CONFLICT', 'Only an unallocated available unit can be discarded.');
          if (unit.expiryDate <= today) throw new HttpError(409, 'UNIT_EXPIRY_DUE', 'Reconcile this due unit before another inventory action.');
          const operation = operationId();
          await requireStoredSession(connection, authorization, actor);
          if (await repository.discardUnit(connection, bloodUnitId, input.reasonCode, discardedAt, today) !== 1) throw conflict();
          await auditWriter.write(connection, { actorAccountId: actorId, actionCode: 'BLOOD_UNIT_DISCARDED',
            subjectType: 'BloodUnit', subjectId: bloodUnitId, reasonCode: input.reasonCode,
            changeSummary: 'AVAILABLE -> DISCARDED', operationId: operation });
          return { bloodUnitId, unitStatus: 'DISCARDED', discardedAt: `${discardedAt.replace(' ', 'T')}+05:30`, reasonCode: input.reasonCode };
        });
      } catch (error) { throw safeAccountError(error); }
    },
  };
}
