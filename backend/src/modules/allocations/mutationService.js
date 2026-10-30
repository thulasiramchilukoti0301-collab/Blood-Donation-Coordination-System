import { randomUUID } from 'node:crypto';
import { HttpError } from '../../utils/httpError.js';
import { requireStoredSession } from '../accounts/sessionAuthorization.js';
import { todayIst } from '../booking/rules.js';
import { requestTransitionReasons } from '../blood-requests/contracts.js';
import { createAuditWriter } from '../audit/writer.js';

const maxId = 18446744073709551615n;
const maxSelection = 25;
const allocatable = new Set(['UNDER_REVIEW', 'AWAITING_INVENTORY', 'PARTIALLY_FULFILLED']);
const invalid = () => new HttpError(400, 'VALIDATION_ERROR', 'Allocation confirmation input is invalid.');
const stale = () => new HttpError(409, 'ALLOCATION_PREVIEW_STALE',
  'The request or selected inventory changed. Refresh the request preview and review the exact FEFO unit IDs again.');
const unavailable = () => new HttpError(503, 'ALLOCATION_UNAVAILABLE', 'Allocation data is temporarily unavailable.');

function id(value) {
  if (typeof value !== 'string' || !/^[1-9][0-9]{0,19}$/u.test(value) || BigInt(value) > maxId) throw invalid();
  return value;
}

function calendarDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) throw invalid();
  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (year < 1000 || year > 9999 || parsed.getUTCFullYear() !== year
    || parsed.getUTCMonth() + 1 !== month || parsed.getUTCDate() !== day) throw invalid();
  return value;
}

function input(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(body))) throw invalid();
  const fields = Reflect.ownKeys(body);
  if (fields.some(key => typeof key !== 'string' || !['bloodUnitIds', 'intendedIssueDate'].includes(key)
      || !Object.hasOwn(Object.getOwnPropertyDescriptor(body, key), 'value'))
    || fields.length !== 2 || !Array.isArray(body.bloodUnitIds)
    || body.bloodUnitIds.length < 1 || body.bloodUnitIds.length > maxSelection) throw invalid();
  const bloodUnitIds = body.bloodUnitIds.map(id);
  if (new Set(bloodUnitIds).size !== bloodUnitIds.length) throw invalid();
  return { bloodUnitIds, intendedIssueDate: calendarDate(body.intendedIssueDate) };
}

function issueInput(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(body))
    || Reflect.ownKeys(body).length !== 1 || !Object.hasOwn(body, 'handoffReference')) throw invalid();
  const raw = typeof body.handoffReference === 'string' ? body.handoffReference : '';
  if (!raw.trim() || [...raw].length > 80 || /\p{Cc}/u.test(raw)) throw invalid();
  return raw.trim();
}

function orderedIds(ids) { return [...ids].sort((a, b) => BigInt(a) < BigInt(b) ? -1 : BigInt(a) > BigInt(b) ? 1 : 0); }

function mapTransactionError(error) {
  if (error instanceof HttpError) return error;
  if (['ER_LOCK_DEADLOCK', 'ER_LOCK_WAIT_TIMEOUT'].includes(error?.code)
    || [1205, 1213].includes(error?.errno)) return new HttpError(409, 'ALLOCATION_CONFLICT',
      'Concurrent inventory activity prevented this allocation. Refresh the preview before another attempt.');
  if (error?.code === 'ER_DUP_ENTRY') return stale();
  return unavailable();
}

