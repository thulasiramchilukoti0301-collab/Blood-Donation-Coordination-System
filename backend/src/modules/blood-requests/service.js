import { randomUUID } from 'node:crypto';
import { HttpError } from '../../utils/httpError.js';
import { requestDependencyUnavailable, requestNotFound, requestValidationError } from './errors.js';
import { mapCreatedRequest, mapRequestRecord } from './response.js';
import { canonicalUnsignedId, validateCreateRequest, validateRequestId, validateRequestListQuery } from './validation.js';
import { assertRequestStatusTransition } from './lifecycle.js';

function identityFrom(principal) {
  try {
    if (!principal || !Object.hasOwn(principal, 'accountId')) throw requestValidationError();
    return canonicalUnsignedId(principal.accountId);
  } catch {
    throw new HttpError(401, 'AUTHENTICATION_REQUIRED', 'Sign in to continue.');
  }
}

async function authorize(repository, principal, role, { forUpdate = false } = {}) {
  const accountId = identityFrom(principal);
  const account = await repository.findAccountById(accountId, { forUpdate });
  if (!account) throw new HttpError(401, 'ACCOUNT_UNAVAILABLE', 'This account cannot use the current session. Sign in again if the account is active.');
  if (account.role !== role) throw new HttpError(403, 'FORBIDDEN', 'You do not have access to this resource.');
  if (account.accountStatus !== 'ACTIVE') {
    throw new HttpError(403, 'ACTIVE_ACCOUNT_REQUIRED', 'An active account is required for this operation.');
  }
  if (forUpdate) {
    if (typeof repository.authorizeSession !== 'function') throw requestDependencyUnavailable();
    await repository.authorizeSession(principal.session, account);
  }
  return accountId;
}

function requireHospitalProfile(profile) {
  if (!profile) throw new HttpError(404, 'HOSPITAL_PROFILE_NOT_FOUND', 'Hospital profile was not found.');
}

function assertCreateDependencies({ auditWriter, requestCreatedActionCode, requestableBloodGroup }) {
  if (typeof requestableBloodGroup !== 'function' || typeof requestCreatedActionCode !== 'string'
    || requestCreatedActionCode.length === 0 || typeof auditWriter?.write !== 'function') {
    throw requestDependencyUnavailable();
  }
}

