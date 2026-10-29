import { HttpError } from '../../utils/httpError.js';
import { fields, id, localDateTime, page } from '../booking/rules.js';

const invalid = () => new HttpError(400, 'VALIDATION_ERROR', 'Check the donation input.');
const outcomes = ['COLLECTED', 'INCOMPLETE', 'DEFERRED'];
const releases = ['PENDING', 'APPROVED', 'REJECTED', 'NOT_REQUIRED'];
const control = /\p{Cc}/u;

export function donationInput(body) {
  fields(body, ['bookingId', 'outcome', 'collectedAt', 'collectionReference'], ['bookingId', 'outcome']);
  const bookingId = id(body.bookingId);
  if (!outcomes.includes(body.outcome)) throw invalid();
  if (body.outcome !== 'COLLECTED') {
    if (Object.hasOwn(body, 'collectedAt') || Object.hasOwn(body, 'collectionReference')) throw invalid();
    return { bookingId, outcome: body.outcome, collectedAt: null, collectionReference: null,
      releaseStatus: 'NOT_REQUIRED' };
  }
  if (!Object.hasOwn(body, 'collectedAt') || !Object.hasOwn(body, 'collectionReference')) throw invalid();
  const collectedAt = localDateTime(body.collectedAt);
  const collectionReference = typeof body.collectionReference === 'string' ? body.collectionReference.trim() : '';
  if (!collectionReference || [...collectionReference].length > 80 || control.test(collectionReference)) throw invalid();
  return { bookingId, outcome: body.outcome, collectedAt, collectionReference, releaseStatus: 'PENDING' };
}

export function donationQuery(query = {}, admin = false) {
  fields(query, admin ? ['donorAccountId', 'outcome', 'releaseStatus', 'from', 'to', 'page'] : ['from', 'to', 'page']);
  if (query.outcome !== undefined && !outcomes.includes(query.outcome)) throw invalid();
  if (query.releaseStatus !== undefined && !releases.includes(query.releaseStatus)) throw invalid();
  const date = value => value === undefined ? undefined : localDateTime(`${value}T00:00:00+05:30`).date;
  const from = date(query.from), to = date(query.to);
  if (from && to && from > to) throw invalid();
  return { donorAccountId: query.donorAccountId === undefined ? undefined : id(query.donorAccountId),
    outcome: query.outcome, releaseStatus: query.releaseStatus, from, to, page: page(query.page) };
}
