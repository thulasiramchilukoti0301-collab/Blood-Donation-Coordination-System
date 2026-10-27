import { randomUUID } from 'node:crypto';
import { HttpError } from '../../utils/httpError.js';
import { createAuditWriter } from '../audit/writer.js';
import { accountIdentifier, validateAccountQueue, validateAccountTransition } from './validation.js';
import { requireStoredSession } from './sessionAuthorization.js';

function activeAdmin(actor) {
  if (!actor || actor.accountStatus !== 'ACTIVE') {
    throw new HttpError(401, 'ACCOUNT_UNAVAILABLE', 'This account cannot use the current session. Sign in again if the account is active.');
  }
  if (actor.role !== 'ADMIN') throw new HttpError(403, 'FORBIDDEN', 'You do not have access to this resource.');
}
export function createAccountAdminService({ repository, sessionStore,
  auditWriter = createAuditWriter({ allowedActionCodes: ['ACCOUNT_APPROVED', 'ACCOUNT_SUSPENDED', 'ACCOUNT_REACTIVATED'] }), operationId = randomUUID }) {
  return {
    async list(actorId, query) {
      const actor = accountIdentifier(actorId);
      const input = validateAccountQueue(query);
      activeAdmin(await repository.actor(actor));
      return repository.list(input);
    },
    async changeStatus(actorId, targetId, body, authorization) {
      const actor = accountIdentifier(actorId);
      const target = accountIdentifier(targetId);
      const transition = validateAccountTransition(body);
      if (actor === target) throw new HttpError(403, 'ACCOUNT_TARGET_FORBIDDEN', 'This Account cannot be approved here.');
      return repository.transaction([actor, target], async (connection, accounts) => {
        activeAdmin(accounts.get(actor));
        await requireStoredSession(connection, authorization, accounts.get(actor));
        const account = accounts.get(target);
        if (!account) throw new HttpError(404, 'ACCOUNT_NOT_FOUND', 'The Account was not found.');
        if (!['DONOR', 'HOSPITAL'].includes(account.role)) {
          throw new HttpError(403, 'ACCOUNT_TARGET_FORBIDDEN', 'This Account cannot be approved here.');
        }
        if (account.accountStatus !== transition.from) {
          throw new HttpError(409, transition.conflict, transition.action === 'ACCOUNT_APPROVED'
            ? 'Only a pending Account can be approved.' : 'The Account is not in the required state for this action.');
        }
        await repository.setStatus(connection, target, transition);
        await sessionStore.revokeAccountSessions(target, connection);
        await auditWriter.write(connection, { actorAccountId: actor, actionCode: transition.action,
          subjectType: 'Account', subjectId: target, reasonCode: transition.reason,
          changeSummary: transition.summary, operationId: operationId() });
        return { accountId: target, accountStatus: transition.to };
      });
    },
  };
}
