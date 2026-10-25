import { HttpError } from '../../utils/httpError.js';

function requirePool(databasePool) {
  if (!databasePool) throw new HttpError(503, 'DATABASE_NOT_CONFIGURED', 'Database is not configured.');
  return databasePool;
}

function safeInsertId(value) {
  if (typeof value === 'string' && /^\d+$/u.test(value)) return value;
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return String(value);
  throw new HttpError(503, 'DATABASE_UNAVAILABLE', 'Database could not complete the request safely.');
}

export function createAuthRepository(databasePool) {
  return {
    async findAccountByEmail(email) {
      const database = requirePool(databasePool);
      const [rows] = await database.execute(
        `SELECT CAST(account_id AS CHAR) AS account_id, password_hash, role, account_status
         FROM Account WHERE email = ? LIMIT 1`,
        [email],
      );
      if (!rows[0]) return null;
      return {
        accountId: String(rows[0].account_id), passwordHash: rows[0].password_hash,
        role: rows[0].role, accountStatus: rows[0].account_status,
      };
    },

    async findAccountById(accountId) {
      const database = requirePool(databasePool);
      const [rows] = await database.execute(
        `SELECT CAST(account_id AS CHAR) AS account_id, role, account_status
         FROM Account WHERE account_id = ? LIMIT 1`,
        [String(accountId)],
      );
      if (!rows[0]) return null;
      return { accountId: String(rows[0].account_id), role: rows[0].role, accountStatus: rows[0].account_status };
    },

    async createDonorAccountProfile(donor) {
      const database = requirePool(databasePool);
      let connection;
      let transactionStarted = false;
      let committed = false;
      try {
        connection = await database.getConnection();
        await connection.beginTransaction();
        transactionStarted = true;
        if (donor.reportedBloodGroupId) {
          const [groups] = await connection.execute(
            'SELECT blood_group_id FROM BloodGroup WHERE blood_group_id = ? LIMIT 1',
            [donor.reportedBloodGroupId],
          );
          if (!groups[0]) throw new HttpError(422, 'INVALID_BLOOD_GROUP', 'Choose an available blood group or leave it blank.');
        }
        const [accountResult] = await connection.execute(
          `INSERT INTO Account (email, password_hash, role, account_status)
           VALUES (?, ?, 'DONOR', 'PENDING')`,
          [donor.email, donor.passwordHash],
        );
        const accountId = safeInsertId(accountResult.insertId);
        await connection.execute(
          `INSERT INTO Donor
             (account_id, full_name, date_of_birth, phone, address, area, reported_blood_group_id, confirmed_blood_group_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, NULL)`,
          [accountId, donor.fullName, donor.dateOfBirth, donor.phone, donor.address, donor.area, donor.reportedBloodGroupId],
        );
        await connection.commit();
        committed = true;
        return { accountId, donorId: accountId, accountStatus: 'PENDING' };
      } finally {
        if (connection) {
          let rollbackFailed = false;
          if (transactionStarted && !committed) {
            try { await connection.rollback(); } catch { rollbackFailed = true; }
          }
          connection.release();
          if (rollbackFailed) throw new HttpError(503, 'DATABASE_UNAVAILABLE', 'Database could not complete the request safely.');
        }
      }
    },

    async findDonorProfile(accountId) {
      const database = requirePool(databasePool);
      const [rows] = await database.execute(
        `SELECT CAST(a.account_id AS CHAR) AS account_id, a.email, a.account_status,
                d.full_name, DATE_FORMAT(d.date_of_birth, '%Y-%m-%d') AS date_of_birth,
                d.phone, d.address, d.area,
                CAST(d.reported_blood_group_id AS CHAR) AS reported_blood_group_id,
                reported.code AS reported_blood_group_code,
                reported.display_name AS reported_blood_group_name,
                CAST(d.confirmed_blood_group_id AS CHAR) AS confirmed_blood_group_id,
                confirmed.code AS confirmed_blood_group_code,
                confirmed.display_name AS confirmed_blood_group_name
         FROM Donor AS d
         JOIN Account AS a ON a.account_id = d.account_id
         LEFT JOIN BloodGroup AS reported ON reported.blood_group_id = d.reported_blood_group_id
         LEFT JOIN BloodGroup AS confirmed ON confirmed.blood_group_id = d.confirmed_blood_group_id
         WHERE d.account_id = ? LIMIT 1`,
        [String(accountId)],
      );
      const row = rows[0];
      if (!row) return null;
      return {
        accountId: String(row.account_id), email: row.email, accountStatus: row.account_status,
        fullName: row.full_name, dateOfBirth: row.date_of_birth, phone: row.phone,
        address: row.address, area: row.area,
        reportedBloodGroup: row.reported_blood_group_id ? {
          id: String(row.reported_blood_group_id), code: row.reported_blood_group_code,
          displayName: row.reported_blood_group_name,
        } : null,
        confirmedBloodGroup: row.confirmed_blood_group_id ? {
          id: String(row.confirmed_blood_group_id), code: row.confirmed_blood_group_code,
          displayName: row.confirmed_blood_group_name,
        } : null,
      };
    },
  };
}
