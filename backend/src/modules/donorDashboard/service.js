import { HttpError } from '../../utils/httpError.js';
import { safeAccountError } from '../accounts/transaction.js';

const invalid = () => new HttpError(400, 'VALIDATION_ERROR', 'Activity dates are invalid.');
function date(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) throw invalid();
  const [y, m, d] = value.split('-').map(Number);
  const parsed = new Date(Date.UTC(y, m - 1, d));
  if (y < 1000 || parsed.getUTCFullYear() !== y || parsed.getUTCMonth() !== m - 1 || parsed.getUTCDate() !== d) throw invalid();
  return value;
}
export function activityQuery(query) {
  if (!query || typeof query !== 'object' || Array.isArray(query)
    || Object.keys(query).some(key => !['from', 'to'].includes(key))) throw invalid();
  const from = query.from === undefined ? null : date(query.from);
  const to = query.to === undefined ? null : date(query.to);
  if (from && to && from > to) throw invalid();
  return { from, to };
}
export function createDonorActivityService({ repository }) {
  return { async activity(donorId, query) {
    try { return await repository.activity(String(donorId), activityQuery(query)); }
    catch (error) { throw safeAccountError(error); }
  } };
}
