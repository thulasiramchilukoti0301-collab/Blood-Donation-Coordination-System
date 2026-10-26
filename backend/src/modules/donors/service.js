import { HttpError } from '../../utils/httpError.js';
import { validateDonorProfilePatch } from '../auth/validation.js';

function safeFailure(error, patch) {
  if (patch?.reportedBloodGroupId && ['ER_NO_REFERENCED_ROW_2', 'ER_NO_REFERENCED_ROW'].includes(error?.code)) {
    return new HttpError(422, 'VALIDATION_ERROR', 'Check the highlighted fields and try again.', {
      reportedBloodGroupId: 'Choose a valid blood group identifier or leave it blank.',
    });
  }
  return error instanceof HttpError
    ? error
    : new HttpError(503, 'DATABASE_UNAVAILABLE', 'Database could not complete the request safely.');
}

export function createDonorProfileService({ repository }) {
  if (!repository) throw new TypeError('A donor repository is required.');
  return {
    async updateOwnProfile(accountId, body, authorization) {
      const patch = validateDonorProfilePatch(body);
      try {
        return await repository.withTransaction(async (transaction) => {
          // Lock Account first; never trust a status checked before this transaction.
          const account = await transaction.findAccountForUpdate(accountId);
          if (!account || account.role !== 'DONOR'
            || !['PENDING', 'ACTIVE'].includes(account.account_status)) {
            throw new HttpError(401, 'ACCOUNT_UNAVAILABLE', 'This account cannot use the current session. Sign in again if the account is active.');
          }
          await transaction.authorizeSession(authorization, account);
          if (!await transaction.findDonorForUpdate(accountId)) {
            throw new HttpError(503, 'DONOR_PROFILE_UNAVAILABLE', 'The donor profile is unavailable.');
          }
          if (patch.reportedBloodGroupId && !await transaction.findReportedBloodGroup(patch.reportedBloodGroupId)) {
            throw new HttpError(422, 'VALIDATION_ERROR', 'Check the highlighted fields and try again.', {
              reportedBloodGroupId: 'Choose a valid blood group identifier or leave it blank.',
            });
          }
          await transaction.updateProfile(accountId, patch);
          const profile = await transaction.findProfile(accountId);
          if (!profile) throw new HttpError(503, 'DONOR_PROFILE_UNAVAILABLE', 'The donor profile is unavailable.');
          return profile;
        });
      } catch (error) {
        throw safeFailure(error, patch);
      }
    },
  };
}
