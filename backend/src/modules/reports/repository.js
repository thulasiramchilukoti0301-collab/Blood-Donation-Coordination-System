import { HttpError } from '../../utils/httpError.js';
const unavailable = () => new HttpError(503, 'REPORTS_UNAVAILABLE', 'Report data is temporarily unavailable.');

export function createReportsRepository(database) {
  if (!database || typeof database.execute !== 'function') throw new TypeError('A mysql2 database dependency is required.');
  async function rows(sql, values = []) { try { const [result] = await database.execute(sql, values); return result; } catch { throw unavailable(); } }
  return {
    async adminDashboard() {
      const [counts, donations, inventory, requests, trend] = await Promise.all([
        rows(`SELECT (SELECT COUNT(*) FROM Donor) AS donors, (SELECT COUNT(*) FROM Hospital) AS hospitals,
          (SELECT COUNT(*) FROM Account WHERE account_status = 'PENDING') AS pendingAccounts,
          (SELECT COUNT(*) FROM Account WHERE role = 'HOSPITAL' AND account_status = 'PENDING') AS pendingHospitals`),
        rows(`SELECT outcome, COUNT(*) AS total FROM Donation GROUP BY outcome`),
        rows(`SELECT bg.code AS bloodGroup, bu.unit_status AS status, COUNT(*) AS total
          FROM BloodUnit bu JOIN BloodGroup bg ON bg.blood_group_id = bu.blood_group_id GROUP BY bg.code, bu.unit_status ORDER BY bg.code, bu.unit_status`),
        rows(`SELECT request_status AS status, COUNT(*) AS total, COALESCE(SUM(quantity_requested), 0) AS quantity
          FROM HospitalRequest GROUP BY request_status ORDER BY request_status`),
        rows(`SELECT DATE_FORMAT(collected_at, '%Y-%m') AS period, COUNT(*) AS total FROM Donation
          WHERE outcome = 'COLLECTED' AND collected_at >= DATE_SUB(CURRENT_DATE, INTERVAL 11 MONTH)
          GROUP BY DATE_FORMAT(collected_at, '%Y-%m') ORDER BY period`),
      ]);
      return { counts: counts[0] ?? {}, donations, inventory, requests, donationTrend: trend };
    },
    async hospitalDashboard(accountId) {
      const [profiles, requests, recent] = await Promise.all([
        rows(`SELECT h.organization_name AS organizationName, h.contact_name AS contactName, a.account_status AS accountStatus
          FROM Hospital h JOIN Account a ON a.account_id = h.account_id WHERE h.account_id = ?`, [accountId]),
        rows(`SELECT request_status AS status, COUNT(*) AS total, COALESCE(SUM(quantity_requested), 0) AS quantity
          FROM HospitalRequest WHERE hospital_account_id = ? GROUP BY request_status ORDER BY request_status`, [accountId]),
        rows(`SELECT CAST(r.request_id AS CHAR) AS requestId, bg.code AS bloodGroup, r.quantity_requested AS quantity,
          r.priority, r.request_status AS status, DATE_FORMAT(r.created_at, '%Y-%m-%d %H:%i:%s') AS createdAt
          FROM HospitalRequest r JOIN BloodGroup bg ON bg.blood_group_id = r.recipient_group_id
          WHERE r.hospital_account_id = ? ORDER BY r.created_at DESC, r.request_id DESC LIMIT 8`, [accountId]),
      ]);
      return { profile: profiles[0] ?? null, requests, recent };
    },
    async inventoryReport() { return rows(`SELECT bg.code AS bloodGroup, bu.unit_status AS status, COUNT(*) AS total
      FROM BloodUnit bu JOIN BloodGroup bg ON bg.blood_group_id = bu.blood_group_id
      GROUP BY bg.code, bu.unit_status ORDER BY bg.code, bu.unit_status`); },
    async donationReport(filters) {
      const period = filters.interval === 'WEEK' ? "DATE_FORMAT(collected_at, '%x-W%v')" : filters.interval === 'MONTH' ? "DATE_FORMAT(collected_at, '%Y-%m')" : "DATE_FORMAT(collected_at, '%Y-%m-%d')";
      const conditions = ['collected_at IS NOT NULL']; const values = [];
      if (filters.from) { conditions.push('collected_at >= ?'); values.push(`${filters.from} 00:00:00`); }
      if (filters.to) { conditions.push('collected_at < DATE_ADD(?, INTERVAL 1 DAY)'); values.push(`${filters.to} 00:00:00`); }
      return rows(`SELECT ${period} AS period, outcome, COUNT(*) AS total FROM Donation WHERE ${conditions.join(' AND ')} GROUP BY period, outcome ORDER BY period, outcome`, values);
    },
    async requestReport(filters) {
      const conditions = ['1 = 1']; const values = [];
      if (filters.from) { conditions.push('created_at >= ?'); values.push(`${filters.from} 00:00:00`); }
      if (filters.to) { conditions.push('created_at < DATE_ADD(?, INTERVAL 1 DAY)'); values.push(`${filters.to} 00:00:00`); }
      const [statuses, trend, hospitals] = await Promise.all([
        rows(`SELECT request_status AS status, COUNT(*) AS total, COALESCE(SUM(quantity_requested), 0) AS quantity FROM HospitalRequest WHERE ${conditions.join(' AND ')} GROUP BY request_status ORDER BY request_status`, values),
        rows(`SELECT DATE_FORMAT(created_at, '%Y-%m-%d') AS period, COUNT(*) AS total FROM HospitalRequest WHERE ${conditions.join(' AND ')} GROUP BY DATE_FORMAT(created_at, '%Y-%m-%d') ORDER BY period`, values),
        rows(`SELECT CAST(r.hospital_account_id AS CHAR) AS hospitalAccountId, h.organization_name AS hospital, r.request_status AS status, COUNT(*) AS total, COALESCE(SUM(r.quantity_requested), 0) AS quantity
          FROM HospitalRequest r JOIN Hospital h ON h.account_id = r.hospital_account_id WHERE ${conditions.join(' AND ')}
          GROUP BY r.hospital_account_id, h.organization_name, r.request_status ORDER BY h.organization_name, r.hospital_account_id, r.request_status` , values),
      ]);
      return { statuses, trend, hospitals };
    },
  };
}

export { unavailable as reportsUnavailable };
