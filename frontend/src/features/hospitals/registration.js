const registrationFields = ['email', 'password', 'organizationName', 'registrationNumber', 'contactName', 'phone', 'address'];
const hospitalTextLimits = { organizationName: 180, registrationNumber: 80, contactName: 120, phone: 30, address: 255 };
const textLabels = { organizationName: 'Organization name', registrationNumber: 'Registration number', contactName: 'Contact name', phone: 'Phone', address: 'Address' };

export function emptyHospitalRegistration() {
  return Object.fromEntries(registrationFields.map((field) => [field, '']));
}

export function validateHospitalRegistration(input) {
  const source = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const errors = {};
  const values = { email: typeof source.email === 'string' ? source.email.trim().toLowerCase() : '',
    password: typeof source.password === 'string' ? source.password : '' };

  if (typeof source.email !== 'string' || !values.email || [...source.email.trim()].length > 254
    || /\p{Cc}/u.test(values.email) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(values.email)) {
    errors.email = 'Enter a valid email address, up to 254 characters.';
  }
  const password = values.password;
  if (typeof source.password !== 'string' || [...password].length < 8
    || new TextEncoder().encode(password).length > 72 || /\p{Cc}/u.test(password)
    || !/\p{N}/u.test(password) || !/[\p{P}\p{S}]/u.test(password)) {
    errors.password = 'Use at least 8 characters with a number and punctuation or symbol, within 72 UTF-8 bytes.';
  }

  for (const [field, limit] of Object.entries(hospitalTextLimits)) {
    const raw = source[field];
    const optional = field === 'registrationNumber';
    if (optional && (raw === undefined || raw === null || (typeof raw === 'string' && !raw.trim()))) {
      values[field] = null;
      continue;
    }
    const normalized = typeof raw === 'string' ? raw.trim() : '';
    values[field] = normalized;
    if (typeof raw !== 'string' || !normalized || [...normalized].length > limit || /[\u0000-\u001f\u007f]/u.test(normalized)) {
      errors[field] = `${textLabels[field]} must contain between 1 and ${limit} characters without control characters.`;
    } else if (field === 'phone' && (!/^[+0-9().\- ]+$/u.test(normalized) || !/[0-9]/u.test(normalized))) {
      errors.phone = 'Enter a phone number using digits, spaces, +, parentheses, dots or hyphens.';
    }
  }
  return { valid: Object.keys(errors).length === 0, values, errors };
}

export function hospitalRegistrationError(error) {
  const detail = error?.response?.data?.error;
  const fields = {};
  for (const field of registrationFields) {
    if (typeof detail?.fields?.[field] === 'string') fields[field] = detail.fields[field];
  }
  if (detail?.code === 'EMAIL_CONFLICT') fields.email = 'An account with this email already exists. Try signing in.';
  if (detail?.code === 'HOSPITAL_REGISTRATION_CONFLICT') fields.registrationNumber = 'This registration number is already in use.';
  const message = typeof detail?.fields?.form === 'string' ? detail.fields.form
    : typeof detail?.message === 'string' ? detail.message : 'Registration is temporarily unavailable. Please try again.';
  return { message, fields };
}
