import { HttpError } from '../../utils/httpError.js';
import { fields, id, page, localDateTime } from '../booking/rules.js';

const invalid = () => new HttpError(400, 'VALIDATION_ERROR', 'Check the release or inventory input.');
export const rejectionReasons = ['TESTING_NOT_APPROVED', 'PROCESSING_ISSUE', 'OTHER_NON_SENSITIVE'];
export const discardReasons = ['DAMAGED', 'PACKAGING_COMPROMISED', 'TEMPERATURE_EXCURSION', 'OTHER_NON_SENSITIVE'];

export function discardInput(body) {
  fields(body, ['reasonCode'], ['reasonCode']);
  if (!discardReasons.includes(body.reasonCode)) throw invalid();
  return { reasonCode: body.reasonCode };
}

export function emptyMutationInput(body) {
  fields(body, []);
}

export function releaseInput(body) {
  fields(body, ['decision', 'confirmedBloodGroupId', 'reasonCode'], ['decision']);
  if (body.decision === 'APPROVED') {
    if (Object.hasOwn(body, 'reasonCode') || !Object.hasOwn(body, 'confirmedBloodGroupId')) throw invalid();
    return { decision: 'APPROVED', groupId: id(body.confirmedBloodGroupId), reasonCode: 'STAFF_RELEASE_APPROVED' };
  }
  if (body.decision === 'REJECTED') {
    if (Object.hasOwn(body, 'confirmedBloodGroupId') || !rejectionReasons.includes(body.reasonCode)) throw invalid();
    return { decision: 'REJECTED', groupId: null, reasonCode: body.reasonCode };
  }
  throw invalid();
}

export function inventoryQuery(query = {}) {
  fields(query, ['bloodGroupId', 'unitStatus', 'availableOnly', 'collectedFrom', 'collectedTo', 'expiresFrom', 'expiresTo', 'page']);
  const statuses = ['AVAILABLE', 'ALLOCATED', 'ISSUED', 'EXPIRED', 'DISCARDED'];
  if (query.unitStatus !== undefined && !statuses.includes(query.unitStatus)) throw invalid();
  if (query.availableOnly !== undefined && !['true', 'false'].includes(query.availableOnly)) throw invalid();
  if (query.availableOnly === 'true' && query.unitStatus && query.unitStatus !== 'AVAILABLE') throw invalid();
  const date = value => value === undefined ? undefined : localDateTime(`${value}T00:00:00+05:30`).date;
  const collectedFrom = date(query.collectedFrom), collectedTo = date(query.collectedTo);
  const expiresFrom = date(query.expiresFrom), expiresTo = date(query.expiresTo);
  if ((collectedFrom && collectedTo && collectedFrom > collectedTo)
    || (expiresFrom && expiresTo && expiresFrom > expiresTo)) throw invalid();
  return { bloodGroupId: query.bloodGroupId === undefined ? undefined : id(query.bloodGroupId),
    unitStatus: query.unitStatus, availableOnly: query.availableOnly === 'true',
    collectedFrom, collectedTo, expiresFrom, expiresTo, page: page(query.page) };
}
