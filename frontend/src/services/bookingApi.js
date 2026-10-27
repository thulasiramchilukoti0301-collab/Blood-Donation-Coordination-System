const obsolete = () => Object.assign(new Error('The confirmation is no longer current.'), { code: 'OBSOLETE_CONFIRMATION' });
const uncertain = () => Object.assign(new Error('The result needs checking.'), { code: 'MUTATION_OUTCOME_UNKNOWN' });
const csrfPattern = /^[a-f0-9]{64}$/u;
export function createBookingApi(client) {
  return {
    eligibility(signal) { return client.get('/donors/me/eligibility', { signal }).then(({ data }) => data.eligibility); },
    slots(params, signal) { return client.get('/donation-slots', { params, signal }).then(({ data }) => data); },
    ownBookings(params, signal) { return client.get('/donors/me/bookings', { params, signal }).then(({ data }) => data); },
    adminBookings(params, signal) { return client.get('/admin/bookings', { params, signal }).then(({ data }) => data); },
  };
}

// A mutation is deliberately not given an AbortSignal. A cancelled CSRF read
// prevents dispatch; once PATCH/POST is sent, only reads can resolve doubt.
export async function bookingMutation({ method, path, body, expected, isCurrent, signal }, client) {
  if (!client) throw new TypeError('An API client is required.');
  const check = () => { if (signal?.aborted || !isCurrent()) throw obsolete(); };
  check();
  const tokenResponse = await client.get('/auth/csrf', { signal });
  check();
  if (tokenResponse.status !== 200 || tokenResponse.data?.success !== true
    || !csrfPattern.test(tokenResponse.data?.csrfToken ?? '')) throw new Error('Security token could not be confirmed.');
  check();
  let result;
  try {
    result = await client.request({ method, url: path, data: body,
      headers: { 'X-CSRF-Token': tokenResponse.data.csrfToken } });
  } catch (error) { error.mutationDispatched = true; throw error; }
  if (![200, 201].includes(result?.status) || result.data?.success !== true || !expected(result.data)) throw uncertain();
  return result.data;
}

export function bookingMutationMessage(error) {
  if (error?.code === 'OBSOLETE_CONFIRMATION') return null;
  const status = error?.response?.status;
  const code = error?.response?.data?.error?.code;
  const unknown = { kind: 'uncertain', text: 'The outcome could not be confirmed. Reload the list to inspect current records. Do not submit this action again without checking.' };
  if (error?.code === 'MUTATION_OUTCOME_UNKNOWN' || code === 'TRANSACTION_OUTCOME_UNKNOWN'
    || code === 'TRANSACTION_CLEANUP_FAILED') return unknown;
  if (status === 409) return { kind: 'conflict', text: 'This item changed. Reload the list before choosing another action.' };
  // A definite server rejection remains definite even after dispatch. Transport
  // failures and uncertain transaction results still need read-only recovery.
  if (status === 400 || status === 422) return {
    kind: 'error', text: error.response.data?.error?.message || 'Check the entered values.',
  };
  if (status === 401 || status === 403) return { kind: 'error', text: 'This action was not authorized. Check your sign-in and access before continuing.' };
  if (status === 404) return { kind: 'error', text: 'This item is no longer available. Reload the list.' };
  if (status === 429) return { kind: 'error', text: 'Too many requests. Please wait before trying again.' };
  if (error?.mutationDispatched) return unknown;
  return { kind: 'error', text: 'Could not prepare this action. Check your connection and try again.' };
}
