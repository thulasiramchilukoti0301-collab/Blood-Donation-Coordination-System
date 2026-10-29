const groups = ['O-', 'O+', 'A-', 'A+', 'B-', 'B+', 'AB-', 'AB+'];
const compatibleRecipients = {
  'O-': groups, 'O+': ['O+', 'A+', 'B+', 'AB+'], 'A-': ['A-', 'A+', 'AB-', 'AB+'],
  'A+': ['A+', 'AB+'], 'B-': ['B-', 'B+', 'AB-', 'AB+'], 'B+': ['B+', 'AB+'],
  'AB-': ['AB-', 'AB+'], 'AB+': ['AB+'],
};
const requestStatuses = new Set(['SUBMITTED', 'UNDER_REVIEW', 'AWAITING_INVENTORY', 'PARTIALLY_FULFILLED', 'FULFILLED', 'REJECTED', 'CANCELLED']);
const maxId = 18446744073709551615n;
const invalid = () => new Error('The allocation preview response could not be confirmed.');

function id(value) {
  if (typeof value !== 'string' || !/^[1-9][0-9]{0,19}$/u.test(value) || BigInt(value) > maxId) throw invalid();
  return value;
}
function text(value) { return typeof value === 'string' && value.length > 0 && !/\p{Cc}/u.test(value); }
function date(value) { return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/u.test(value)
  && Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value; }

export function readCompatibilityResponse(data) {
  if (data?.success !== true || !Array.isArray(data.groups) || data.groups.length !== 8
    || !Array.isArray(data.pairs) || data.pairs.length !== 64) throw invalid();
  const parsedGroups = data.groups.map((group) => {
    if (!text(group.code) || !text(group.displayName)) throw invalid();
    return { bloodGroupId: id(group.bloodGroupId), code: group.code, displayName: group.displayName };
  });
  if (new Set(parsedGroups.map((group) => group.code)).size !== 8
    || groups.some((code) => !parsedGroups.some((group) => group.code === code))) throw invalid();
  const parsedPairs = data.pairs.map((pair) => {
    if (!groups.includes(pair.donorGroupCode) || !groups.includes(pair.recipientGroupCode)
      || typeof pair.isCompatible !== 'boolean') throw invalid();
    return { donorGroupCode: pair.donorGroupCode, recipientGroupCode: pair.recipientGroupCode,
      isCompatible: pair.isCompatible };
  });
  const keys = parsedPairs.map((pair) => `${pair.donorGroupCode}>${pair.recipientGroupCode}`);
  if (new Set(keys).size !== 64 || parsedPairs.filter((pair) => pair.isCompatible).length !== 27) throw invalid();
  for (const donor of groups) for (const recipient of groups) if (!keys.includes(`${donor}>${recipient}`)) throw invalid();
  return { groups: parsedGroups.sort((a, b) => groups.indexOf(a.code) - groups.indexOf(b.code)), pairs: parsedPairs };
}

export function readAllocationPreview(data, expectedRequestId) {
  const preview = data?.preview;
  const request = preview?.request;
  const counts = preview?.counts;
  const page = preview?.candidatePagination;
  if (data?.success !== true || preview?.isBinding !== false || !request || !counts || !page
    || request.requestId !== expectedRequestId || request.recipientGroupId !== id(request.recipientGroupId)
    || !groups.includes(request.recipientGroupCode) || !text(request.recipientGroupName) || !text(request.hospitalName)
    || !Number.isSafeInteger(request.quantityRequested) || request.quantityRequested < 1
    || !requestStatuses.has(request.requestStatus) || !date(preview.intendedIssueDate) || typeof preview.eligibleForAllocation !== 'boolean'
    || !['allocated', 'issued', 'outstanding', 'availableCandidateCount', 'allocatableCount'].every((key) => Number.isSafeInteger(counts[key]) && counts[key] >= 0)
    || counts.allocated + counts.issued + counts.outstanding !== request.quantityRequested
    || counts.allocatableCount > counts.outstanding || counts.allocatableCount > counts.availableCandidateCount
    || !Number.isSafeInteger(page.page) || page.page < 1 || page.pageSize !== 25 || page.total !== counts.allocatableCount
    || page.pageCount !== Math.ceil(page.total / page.pageSize) || !Array.isArray(preview.candidates)
    || preview.candidates.length > page.pageSize || preview.candidates.length > page.total) throw invalid();
  const candidates = preview.candidates.map((candidate) => {
    if (!groups.includes(candidate.donorGroupCode) || !compatibleRecipients[candidate.donorGroupCode].includes(request.recipientGroupCode)
      || !date(candidate.expiryDate) || !text(candidate.collectedAt)) throw invalid();
    return { bloodUnitId: id(candidate.bloodUnitId), donorGroupCode: candidate.donorGroupCode,
      expiryDate: candidate.expiryDate, collectedAt: candidate.collectedAt };
  });
  if (new Set(candidates.map((candidate) => candidate.bloodUnitId)).size !== candidates.length) throw invalid();
  for (let index = 1; index < candidates.length; index++) {
    const prior = candidates[index - 1]; const next = candidates[index];
    if (prior.expiryDate > next.expiryDate || (prior.expiryDate === next.expiryDate && prior.collectedAt > next.collectedAt)
      || (prior.expiryDate === next.expiryDate && prior.collectedAt === next.collectedAt && BigInt(prior.bloodUnitId) > BigInt(next.bloodUnitId))) throw invalid();
  }
  return { request: { requestId: id(request.requestId), recipientGroupId: id(request.recipientGroupId),
    recipientGroupCode: request.recipientGroupCode, recipientGroupName: request.recipientGroupName,
    hospitalName: request.hospitalName, quantityRequested: request.quantityRequested, requestStatus: request.requestStatus },
  eligibleForAllocation: preview.eligibleForAllocation, intendedIssueDate: preview.intendedIssueDate,
  counts: { allocated: counts.allocated, issued: counts.issued, outstanding: counts.outstanding,
    availableCandidateCount: counts.availableCandidateCount, allocatableCount: counts.allocatableCount },
  candidates, candidatePagination: { page: page.page, pageSize: page.pageSize, total: page.total, pageCount: page.pageCount } };
}

export function createAllocationReadApi(client) {
  return {
    async compatibility({ signal } = {}) {
      const { data } = await client.get('/admin/blood-compatibility', { signal });
      return readCompatibilityResponse(data);
    },
    async preview(requestId, { intendedIssueDate, candidatePage = 1, signal } = {}) {
      id(requestId);
      if (!date(intendedIssueDate) || !Number.isSafeInteger(candidatePage) || candidatePage < 1) throw invalid();
      const { data } = await client.get(`/admin/requests/${encodeURIComponent(requestId)}/allocation-preview`, {
        params: { intendedIssueDate, candidatePage }, signal,
      });
      return readAllocationPreview(data, requestId);
    },
  };
}
