const maxId = 18446744073709551615n;
const csrf = /^[a-f0-9]{64}$/u;
const invalid = () => new Error('Allocation confirmation could not be validated.');
function id(value) {
  if (typeof value !== 'string' || !/^[1-9][0-9]{0,19}$/u.test(value) || BigInt(value) > maxId) throw invalid();
  return value;
}
function date(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) throw invalid();
  const parsed = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) throw invalid();
}
function parseResult(data, requestId, unitIds) {
  const result = data?.allocation;
  if (data?.success !== true || !result || result.requestId !== requestId || result.requestStatus !== 'PARTIALLY_FULFILLED'
    || result.allocations?.length !== unitIds.length || !Number.isSafeInteger(result.allocated) || result.allocated < unitIds.length
    || !Number.isSafeInteger(result.issued) || result.issued < 0 || !Number.isSafeInteger(result.outstanding) || result.outstanding < 0
    || typeof result.operationId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(result.operationId)) throw invalid();
  const allocations = result.allocations.map((row, index) => {
    const allocationId = id(row?.allocationId); const bloodUnitId = id(row?.bloodUnitId);
    if (bloodUnitId !== unitIds[index]) throw invalid();
    return { allocationId, bloodUnitId };
  });
  if (new Set(allocations.map(row => row.allocationId)).size !== allocations.length
    || new Set(allocations.map(row => row.bloodUnitId)).size !== allocations.length) throw invalid();
  return { requestId, allocations, allocated: result.allocated, issued: result.issued,
    outstanding: result.outstanding, requestStatus: result.requestStatus, operationId: result.operationId };
}

export function createAllocationMutationApi(client) {
  return {
    async issue(allocationIdValue, { handoffReference, isCurrent } = {}) {
      const allocationId = id(allocationIdValue);
      if (typeof handoffReference !== 'string' || !handoffReference.trim() || [...handoffReference].length > 80 || /\p{Cc}/u.test(handoffReference)) throw invalid();
      const current = () => typeof isCurrent === 'function' && isCurrent();
      if (!current()) throw Object.assign(new Error('This issue action is no longer current.'), { code: 'OBSOLETE_CONFIRMATION' });
      const tokenResponse = await client.get('/auth/csrf');
      if (!current()) throw Object.assign(new Error('This issue action is no longer current.'), { code: 'OBSOLETE_CONFIRMATION' });
      if (tokenResponse.status !== 200 || tokenResponse.data?.success !== true || !csrf.test(tokenResponse.data?.csrfToken ?? '')) throw invalid();
      let response;
      try { response = await client.post(`/admin/allocations/${encodeURIComponent(allocationId)}/issue`,
        { handoffReference: handoffReference.trim() }, { headers: { 'X-CSRF-Token': tokenResponse.data.csrfToken } }); }
      catch (error) { error.mutationDispatched = true; throw error; }
      const result = response.data?.issue;
      if (response.status !== 200 || response.data?.success !== true || result?.allocationId !== allocationId
        || result.allocationStatus !== 'ISSUED' || result.unitStatus !== 'ISSUED'
        || !['PARTIALLY_FULFILLED', 'FULFILLED'].includes(result.requestStatus)
        || !Number.isSafeInteger(result.issued) || !Number.isSafeInteger(result.allocated)
        || !Number.isSafeInteger(result.outstanding) || result.handoffReference !== handoffReference.trim()) {
        const error = invalid(); error.mutationDispatched = true; throw error;
      }
      return result;
    },
    async confirm(requestIdValue, { bloodUnitIds, intendedIssueDate, isCurrent, signal } = {}) {
      const requestId = id(requestIdValue);
      if (!Array.isArray(bloodUnitIds) || bloodUnitIds.length < 1 || bloodUnitIds.length > 25) throw invalid();
      const ids = bloodUnitIds.map(id);
      if (new Set(ids).size !== ids.length) throw invalid();
      date(intendedIssueDate);
      const current = () => typeof isCurrent === 'function' && isCurrent();
      if (!current()) throw Object.assign(new Error('This allocation confirmation is no longer current.'), { code: 'OBSOLETE_CONFIRMATION' });
      const tokenResponse = await client.get('/auth/csrf', { signal });
      if (!current()) throw Object.assign(new Error('This allocation confirmation is no longer current.'), { code: 'OBSOLETE_CONFIRMATION' });
      if (tokenResponse.status !== 200 || tokenResponse.data?.success !== true || !csrf.test(tokenResponse.data?.csrfToken ?? '')) throw invalid();
      if (!current()) throw Object.assign(new Error('This allocation confirmation is no longer current.'), { code: 'OBSOLETE_CONFIRMATION' });
      let response;
      try {
        response = await client.post(`/admin/requests/${encodeURIComponent(requestId)}/allocations`,
          { bloodUnitIds: ids, intendedIssueDate }, { headers: { 'X-CSRF-Token': tokenResponse.data.csrfToken } });
      } catch (error) { error.mutationDispatched = true; throw error; }
      try {
        if (response.status !== 201) throw invalid();
        return parseResult(response.data, requestId, ids);
      } catch (error) { error.mutationDispatched = true; throw error; }
    },
  };
}

export function allocationMutationMessage(error) {
  if (error?.code === 'OBSOLETE_CONFIRMATION') return null;
  const status = error?.response?.status;
  const code = error?.response?.data?.error?.code;
  if (code === 'TRANSACTION_OUTCOME_UNKNOWN' || code === 'TRANSACTION_CLEANUP_FAILED'
    || error?.mutationDispatched && !status) return { kind: 'uncertain', text: 'The result is uncertain. Refresh request and inventory data before any new submission; these unit IDs will not be replaced automatically.' };
  if (status === 409) return { kind: 'conflict', text: 'The preview is stale or another transaction changed inventory. Review a fresh preview before deciding which exact units to reserve.' };
  if (status === 401 || status === 403) return { kind: 'error', text: 'This action was not authorized. Check that you are signed in as an ACTIVE Admin.' };
  if (status === 404) return { kind: 'error', text: 'The request is no longer available. Refresh the Admin request queue.' };
  if (error?.mutationDispatched) return { kind: 'error', text: error?.response?.data?.error?.message || 'The allocation was not confirmed. Refresh the request and inventory before deciding whether to submit again.' };
  return { kind: 'error', text: 'Could not prepare the allocation. Check your connection and current Admin session.' };
}
