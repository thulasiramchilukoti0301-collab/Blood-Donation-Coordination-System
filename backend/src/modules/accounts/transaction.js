import { HttpError } from '../../utils/httpError.js';

export function safeAccountError(error) {
  return error instanceof HttpError ? error
    : new HttpError(503, 'DATABASE_UNAVAILABLE', 'Account data is temporarily unavailable.');
}

// All cooperating writers lock Accounts by ascending numeric ID, then sessions.
// Credential columns are internal only and must never be spread into responses.
export async function withAccountLocks(database, ids, work) {
  let connection;
  let started = false;
  let committing = false;
  let committed = false;
  let result;
  let failure;
  try {
    connection = await database.getConnection();
    started = true;
    await connection.beginTransaction();
    const accounts = new Map();
    const ordered = [...new Set(ids)].sort((a, b) => BigInt(a) < BigInt(b) ? -1 : BigInt(a) > BigInt(b) ? 1 : 0);
    for (const id of ordered) {
      const [rows] = await connection.execute(`SELECT CAST(account_id AS CHAR) AS accountId,
        email, password_hash AS passwordHash, role, account_status AS accountStatus
        FROM Account WHERE account_id = ? FOR UPDATE`, [id]);
      accounts.set(id, rows[0] ?? null);
    }
    result = await work(connection, accounts);
    committing = true;
    await connection.commit();
    committed = true;
  } catch (error) {
    failure = committing
      ? new HttpError(503, 'TRANSACTION_OUTCOME_UNKNOWN', 'The transaction outcome is uncertain. Refresh before retrying.')
      : safeAccountError(error);
  } finally {
    if (connection) {
      let dispose = false;
      if (started && !committed) {
        try { await connection.rollback(); }
        catch { dispose = true; }
      }
      if (dispose) {
        try { connection.destroy(); } catch { /* Keep diagnostics safe. */ }
        failure = new HttpError(503, committing ? 'TRANSACTION_OUTCOME_UNKNOWN' : 'TRANSACTION_CLEANUP_FAILED',
          'The transaction could not be cleaned up safely. Refresh before retrying.');
      } else {
        try { connection.release(); }
        catch {
          try { connection.destroy(); } catch { /* Never return an uncertain connection to the pool. */ }
          failure = new HttpError(503, committed ? 'TRANSACTION_OUTCOME_UNKNOWN' : 'TRANSACTION_CLEANUP_FAILED',
            'The transaction could not be cleaned up safely. Refresh before retrying.');
        }
      }
    }
  }
  if (failure) throw failure;
  return result;
}
