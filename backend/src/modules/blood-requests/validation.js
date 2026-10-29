import { requestValidationError } from './errors.js';

export const requestStatuses = Object.freeze([
  'SUBMITTED', 'UNDER_REVIEW', 'AWAITING_INVENTORY', 'PARTIALLY_FULFILLED', 'FULFILLED', 'REJECTED', 'CANCELLED',
]);
export const requestPriorities = Object.freeze(['EMERGENCY', 'URGENT', 'NORMAL']);
export const requestPageSize = 20;

const maximumUnsignedBigInt = 18446744073709551615n;
const allowedCreateFields = new Set(['recipientGroupId', 'quantityRequested', 'priority', 'neededBy', 'note']);
const hospitalQueryFields = new Set([
  'requestStatus', 'priority', 'recipientGroupId', 'submittedFrom', 'submittedTo', 'neededByFrom', 'neededByTo', 'page',
]);
const adminQueryFields = new Set([...hospitalQueryFields, 'hospitalId']);
const controls = /\p{Cc}/u;

function plainDataObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw requestValidationError();
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (typeof key !== 'string' || !descriptor || !Object.hasOwn(descriptor, 'value')) throw requestValidationError();
  }
}

export function canonicalUnsignedId(value) {
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value < 1) throw requestValidationError();
    value = String(value);
  }
  if (typeof value !== 'string' || !/^[1-9][0-9]{0,19}$/u.test(value) || BigInt(value) > maximumUnsignedBigInt) {
    throw requestValidationError();
  }
  return value;
}

function calendarDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) throw requestValidationError();
  const [year, month, day] = value.split('-').map(Number);
  if (year < 1000 || year > 9999) throw requestValidationError();
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() + 1 !== month || date.getUTCDate() !== day) {
    throw requestValidationError();
  }
  return value;
}

function localProjectDateTime(value) {
  // Second precision, explicit offset, normalized to the project's DATETIME zone.
  const match = typeof value === 'string'
    ? /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(Z|([+-])(\d{2}):(\d{2}))$/u.exec(value)
    : null;
  if (!match) throw requestValidationError();
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, zone, sign, offsetHourText, offsetMinuteText] = match;
  const [year, month, day, hour, minute, second] = [yearText, monthText, dayText, hourText, minuteText, secondText].map(Number);
  if (year < 1000 || year > 9999 || hour > 23 || minute > 59 || second > 59) throw requestValidationError();
  const wallClock = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  if (wallClock.getUTCFullYear() !== year || wallClock.getUTCMonth() + 1 !== month || wallClock.getUTCDate() !== day) {
    throw requestValidationError();
  }
  let offsetMinutes = 0;
  if (zone !== 'Z') {
    const offsetHour = Number(offsetHourText);
    const offsetMinute = Number(offsetMinuteText);
    if (offsetHour > 14 || offsetMinute > 59 || (offsetHour === 14 && offsetMinute !== 0)) throw requestValidationError();
    offsetMinutes = (offsetHour * 60 + offsetMinute) * (sign === '+' ? 1 : -1);
  }
  const indiaWallClock = new Date(wallClock.getTime() - offsetMinutes * 60_000 + 330 * 60_000);
  const indiaYear = indiaWallClock.getUTCFullYear();
  if (indiaYear < 1000 || indiaYear > 9999) throw requestValidationError();
  const pad = (number) => String(number).padStart(2, '0');
  return `${String(indiaYear).padStart(4, '0')}-${pad(indiaWallClock.getUTCMonth() + 1)}-${pad(indiaWallClock.getUTCDate())} `
    + `${pad(indiaWallClock.getUTCHours())}:${pad(indiaWallClock.getUTCMinutes())}:${pad(indiaWallClock.getUTCSeconds())}`;
}

function rangeDate(value) {
  return value === undefined ? undefined : calendarDate(value);
}

function positivePage(value) {
  if (value === undefined) return 1;
  if (typeof value !== 'string' || !/^[1-9][0-9]*$/u.test(value)) throw requestValidationError();
  const page = Number(value);
  if (!Number.isSafeInteger(page) || page > Math.floor(Number.MAX_SAFE_INTEGER / requestPageSize)) {
    throw requestValidationError();
  }
  return page;
}

export function validateRequestId(value) {
  return canonicalUnsignedId(value);
}

export function validateCreateRequest(input, { now = Date.now() } = {}) {
  plainDataObject(input);
  if (Object.keys(input).some((key) => !allowedCreateFields.has(key))) throw requestValidationError();
  const recipientGroupId = canonicalUnsignedId(input.recipientGroupId);
  if (!Number.isInteger(input.quantityRequested) || input.quantityRequested < 1 || input.quantityRequested > 65535) {
    throw requestValidationError();
  }
  if (!requestPriorities.includes(input.priority)) throw requestValidationError();
  const neededBy = localProjectDateTime(input.neededBy);
  if (!Number.isFinite(now) || Date.parse(`${neededBy.replace(' ', 'T')}+05:30`) <= now) throw requestValidationError();
  let note = null;
  if (Object.hasOwn(input, 'note') && input.note !== null) {
    if (typeof input.note !== 'string' || [...input.note].length > 500 || controls.test(input.note)) throw requestValidationError();
    note = input.note.trim() || null;
  }
  return { recipientGroupId, quantityRequested: input.quantityRequested, priority: input.priority, neededBy, note };
}

export function validateRequestListQuery(input = {}, { admin = false } = {}) {
  plainDataObject(input);
  const allowed = admin ? adminQueryFields : hospitalQueryFields;
  if (Object.keys(input).some((key) => !allowed.has(key))) throw requestValidationError();

  const requestStatus = input.requestStatus;
  const priority = input.priority;
  if (requestStatus !== undefined && !requestStatuses.includes(requestStatus)) throw requestValidationError();
  if (priority !== undefined && !requestPriorities.includes(priority)) throw requestValidationError();

  const submittedFrom = rangeDate(input.submittedFrom);
  const submittedTo = rangeDate(input.submittedTo);
  const neededByFrom = rangeDate(input.neededByFrom);
  const neededByTo = rangeDate(input.neededByTo);
  if ((submittedFrom && submittedTo && submittedFrom > submittedTo)
    || (neededByFrom && neededByTo && neededByFrom > neededByTo)) throw requestValidationError();

  const filters = {
    requestStatus,
    priority,
    recipientGroupId: input.recipientGroupId === undefined ? undefined : canonicalUnsignedId(input.recipientGroupId),
    submittedFrom,
    submittedTo,
    neededByFrom,
    neededByTo,
    page: positivePage(input.page),
  };
  if (admin && input.hospitalId !== undefined) filters.hospitalId = canonicalUnsignedId(input.hospitalId);
  return filters;
}
