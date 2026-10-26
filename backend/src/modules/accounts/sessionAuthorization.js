import { HttpError } from '../../utils/httpError.js';
import { accountIdentifier } from './validation.js';

export const sessionUnavailable = () => new HttpError(401, 'ACCOUNT_UNAVAILABLE',
  'This account cannot use the current session. Sign in again if the account is active.');

// Internal server context only, never accepted from a body/query or returned.
export function sessionAuthorization(sessionId, principal) {
  try { accountIdentifier(principal?.accountId); } catch { throw sessionUnavailable(); }
  if (typeof sessionId !== 'string' || !sessionId || sessionId.length > 128 || /\p{Cc}/u.test(sessionId)
    || !['ADMIN', 'DONOR', 'HOSPITAL'].includes(principal.role)
    || !(principal.accountStatus === 'ACTIVE' || (principal.accountStatus === 'PENDING' && principal.role !== 'ADMIN'))) {
    throw sessionUnavailable();
  }
  return Object.freeze({ sessionId, principal: Object.freeze({ accountId: principal.accountId,
    role: principal.role, accountStatus: principal.accountStatus }) });
}

// Caller must own the transaction and already hold this Account's row lock.
// Re-read the SID with a locking/current read, then sample time after row waits.
// Account status matching is not a security generation counter: the tombstone
// remains authoritative across ACTIVE -> SUSPENDED -> ACTIVE, even in one second.
export async function requireStoredSession(connection, authorization, account) {
  const context = sessionAuthorization(authorization?.sessionId, authorization?.principal);
  const principal = context.principal;
  if (!account || account.accountId !== principal.accountId || account.role !== principal.role
    || account.accountStatus !== principal.accountStatus) throw sessionUnavailable();
  const [rows] = await connection.execute(`SELECT session_data, expires_at, revoked_at FROM app_session
    WHERE session_id = ? FOR UPDATE`, [context.sessionId]);
  const row = rows[0];
  const now = Date.now();
  if (!row || row.revoked_at !== null || row.session_data === null || !(Number(row.expires_at) > now)) {
    throw sessionUnavailable();
  }
  let stored;
  try { stored = JSON.parse(row.session_data)?.auth; } catch { throw sessionUnavailable(); }
  if (stored?.accountId !== principal.accountId || stored.role !== principal.role
    || stored.accountStatus !== principal.accountStatus) throw sessionUnavailable();
  return { accountId: principal.accountId, role: principal.role, accountStatus: principal.accountStatus };
}
