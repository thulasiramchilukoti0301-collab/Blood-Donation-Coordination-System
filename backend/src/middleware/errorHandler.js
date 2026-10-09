import { HttpError } from '../utils/httpError.js';

export function errorHandler(error, req, res, next) {
  if (res.headersSent) return next(error);

  let status = 500;
  let code = 'INTERNAL_SERVER_ERROR';
  let message = 'An unexpected server error occurred.';

  if (error instanceof HttpError) {
    ({ status, code, message } = error);
  } else if (error.type === 'entity.parse.failed') {
    status = 400;
    code = 'INVALID_JSON';
    message = 'Request body must contain valid JSON.';
  } else if (error.type === 'entity.too.large') {
    status = 413;
    code = 'PAYLOAD_TOO_LARGE';
    message = 'Request body is too large.';
  }

  res.status(status).json({ success: false, error: { code, message } });
}
