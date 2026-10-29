import { HttpError } from '../../utils/httpError.js';
import { accountIdentifier } from '../accounts/validation.js';
import { localDateInKolkata } from '../auth/validation.js';

const invalid = () => new HttpError(400, 'VALIDATION_ERROR', 'Donor search or correction input is invalid.');
const plain = value => value && typeof value === 'object' && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));
function fields(value, allowed) {
  if (!plain(value) || Reflect.ownKeys(value).some(key => typeof key !== 'string' || !allowed.includes(key)
    || !Object.hasOwn(Object.getOwnPropertyDescriptor(value, key), 'value'))) throw invalid();
}
function page(value) {
  const raw = value === undefined ? '1' : value;
  if (typeof raw !== 'string' || !/^[1-9][0-9]*$/u.test(raw)) throw invalid();
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed > Math.floor(Number.MAX_SAFE_INTEGER / 20)) throw invalid();
  return parsed;
}
function groupId(value, { nullable = false } = {}) {
  if (nullable && (value === null || value === '')) return null;
  try { return accountIdentifier(value); } catch { throw invalid(); }
}
function text(body, field, max, { nullable = false } = {}) {
  const value = body[field];
  if (nullable && (value === null || value === '')) return null;
  if (typeof value !== 'string' || /\p{Cc}/u.test(value)) throw invalid();
  const normalized = value.trim();
  if (nullable && !normalized) return null;
  if (!normalized || [...normalized].length > max) throw invalid();
  return normalized;
}
function dateOnly(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return year >= 1000 && date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export function validateAdminDonorId(value) {
  try { return accountIdentifier(value); } catch { throw new HttpError(400, 'VALIDATION_ERROR', 'Donor identifier is invalid.'); }
}

export function adminDonorQuery(query = {}) {
  fields(query, ['search', 'accountStatus', 'bloodGroupId', 'groupMatch', 'page']);
  if (query.search !== undefined && (typeof query.search !== 'string' || [...query.search].length > 120 || /\p{Cc}/u.test(query.search))) throw invalid();
  const accountStatus = query.accountStatus ?? 'ANY';
  if (!['ANY', 'PENDING', 'ACTIVE', 'SUSPENDED'].includes(accountStatus)) throw invalid();
  const groupMatch = query.groupMatch ?? 'EITHER';
  if (!['EITHER', 'REPORTED', 'CONFIRMED'].includes(groupMatch)) throw invalid();
  return { search: query.search?.trim() ?? '', accountStatus,
    bloodGroupId: query.bloodGroupId === undefined || query.bloodGroupId === '' ? undefined : groupId(query.bloodGroupId),
    groupMatch, page: page(query.page) };
}

export function adminDonorPatch(body, now = new Date()) {
  const profile = ['fullName', 'dateOfBirth', 'phone', 'address', 'area'];
  fields(body, [...profile, 'confirmedBloodGroupId', 'reasonCode', 'originalValues']);
  const keys = Reflect.ownKeys(body);
  const hasGroup = Object.hasOwn(body, 'confirmedBloodGroupId');
  const hasProfile = profile.some(key => Object.hasOwn(body, key));
  if (!hasGroup && !hasProfile) throw invalid();
  // Keep staff confirmation separate from general profile correction so the
  // audit reason is explicit and cannot be chosen independently of the action.
  if (hasGroup && hasProfile) throw invalid();
  const reasonCode = hasGroup ? 'STAFF_GROUP_CONFIRMATION' : 'STAFF_PROFILE_CORRECTION';
  if (body.reasonCode !== reasonCode || keys.length !== (hasGroup ? 3 : profile.filter(key => Object.hasOwn(body, key)).length + 2)) throw invalid();
  const patch = {};
  for (const field of profile) {
    if (!Object.hasOwn(body, field)) continue;
    if (field === 'dateOfBirth') {
      if (!dateOnly(body[field]) || body[field] > localDateInKolkata(now)) throw new HttpError(422, 'VALIDATION_ERROR', 'Check the highlighted Donor fields.', { dateOfBirth: 'Enter a valid non-future date.' });
      patch[field] = body[field];
    } else patch[field] = text(body, field, { fullName: 120, phone: 30, address: 255, area: 100 }[field], { nullable: field === 'area' });
  }
  if (hasGroup) patch.confirmedBloodGroupId = groupId(body.confirmedBloodGroupId);
  // The precondition is the exact stored value observed by the Admin, not a
  // timestamp or a normalized replacement value. Nullable columns use JSON null.
  const changedFields = Object.keys(patch);
  fields(body.originalValues, changedFields);
  if (Reflect.ownKeys(body.originalValues).length !== changedFields.length) throw invalid();
  const originalValues = {};
  for (const field of changedFields) {
    const value = body.originalValues[field];
    if (field === 'confirmedBloodGroupId') {
      originalValues[field] = value === null ? null : groupId(value);
    } else if (field === 'dateOfBirth') {
      if (!dateOnly(value)) throw invalid();
      originalValues[field] = value;
    } else if (field === 'area' && value === null) originalValues[field] = null;
    else {
      const max = { fullName: 120, phone: 30, address: 255, area: 100 }[field];
      if (typeof value !== 'string' || !value || [...value].length > max || /\p{Cc}/u.test(value)) throw invalid();
      originalValues[field] = value;
    }
  }
  return { patch, originalValues, reasonCode, groupConfirmation: hasGroup };
}

export function validateDonorBirthDate(birthDate, now) {
  if (birthDate > localDateInKolkata(now)) {
    throw new HttpError(422, 'VALIDATION_ERROR', 'Check the highlighted Donor fields.', { dateOfBirth: 'Enter a valid non-future date.' });
  }
}
