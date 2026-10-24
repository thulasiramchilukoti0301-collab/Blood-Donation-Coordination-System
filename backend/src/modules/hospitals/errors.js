import { HttpError } from '../../utils/httpError.js';

export function validationError() {
  return new HttpError(400, 'VALIDATION_ERROR', 'Hospital input is invalid.');
}

export function safeHospitalError(error) {
  if (error instanceof HttpError) return error;
  if (error?.code === 'ER_DUP_ENTRY') {
    const registration = typeof error.sqlMessage === 'string'
      && error.sqlMessage.includes('uq_hospital_registration_number');
    return new HttpError(409, registration ? 'HOSPITAL_REGISTRATION_CONFLICT' : 'HOSPITAL_CONFLICT',
      registration ? 'That registration number is already in use.' : 'Hospital data conflicts with an existing record.');
  }
  return new HttpError(503, 'DATABASE_UNAVAILABLE', 'Hospital data is temporarily unavailable.');
}