// The service accepts only the trusted principal produced by the existing
// current-account middleware. It reloads Account state for every operation;
// request creation also rechecks the stored SID under the Account lock so a
// status change between the HTTP guard and transaction cannot authorize a
// stale session.
export function createBloodRequestService({ repository, auditWriter = null, requestCreatedActionCode = null,
  requestableBloodGroup = null, operationId = randomUUID, statusIntegration = null,
  historyEnabled = false, timestampSerializer = null, now = Date.now } = {}) {
  if (!repository) throw new TypeError('A blood request repository is required.');

  function mapRecord(row, options) {
    const result = mapRequestRecord(row, options);
    if (timestampSerializer && result) for (const key of ['neededBy', 'createdAt', 'updatedAt']) result[key] = timestampSerializer(row[key]);
    return result;
  }
  async function detailRecord(row, options = {}, hospitalAccountId = null) {
    const result = mapRecord(row, options);
    if (historyEnabled === true) {
      const history = await repository.findStatusHistory(result.requestId, { hospitalAccountId });
      result.requestStatusHistory = history.map((event) => ({ oldStatus: event.oldStatus, newStatus: event.newStatus,
        changedAt: timestampSerializer ? timestampSerializer(event.changedAt) : event.changedAt }));
    }
    return result;
  }

  return {
    async assertStorageReady() { return repository.assertStorageReady(); },
    async listRequestableBloodGroups(principal, query = {}) {
      if (Object.keys(query).length) throw requestValidationError();
      const accountId = identityFrom(principal);
      const account = await repository.findAccountById(accountId);
      if (!account || !['ADMIN', 'HOSPITAL'].includes(account.role)) throw new HttpError(403, 'FORBIDDEN', 'You do not have access to this resource.');
      await authorize(repository, principal, account.role);
      if (account.role === 'HOSPITAL') requireHospitalProfile(await repository.findHospitalByAccountId(accountId));
      const rows = await repository.listActiveBloodGroups();
      return rows.map((row) => ({ bloodGroupId: canonicalUnsignedId(row.bloodGroupId), code: row.code, displayName: row.displayName }));
    },
    // Internal preparation only. No HTTP mutation route calls this method.
    async reviewRequest(trustedPrincipal, requestId, input) {
      const id = validateRequestId(requestId);
      if (!input || Object.keys(input).some((key) => !['decision', 'reasonCode'].includes(key))
        || !['UNDER_REVIEW', 'AWAITING_INVENTORY', 'REJECTED'].includes(input.decision)) throw requestValidationError();
      if (statusIntegration?.enabled !== true || typeof statusIntegration.authorizeTransition !== 'function'
        || typeof statusIntegration.actionCode !== 'string' || !statusIntegration.actionCode
        || typeof auditWriter?.write !== 'function') throw requestDependencyUnavailable();
      const reason = input.reasonCode ?? null;
      if ((reason !== null && !statusIntegration.reasonCodes?.includes(reason))
        || (input.decision === 'REJECTED' && reason === null)) throw requestValidationError();
      return repository.withTransaction(async (transaction, connection) => {
        const actor = await authorize(transaction, trustedPrincipal, 'ADMIN', { forUpdate: true });
        const row = await transaction.lockRequest(id);
        if (!row) throw requestNotFound();
        assertRequestStatusTransition(row.requestStatus, input.decision);
        // This injected policy must check authoritative Allocation predicates under locks.
        if (await statusIntegration.authorizeTransition(transaction, row, input.decision) !== true) throw requestDependencyUnavailable();
        await transaction.setStatusContext({ actorAccountId: actor, reasonCode: reason });
        await transaction.updateStatus(id, row.requestStatus, input.decision, reason);
        await auditWriter.write(connection, {
          actorAccountId: actor, actionCode: statusIntegration.actionCode, subjectType: 'HospitalRequest', subjectId: id,
          reasonCode: reason, changeSummary: `Request status changed: ${row.requestStatus} -> ${input.decision}`, operationId: operationId(),
        });
        return { requestId: id, requestStatus: input.decision };
      });
    },
    async createHospitalRequest(trustedPrincipal, body) {
      const actorId = identityFrom(trustedPrincipal);
      await authorize(repository, trustedPrincipal, 'HOSPITAL');
      const input = validateCreateRequest(body, { now: now() });
      assertCreateDependencies({ auditWriter, requestCreatedActionCode, requestableBloodGroup });

      return repository.withTransaction(async (transaction, connection) => {
        const lockedActorId = await authorize(transaction, trustedPrincipal, 'HOSPITAL', { forUpdate: true });
        if (lockedActorId !== actorId) throw new HttpError(401, 'ACCOUNT_UNAVAILABLE', 'This account cannot use the current session.');
        requireHospitalProfile(await transaction.findHospitalByAccountId(actorId, { forUpdate: true }));
        const group = await transaction.findBloodGroupById(input.recipientGroupId, { forUpdate: true });
        if (!group) throw requestValidationError();
        const permitted = await requestableBloodGroup(group, { actorAccountId: actorId });
        if (typeof permitted !== 'boolean') throw requestDependencyUnavailable();
        if (!permitted) throw requestValidationError();
        // Lock waits must not allow a deadline that has elapsed since validation.
        validateCreateRequest(body, { now: now() });

        const inserted = await transaction.insertRequest({
          hospitalAccountId: actorId,
          recipientGroupId: input.recipientGroupId,
          quantityRequested: input.quantityRequested,
          priority: input.priority,
          neededBy: input.neededBy,
          note: input.note,
        });
        const requestId = canonicalUnsignedId(inserted?.requestId);
        await transaction.insertInitialStatusHistory({ requestId, actorAccountId: actorId });
        await auditWriter.write(connection, {
          actorAccountId: actorId,
          actionCode: requestCreatedActionCode,
          subjectType: 'HospitalRequest',
          subjectId: requestId,
          changeSummary: 'Hospital request created',
          operationId: operationId(),
        });
        return mapCreatedRequest({ requestId, quantityRequested: input.quantityRequested });
      });
    },

    async listHospitalRequests(trustedPrincipal, query) {
      const accountId = await authorize(repository, trustedPrincipal, 'HOSPITAL');
      requireHospitalProfile(await repository.findHospitalByAccountId(accountId));
      const filters = validateRequestListQuery(query);
      const result = await repository.listHospitalRequests(accountId, filters);
      return { requests: result.records.map((row) => mapRecord(row)), pagination: result.pagination };
    },

    async getHospitalRequest(trustedPrincipal, requestId) {
      const accountId = await authorize(repository, trustedPrincipal, 'HOSPITAL');
      requireHospitalProfile(await repository.findHospitalByAccountId(accountId));
      const record = await repository.findHospitalRequest(accountId, validateRequestId(requestId));
      if (!record) throw requestNotFound();
      return detailRecord(record, {}, accountId);
    },

    async listAdminRequests(trustedPrincipal, query) {
      const accountId = await authorize(repository, trustedPrincipal, 'ADMIN');
      const filters = validateRequestListQuery(query, { admin: true });
      const result = await repository.listAdminRequests(filters);
      return { requests: result.records.map((row) => mapRecord(row, { includeHospital: true })), pagination: result.pagination };
    },

    async getAdminRequestRecord(trustedPrincipal, requestId) {
      await authorize(repository, trustedPrincipal, 'ADMIN');
      const record = await repository.findAdminRequest(validateRequestId(requestId));
      if (!record) throw requestNotFound();
      return detailRecord(record, { includeHospital: true });
    },
  };
}
