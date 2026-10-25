import { withAccountLocks, safeAccountError } from './transaction.js';

const pageSize = 20;
export function createAccountAdminRepository(database) {
  return {
    transaction(ids, work) { return withAccountLocks(database, ids, work); },
    async actor(id) {
      try {
        const [rows] = await database.execute(`SELECT CAST(account_id AS CHAR) AS accountId,
          role, account_status AS accountStatus FROM Account WHERE account_id = ?`, [id]);
        return rows[0] ?? null;
      } catch (error) { throw safeAccountError(error); }
    },
    async list({ role, accountStatus, search, page }) {
      const conditions = ["role IN ('DONOR', 'HOSPITAL')", 'account_status = ?'];
      const values = [accountStatus];
      if (role) { conditions.push('role = ?'); values.push(role); }
      if (search) { conditions.push("email LIKE ? ESCAPE '!'"); values.push(`%${search.replace(/[!%_]/gu, '!$&')}%`); }
      const where = conditions.join(' AND ');
      try {
        const [totals] = await database.execute(`SELECT COUNT(*) AS total FROM Account WHERE ${where}`, values);
        const total = Number(totals[0]?.total);
        if (!Number.isSafeInteger(total) || total < 0) throw new Error();
        const [rows] = await database.execute(`SELECT CAST(account_id AS CHAR) AS accountId,
          email, role, account_status AS accountStatus,
          DATE_FORMAT(created_at, '%Y-%m-%d %H:%i:%s') AS createdAt
          FROM Account WHERE ${where} ORDER BY created_at, account_id LIMIT ? OFFSET ?`,
        [...values, pageSize, (page - 1) * pageSize]);
        // Fixed projection remains authoritative even with an injected driver.
        const accounts = rows.map((row) => ({ accountId: String(row.accountId), email: row.email,
          role: row.role, accountStatus: row.accountStatus, createdAt: row.createdAt }));
        return { accounts, pagination: { page, pageSize, total } };
      } catch (error) { throw safeAccountError(error); }
    },
    async approve(connection, id) {
      const [result] = await connection.execute(`UPDATE Account SET account_status = 'ACTIVE', updated_at = CURRENT_TIMESTAMP
        WHERE account_id = ? AND account_status = 'PENDING' AND role IN ('DONOR', 'HOSPITAL')`, [id]);
      if (result.affectedRows !== 1) throw new Error();
    },
  };
}
