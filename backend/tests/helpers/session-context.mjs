import { requireStoredSession, sessionAuthorization } from '../../src/modules/accounts/sessionAuthorization.js';

// Disposable test contexts only; never an application authentication bypass.
export function testAuthorization(accountId, role = 'DONOR', accountStatus = 'PENDING') {
  return sessionAuthorization(`fixture-session-${accountId}`, { accountId, role, accountStatus });
}
export function testSessionRow(authorization) {
  return { session_data: JSON.stringify({ auth: authorization.principal }),
    expires_at: Date.now() + 3_600_000, revoked_at: null };
}
// Older HTTP unit fixtures deliberately use MemoryStore. Their explicit adapter
// exercises the real SID validator; production continues to use locked MySQL.
export function authorizeMemorySessions(service, store) {
  service.authorizeSession = async (id, principal) => {
    const account = await service.currentAccount(principal.accountId);
    return requireStoredSession({ execute: async () => {
      const value = await new Promise((resolve, reject) => store.get(id, (error, data) => error ? reject(error) : resolve(data)));
      return [value ? [{ session_data: JSON.stringify(value), expires_at: new Date(value.cookie.expires).getTime(), revoked_at: null }] : []];
    } }, sessionAuthorization(id, principal), account);
  };
}
