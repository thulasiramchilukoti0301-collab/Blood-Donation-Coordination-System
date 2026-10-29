import { HttpError } from '../../utils/httpError.js';

const maximumId = 18446744073709551615n;
const subjectTypes = new Set(['Account', 'Donor', 'Hospital', 'BloodGroup', 'BloodCompatibility', 'DonationSlot', 'Booking',
  'EligibilityDecision', 'Donation', 'BloodUnit', 'HospitalRequest', 'RequestStatusHistory', 'Allocation', 'AuditEvent', 'SYSTEM_TASK']);
const allowed = new Set(['actorAccountId', 'actionCode', 'subjectType', 'subjectId', 'from', 'to', 'page', 'pageSize']);
const invalid = () => new HttpError(400, 'VALIDATION_ERROR', 'Audit search filters are invalid.');

function positiveId(value) {
  if (typeof value !== 'string' || !/^[1-9][0-9]{0,19}$/u.test(value) || BigInt(value) > maximumId) throw invalid();
  return value;
}

function date(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) throw invalid();
  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (year < 1000 || parsed.getUTCFullYear() !== year || parsed.getUTCMonth() + 1 !== month || parsed.getUTCDate() !== day) throw invalid();
  return value;
}

function positivePage(value, fallback, maximum) {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || !/^[1-9][0-9]{0,6}$/u.test(value)) throw invalid();
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed > maximum) throw invalid();
  return parsed;
}

export function validateAuditQuery(query = {}) {
  if (!query || typeof query !== 'object' || Array.isArray(query)
    || Object.keys(query).some((key) => !allowed.has(key))) throw invalid();
  const result = { page: positivePage(query.page, 1, 1_000_000), pageSize: positivePage(query.pageSize, 25, 100) };
  if (query.actorAccountId !== undefined) result.actorAccountId = positiveId(query.actorAccountId);
  if (query.subjectId !== undefined) result.subjectId = positiveId(query.subjectId);
  if (query.actionCode !== undefined) {
    if (typeof query.actionCode !== 'string' || !/^[\x21-\x7e]{1,48}$/u.test(query.actionCode)) throw invalid();
    result.actionCode = query.actionCode;
  }
  if (query.subjectType !== undefined) {
    if (typeof query.subjectType !== 'string' || !subjectTypes.has(query.subjectType)) throw invalid();
    result.subjectType = query.subjectType;
  }
  if (query.from !== undefined) result.from = date(query.from);
  if (query.to !== undefined) result.to = date(query.to);
  if (result.from && result.to && result.from > result.to) throw invalid();
  return result;
}

export const auditSubjectTypes = Object.freeze([...subjectTypes]);
