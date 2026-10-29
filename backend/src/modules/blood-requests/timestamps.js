import { requestValidationError } from './errors.js';

// Approved second-precision project DATETIME serializer, enabled by runtime.js.
export function serializeRequestTimestamp(value) {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) {
    const local = new Date(value.getTime() + 330 * 60000);
    if (!Number.isFinite(local.getTime()) || local.getUTCFullYear() < 1000 || local.getUTCFullYear() > 9999) throw requestValidationError();
    return `${local.toISOString().slice(0, 19)}+05:30`;
  }
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}$/u.test(value)) throw requestValidationError();
  const local = value.replace(' ', 'T');
  const instant = new Date(`${local}+05:30`);
  if (!Number.isFinite(instant.getTime()) || serializeRequestTimestamp(instant) !== `${local}+05:30`) throw requestValidationError();
  return `${local}+05:30`;
}
