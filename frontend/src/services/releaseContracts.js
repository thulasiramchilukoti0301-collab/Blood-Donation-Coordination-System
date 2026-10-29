import { bookingMutation } from './bookingApi.js';
import { reportedBloodGroupChoices } from '../features/donors/bloodGroups.js';

const validId = value => typeof value === 'string' && /^[1-9][0-9]{0,19}$/u.test(value)
  && BigInt(value) <= 18446744073709551615n;
const validTime = value => typeof value === 'string' && /\+05:30$/u.test(value) && !Number.isNaN(Date.parse(value));
const plus42 = date => new Date(Date.parse(`${date}T00:00:00Z`) + 42 * 86_400_000).toISOString().slice(0, 10);

export function createReleaseApi(client) {
  return {
    pending(params, signal) { return client.get('/admin/donations', { params, signal }).then(({ data }) => data); },
    inventory(params, signal) { return client.get('/inventory', { params, signal }).then(({ data }) => data); },
    detail(id, signal) { return client.get(`/admin/inventory/${encodeURIComponent(id)}`, { signal }).then(({ data }) => data); },
  };
}

export function matchesRelease(result, captured) {
  const row = result?.release;
  if (result?.success !== true || row?.donationId !== captured.donationId
    || row.decision !== captured.decision || row.reasonCode !== captured.reasonCode
    || !validTime(row.releaseDecidedAt) || typeof row.replayed !== 'boolean') return false;
  if (captured.decision === 'REJECTED') return row.unit === null;
  const unit = row.unit;
  const group = reportedBloodGroupChoices.find(item => item.id === captured.confirmedBloodGroupId);
  const expiryDate = plus42(captured.collectedAt.slice(0, 10));
  return validId(unit?.bloodUnitId) && unit.donationId === captured.donationId
    && unit.bloodGroupId === captured.confirmedBloodGroupId
    && unit.bloodGroupCode === group?.code && unit.expiryDate === expiryDate
    && (row.replayed
      ? ['AVAILABLE', 'ALLOCATED', 'ISSUED', 'EXPIRED', 'DISCARDED'].includes(unit.unitStatus)
      : unit.unitStatus === (row.releaseDecidedAt.slice(0, 10) < expiryDate ? 'AVAILABLE' : 'EXPIRED'));
}

export function releaseMutation(captured, isCurrent, signal, client) {
  return bookingMutation({ method: 'POST', path: `/admin/donations/${encodeURIComponent(captured.donationId)}/testing-decision`,
    body: captured.decision === 'APPROVED'
      ? { decision: 'APPROVED', confirmedBloodGroupId: captured.confirmedBloodGroupId }
      : { decision: 'REJECTED', reasonCode: captured.reasonCode },
    expected: result => matchesRelease(result, captured), isCurrent, signal }, client);
}

export function matchesDiscard(result, captured) {
  const row = result?.discard;
  return result?.success === true && Object.keys(result).sort().join(',') === 'discard,success'
    && Object.keys(row ?? {}).sort().join(',') === 'bloodUnitId,discardedAt,reasonCode,unitStatus'
    && validId(row?.bloodUnitId) && row.bloodUnitId === captured.bloodUnitId
    && row.unitStatus === 'DISCARDED' && row.reasonCode === captured.reasonCode && validTime(row.discardedAt);
}

export function matchesExpiry(result, captured) {
  const row = result?.result;
  void captured;
  const runDateMs = /^\d{4}-\d{2}-\d{2}$/u.test(row?.runDate ?? '') ? Date.parse(`${row.runDate}T00:00:00+05:30`) : NaN;
  const validDate = Number.isFinite(runDateMs)
    && new Date(runDateMs + 330 * 60_000).toISOString().slice(0, 10) === row.runDate;
  return result?.success === true && Object.keys(result).sort().join(',') === 'result,success'
    && Object.keys(row ?? {}).sort().join(',') === 'checkedCount,expiredCount,operationId,runAt,runDate'
    && validDate && validTime(row?.runAt) && row.runAt.startsWith(`${row.runDate}T`)
    && Number.isSafeInteger(row.checkedCount) && row.checkedCount >= 0
    && Number.isSafeInteger(row.expiredCount) && row.expiredCount >= 0 && row.expiredCount <= row.checkedCount
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(row.operationId ?? '');
}

export function inventoryMutation(kind, captured, isCurrent, signal, client) {
  const discard = kind === 'discard';
  const path = discard ? `/admin/inventory/${encodeURIComponent(captured.bloodUnitId)}/discard` : '/admin/inventory/expiry/run';
  return bookingMutation({ method: 'POST', path, body: discard ? { reasonCode: captured.reasonCode } : {},
    expected: result => discard ? matchesDiscard(result, captured) : matchesExpiry(result, captured), isCurrent, signal }, client);
}