export function createAllocationMutationService({ repository, auditWriter = createAuditWriter({
  allowedActionCodes: ['ALLOCATION_CREATED', 'ALLOCATION_ISSUED', 'HOSPITAL_REQUEST_STATUS_CHANGED'],
}), operationId = randomUUID, clock = Date.now } = {}) {
  if (!repository || typeof repository.transaction !== 'function') throw new TypeError('An allocation mutation repository is required.');

  return {
    async allocate(requestIdValue, actorIdValue, body, authorization) {
      const requestId = id(requestIdValue);
      const actorId = id(actorIdValue);
      const values = input(body);
      const today = todayIst(clock());
      if (values.intendedIssueDate < today) throw invalid();
      try {
        return await repository.transaction(actorId, async (connection, accounts) => {
          const actor = accounts.get(actorId);
          if (!actor || actor.role !== 'ADMIN' || actor.accountStatus !== 'ACTIVE') {
            throw new HttpError(401, 'ACCOUNT_UNAVAILABLE', 'Sign in with an active Admin account.');
          }
          await requireStoredSession(connection, authorization, actor);
          const request = await repository.lockRequest(connection, requestId);
          if (!request) throw new HttpError(404, 'REQUEST_NOT_FOUND', 'The blood request was not found.');
          if (!allocatable.has(request.requestStatus) || request.requestStatus === 'SUBMITTED') throw stale();
          if (values.intendedIssueDate > request.neededBy.slice(0, 10)) throw invalid();

          // Lock all reference groups first. This prevents an approved release
          // from adding a new eligible unit while the FEFO candidate set is bound.
          const groupRows = await repository.lockBloodGroups(connection);
          if (!groupRows.some(row => row.bloodGroupId === request.recipientGroupId && row.isActive)) throw stale();
          const compatibleGroupIds = await repository.compatibleGroups(connection, request.recipientGroupId);
          const snapshot = await repository.candidateSnapshot(connection, compatibleGroupIds, values.intendedIssueDate);
          if (snapshot.some(row => row.hasActiveAllocation === 1 || row.hasActiveAllocation === true)) {
            throw new HttpError(503, 'ALLOCATION_CONSISTENCY_ERROR',
              'An available unit already has an active allocation. No inventory was changed.');
          }
          const expected = snapshot.slice(0, values.bloodUnitIds.length).map(row => String(row.bloodUnitId));
          if (expected.length !== values.bloodUnitIds.length
            || expected.some((unitId, index) => unitId !== values.bloodUnitIds[index])) throw stale();
          const requestUnits = await repository.activeRequestUnits(connection, requestId);

          // Expiry reconciliation takes BloodUnit locks in (expiry_date, unit_id)
          // order. Use that same order even though FEFO has collection time as a
          // secondary selection key. Also lock every unit already counted toward
          // this request so Allocation/BloodUnit status consistency is authoritative.
          const lockTargets = new Map();
          for (const row of [...snapshot.slice(0, expected.length), ...requestUnits]) lockTargets.set(String(row.bloodUnitId), row);
          const lockOrder = [...lockTargets.values()].sort((a, b) => a.expiryDate.localeCompare(b.expiryDate)
            || (BigInt(a.bloodUnitId) < BigInt(b.bloodUnitId) ? -1 : BigInt(a.bloodUnitId) > BigInt(b.bloodUnitId) ? 1 : 0));
          const lockedUnits = new Map();
          for (const candidate of lockOrder) {
            const unit = await repository.lockUnit(connection, String(candidate.bloodUnitId));
            if (!unit) throw stale();
            lockedUnits.set(String(unit.bloodUnitId), unit);
            if (expected.includes(String(candidate.bloodUnitId))) {
              if (unit.unitStatus !== 'AVAILABLE' || unit.expiryDate <= values.intendedIssueDate
                || String(unit.donationId) !== String(candidate.donationId)
                || String(unit.bloodGroupId) !== String(candidate.bloodGroupId)) throw stale();
            } else if (unit.unitStatus !== candidate.allocationStatus) {
              throw new HttpError(503, 'ALLOCATION_CONSISTENCY_ERROR',
                'Request allocation and BloodUnit statuses disagree. No inventory was changed.');
            }
          }

          // Lock every relevant Allocation row once, in global allocation ID
          // order, after unit locks. This detects unit/status divergence and
          // serializes request totals with cancellation/other allocation work.
          const relevant = await repository.lockAllocations(connection, requestId, orderedIds(expected));
          const requestRows = relevant.filter(row => row.requestId === requestId
            && ['ALLOCATED', 'ISSUED'].includes(row.allocationStatus));
          if (requestRows.length !== requestUnits.length || requestRows.some(row => {
            const unit = lockedUnits.get(row.bloodUnitId);
            return !unit || unit.unitStatus !== row.allocationStatus;
          })) throw new HttpError(503, 'ALLOCATION_CONSISTENCY_ERROR',
            'Request allocation and BloodUnit statuses disagree. No inventory was changed.');
          const activeByUnit = new Map();
          for (const row of relevant) if (['ALLOCATED', 'ISSUED'].includes(row.allocationStatus)) {
            activeByUnit.set(row.bloodUnitId, row);
          }
          if (expected.some(unitId => activeByUnit.has(unitId))) {
            throw new HttpError(503, 'ALLOCATION_CONSISTENCY_ERROR',
              'An available unit already has an active allocation. No inventory was changed.');
          }
          const allocated = requestRows.filter(row => row.allocationStatus === 'ALLOCATED').length;
          const issued = requestRows.filter(row => row.allocationStatus === 'ISSUED').length;
          const quantity = Number(request.quantityRequested);
          const outstanding = quantity - allocated - issued;
          if (!Number.isSafeInteger(quantity) || !Number.isSafeInteger(outstanding) || outstanding < values.bloodUnitIds.length) throw stale();
          if (request.requestStatus !== 'PARTIALLY_FULFILLED' && allocated + issued !== 0) {
            throw new HttpError(503, 'ALLOCATION_CONSISTENCY_ERROR', 'Request status and stored allocations disagree.');
          }

          // Revalidate the actual stored session after all row-lock waits and
          // immediately before the first write.
          await requireStoredSession(connection, authorization, actor);
          const op = operationId();
          const created = [];
          const firstIds = new Map(expected.map((unitId, index) => [unitId, snapshot[index]]));
          for (const bloodUnitId of values.bloodUnitIds) {
            const candidate = firstIds.get(bloodUnitId);
            if (!candidate || await repository.reserveBloodUnit(connection, bloodUnitId, values.intendedIssueDate) !== 1) throw stale();
            const allocationId = await repository.createAllocation(connection, { requestId, bloodUnitId, actorAccountId: actorId });
            created.push({ allocationId, bloodUnitId });
            await auditWriter.write(connection, { actorAccountId: actorId, actionCode: 'ALLOCATION_CREATED',
              subjectType: 'Allocation', subjectId: allocationId, reasonCode: null,
              changeSummary: 'Blood unit reserved for hospital request', operationId: op });
          }
          let requestStatus = request.requestStatus;
          if (requestStatus !== 'PARTIALLY_FULFILLED') {
            const reasonCode = requestTransitionReasons.PARTIALLY_FULFILLED;
            await repository.setRequestStatusContext(connection, actorId, reasonCode);
            if (await repository.updateRequestStatus(connection, requestId, requestStatus) !== 1) throw stale();
            await repository.setStatusContextClear(connection);
            requestStatus = 'PARTIALLY_FULFILLED';
            await auditWriter.write(connection, { actorAccountId: actorId, actionCode: 'HOSPITAL_REQUEST_STATUS_CHANGED',
              subjectType: 'HospitalRequest', subjectId: requestId, reasonCode,
              changeSummary: `Request status changed: ${request.requestStatus} -> PARTIALLY_FULFILLED`, operationId: op });
          }
          return { requestId, allocations: created, allocated: allocated + created.length, issued,
            outstanding: outstanding - created.length, requestStatus, operationId: op };
        }, authorization);
      } catch (error) { throw mapTransactionError(error); }
    },
    async issue(allocationIdValue, actorIdValue, body, authorization) {
      const allocationId = id(allocationIdValue);
      const actorId = id(actorIdValue);
      const handoffReference = issueInput(body);
      let hint;
      try { hint = await repository.allocationHint(allocationId); }
      catch (error) { throw mapTransactionError(error); }
      if (!hint) throw new HttpError(404, 'ALLOCATION_NOT_FOUND', 'The allocation was not found.');
      try {
        return await repository.transaction(actorId, async (connection, accounts) => {
          const actor = accounts.get(actorId);
          if (!actor || actor.role !== 'ADMIN' || actor.accountStatus !== 'ACTIVE') {
            throw new HttpError(401, 'ACCOUNT_UNAVAILABLE', 'Sign in with an active Admin account.');
          }
          await requireStoredSession(connection, authorization, actor);
          const request = await repository.lockRequest(connection, hint.requestId);
          if (!request) throw new HttpError(404, 'REQUEST_NOT_FOUND', 'The blood request was not found.');
          if (request.requestStatus !== 'PARTIALLY_FULFILLED') throw stale();
          const requestUnits = await repository.activeRequestUnits(connection, hint.requestId);
          const targetMetadata = await repository.unitOrderDetails(connection, hint.bloodUnitId);
          if (!targetMetadata) throw stale();
          const unitTargets = new Map(requestUnits.map(row => [row.bloodUnitId, row]));
          if (!unitTargets.has(hint.bloodUnitId)) unitTargets.set(hint.bloodUnitId, targetMetadata);
          const lockOrder = [...unitTargets.values()].sort((a, b) => a.expiryDate.localeCompare(b.expiryDate)
            || (BigInt(a.bloodUnitId) < BigInt(b.bloodUnitId) ? -1 : BigInt(a.bloodUnitId) > BigInt(b.bloodUnitId) ? 1 : 0));
          const lockedUnits = new Map();
          for (const target of lockOrder) {
            const unit = await repository.lockUnit(connection, target.bloodUnitId);
            if (!unit) throw stale();
            lockedUnits.set(unit.bloodUnitId, unit);
            if (target.allocationStatus && unit.unitStatus !== target.allocationStatus) {
              throw new HttpError(503, 'ALLOCATION_CONSISTENCY_ERROR', 'Request allocation and BloodUnit statuses disagree.');
            }
          }
          const relevant = await repository.lockAllocations(connection, hint.requestId, [hint.bloodUnitId]);
          const activeRows = relevant.filter(row => row.requestId === hint.requestId
            && ['ALLOCATED', 'ISSUED'].includes(row.allocationStatus));
          const target = relevant.find(row => row.allocationId === allocationId && row.requestId === hint.requestId
            && row.bloodUnitId === hint.bloodUnitId);
          if (activeRows.length !== requestUnits.length || activeRows.some(row => {
            const unit = lockedUnits.get(row.bloodUnitId);
            return !unit || unit.unitStatus !== row.allocationStatus;
          })) throw new HttpError(503, 'ALLOCATION_CONSISTENCY_ERROR', 'Request allocation and BloodUnit statuses disagree.');
          const unit = lockedUnits.get(hint.bloodUnitId);
          if (!target || target.allocationStatus !== 'ALLOCATED' || unit?.unitStatus !== 'ALLOCATED') throw stale();
          const today = todayIst(clock());
          if (unit.expiryDate <= today) throw new HttpError(409, 'UNIT_EXPIRY_DUE', 'This reserved unit cannot be issued after its expiry date.');
          const quantity = Number(request.quantityRequested);
          const allocated = activeRows.filter(row => row.allocationStatus === 'ALLOCATED').length;
          const issued = activeRows.filter(row => row.allocationStatus === 'ISSUED').length;
          if (!Number.isSafeInteger(quantity) || activeRows.length > quantity || allocated < 1) {
            throw new HttpError(503, 'ALLOCATION_CONSISTENCY_ERROR', 'Request quantities and active allocations disagree.');
          }
          await requireStoredSession(connection, authorization, actor);
          const issuedAt = await repository.issueAllocation(connection, allocationId, handoffReference);
          if (!issuedAt || await repository.issueBloodUnit(connection, hint.bloodUnitId) !== 1) throw stale();
          const op = operationId();
          await auditWriter.write(connection, { actorAccountId: actorId, actionCode: 'ALLOCATION_ISSUED',
            subjectType: 'Allocation', subjectId: allocationId, reasonCode: null,
            changeSummary: 'Blood unit issued to hospital', operationId: op });
          let requestStatus = request.requestStatus;
          if (issued + 1 === quantity) {
            if (allocated !== 1 || activeRows.length !== quantity) {
              throw new HttpError(503, 'ALLOCATION_CONSISTENCY_ERROR', 'All requested units must be issued before the request is fulfilled.');
            }
            const reasonCode = requestTransitionReasons.FULFILLED;
            await repository.setRequestStatusContext(connection, actorId, reasonCode);
            if (await repository.updateFulfilledRequestStatus(connection, hint.requestId) !== 1) throw stale();
            await repository.setStatusContextClear(connection);
            requestStatus = 'FULFILLED';
            await auditWriter.write(connection, { actorAccountId: actorId, actionCode: 'HOSPITAL_REQUEST_STATUS_CHANGED',
              subjectType: 'HospitalRequest', subjectId: hint.requestId, reasonCode,
              changeSummary: `Request status changed: ${request.requestStatus} -> FULFILLED`, operationId: op });
          }
          return { allocationId, requestId: hint.requestId, bloodUnitId: hint.bloodUnitId,
            allocationStatus: 'ISSUED', unitStatus: 'ISSUED', issuedAt: `${issuedAt.replace(' ', 'T')}+05:30`,
            handoffReference, requestStatus, allocated: allocated - 1, issued: issued + 1,
            outstanding: quantity - (allocated + issued) };
        });
      } catch (error) { throw mapTransactionError(error); }
    },
  };
}
