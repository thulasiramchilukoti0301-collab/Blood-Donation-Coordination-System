import { HttpError } from '../../utils/httpError.js';
import { MAX_PASSWORD_UTF8_BYTES, validatePassword } from './passwordPolicy.js';

const invalid = () => new HttpError(400, 'VALIDATION_ERROR', 'Password change input is invalid.');

export function validatePasswordChange(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(body))
    || Reflect.ownKeys(body).length !== 2
    || !Object.hasOwn(body, 'currentPassword') || !Object.hasOwn(body, 'newPassword')) throw invalid();
  const currentPassword = body.currentPassword;
  if (typeof currentPassword !== 'string' || !currentPassword
    || Buffer.byteLength(currentPassword, 'utf8') > MAX_PASSWORD_UTF8_BYTES
    || /\p{Cc}/u.test(currentPassword)) throw invalid();
  if (!validatePassword(body.newPassword).valid) {
    throw new HttpError(422, 'VALIDATION_ERROR', 'Check the new password requirements.', {
      newPassword: 'Use 8 or more characters, at most 72 UTF-8 bytes, including a number and a symbol.',
    });
  }
  return { currentPassword, newPassword: body.newPassword };
}
