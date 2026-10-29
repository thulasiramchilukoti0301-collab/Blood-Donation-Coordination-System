export const REQUEST_STATUSES = Object.freeze(['SUBMITTED', 'UNDER_REVIEW', 'AWAITING_INVENTORY', 'PARTIALLY_FULFILLED', 'FULFILLED', 'REJECTED', 'CANCELLED']);
export const REQUEST_PRIORITIES = Object.freeze(['EMERGENCY', 'URGENT', 'NORMAL']);
export const requestAvailability = Object.freeze({ reads: true, creation: true });
export const setupMessage = 'Blood requests are not available yet. You can review this workspace, but no request can be submitted until setup is complete.';
export function canUseRequests(user, role) { return user?.role === role && user.accountStatus === 'ACTIVE'; }
export function requestId(value) {
  if (typeof value !== 'string' || !/^[1-9][0-9]{0,19}$/u.test(value) || BigInt(value) > 18446744073709551615n) throw new Error('Choose a valid request.');
  return value;
}
export function label(value) { return value.toLowerCase().replaceAll('_', ' '); }
export function timestamp(value) {
  if (typeof value !== 'string') return 'Time unavailable';
  // Request wire format carries an explicit offset; never guess a DATETIME zone.
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:Z|[+-]\d{2}:\d{2})$/u.test(value)) return 'Time unavailable';
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? `${new Intl.DateTimeFormat('en-IN', {
    dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata',
  }).format(date)} IST` : 'Time unavailable';
}
export function requestFailure(error) {
  const code = error?.response?.data?.error?.code;
  if (code === 'REQUEST_NOT_FOUND') return { state: 'missing', message: 'This request was not found or is not available to your account.' };
  if (['NOT_FOUND', 'REQUEST_FEATURE_NOT_READY', 'REQUEST_STORAGE_UNAVAILABLE', 'DATABASE_NOT_CONFIGURED', 'AUTHENTICATION_NOT_CONFIGURED'].includes(code)) return { state: 'unavailable', message: setupMessage };
  if ([401, 403].includes(error?.response?.status)) return { state: 'denied', message: 'Your access has changed. Check your account status before continuing.' };
  return { state: 'error', message: 'Could not load blood requests. Please try again.' };
}
export function cleanFilters(draft, admin = false) {
  const fields = ['requestStatus', 'priority', 'recipientGroupId', 'submittedFrom', 'submittedTo', 'neededByFrom', 'neededByTo', ...(admin ? ['hospitalId'] : [])];
  const query = {};
  for (const key of fields) {
    const value = draft[key]?.trim();
    if (!value) continue;
    if (key === 'requestStatus' && !REQUEST_STATUSES.includes(value)) throw new Error('Choose a valid status.');
    if (key === 'priority' && !REQUEST_PRIORITIES.includes(value)) throw new Error('Choose a valid priority.');
    if (key.endsWith('Id')) requestId(value);
    if (/(From|To)$/u.test(key)) {
      if (!/^\d{4}-\d{2}-\d{2}$/u.test(value) || !Number.isFinite(Date.parse(`${value}T00:00:00Z`))
        || new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value) throw new Error('Enter valid calendar dates.');
    }
    query[key] = value;
  }
  for (const prefix of ['submitted', 'neededBy']) {
    if (query[`${prefix}From`] && query[`${prefix}To`] && query[`${prefix}From`] > query[`${prefix}To`]) throw new Error('The end date must follow the start date.');
  }
  return query;
}
export function validateDraft(draft, { now = Date.now() } = {}) {
  const errors = {};
  try { requestId(draft.recipientGroupId); } catch { errors.recipientGroupId = 'Choose an available blood group.'; }
  if (!/^\d+$/u.test(draft.quantityRequested) || Number(draft.quantityRequested) < 1 || Number(draft.quantityRequested) > 65535) errors.quantityRequested = 'Enter a whole number from 1 to 65,535.';
  if (!REQUEST_PRIORITIES.includes(draft.priority)) errors.priority = 'Choose a priority.';
  // datetime-local is explicitly labelled IST, independent of browser timezone/DST.
  const neededBy = `${draft.neededBy.length === 16 ? `${draft.neededBy}:00` : draft.neededBy}+05:30`;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+05:30$/u.test(neededBy)
    || !Number.isFinite(Date.parse(neededBy))
    || new Date(Date.parse(neededBy) + 330 * 60000).toISOString().slice(0, 19) !== neededBy.slice(0, 19)) errors.neededBy = 'Enter a valid date and time in IST.';
  else if (Date.parse(neededBy) <= now) errors.neededBy = 'Choose a future date and time.';
  if ([...(draft.note || '')].length > 500 || /\p{Cc}/u.test(draft.note || '')) errors.note = 'Use up to 500 characters without control characters.';
  return { errors, body: { recipientGroupId: draft.recipientGroupId, quantityRequested: Number(draft.quantityRequested), priority: draft.priority, neededBy, note: draft.note?.trim() || null } };
}
