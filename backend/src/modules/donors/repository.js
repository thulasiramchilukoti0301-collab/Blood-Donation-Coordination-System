import { HttpError } from '../../utils/httpError.js';
import { createAuthRepository } from '../auth/repository.js';

const editableColumns = Object.freeze({
  fullName: 'full_name',
  phone: 'phone',
  address: 'address',
  area: 'area',
});

export function createDonorRepository(databasePool) {
  if (!databasePool) throw new TypeError('A database pool is required.');
  return {
    async withTransaction(work) {
      let connection;
      let started = false;
      try {
        connection = await databasePool.getConnection();
        await connection.beginTransaction();
        started = true;
        const transaction = {
          async findAccountForUpdate(accountId) {
            const [rows] = await connection.execute(
              `SELECT CAST(account_id AS CHAR) AS account_id, role, account_status
               FROM Account WHERE account_id = ? FOR UPDATE`,
              [String(accountId)],
            );
            return rows[0] ?? null;
          },
          async findDonorForUpdate(accountId) {
            const [rows] = await connection.execute(
              'SELECT account_id FROM Donor WHERE account_id = ? FOR UPDATE',
              [String(accountId)],
            );
            return rows[0] ?? null;
          },
          async updateProfile(accountId, patch) {
            const fields = Object.keys(patch);
            if (!fields.length || fields.some((field) => !Object.hasOwn(editableColumns, field))) {
              throw new TypeError('Only validated donor profile fields may be updated.');
            }
            await connection.execute(
              `UPDATE Donor SET ${fields.map((field) => `${editableColumns[field]} = ?`).join(', ')},
               updated_at = CURRENT_TIMESTAMP WHERE account_id = ?`,
              [...fields.map((field) => patch[field]), String(accountId)],
            );
          },
          findProfile(accountId) {
            return createAuthRepository(connection).findDonorProfile(accountId);
          },
        };
        const result = await work(transaction);
        await connection.commit();
        started = false;
        return result;
      } catch (error) {
        if (started) {
          try { await connection.rollback(); }
          catch { throw new HttpError(503, 'DATABASE_UNAVAILABLE', 'Database could not complete the request safely.'); }
        }
        throw error;
      } finally {
        if (connection) {
          try { connection.release(); }
          catch { throw new HttpError(503, 'DATABASE_UNAVAILABLE', 'Database could not complete the request safely.'); }
        }
      }
    },
  };
}
