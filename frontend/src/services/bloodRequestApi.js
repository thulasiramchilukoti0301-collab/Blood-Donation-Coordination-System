import { cleanFilters, requestId, REQUEST_PRIORITIES, REQUEST_STATUSES } from '../features/blood-requests/model.js';

const invalid = () => new Error('The blood request response could not be confirmed.');
const text = (value) => typeof value === 'string' && !/\p{Cc}/u.test(value);
export function readRequest(row) {
  if (!row || !REQUEST_STATUSES.includes(row.requestStatus) || !REQUEST_PRIORITIES.includes(row.priority)
    || !Number.isInteger(row.quantityRequested) || row.quantityRequested < 1 || row.quantityRequested > 65535
    || !text(row.recipientBloodGroupCode) || !text(row.recipientBloodGroupName)
    || typeof row.neededBy !== 'string') throw invalid();
  const record = { requestId: requestId(row.requestId), recipientGroupId: requestId(row.recipientGroupId),
    recipientBloodGroupCode: row.recipientBloodGroupCode, recipientBloodGroupName: row.recipientBloodGroupName,
    quantityRequested: row.quantityRequested, priority: row.priority, neededBy: row.neededBy, requestStatus: row.requestStatus,
    createdAt: text(row.createdAt) ? row.createdAt : null, updatedAt: text(row.updatedAt) ? row.updatedAt : null,
    note: text(row.note) ? row.note : null };
  if (row.hospital) {
    if (!text(row.hospital.organizationName)) throw invalid();
    record.hospital = { hospitalId: requestId(row.hospital.hospitalId), organizationName: row.hospital.organizationName };
  }
  for (const key of ['allocatedQuantity', 'issuedQuantity', 'outstandingQuantity']) {
    if (Object.hasOwn(row, key)) {
      if (!Number.isInteger(row[key]) || row[key] < 0 || row[key] > row.quantityRequested) throw invalid();
      record[key] = row[key];
    }
  }
  if (record.allocatedQuantity !== undefined && record.issuedQuantity !== undefined
    && (record.allocatedQuantity + record.issuedQuantity > row.quantityRequested
      || (record.outstandingQuantity !== undefined && record.outstandingQuantity !== row.quantityRequested - record.allocatedQuantity - record.issuedQuantity))) throw invalid();
  if (row.requestStatusHistory !== undefined) {
    if (!Array.isArray(row.requestStatusHistory)) throw invalid();
    record.requestStatusHistory = row.requestStatusHistory.map((event) => {
      if (!REQUEST_STATUSES.includes(event.newStatus) || (event.oldStatus !== null && !REQUEST_STATUSES.includes(event.oldStatus))
        || !text(event.changedAt)) throw invalid();
      const safe = { oldStatus: event.oldStatus, newStatus: event.newStatus, changedAt: event.changedAt };
      if (Object.hasOwn(event, 'actorAccountId')) safe.actorAccountId = event.actorAccountId === null ? null : requestId(event.actorAccountId);
      if (Object.hasOwn(event, 'reasonCode')) {
        if (event.reasonCode !== null && (!text(event.reasonCode) || [...event.reasonCode].length > 40)) throw invalid();
        safe.reasonCode = event.reasonCode;
      }
      return safe;
    });
  }
  return record;
}

// Paths match api-design.md. Availability is supplied by integration, never by URL/query input.
export function createBloodRequestApi(client, { creationEnabled = false } = {}) {
  const base = (admin) => admin ? '/admin/requests' : '/hospitals/me/requests';
  return {
    async groups({ signal } = {}) {
      const { data } = await client.get('/blood-groups', { signal });
      if (data?.success !== true || !Array.isArray(data.bloodGroups)) throw invalid();
      const groups = data.bloodGroups.map((group) => {
        if (!text(group.code) || !text(group.displayName)) throw invalid();
        return { bloodGroupId: requestId(group.bloodGroupId), code: group.code, displayName: group.displayName };
      });
      if (new Set(groups.map((group) => group.bloodGroupId)).size !== groups.length) throw invalid();
      return groups;
    },
    async list(query = {}, { admin = false, signal } = {}) {
      const page = query.page ?? 1;
      if (!Number.isSafeInteger(page) || page < 1 || page > Math.floor(Number.MAX_SAFE_INTEGER / 20)) throw invalid();
      const params = { ...cleanFilters(query, admin), page };
      const { data } = await client.get(base(admin), { params, signal });
      const p = data?.pagination;
      if (data?.success !== true || !Array.isArray(data.requests) || data.requests.length > 20
        || !p || p.page !== page || p.pageSize !== 20 || !Number.isSafeInteger(p.total) || p.total < 0
        || data.requests.length > Math.max(0, p.total - (page - 1) * 20)) throw invalid();
      const requests = data.requests.map(readRequest);
      if (new Set(requests.map((row) => row.requestId)).size !== requests.length) throw invalid();
      return { requests, pagination: { page: p.page, pageSize: 20, total: p.total } };
    },
    async detail(id, { admin = false, signal } = {}) {
      requestId(id);
      const { data } = await client.get(`${base(admin)}/${encodeURIComponent(id)}`, { signal });
      if (data?.success !== true) throw invalid();
      const record = readRequest(data.request);
      if (record.requestId !== id) throw invalid();
      return record;
    },
    async create(body, { signal } = {}) {
      if (creationEnabled !== true) throw new Error('Request submission is not available yet.');
      const { data: token } = await client.get('/auth/csrf', { signal });
      if (token?.success !== true || !/^[a-f0-9]{64}$/u.test(token.csrfToken)) throw invalid();
      const values = Object.fromEntries(['recipientGroupId', 'quantityRequested', 'priority', 'neededBy', 'note'].map((key) => [key, body[key]]));
      const { status, data } = await client.post(base(false), values, { signal, headers: { 'X-CSRF-Token': token.csrfToken } });
      if (status !== 201 || data?.success !== true || data.requestStatus !== 'SUBMITTED' || data.outstandingQuantity !== body.quantityRequested) throw invalid();
      return { requestId: requestId(data.requestId), requestStatus: data.requestStatus, outstandingQuantity: data.outstandingQuantity };
    },
  };
}
