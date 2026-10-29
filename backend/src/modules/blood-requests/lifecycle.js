import { HttpError } from '../../utils/httpError.js';
import { requestDependencyUnavailable, requestValidationError } from './errors.js';
import { requestStatuses } from './validation.js';

const transitions = new Map([
  ['SUBMITTED', new Set(['UNDER_REVIEW', 'CANCELLED'])],
  ['UNDER_REVIEW', new Set(['AWAITING_INVENTORY', 'PARTIALLY_FULFILLED', 'REJECTED', 'CANCELLED'])],
  ['AWAITING_INVENTORY', new Set(['PARTIALLY_FULFILLED', 'CANCELLED'])],
  ['PARTIALLY_FULFILLED', new Set(['FULFILLED', 'AWAITING_INVENTORY', 'CANCELLED'])],
  ['FULFILLED', new Set()],
  ['REJECTED', new Set()],
  ['CANCELLED', new Set()],
]);

export function canTransitionRequestStatus(currentStatus, nextStatus) {
  return transitions.get(currentStatus)?.has(nextStatus) ?? false;
}

export function assertRequestStatusTransition(currentStatus, nextStatus) {
  if (!requestStatuses.includes(currentStatus) || !requestStatuses.includes(nextStatus)) throw requestValidationError();
  if (!canTransitionRequestStatus(currentStatus, nextStatus)) {
    throw new HttpError(409, 'INVALID_REQUEST_TRANSITION', 'The request cannot move to that status.');
  }
}

export function assertHospitalCancellationBeforeIssue(issuedQuantity) {
  if (issuedQuantity === null || issuedQuantity === undefined) throw requestDependencyUnavailable();
  if (!Number.isSafeInteger(issuedQuantity) || issuedQuantity < 0) throw requestValidationError();
  if (issuedQuantity > 0) {
    throw new HttpError(409, 'CANCELLATION_NOT_PERMITTED', 'A request cannot be cancelled after a unit has been issued.');
  }
  return true;
}
