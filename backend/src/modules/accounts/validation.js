import { HttpError } from '../../utils/httpError.js';

const invalid = () => new HttpError(400, 'VALIDATION_ERROR', 'Account query or approval input is invalid.');
function object(value, allowed) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw invalid();
  if (Reflect.ownKeys(value).some((key) => !allowed.includes(key)
    || !Object.hasOwn(Object.getOwnPropertyDescriptor(value, key), 'value'))) throw invalid();
}
export function accountIdentifier(value) {
  if (typeof value !== 'string' || /^[1-9][0-9]{0,19}$/u.exec(value)?.[0] !== value
    || BigInt(value) > 18446744073709551615n) throw invalid();
  return value;
}
export function validateAccountQueue(query = {}) {
  object(query, ['role', 'accountStatus', 'search', 'page']);
  if (query.role !== undefined && !['DONOR', 'HOSPITAL'].includes(query.role)) throw invalid();
  const accountStatus = query.accountStatus === undefined ? 'PENDING' : query.accountStatus;
  if (!['PENDING', 'ACTIVE', 'SUSPENDED'].includes(accountStatus)) throw invalid();
  if (query.search !== undefined && (typeof query.search !== 'string'
    || [...query.search].length > 254 || /\p{Cc}/u.test(query.search))) throw invalid();
  const search = query.search?.trim() ?? '';
  const rawPage = query.page === undefined ? '1' : query.page;
  if (typeof rawPage !== 'string' || /^[1-9][0-9]*$/u.exec(rawPage)?.[0] !== rawPage) throw invalid();
  const page = Number(rawPage);
  if (!Number.isSafeInteger(page) || page > Math.floor(Number.MAX_SAFE_INTEGER / 20)) throw invalid();
  return { role: query.role, accountStatus, search, page };
}
export function validateApproval(body) {
  object(body, ['accountStatus', 'reason']);
  if (Reflect.ownKeys(body).length !== 2 || body.accountStatus !== 'ACTIVE'
    || body.reason !== 'REGISTRATION_REVIEWED') throw invalid();
  return { accountStatus: 'ACTIVE', reason: 'REGISTRATION_REVIEWED' };
}
