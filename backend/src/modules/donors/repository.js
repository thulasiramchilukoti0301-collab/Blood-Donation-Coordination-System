import { HttpError } from '../../utils/httpError.js';
import { createAuthRepository } from '../auth/repository.js';
import { requireStoredSession } from '../accounts/sessionAuthorization.js';

const editableColumns = Object.freeze({
  fullName: 'full_name',
  phone: 'phone',
  address: 'address',
  area: 'area',
  reportedBloodGroupId: 'reported_blood_group_id',
});

export function createDonorRepository(databasePool) {
  if (!databasePool) throw new TypeError('A database pool is required.');
  return {
    async withTransaction(work) {
      let connection;
      let started = false;
      let rollbackFailed = false;
      try {
        connection = await databasePool.getConnection();
        await connection.beginTransaction();
        started = true;
        const transaction = {
          authorizeSession(authorization, account) {
            return requireStoredSession(connection, authorization, {
              accountId: String(account.account_id), role: account.role, accountStatus: account.account_status,
            });
          },
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
          async findReportedBloodGroup(id) {
            const [rows] = await connection.execute(
              'SELECT blood_group_id FROM BloodGroup WHERE blood_group_id = ? LIMIT 1',
              [id],
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
          catch {
            rollbackFailed = true;
            throw new HttpError(503, 'DATABASE_UNAVAILABLE', 'Database could not complete the request safely.');
          }
        }
        throw error;
      } finally {
        if (connection) {
          if (rollbackFailed) {
            // Never release an uncertain transaction, even if disposal fails.
            try { connection.destroy(); } catch { /* Keep cleanup diagnostics private. */ }
          } else {
            try { connection.release(); }
            catch {
              try { connection.destroy(); } catch { /* Never retry release after failed disposal. */ }
              throw new HttpError(503, 'DATABASE_UNAVAILABLE', 'Database could not complete the request safely.');
            }
          }
        }
      }
    },
  };
}
