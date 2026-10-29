import { canonicalUnsignedId } from './validation.js';

function dateString(value) {
  if (typeof value === 'string') return value;
  if (value instanceof Date && Number.isFinite(value.getTime())) return value.toISOString();
  return null;
}

export function mapRequestRecord(row, { includeHospital = false } = {}) {
  if (!row || typeof row !== 'object') return null;
  const safe = {
    requestId: canonicalUnsignedId(row.requestId),
    recipientGroupId: canonicalUnsignedId(row.recipientGroupId),
    recipientBloodGroupCode: row.recipientBloodGroupCode,
    recipientBloodGroupName: row.recipientBloodGroupName,
    quantityRequested: row.quantityRequested,
    priority: row.priority,
    neededBy: dateString(row.neededBy),
    note: row.note ?? null,
    requestStatus: row.requestStatus,
    rejectionReasonCode: row.rejectionReasonCode ?? null,
    createdAt: dateString(row.createdAt),
    updatedAt: dateString(row.updatedAt),
  };
  if (includeHospital) {
    safe.hospital = {
      hospitalId: canonicalUnsignedId(row.hospitalId),
      organizationName: row.organizationName,
    };
  }
  return safe;
}

export function mapCreatedRequest({ requestId, quantityRequested }) {
  return {
    requestId: canonicalUnsignedId(requestId),
    requestStatus: 'SUBMITTED',
    outstandingQuantity: quantityRequested,
  };
}
