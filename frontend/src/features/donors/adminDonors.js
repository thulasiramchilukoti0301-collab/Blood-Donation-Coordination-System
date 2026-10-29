export const DONOR_STATUSES = Object.freeze(['PENDING', 'ACTIVE', 'SUSPENDED']);
export const DEFAULT_DONOR_FILTERS = Object.freeze({ search: '', accountStatus: 'ANY', bloodGroupId: '', groupMatch: 'EITHER' });
const maxId = 18446744073709551615n;
const idOk = value => typeof value === 'string' && /^[1-9][0-9]{0,19}$/u.test(value) && BigInt(value) <= maxId;

export function canManageDonors(user) {
  return Boolean(user?.role === 'ADMIN' && user.accountStatus === 'ACTIVE' && idOk(user.accountId));
}
export function validateAdminDonorFilters(input = {}) {
  const errors = {};
  const search = typeof input.search === 'string' ? input.search.trim() : '';
  if (typeof input.search !== 'string' && input.search !== undefined) errors.search = 'Enter a Donor search.';
  else if ([...search].length > 120) errors.search = 'Use no more than 120 characters.';
  else if (/\p{Cc}/u.test(search)) errors.search = 'Remove control characters from the search.';
  const accountStatus = input.accountStatus ?? 'ANY';
  if (!['ANY', ...DONOR_STATUSES].includes(accountStatus)) errors.accountStatus = 'Choose an available account status.';
  const groupMatch = input.groupMatch ?? 'EITHER';
  if (!['EITHER', 'REPORTED', 'CONFIRMED'].includes(groupMatch)) errors.groupMatch = 'Choose how the blood-group filter should match.';
  const bloodGroupId = input.bloodGroupId ?? '';
  if (bloodGroupId !== '' && (typeof bloodGroupId !== 'string' || !idOk(bloodGroupId))) errors.bloodGroupId = 'Choose a valid blood group.';
  return { valid: Object.keys(errors).length === 0, errors, values: { search, accountStatus, bloodGroupId, groupMatch } };
}
export function readAdminDonor(input, expectedId) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || !idOk(input.donorId)
    || (expectedId && input.donorId !== expectedId) || !DONOR_STATUSES.includes(input.accountStatus)) return null;
  const stringFields = { email: 254, fullName: 120, dateOfBirth: 10, phone: 30, address: 255 };
  for (const [field, max] of Object.entries(stringFields)) {
    if (typeof input[field] !== 'string' || !input[field].trim() || [...input[field]].length > max || /\p{Cc}/u.test(input[field])) return null;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(input.dateOfBirth)) return null;
  if (input.area !== null && (typeof input.area !== 'string' || [...input.area].length > 100 || /\p{Cc}/u.test(input.area))) return null;
  const group = value => value === null ? null : value && idOk(value.bloodGroupId)
    && typeof value.code === 'string' && ['O-', 'O+', 'A-', 'A+', 'B-', 'B+', 'AB-', 'AB+'].includes(value.code)
    && (value.displayName === undefined || typeof value.displayName === 'string')
    ? { bloodGroupId: value.bloodGroupId, code: value.code, ...(value.displayName === undefined ? {} : { displayName: value.displayName }) } : undefined;
  const reported = group(input.reportedBloodGroup), confirmed = group(input.confirmedBloodGroup);
  if (reported === undefined || confirmed === undefined) return null;
  const timestamp = value => typeof value === 'string' && Number.isFinite(Date.parse(value));
  if (!timestamp(input.createdAt) || !timestamp(input.updatedAt)) return null;
  const context = input.context;
  if (!context || !Number.isSafeInteger(context.bookingCount) || context.bookingCount < 0
    || !Number.isSafeInteger(context.donationCount) || context.donationCount < 0) return null;
  const latestBooking = context.latestBooking;
  if (latestBooking !== null && (!latestBooking || !['BOOKED', 'CANCELLED_BY_DONOR', 'CANCELLED_BY_STAFF', 'CHECKED_IN', 'NO_SHOW', 'COMPLETED'].includes(latestBooking.bookingStatus)
    || !timestamp(latestBooking.appointmentAt))) return null;
  const latestDonation = context.latestDonation;
  if (latestDonation !== null && (!latestDonation || !['COLLECTED', 'INCOMPLETE', 'DEFERRED'].includes(latestDonation.outcome)
    || !['PENDING', 'APPROVED', 'REJECTED', 'NOT_REQUIRED'].includes(latestDonation.releaseStatus)
    || (latestDonation.collectedAt !== null && !timestamp(latestDonation.collectedAt)))) return null;
  return { donorId: input.donorId, email: input.email, accountStatus: input.accountStatus, fullName: input.fullName,
    dateOfBirth: input.dateOfBirth, phone: input.phone, address: input.address, area: input.area,
    reportedBloodGroup: reported, confirmedBloodGroup: confirmed, createdAt: input.createdAt, updatedAt: input.updatedAt,
    context: { bookingCount: context.bookingCount, donationCount: context.donationCount,
      latestBooking: latestBooking ? { bookingStatus: latestBooking.bookingStatus, appointmentAt: latestBooking.appointmentAt } : null,
      latestDonation: latestDonation ? { outcome: latestDonation.outcome, releaseStatus: latestDonation.releaseStatus, collectedAt: latestDonation.collectedAt } : null } };
}
export function readAdminDonorPage(input, expectedPage) {
  if (!input || !Array.isArray(input.donors) || input.donors.length > 20 || !input.pagination
    || input.pagination.page !== expectedPage || input.pagination.pageSize !== 20
    || !Number.isSafeInteger(input.pagination.total) || input.pagination.total < 0) return null;
  const donors = input.donors.map(row => {
    const full = readAdminDonor({ ...row, email: 'list@example.invalid', dateOfBirth: '2000-01-01', address: 'not returned',
      createdAt: '2000-01-01T00:00:00.000Z', updatedAt: '2000-01-01T00:00:00.000Z', context: { bookingCount: 0, donationCount: 0, latestBooking: null, latestDonation: null },
      reportedBloodGroup: row.reportedBloodGroup ? { ...row.reportedBloodGroup, displayName: 'Reported' } : null,
      confirmedBloodGroup: row.confirmedBloodGroup ? { ...row.confirmedBloodGroup, displayName: 'Confirmed' } : null });
    if (!full) return null;
    return { donorId: full.donorId, fullName: full.fullName, phone: full.phone, area: full.area,
      accountStatus: full.accountStatus, reportedBloodGroup: full.reportedBloodGroup,
      confirmedBloodGroup: full.confirmedBloodGroup };
  });
  if (donors.some(row => !row) || new Set(donors.map(row => row.donorId)).size !== donors.length) return null;
  return { donors, pagination: { page: expectedPage, pageSize: 20, total: input.pagination.total } };
}
export function adminDonorError(error) {
  const status = error?.response?.status;
  if (status === 401 || status === 403) return { kind: 'auth', message: 'An active Admin account is required. Check your sign-in status.' };
  if (status === 404) return { kind: 'missing', message: 'This Donor record is no longer available. Return to the list and refresh.' };
  if (status === 409) return { kind: 'conflict', message: error?.response?.data?.error?.message || 'The Donor record changed. Refresh before editing again.' };
  return { kind: 'error', message: 'Donor information is temporarily unavailable. Try a read-only refresh.' };
}
