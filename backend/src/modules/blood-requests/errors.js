import { HttpError } from '../../utils/httpError.js';

export function requestValidationError() {
  return new HttpError(400, 'VALIDATION_ERROR', 'Blood request input is invalid.');
}

export function requestDependencyUnavailable() {
  return new HttpError(503, 'REQUEST_FEATURE_NOT_READY', 'Blood request operation is not available.');
}

export function requestNotFound() {
  return new HttpError(404, 'REQUEST_NOT_FOUND', 'The blood request was not found.');
}

export function safeBloodRequestError(error) {
  if (error instanceof HttpError) return error;
  if (error?.code === 'ER_DUP_ENTRY') {
    return new HttpError(409, 'REQUEST_CONFLICT', 'The blood request conflicts with existing data.');
  }
  return new HttpError(503, 'DATABASE_UNAVAILABLE', 'Blood request data is temporarily unavailable.');
}
