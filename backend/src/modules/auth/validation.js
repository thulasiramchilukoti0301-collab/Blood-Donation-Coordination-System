import { HttpError } from '../../utils/httpError.js';
import { MAX_PASSWORD_UTF8_BYTES, validatePassword } from './passwordPolicy.js';
import { validateHospitalDetails } from '../hospitals/validation.js';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;
const MAX_UNSIGNED_BIGINT = 18446744073709551615n;

function fail(fields, message = 'Check the highlighted fields and try again.') {
  throw new HttpError(422, 'VALIDATION_ERROR', message, fields);
}

function objectBody(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) fail({ body: 'Enter the required details.' });
  return body;
}

function rejectUnknownFields(body, allowed) {
  const unknown = Object.keys(body).filter((key) => !allowed.has(key));
  if (unknown.length) fail({ form: 'The request contains fields that cannot be submitted.' });
}

function text(body, field, maxLength, { optional = false } = {}) {
  const raw = body[field];
  if (raw === undefined && optional) return null;
  if (typeof raw !== 'string') fail({ [field]: 'Enter a valid value.' });
  const normalized = raw.trim();
  if (!normalized && optional) return null;
  if (!normalized || Array.from(normalized).length > maxLength || /\p{Cc}/u.test(normalized)) {
    fail({ [field]: `Enter between 1 and ${maxLength} characters without control characters.` });
  }
  return normalized;
}

export function localDateInKolkata(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function validDateOnly(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  if (year < 1000) return false; // MySQL DATE's supported lower year; this is not an age rule.
  const candidate = new Date(Date.UTC(year, month - 1, day));
  return candidate.getUTCFullYear() === year
    && candidate.getUTCMonth() === month - 1
    && candidate.getUTCDate() === day;
}

function optionalUnsignedId(value) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' && !(typeof value === 'number' && Number.isSafeInteger(value))) return undefined;
  const stringValue = String(value);
  if (!/^\d+$/u.test(stringValue)) return undefined;
  try {
    const id = BigInt(stringValue);
    return id > 0n && id <= MAX_UNSIGNED_BIGINT ? id.toString() : undefined;
  } catch {
    return undefined;
  }
}

export function validateDonorRegistration(body, now = new Date()) {
  objectBody(body);
  rejectUnknownFields(body, new Set([
    'fullName', 'email', 'password', 'dateOfBirth', 'phone', 'address', 'area', 'reportedBloodGroupId',
  ]));

  const fullName = text(body, 'fullName', 120);
  const email = text(body, 'email', 254).toLowerCase();
  if (!EMAIL_PATTERN.test(email)) fail({ email: 'Enter a valid email address.' });

  const password = body.password;
  const policyResult = validatePassword(password);
  if (!policyResult.valid) {
    fail({ password: 'Use at least 8 characters, including a number and a punctuation or symbol character; maximum 72 UTF-8 bytes.' });
  }

  const dateOfBirth = body.dateOfBirth;
  if (!validDateOnly(dateOfBirth)) fail({ dateOfBirth: 'Enter a real date in YYYY-MM-DD format.' });
  if (dateOfBirth > localDateInKolkata(now)) fail({ dateOfBirth: 'Date of birth cannot be in the future.' });

  const phone = text(body, 'phone', 30);
  const address = text(body, 'address', 255);
  const area = text(body, 'area', 100, { optional: true });
  const reportedBloodGroupId = optionalUnsignedId(body.reportedBloodGroupId);
  if (reportedBloodGroupId === undefined) fail({ reportedBloodGroupId: 'Choose a valid blood group identifier or leave it blank.' });

  return { fullName, email, password, dateOfBirth, phone, address, area, reportedBloodGroupId };
}

export function validateHospitalRegistration(body) {
  objectBody(body);
  rejectUnknownFields(body, new Set([
    'email', 'password', 'organizationName', 'registrationNumber', 'contactName', 'phone', 'address',
  ]));
  const email = text(body, 'email', 254).toLowerCase();
  if (!EMAIL_PATTERN.test(email)) fail({ email: 'Enter a valid email address.' });
  const password = body.password;
  if (!validatePassword(password).valid) {
    fail({ password: 'Use at least 8 characters, including a number and a punctuation or symbol character; maximum 72 UTF-8 bytes.' });
  }
  let details;
  try {
    details = validateHospitalDetails({
      organizationName: body.organizationName, registrationNumber: body.registrationNumber ?? null,
      contactName: body.contactName, phone: body.phone, address: body.address,
    });
  } catch (error) {
    if (error instanceof HttpError && error.code === 'VALIDATION_ERROR') {
      fail({ form: 'Enter valid Hospital organization and contact details.' });
    }
    throw error;
  }
  return { email, password, ...details };
}

export function validateLogin(body) {
  objectBody(body);
  rejectUnknownFields(body, new Set(['email', 'password']));
  const email = text(body, 'email', 254).toLowerCase();
  if (!EMAIL_PATTERN.test(email)) fail({ form: 'Email or password is invalid.' }, 'Email or password is invalid.');
  if (typeof body.password !== 'string' || body.password.length === 0
    || Buffer.byteLength(body.password, 'utf8') > MAX_PASSWORD_UTF8_BYTES) {
    fail({ form: 'Email or password is invalid.' }, 'Email or password is invalid.');
  }
  return { email, password: body.password };
}

export function validateCsrfHeader(value) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value);
}
