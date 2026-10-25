const contactFields = Object.freeze({ contactName: 120, phone: 30, address: 255 });
const permittedStatuses = new Set(['PENDING', 'ACTIVE']);

export function hospitalContactValues(profile) {
  return Object.fromEntries(Object.keys(contactFields).map((field) =>
    [field, typeof profile?.[field] === 'string' ? profile[field] : '']));
}

export function validateHospitalContact(input) {
  const values = hospitalContactValues(input);
  const errors = {};
  for (const [field, limit] of Object.entries(contactFields)) {
    values[field] = values[field].trim();
    if (!values[field]) errors[field] = 'This field is required.';
    else if ([...values[field]].length > limit) errors[field] = `Use no more than ${limit} characters.`;
    else if (/[\u0000-\u001f\u007f]/u.test(values[field])) errors[field] = 'Remove control characters from this field.';
  }
  if (!errors.phone && (!/^[+0-9().\- ]+$/u.test(values.phone) || !/[0-9]/u.test(values.phone))) {
    errors.phone = 'Use digits with spaces, +, parentheses, dots or hyphens.';
  }
  return { values, errors, valid: Object.keys(errors).length === 0 };
}

export function createHospitalContactPatch(input, savedProfile) {
  const { values } = validateHospitalContact(input);
  return Object.fromEntries(Object.keys(contactFields)
    .filter((field) => values[field] !== savedProfile?.[field])
    .map((field) => [field, values[field]]));
}

export function isHospitalProfile(profile, expectedAccountId) {
  return Boolean(profile && typeof profile === 'object'
    && typeof profile.hospitalId === 'string' && profile.hospitalId === expectedAccountId
    && permittedStatuses.has(profile.accountStatus)
    && ['organizationName', 'contactName', 'phone', 'address'].every((field) =>
      typeof profile[field] === 'string' && profile[field].trim().length > 0)
    && (profile.registrationNumber === null || typeof profile.registrationNumber === 'string')
    && ['createdAt', 'updatedAt'].every((field) =>
      typeof profile[field] === 'string' && Number.isFinite(Date.parse(profile[field]))));
}

export function formatHospitalTimestamp(value) {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) return 'Not available';
  return new Intl.DateTimeFormat('en-IN', {
    dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata',
  }).format(new Date(value));
}

export function hospitalProfileError(error) {
  const detail = error?.response?.data?.error;
  const fields = {};
  for (const field of Object.keys(contactFields)) {
    if (typeof detail?.fields?.[field] === 'string') fields[field] = detail.fields[field];
  }
  return {
    message: typeof detail?.message === 'string' ? detail.message : 'Your Hospital profile is temporarily unavailable. Please try again.',
    fields,
    missing: error?.response?.status === 404 && detail?.code === 'HOSPITAL_NOT_FOUND',
    accessDenied: error?.response?.status === 401 || (error?.response?.status === 403
      && !['CSRF_TOKEN_INVALID', 'ORIGIN_NOT_ALLOWED'].includes(detail?.code)),
  };
}
