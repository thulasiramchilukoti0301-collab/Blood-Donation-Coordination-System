import { HttpError } from '../../utils/httpError.js';

const maximumId = 18446744073709551615n;
const subjectTypes = new Set([
  'Account', 'Donor', 'Hospital', 'BloodGroup', 'BloodCompatibility', 'DonationSlot', 'Booking',
  'EligibilityDecision', 'Donation', 'BloodUnit', 'HospitalRequest', 'RequestStatusHistory',
  'Allocation', 'AuditEvent', 'SYSTEM_TASK',
]);
const eventFields = new Set([
  'actorAccountId', 'actionCode', 'subjectType', 'subjectId', 'reasonCode', 'changeSummary', 'operationId',
]);
const controlCharacters = /\p{Cc}/u;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const insertEvent = `INSERT INTO AuditEvent
  (actor_account_id, action_code, subject_type, subject_id, reason_code, change_summary, operation_id)
  VALUES (?, ?, ?, ?, ?, ?, ?)`;

const invalidEvent = () => new HttpError(400, 'VALIDATION_ERROR', 'Audit event input is invalid.');
const unavailable = () => new HttpError(503, 'DATABASE_UNAVAILABLE', 'Audit data is temporarily unavailable.');

function positiveId(value) {
  if (typeof value === 'number' && Number.isSafeInteger(value)) value = String(value);
  const match = typeof value === 'string' ? /^[1-9][0-9]{0,19}$/u.exec(value) : null;
  if (!match || match[0] !== value || BigInt(value) > maximumId) throw invalidEvent();
  return value;
}

function plainDataObject(value, allowedFields) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw invalidEvent();
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string' || !allowedFields.has(key)
      || !Object.hasOwn(Object.getOwnPropertyDescriptor(value, key), 'value')) throw invalidEvent();
  }
}

function optionalText(event, key, maximumLength) {
  if (!Object.hasOwn(event, key) || event[key] === null) return null;
  const value = event[key];
  if (typeof value !== 'string' || !value.trim() || [...value].length > maximumLength
    || controlCharacters.test(value)) throw invalidEvent();
  return value;
}

function transactionConnection(connection) {
  if (!connection || typeof connection !== 'object' || typeof connection.getConnection === 'function'
    || !['execute', 'beginTransaction', 'commit', 'rollback'].every((method) => typeof connection[method] === 'function')) {
    throw new HttpError(500, 'AUDIT_CONNECTION_REQUIRED', 'An existing transaction connection is required for audit writes.');
  }
  // These capabilities reject a pool; they cannot prove BEGIN was called.
  // This internal API relies on its trusted caller to own an active transaction.
}

export function createAuditWriter(options) {
  const registry = Array.isArray(options?.allowedActionCodes) ? [...options.allowedActionCodes] : null;
  if (!registry?.length || new Set(registry).size !== registry.length
    || registry.some((code) => typeof code !== 'string' || !code.length || code.length > 48 || /[^\x21-\x7e]/u.test(code))) {
    throw new HttpError(500, 'AUDIT_CONFIGURATION_ERROR', 'A valid audit action registry is required.');
  }
  // Copy the trusted registry so later caller mutations cannot authorize codes.
  const allowedActions = new Set(registry);

  function eventValues(event, system) {
    plainDataObject(event, eventFields);
    if (!['actionCode', 'subjectType', 'subjectId'].every((key) => Object.hasOwn(event, key))
      || !allowedActions.has(event.actionCode) || !subjectTypes.has(event.subjectType)) throw invalidEvent();
    let actorAccountId;
    if (system) {
      if (Object.hasOwn(event, 'actorAccountId')) throw invalidEvent();
      actorAccountId = null;
    } else {
      if (!Object.hasOwn(event, 'actorAccountId')) throw invalidEvent();
      actorAccountId = positiveId(event.actorAccountId);
    }
    let subjectId;
    if (event.subjectType === 'SYSTEM_TASK') {
      if (event.subjectId !== null) throw invalidEvent();
      subjectId = null;
    } else subjectId = positiveId(event.subjectId);
    const reasonCode = optionalText(event, 'reasonCode', 40);
    const changeSummary = optionalText(event, 'changeSummary', 1000);
    const operationId = optionalText(event, 'operationId', 36);
    if (operationId !== null && !uuid.test(operationId)) throw invalidEvent();
    // Only a bounded scalar summary is accepted, never a request body/object.
    // Trusted callers must construct it without credentials or medical answers.
    return [actorAccountId, event.actionCode, event.subjectType, subjectId, reasonCode, changeSummary, operationId];
  }

  async function append(connection, event, system) {
    transactionConnection(connection);
    const values = eventValues(event, system);
    try {
      const [result] = await connection.execute(insertEvent, values);
      if (result?.affectedRows !== 1) throw unavailable();
      try { return positiveId(result.insertId); } catch { throw unavailable(); }
    } catch (error) {
      if (error instanceof HttpError) throw error;
      throw unavailable();
    }
  }

  return {
    write(connection, event) { return append(connection, event, false); },
    // Separate internal capability for trusted scheduler work, never an HTTP API.
    writeSystemEvent(connection, event) { return append(connection, event, true); },
  };
}
