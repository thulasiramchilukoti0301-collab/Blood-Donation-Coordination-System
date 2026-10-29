const subjectTypes = ['Account', 'Donor', 'Hospital', 'BloodGroup', 'BloodCompatibility', 'DonationSlot', 'Booking',
  'EligibilityDecision', 'Donation', 'BloodUnit', 'HospitalRequest', 'RequestStatusHistory', 'Allocation', 'AuditEvent', 'SYSTEM_TASK'];
const maxId = 18446744073709551615n;
const invalid = () => new Error('The audit response could not be confirmed.');
function id(value, nullable = false) {
  if (nullable && value === null) return null;
  if (typeof value !== 'string' || !/^[1-9][0-9]{0,19}$/u.test(value) || BigInt(value) > maxId) throw invalid();
  return value;
}
function dateTime(value) { return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+05:30$/u.test(value)
  && Number.isFinite(Date.parse(value)) && new Date(Date.parse(value) + 330 * 60000).toISOString().slice(0, 19) === value.slice(0, 19); }
function safeText(value, max) { return value === null || (typeof value === 'string' && value.length <= max && !/\p{Cc}/u.test(value)); }

export function cleanAuditFilters(input = {}) {
  const allowed = ['actorAccountId', 'actionCode', 'subjectType', 'subjectId', 'from', 'to', 'page', 'pageSize'];
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some((key) => !allowed.includes(key))) throw invalid();
  const query = { page: input.page ?? 1, pageSize: input.pageSize ?? 25 };
  if (!Number.isSafeInteger(query.page) || query.page < 1 || query.page > 1_000_000
    || ![25, 50, 100].includes(query.pageSize)) throw invalid();
  for (const key of ['actorAccountId', 'subjectId']) if (input[key] !== undefined && input[key] !== '') query[key] = id(input[key]);
  if (input.actionCode) {
    if (typeof input.actionCode !== 'string' || !/^[\x21-\x7e]{1,48}$/u.test(input.actionCode)) throw invalid();
    query.actionCode = input.actionCode;
  }
  if (input.subjectType) {
    if (!subjectTypes.includes(input.subjectType)) throw invalid();
    query.subjectType = input.subjectType;
  }
  for (const key of ['from', 'to']) if (input[key]) {
    if (typeof input[key] !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(input[key])
      || new Date(`${input[key]}T00:00:00Z`).toISOString().slice(0, 10) !== input[key]) throw invalid();
    query[key] = input[key];
  }
  if (query.from && query.to && query.from > query.to) throw invalid();
  return query;
}

export function readAuditResponse(data, requested) {
  const page = data?.pagination;
  if (data?.success !== true || !Array.isArray(data.events) || !page || page.page !== requested.page
    || page.pageSize !== requested.pageSize || !Number.isSafeInteger(page.total) || page.total < 0
    || data.events.length > page.pageSize || data.events.length > Math.max(0, page.total - (page.page - 1) * page.pageSize)) throw invalid();
  const events = data.events.map((event) => {
    if (!event || typeof event.actionCode !== 'string' || !safeText(event.actionCode, 48) || !/^[\x21-\x7e]{1,48}$/u.test(event.actionCode)
      || !subjectTypes.includes(event.subjectType) || !dateTime(event.occurredAt)
      || !safeText(event.reasonCode, 40) || !safeText(event.changeSummary, 1000)
      || (event.subjectType === 'SYSTEM_TASK' ? event.subjectId !== null : event.subjectId === null)) throw invalid();
    return { eventId: id(event.eventId), actorAccountId: id(event.actorAccountId, true), actionCode: event.actionCode,
      subjectType: event.subjectType, subjectId: id(event.subjectId, true), occurredAt: event.occurredAt,
      reasonCode: event.reasonCode ?? null, changeSummary: event.changeSummary ?? null };
  });
  for (let index = 1; index < events.length; index++) {
    const a = events[index - 1], b = events[index];
    if (a.occurredAt < b.occurredAt || (a.occurredAt === b.occurredAt && BigInt(a.eventId) < BigInt(b.eventId))) throw invalid();
  }
  return { events, pagination: { page: page.page, pageSize: page.pageSize, total: page.total } };
}

export function createAuditApi(client) {
  return { async list(filters = {}, { signal } = {}) {
    const query = cleanAuditFilters(filters);
    const { data } = await client.get('/admin/audit-events', { params: query, signal });
    return readAuditResponse(data, query);
  } };
}
