export const HOSPITAL_ACCOUNT_STATUSES = Object.freeze(['PENDING', 'ACTIVE', 'SUSPENDED']);
const profileFields = Object.freeze(['hospitalId', 'organizationName', 'registrationNumber', 'contactName',
  'phone', 'address', 'accountStatus', 'createdAt', 'updatedAt']);
const maximumId = 18446744073709551615n;

export function isHospitalIdentifier(value) {
  return typeof value === 'string' && /^[1-9][0-9]{0,19}$/u.test(value) && BigInt(value) <= maximumId;
}

export function canManageHospitals(user) {
  return Boolean(user?.role === 'ADMIN' && user.accountStatus === 'ACTIVE' && isHospitalIdentifier(user.accountId));
}

export function validateAdminHospitalFilters(input = {}) {
  const search = typeof input.search === 'string' ? input.search.trim() : '';
  const accountStatus = typeof input.accountStatus === 'string' ? input.accountStatus : '';
  const errors = {};
  if (typeof input.search !== 'string' && input.search !== undefined) errors.search = 'Enter a Hospital search.';
  else if ([...search].length > 180) errors.search = 'Use no more than 180 characters.';
  else if (/[\u0000-\u001f\u007f]/u.test(search)) errors.search = 'Remove control characters from your search.';
  if (input.accountStatus !== undefined && input.accountStatus !== '' && !HOSPITAL_ACCOUNT_STATUSES.includes(input.accountStatus)) {
    errors.accountStatus = 'Choose one of the available account statuses.';
  }
  return { values: { search, accountStatus }, errors, valid: Object.keys(errors).length === 0 };
}

// Only approved management fields enter component state, even if an API adds fields later.
export function readAdminHospitalProfile(input, expectedHospitalId) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || !isHospitalIdentifier(input.hospitalId)
    || (expectedHospitalId !== undefined && input.hospitalId !== expectedHospitalId)
    || !HOSPITAL_ACCOUNT_STATUSES.includes(input.accountStatus)) return null;
  const limits = { organizationName: 180, contactName: 120, phone: 30, address: 255 };
  for (const [field, limit] of Object.entries(limits)) {
    if (typeof input[field] !== 'string' || !input[field].trim() || [...input[field]].length > limit
      || /[\u0000-\u001f\u007f]/u.test(input[field])) return null;
  }
  if (input.registrationNumber !== null && (typeof input.registrationNumber !== 'string'
    || !input.registrationNumber.trim() || [...input.registrationNumber].length > 80
    || /[\u0000-\u001f\u007f]/u.test(input.registrationNumber))) return null;
  if (!['createdAt', 'updatedAt'].every((field) => typeof input[field] === 'string'
    && Number.isFinite(Date.parse(input[field])))) return null;
  return Object.fromEntries(profileFields.map((field) => [field, input[field]]));
}

export function readAdminHospitalPage(input, expectedPage) {
  const pagination = input?.pagination;
  if (!input || !Array.isArray(input.hospitals) || input.hospitals.length > 20
    || !pagination || pagination.page !== expectedPage || !Number.isSafeInteger(pagination.page) || pagination.page < 1
    || pagination.pageSize !== 20 || !Number.isSafeInteger(pagination.total) || pagination.total < 0) return null;
  const hospitals = input.hospitals.map((profile) => readAdminHospitalProfile(profile));
  if (hospitals.some((profile) => !profile) || new Set(hospitals.map((profile) => profile.hospitalId)).size !== hospitals.length) return null;
  return { hospitals, pagination: { page: pagination.page, pageSize: 20, total: pagination.total } };
}

export function adminHospitalPageSummary(pagination, rowCount) {
  const pages = Math.max(1, Math.ceil(pagination.total / pagination.pageSize));
  return { pages, first: rowCount ? (pagination.page - 1) * pagination.pageSize + 1 : 0,
    last: rowCount ? (pagination.page - 1) * pagination.pageSize + rowCount : 0,
    previous: pagination.page > 1, next: pagination.page < pages };
}

export function adminHospitalError(error, scope = 'list') {
  const status = error?.response?.status;
  const code = error?.response?.data?.error?.code;
  if (status === 401 || status === 403) return { accessDenied: true, missing: false,
    message: 'An active Admin account is required. Check your sign-in status before trying again.' };
  if (status === 404 && code === 'HOSPITAL_NOT_FOUND') return { accessDenied: false, missing: true,
    message: 'This Hospital profile is no longer available. Refresh the Hospital list.' };
  if (status === 400) return { accessDenied: false, missing: false,
    message: 'The Hospital search or identifier was not accepted. Review your filters and try again.' };
  return { accessDenied: false, missing: false, message: scope === 'detail'
    ? 'Hospital details are temporarily unavailable. Please try again.'
    : 'The Hospital list is temporarily unavailable. Please try again.' };
}
