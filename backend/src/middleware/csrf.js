import { timingSafeEqual } from 'node:crypto';
import { HttpError } from '../utils/httpError.js';
import { validateCsrfHeader } from '../modules/auth/validation.js';

export function requireTrustedOriginAndCsrf(frontendUrl) {
  return function csrfGuard(req, res, next) {
    const origin = req.get('origin');
    if (origin && origin !== frontendUrl) {
      return next(new HttpError(403, 'ORIGIN_NOT_ALLOWED', 'Request origin is not allowed.'));
    }
    const expected = req.session?.csrfToken;
    const received = req.get('x-csrf-token');
    if (!validateCsrfHeader(expected) || !validateCsrfHeader(received)) {
      return next(new HttpError(403, 'CSRF_TOKEN_INVALID', 'Refresh the page and try again.'));
    }
    const expectedBytes = Buffer.from(expected, 'hex');
    const receivedBytes = Buffer.from(received, 'hex');
    if (expectedBytes.length !== receivedBytes.length || !timingSafeEqual(expectedBytes, receivedBytes)) {
      return next(new HttpError(403, 'CSRF_TOKEN_INVALID', 'Refresh the page and try again.'));
    }
    return next();
  };
}
