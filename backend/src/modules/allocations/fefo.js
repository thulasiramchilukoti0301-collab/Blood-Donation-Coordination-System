// Internal selection logic. A preview is a snapshot, never a reservation.
const eligibleStatuses = new Set(['UNDER_REVIEW', 'AWAITING_INVENTORY', 'PARTIALLY_FULFILLED']);

export function allocationCapacity(request, allocations) {
  if (!eligibleStatuses.has(request.requestStatus)) throw new RangeError('Request is not eligible for allocation.');
  const quantity = Number(request.quantityRequested);
  if (!Number.isSafeInteger(quantity) || quantity < 1) throw new RangeError('Invalid requested quantity.');
  const allocated = allocations.filter((row) => row.allocationStatus === 'ALLOCATED').length;
  const issued = allocations.filter((row) => row.allocationStatus === 'ISSUED').length;
  if (allocated + issued > quantity) throw new RangeError('Stored allocations exceed requested quantity.');
  return { allocated, issued, outstanding: quantity - allocated - issued };
}

export function selectFefoUnits({ request, allocations, units, intendedIssueDate, quantity }) {
  if (typeof intendedIssueDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(intendedIssueDate)
    || Number.isNaN(Date.parse(`${intendedIssueDate}T00:00:00Z`))) throw new TypeError('Invalid intended issue date.');
  const totals = allocationCapacity(request, allocations);
  const wanted = quantity === undefined ? totals.outstanding : Number(quantity);
  if (!Number.isSafeInteger(wanted) || wanted < 1 || wanted > totals.outstanding) throw new RangeError('Invalid allocation quantity.');
  const seen = new Set();
  const eligible = units.filter((unit) => {
    const id = String(unit.bloodUnitId);
    if (seen.has(id)) throw new RangeError('Duplicate unit in candidate set.');
    seen.add(id);
    return unit.unitStatus === 'AVAILABLE' && unit.releaseStatus === 'APPROVED'
      && unit.donationOutcome === 'COLLECTED' && unit.isCompatible === 1
      && unit.expiryDate > intendedIssueDate && unit.collectedAt != null
      && unit.hasActiveAllocation !== true && unit.hasActiveAllocation !== 1;
  }).sort((a, b) => a.expiryDate.localeCompare(b.expiryDate)
    || a.collectedAt.localeCompare(b.collectedAt)
    || (BigInt(a.bloodUnitId) < BigInt(b.bloodUnitId) ? -1 : BigInt(a.bloodUnitId) > BigInt(b.bloodUnitId) ? 1 : 0));
  const selected = eligible.slice(0, wanted);
  return { units: selected, allocated: totals.allocated, issued: totals.issued,
    outstanding: totals.outstanding, available: eligible.length,
    shortfall: wanted - selected.length, guaranteed: false };
}
