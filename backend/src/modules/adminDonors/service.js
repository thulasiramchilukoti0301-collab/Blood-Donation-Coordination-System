import { randomUUID } from 'node:crypto';
import { HttpError } from '../../utils/httpError.js';
import { safeAccountError } from '../accounts/transaction.js';
import { requireStoredSession } from '../accounts/sessionAuthorization.js';
import { createAuditWriter } from '../audit/writer.js';
import { adminDonorPatch, adminDonorQuery, validateAdminDonorId, validateDonorBirthDate } from './validation.js';

const notFound = () => new HttpError(404, 'DONOR_NOT_FOUND', 'The Donor was not found.');
const targetConflict = () => new HttpError(409, 'DONOR_STATE_CONFLICT', 'This Donor is not in a state that permits profile correction. Refresh the Donor details.');
const historyConflict = () => new HttpError(409, 'DONOR_GROUP_HISTORY_CONFLICT', 'The confirmed blood group conflicts with recorded BloodUnit history. Existing Donation and BloodUnit records were not changed.');

function activeAdmin(account) {
  if (!account || account.accountStatus !== 'ACTIVE') throw new HttpError(401, 'ACCOUNT_UNAVAILABLE', 'This account cannot use the current session. Sign in again if the account is active.');
  if (account.role !== 'ADMIN') throw new HttpError(403, 'FORBIDDEN', 'You do not have access to this resource.');
}

export function createAdminDonorService({ repository,
  auditWriter = createAuditWriter({ allowedActionCodes: ['DONOR_PROFILE_CORRECTED', 'DONOR_BLOOD_GROUP_CONFIRMED'] }),
  clock = () => new Date(), operationId = randomUUID }) {
  if (!repository) throw new TypeError('An Admin Donor repository is required.');
  return {
    async list(actorId, query) {
      try {
        activeAdmin(await repository.actor(actorId));
        return await repository.list(adminDonorQuery(query));
      }
      catch (error) { throw safeAccountError(error); }
    },
    async detail(actorId, donorId) {
      const target = validateAdminDonorId(donorId);
      try {
        activeAdmin(await repository.actor(actorId));
        const result = await repository.detail(null, target);
        if (!result) throw notFound();
        return result;
      } catch (error) { throw safeAccountError(error); }
    },
    async update(actorIdValue, donorIdValue, body, authorization) {
      const actorId = validateAdminDonorId(actorIdValue);
      const donorId = validateAdminDonorId(donorIdValue);
      if (actorId === donorId) throw new HttpError(403, 'DONOR_TARGET_FORBIDDEN', 'This Account cannot be managed as a Donor.');
      const input = adminDonorPatch(body);
      try {
        return await repository.transaction([actorId, donorId], async (connection, accounts) => {
          const actor = accounts.get(actorId);
          activeAdmin(actor);
          await requireStoredSession(connection, authorization, actor);
          const targetAccount = accounts.get(donorId);
          if (!targetAccount || targetAccount.role !== 'DONOR') throw notFound();
          if (!['PENDING', 'ACTIVE'].includes(targetAccount.accountStatus)) throw targetConflict();
          const current = await repository.lockDonor(connection, donorId);
          if (!current) throw notFound();
          const sameStoredValue = (field, value) => field === 'confirmedBloodGroupId'
            ? (current.confirmedBloodGroupId === null ? null : String(current.confirmedBloodGroupId)) === value
            : current[field] === value;
          if (Object.entries(input.originalValues).some(([field, value]) => !sameStoredValue(field, value))) {
            throw new HttpError(409, 'DONOR_EDIT_CONFLICT', 'The Donor profile changed. Refresh before editing again.');
          }
          if (Object.hasOwn(input.patch, 'dateOfBirth')) validateDonorBirthDate(input.patch.dateOfBirth, clock());
          if (input.groupConfirmation) {
            if (!await repository.lockGroup(connection, input.patch.confirmedBloodGroupId)) {
              throw new HttpError(422, 'VALIDATION_ERROR', 'Check the highlighted Donor fields.', {
                confirmedBloodGroupId: 'Choose an existing blood group.',
              });
            }
            const historicalGroups = new Set(await repository.unitGroupHistory(connection, donorId));
            for (const previousGroup of historicalGroups) {
              if (previousGroup !== input.patch.confirmedBloodGroupId) throw historyConflict();
            }
          }
          const equal = (field, value) => field === 'confirmedBloodGroupId'
            ? String(current.confirmedBloodGroupId ?? '') === String(value ?? '')
            : (current[field] ?? null) === (value ?? null);
          if (Object.entries(input.patch).every(([field, value]) => equal(field, value))) {
            throw new HttpError(409, 'DONOR_EDIT_CONFLICT', 'The requested correction does not change the saved Donor profile. Refresh before editing.');
          }
          // Re-read and validate the Admin SID after every Account, Donor,
          // BloodGroup and historical-unit lock/wait, directly before write.
          await requireStoredSession(connection, authorization, actor);
          if (await repository.update(connection, donorId, input.patch) !== 1) {
            throw new HttpError(409, 'DONOR_EDIT_CONFLICT', 'The Donor profile changed. Refresh before editing again.');
          }
          const group = input.groupConfirmation;
          await auditWriter.write(connection, {
            actorAccountId: actorId,
            actionCode: group ? 'DONOR_BLOOD_GROUP_CONFIRMED' : 'DONOR_PROFILE_CORRECTED',
            subjectType: 'Donor', subjectId: donorId, reasonCode: input.reasonCode,
            changeSummary: group ? 'Staff-confirmed Donor blood group updated' : 'Staff corrected approved Donor profile fields',
            operationId: operationId(),
          });
          const saved = await repository.detail(connection, donorId);
          if (!saved) throw new Error('Donor detail unavailable');
          return saved;
        });
      } catch (error) {
        if (input.groupConfirmation && ['ER_NO_REFERENCED_ROW_2', 'ER_NO_REFERENCED_ROW'].includes(error?.code)) {
          throw new HttpError(422, 'VALIDATION_ERROR', 'Check the highlighted Donor fields.', {
            confirmedBloodGroupId: 'Choose an existing blood group.',
          });
        }
        throw safeAccountError(error);
      }
    },
  };
}
