import { randomUUID } from 'node:crypto';
import { HttpError } from '../../utils/httpError.js';
import { createAuditWriter } from '../audit/writer.js';
import { accountIdentifier, validateAccountQueue, validateApproval } from './validation.js';

function activeAdmin(actor) {
  if (!actor || actor.accountStatus !== 'ACTIVE') {
    throw new HttpError(401, 'ACCOUNT_UNAVAILABLE', 'This account cannot use the current session. Sign in again if the account is active.');
  }
  if (actor.role !== 'ADMIN') throw new HttpError(403, 'FORBIDDEN', 'You do not have access to this resource.');
}
export function createAccountAdminService({ repository, sessionStore,
  auditWriter = createAuditWriter({ allowedActionCodes: ['ACCOUNT_APPROVED'] }), operationId = randomUUID }) {
  return {
    async list(actorId, query) {
      const actor = accountIdentifier(actorId);
      const input = validateAccountQueue(query);
      activeAdmin(await repository.actor(actor));
      return repository.list(input);
    },
    async approve(actorId, targetId, body) {
      const actor = accountIdentifier(actorId);
      const target = accountIdentifier(targetId);
      validateApproval(body);
      if (actor === target) throw new HttpError(403, 'ACCOUNT_TARGET_FORBIDDEN', 'This Account cannot be approved here.');
      return repository.transaction([actor, target], async (connection, accounts) => {
        activeAdmin(accounts.get(actor));
        const account = accounts.get(target);
        if (!account) throw new HttpError(404, 'ACCOUNT_NOT_FOUND', 'The Account was not found.');
        if (!['DONOR', 'HOSPITAL'].includes(account.role)) {
          throw new HttpError(403, 'ACCOUNT_TARGET_FORBIDDEN', 'This Account cannot be approved here.');
        }
        if (account.accountStatus !== 'PENDING') {
          throw new HttpError(409, 'ACCOUNT_APPROVAL_CONFLICT', 'Only a pending Account can be approved.');
        }
        await repository.approve(connection, target);
        await sessionStore.revokeAccountSessions(target, connection);
        await auditWriter.write(connection, { actorAccountId: actor, actionCode: 'ACCOUNT_APPROVED',
          subjectType: 'Account', subjectId: target, reasonCode: 'REGISTRATION_REVIEWED',
          changeSummary: 'PENDING -> ACTIVE', operationId: operationId() });
        return { accountId: target, accountStatus: 'ACTIVE' };
      });
    },
  };
}
