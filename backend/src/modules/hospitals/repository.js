import { safeHospitalError } from './errors.js';

const profileColumns = `CAST(h.account_id AS CHAR) AS hospitalId,
  h.organization_name AS organizationName, h.registration_number AS registrationNumber,
  h.contact_name AS contactName, h.phone, h.address,
  h.created_at AS createdAt, h.updated_at AS updatedAt, a.account_status AS accountStatus`;
const editableColumns = Object.freeze({ contactName: 'contact_name', phone: 'phone', address: 'address' });
const pageSize = 20;

// Inject the existing mysql2 pool/connection when shared route integration is
// authorized. Importing this module never loads environment files or connects.
export function createHospitalRepository(database) {
  if (!database || typeof database.execute !== 'function') throw new TypeError('A mysql2 database dependency is required.');
  async function execute(sql, values = []) {
    try {
      return await database.execute(sql, values);
    } catch (error) {
      throw safeHospitalError(error);
    }
  }
  return {
    async findAccountById(id, { forUpdate = false } = {}) {
      const [rows] = await execute(`SELECT CAST(account_id AS CHAR) AS accountId, role, account_status AS accountStatus
        FROM Account WHERE account_id = ?${forUpdate ? ' FOR UPDATE' : ''}`, [id]);
      return rows[0] ?? null;
    },
    async findProfileByAccountId(id, { forUpdate = false } = {}) {
      const [rows] = await execute(`SELECT ${profileColumns}
        FROM Hospital h JOIN Account a ON a.account_id = h.account_id
        WHERE h.account_id = ? AND a.role = 'HOSPITAL'${forUpdate ? ' FOR UPDATE' : ''}`, [id]);
      return rows[0] ?? null;
    },
    // For future shared transactional registration validation. Database UNIQUE
    // remains authoritative for races; no public availability route is added.
    async findAccountIdByRegistrationNumber(registrationNumber) {
      const [rows] = await execute(`SELECT CAST(account_id AS CHAR) AS accountId
        FROM Hospital WHERE registration_number = ?`, [registrationNumber]);
      return rows[0]?.accountId ?? null;
    },
    async updateContactProfile(id, patch) {
      // Defense in depth: never interpolate browser-controlled column names.
      const keys = Object.keys(patch);
      if (!keys.length || keys.some((key) => !Object.hasOwn(editableColumns, key))) {
        throw new TypeError('Only validated Hospital contact updates are accepted.');
      }
      await execute(`UPDATE Hospital SET ${keys.map((key) => `${editableColumns[key]} = ?`).join(', ')},
        updated_at = CURRENT_TIMESTAMP WHERE account_id = ?`, [...keys.map((key) => patch[key]), id]);
      // Do not interpret affectedRows=0 as missing: identical values within one
      // timestamp second are legitimate. The service locks/checks existence.
      return this.findProfileByAccountId(id);
    },
    async listHospitals({ search, accountStatus, page }) {
      const conditions = ["a.role = 'HOSPITAL'"];
      const values = [];
      if (search) {
        // '!' is the explicit LIKE escape, so literal %, _ and ! are searchable.
        const pattern = `%${search.replace(/[!%_]/g, '!$&')}%`;
        conditions.push(`(h.organization_name LIKE ? ESCAPE '!' OR h.registration_number LIKE ? ESCAPE '!'
          OR h.contact_name LIKE ? ESCAPE '!' OR h.phone LIKE ? ESCAPE '!')`);
        values.push(pattern, pattern, pattern, pattern);
      }
      if (accountStatus) {
        conditions.push('a.account_status = ?');
        values.push(accountStatus);
      }
      const from = `FROM Hospital h JOIN Account a ON a.account_id = h.account_id WHERE ${conditions.join(' AND ')}`;
      const [[count]] = await execute(`SELECT COUNT(*) AS total ${from}`, values);
      const [hospitals] = await execute(`SELECT ${profileColumns} ${from}
        ORDER BY h.organization_name, h.account_id LIMIT ? OFFSET ?`, [...values, pageSize, (page - 1) * pageSize]);
      return { hospitals, pagination: { page, pageSize, total: Number(count.total) } };
    },
    async withTransaction(work) {
      let connection;
      let began = false;
      let rollbackFailed = false;
      try {
        connection = await database.getConnection();
        await connection.beginTransaction();
        began = true;
        const result = await work(createHospitalRepository(connection));
        await connection.commit();
        began = false;
        return result;
      } catch (error) {
        if (began) {
          try { await connection.rollback(); } catch { rollbackFailed = true; }
        }
        throw safeHospitalError(error);
      } finally {
        // Never return an uncertain transaction to the pool. Keep the original
        // operation's safe error instead of replacing it with a rollback error.
        if (rollbackFailed) {
          try { connection.destroy(); } catch {
            // Disposal must not replace the original safe failure. Never try
            // releasing this connection, including when destruction fails.
          }
        } else connection?.release();
      }
    },
  };
}
