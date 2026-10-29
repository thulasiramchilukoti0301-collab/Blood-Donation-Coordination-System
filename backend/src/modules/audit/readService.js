import { HttpError } from '../../utils/httpError.js';
import { validateAuditQuery } from './readValidation.js';
import { auditSubjectTypes } from './readValidation.js';
import { auditReadUnavailable } from './readRepository.js';
import { serializeRequestTimestamp } from '../blood-requests/timestamps.js';

function safe(error) { return error instanceof HttpError ? error : auditReadUnavailable(); }

const maximumId = 18446744073709551615n;
function validId(value, nullable = false) {
  if (nullable && value === null) return true;
  return typeof value === 'string' && /^[1-9][0-9]{0,19}$/u.test(value) && BigInt(value) <= maximumId;
}
function safeText(value, maximum) {
  return value === null || (typeof value === 'string' && [...value].length <= maximum && !/\p{Cc}/u.test(value));
}

function mapEvent(row) {
  if (!row || typeof row !== 'object' || !validId(row.eventId) || !validId(row.actorAccountId, true)
    || typeof row.actionCode !== 'string' || !/^[\x21-\x7e]{1,48}$/u.test(row.actionCode)
    || !auditSubjectTypes.includes(row.subjectType)
    || (row.subjectType === 'SYSTEM_TASK' ? row.subjectId !== null : !validId(row.subjectId))
    || !safeText(row.reasonCode ?? null, 40) || !safeText(row.changeSummary ?? null, 1000)) throw auditReadUnavailable();
  let occurredAt;
  try { occurredAt = serializeRequestTimestamp(row.occurredAt); } catch { throw auditReadUnavailable(); }
  if (!occurredAt) throw auditReadUnavailable();
  return {
    eventId: row.eventId,
    actorAccountId: row.actorAccountId,
    actionCode: row.actionCode,
    subjectType: row.subjectType,
    subjectId: row.subjectId,
    occurredAt,
    reasonCode: row.reasonCode ?? null,
    changeSummary: row.changeSummary ?? null,
  };
}

export function createAuditReadService(repository) {
  if (!repository) throw new TypeError('An audit read repository is required.');
  return {
    async assertStorageReady() { try { await repository.assertStorageReady(); } catch (error) { throw safe(error); } },
    async list(query) {
      const filters = validateAuditQuery(query);
      try {
        const result = await repository.list(filters);
        return { events: result.rows.map(mapEvent), pagination: result.pagination };
      } catch (error) { throw safe(error); }
    },
  };
}
