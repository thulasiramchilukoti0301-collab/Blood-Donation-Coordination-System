import { bookingMutation } from './bookingApi.js';

export function createDonationApi(client) {
  return {
    adminHistory(params, signal) { return client.get('/admin/donations', { params, signal }).then(({ data }) => data); },
    ownHistory(params, signal) { return client.get('/donors/me/donations', { params, signal }).then(({ data }) => data); },
  };
}
const id = value => typeof value === 'string' && /^[1-9][0-9]{0,19}$/u.test(value)
  && BigInt(value) <= 18446744073709551615n;
export function matchesDonation(result, captured) {
  const row = result?.donation;
  return result?.success === true && id(row?.donationId) && row.bookingId === captured.bookingId
    && row.donorAccountId === captured.donorAccountId && row.bookingStatus === 'COMPLETED'
    && row.outcome === captured.outcome && row.releaseStatus === (captured.outcome === 'COLLECTED' ? 'PENDING' : 'NOT_REQUIRED')
    && (row.collectedAt ?? null) === (captured.collectedAt ?? null)
    && (row.collectionReference ?? null) === (captured.collectionReference ?? null)
    && typeof row.createdAt === 'string' && !Number.isNaN(Date.parse(row.createdAt));
}
export function donationMutation(captured, isCurrent, signal, client) {
  const { bookingId, outcome, collectedAt, collectionReference } = captured;
  return bookingMutation({ method: 'POST', path: '/admin/donations',
    body: { bookingId, outcome, ...(outcome === 'COLLECTED' ? { collectedAt, collectionReference } : {}) },
    expected: result => matchesDonation(result, captured), isCurrent, signal }, client);
}
