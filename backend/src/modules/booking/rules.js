import { HttpError } from '../../utils/httpError.js';
import { accountIdentifier } from '../accounts/validation.js';

export const IST_OFFSET_MS = 330 * 60_000;
const invalid = () => new HttpError(400, 'VALIDATION_ERROR', 'Check the booking or slot input.');
const plain = value => value && typeof value === 'object' && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));
export function fields(value, allowed, required = []) {
  if (!plain(value) || Reflect.ownKeys(value).some(key => typeof key !== 'string' || !allowed.includes(key)
    || !Object.hasOwn(Object.getOwnPropertyDescriptor(value, key), 'value'))
    || required.some(key => !Object.hasOwn(value, key))) throw invalid();
  return value;
}
export function id(value) { try { return accountIdentifier(value); } catch { throw invalid(); } }
export function page(value) {
  const text = value === undefined ? '1' : value;
  if (typeof text !== 'string' || !/^[1-9][0-9]*$/u.test(text)) throw invalid();
  const number = Number(text);
  if (!Number.isSafeInteger(number) || number > Math.floor(Number.MAX_SAFE_INTEGER / 20)) throw invalid();
  return number;
}
export function localDateTime(value) {
  if (typeof value !== 'string') throw invalid();
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?\+05:30$/u.exec(value);
  if (!match) throw invalid();
  const [, year, month, day, hour, minute, second = '00'] = match;
  const local = `${year}-${month}-${day} ${hour}:${minute}:${second}`;
  const utc = Date.UTC(+year, +month - 1, +day, +hour, +minute, +second) - IST_OFFSET_MS;
  if (!Number.isFinite(utc) || new Date(utc + IST_OFFSET_MS).toISOString().slice(0, 19).replace('T', ' ') !== local
    || +year < 1000 || +year > 9999) throw invalid();
  return { local, utc, date: local.slice(0, 10), iso: `${local.replace(' ', 'T')}+05:30` };
}
export function storedTime(value) {
  const text = value instanceof Date ? new Date(value.getTime() + IST_OFFSET_MS).toISOString().slice(0, 19)
    : String(value).slice(0, 19).replace('T', ' ');
  return localDateTime(`${text.replace(' ', 'T')}+05:30`);
}
export function todayIst(now = Date.now()) { return new Date(now + IST_OFFSET_MS).toISOString().slice(0, 10); }
export function addDays(date, days) {
  const utc = Date.parse(`${date}T00:00:00Z`);
  return new Date(utc + days * 86_400_000).toISOString().slice(0, 10);
}
export function eligibility({ lastCollectedDate, decision }, evaluationDate) {
  const nextEligibleDate = lastCollectedDate ? addDays(lastCollectedDate, 56) : null;
  const latestDecision = decision?.decision ?? null;
  const deferredUntil = decision?.deferredUntil ?? null;
  let result = 'ELIGIBLE';
  let reasonCode = 'NO_BLOCKING_HISTORY';
  if (latestDecision === 'REVIEW_REQUIRED') { result = 'STAFF_REVIEW_REQUIRED'; reasonCode = 'STAFF_REVIEW_PENDING'; }
  else if (latestDecision === 'TEMPORARILY_DEFERRED' && deferredUntil >= evaluationDate) {
    result = 'INELIGIBLE_UNTIL_DATE'; reasonCode = 'TEMPORARY_DEFERRAL';
  } else if (nextEligibleDate && nextEligibleDate > evaluationDate) {
    result = 'INELIGIBLE_UNTIL_DATE'; reasonCode = 'COLLECTION_INTERVAL';
  }
  return { result, reasonCode, evaluationDate, nextEligibleDate, deferredUntil: latestDecision === 'TEMPORARILY_DEFERRED' ? deferredUntil : null,
    latestDecision };
}
export function capacity(value) {
  if (!Number.isInteger(value) || value < 1 || value > 65535) throw invalid();
  return value;
}
export function slotCreate(body, now = Date.now()) {
  fields(body, ['startsAt', 'endsAt', 'capacity'], ['startsAt', 'endsAt', 'capacity']);
  const start = localDateTime(body.startsAt); const end = localDateTime(body.endsAt);
  if (start.utc <= now || end.utc <= start.utc) throw invalid();
  return { start, end, capacity: capacity(body.capacity) };
}
export function slotPatch(body) {
  fields(body, ['startsAt', 'endsAt', 'capacity', 'slotStatus', 'reason']);
  if (!Object.keys(body).length) throw invalid();
  if (body.slotStatus !== undefined) {
    if (!['CLOSED', 'CANCELLED'].includes(body.slotStatus)
      || body.reason !== (body.slotStatus === 'CLOSED' ? 'STAFF_CLOSED' : 'STAFF_CANCELLED')
      || Object.keys(body).some(key => !['slotStatus', 'reason'].includes(key))) throw invalid();
    return { status: body.slotStatus, reason: body.reason };
  }
  if (Object.hasOwn(body, 'reason')) throw invalid();
  return { capacity: body.capacity === undefined ? undefined : capacity(body.capacity),
    start: body.startsAt === undefined ? undefined : localDateTime(body.startsAt),
    end: body.endsAt === undefined ? undefined : localDateTime(body.endsAt) };
}
export function bookingQuery(query = {}, admin = false) {
  fields(query, admin ? ['donor', 'bookingStatus', 'from', 'to', 'page'] : ['bookingStatus', 'from', 'to', 'page']);
  const statuses = ['BOOKED', 'CANCELLED_BY_DONOR', 'CANCELLED_BY_STAFF', 'CHECKED_IN', 'NO_SHOW', 'COMPLETED'];
  if (query.bookingStatus !== undefined && !statuses.includes(query.bookingStatus)) throw invalid();
  const date = value => { if (value === undefined) return undefined; const time = localDateTime(`${value}T00:00:00+05:30`); return time.date; };
  const from = date(query.from), to = date(query.to);
  if (from && to && from > to) throw invalid();
  const donor = query.donor === undefined ? undefined : id(query.donor);
  return { donor, bookingStatus: query.bookingStatus, from, to, page: page(query.page) };
}
export function slotQuery(query = {}, admin = false) {
  fields(query, admin ? ['from', 'to', 'slotStatus', 'page'] : ['from', 'to', 'page']);
  if (query.slotStatus !== undefined && !['OPEN', 'CLOSED', 'CANCELLED'].includes(query.slotStatus)) throw invalid();
  const date = value => value === undefined ? undefined : localDateTime(`${value}T00:00:00+05:30`).date;
  const from = date(query.from), to = date(query.to);
  if (from && to && from > to) throw invalid();
  return { from, to, slotStatus: query.slotStatus, page: page(query.page) };
}
export function overlaps(aStart, aEnd, bStart, bEnd) { return aStart < bEnd && bStart < aEnd; }
