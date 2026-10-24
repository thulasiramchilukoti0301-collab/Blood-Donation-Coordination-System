export const BCRYPT_WORK_FACTOR = 12;
export const MAX_PASSWORD_UTF8_BYTES = 72;
export const MIN_PASSWORD_CODE_POINTS = 8;

export function validatePassword(password) {
  if (typeof password !== 'string') return { valid: false, reason: 'TYPE' };
  const codePoints = Array.from(password).length;
  const bytes = Buffer.byteLength(password, 'utf8');
  if (codePoints < MIN_PASSWORD_CODE_POINTS) return { valid: false, reason: 'MIN_LENGTH' };
  if (bytes > MAX_PASSWORD_UTF8_BYTES) return { valid: false, reason: 'MAX_BYTES' };
  if (/\p{Cc}/u.test(password)) return { valid: false, reason: 'CONTROL_CHARACTER' };
  if (!/\p{N}/u.test(password)) return { valid: false, reason: 'NUMBER_REQUIRED' };
  if (!/[\p{P}\p{S}]/u.test(password)) return { valid: false, reason: 'SYMBOL_REQUIRED' };
  return { valid: true, reason: null };
}
