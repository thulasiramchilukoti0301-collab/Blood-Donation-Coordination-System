import { validationError } from './errors.js';

const lengths = Object.freeze({ organizationName: 180, registrationNumber: 80, contactName: 120, phone: 30, address: 255 });
const editable = ['contactName', 'phone', 'address'];
const statuses = ['PENDING', 'ACTIVE', 'SUSPENDED'];
const maximumId = 18446744073709551615n;

function object(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw validationError();
}

export function accountId(value) {
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) throw validationError();
    value = String(value);
  }
  if (typeof value !== 'string' || !/^[1-9][0-9]{0,19}$/.test(value) || BigInt(value) > maximumId) throw validationError();
  return value;
}

function field(name, value) {
  if (name === 'registrationNumber' && value === null) return null;
  if (typeof value !== 'string') throw validationError();
  value = value.trim();
  if (name === 'registrationNumber' && value === '') return null;
  if (!value || [...value].length > lengths[name] || /[\u0000-\u001f\u007f]/u.test(value)) throw validationError();
  // Accept international/local contact formatting without inventing a country
  // or fixed digit count. The approved schema caps stored phone text at 30.
  if (name === 'phone' && (!/^[+0-9().\- ]+$/.test(value) || !/[0-9]/.test(value))) throw validationError();
  return value;
}

// Reusable validation only, for the future shared registration contract.
// This does not authorize organization/registration changes through PATCH /me.
export function validateHospitalDetails(input) {
  object(input);
  const fields = Object.keys(lengths);
  if (Object.keys(input).some((key) => !fields.includes(key))) throw validationError();
  return Object.fromEntries(fields.map((name) => [name,
    field(name, name === 'registrationNumber' && !Object.hasOwn(input, name) ? null : input[name])]));
}

export function validateContactPatch(input) {
  object(input);
  const keys = Object.keys(input);
  if (keys.length === 0 || keys.some((name) => !editable.includes(name))) throw validationError();
  return Object.fromEntries(keys.map((name) => [name, field(name, input[name])]));
}

export function validateHospitalQuery(input = {}) {
  object(input);
  if (Object.keys(input).some((key) => !['search', 'accountStatus', 'page'].includes(key))) throw validationError();
  let search = '';
  if (input.search !== undefined) {
    if (typeof input.search !== 'string') throw validationError();
    search = input.search.trim();
    if ([...search].length > 180 || /[\u0000-\u001f\u007f]/u.test(search)) throw validationError();
  }
  const accountStatus = input.accountStatus;
  if (accountStatus !== undefined && !statuses.includes(accountStatus)) throw validationError();
  const rawPage = input.page ?? 1;
  if (!(typeof rawPage === 'number' && Number.isSafeInteger(rawPage))
    && !(typeof rawPage === 'string' && /^[1-9][0-9]*$/.test(rawPage))) throw validationError();
  const page = Number(rawPage);
  if (!Number.isSafeInteger(page) || page < 1 || page > Math.floor(Number.MAX_SAFE_INTEGER / 20)) throw validationError();
  return { search, accountStatus, page };
}
