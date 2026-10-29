import { withAccountLocks } from '../accounts/transaction.js';

const pageSize = 20;
const profileSelect = `SELECT CAST(d.account_id AS CHAR) AS donorId, a.email, a.account_status AS accountStatus,
  d.full_name AS fullName, DATE_FORMAT(d.date_of_birth, '%Y-%m-%d') AS dateOfBirth,
  d.phone, d.address, d.area,
  CAST(d.reported_blood_group_id AS CHAR) AS reportedBloodGroupId, rg.code AS reportedBloodGroupCode,
  rg.display_name AS reportedBloodGroupName,
  CAST(d.confirmed_blood_group_id AS CHAR) AS confirmedBloodGroupId, cg.code AS confirmedBloodGroupCode,
  cg.display_name AS confirmedBloodGroupName,
  DATE_FORMAT(d.created_at, '%Y-%m-%d %H:%i:%s') AS createdAt,
  DATE_FORMAT(d.updated_at, '%Y-%m-%d %H:%i:%s') AS updatedAt
  FROM Donor d JOIN Account a ON a.account_id = d.account_id AND a.role = 'DONOR'
  LEFT JOIN BloodGroup rg ON rg.blood_group_id = d.reported_blood_group_id
  LEFT JOIN BloodGroup cg ON cg.blood_group_id = d.confirmed_blood_group_id`;

function profile(row) {
  if (!row) return null;
  const group = (id, code, displayName) => id === null ? null : { bloodGroupId: String(id), code, displayName };
  return { donorId: String(row.donorId), email: row.email, accountStatus: row.accountStatus,
    fullName: row.fullName, dateOfBirth: row.dateOfBirth, phone: row.phone, address: row.address, area: row.area,
    reportedBloodGroup: group(row.reportedBloodGroupId, row.reportedBloodGroupCode, row.reportedBloodGroupName),
    confirmedBloodGroup: group(row.confirmedBloodGroupId, row.confirmedBloodGroupCode, row.confirmedBloodGroupName),
    createdAt: row.createdAt, updatedAt: row.updatedAt };
}

export function createAdminDonorRepository(database) {
  return {
    transaction(ids, work) { return withAccountLocks(database, ids, work); },
    async actor(id) {
      const [rows] = await database.execute(`SELECT CAST(account_id AS CHAR) AS accountId,
        role, account_status AS accountStatus FROM Account WHERE account_id = ?`, [id]);
      return rows[0] ?? null;
    },
    async list(query) {
      const where = ["a.role = 'DONOR'"];
      const args = [];
      if (query.accountStatus !== 'ANY') { where.push('a.account_status = ?'); args.push(query.accountStatus); }
      if (query.search) {
        const escaped = `%${query.search.replace(/[!%_]/gu, '!$&')}%`;
        where.push("(d.full_name LIKE ? ESCAPE '!' OR d.phone LIKE ? ESCAPE '!' OR COALESCE(d.area, '') LIKE ? ESCAPE '!' OR CAST(d.account_id AS CHAR) LIKE ? ESCAPE '!')");
        args.push(escaped, escaped, escaped, escaped);
      }
      if (query.bloodGroupId) {
        const groupColumn = query.groupMatch === 'REPORTED' ? 'd.reported_blood_group_id'
          : query.groupMatch === 'CONFIRMED' ? 'd.confirmed_blood_group_id'
            : '(d.reported_blood_group_id = ? OR d.confirmed_blood_group_id = ?)';
        if (query.groupMatch === 'EITHER') { where.push(groupColumn); args.push(query.bloodGroupId, query.bloodGroupId); }
        else { where.push(`${groupColumn} = ?`); args.push(query.bloodGroupId); }
      }
      const clause = `WHERE ${where.join(' AND ')}`;
      const [countRows] = await database.execute(`SELECT COUNT(*) AS total FROM Donor d JOIN Account a ON a.account_id = d.account_id ${clause}`, args);
      const total = Number(countRows[0]?.total);
      if (!Number.isSafeInteger(total) || total < 0) throw new Error('Count unavailable');
      const [rows] = await database.execute(`SELECT CAST(d.account_id AS CHAR) AS donorId,
        d.full_name AS fullName, d.phone, d.area, a.account_status AS accountStatus,
        CAST(d.reported_blood_group_id AS CHAR) AS reportedBloodGroupId, rg.code AS reportedBloodGroupCode,
        CAST(d.confirmed_blood_group_id AS CHAR) AS confirmedBloodGroupId, cg.code AS confirmedBloodGroupCode
        FROM Donor d JOIN Account a ON a.account_id = d.account_id
        LEFT JOIN BloodGroup rg ON rg.blood_group_id = d.reported_blood_group_id
        LEFT JOIN BloodGroup cg ON cg.blood_group_id = d.confirmed_blood_group_id
        ${clause} ORDER BY d.full_name ASC, d.account_id ASC LIMIT ? OFFSET ?`,
      [...args, pageSize, (query.page - 1) * pageSize]);
      return { donors: rows.map(row => ({ donorId: String(row.donorId), fullName: row.fullName,
        phone: row.phone, area: row.area, accountStatus: row.accountStatus,
        reportedBloodGroup: row.reportedBloodGroupId === null ? null : { bloodGroupId: String(row.reportedBloodGroupId), code: row.reportedBloodGroupCode },
        confirmedBloodGroup: row.confirmedBloodGroupId === null ? null : { bloodGroupId: String(row.confirmedBloodGroupId), code: row.confirmedBloodGroupCode } })),
      pagination: { page: query.page, pageSize, total } };
    },
    async detail(connection, donorId) {
      const executor = connection ?? database;
      const [rows] = await executor.execute(`${profileSelect} WHERE d.account_id = ?`, [donorId]);
      if (!rows[0]) return null;
      const [contextRows] = await executor.execute(`SELECT
        (SELECT COUNT(*) FROM Booking b WHERE b.donor_account_id = d.account_id) AS bookingCount,
        (SELECT COUNT(*) FROM Donation dn JOIN Booking b2 ON b2.booking_id = dn.booking_id WHERE b2.donor_account_id = d.account_id) AS donationCount,
        (SELECT b.booking_status FROM Booking b WHERE b.donor_account_id = d.account_id ORDER BY b.status_changed_at DESC, b.booking_id DESC LIMIT 1) AS latestBookingStatus,
        (SELECT DATE_FORMAT(s.starts_at, '%Y-%m-%d %H:%i:%s') FROM Booking b JOIN DonationSlot s ON s.slot_id = b.slot_id WHERE b.donor_account_id = d.account_id ORDER BY b.status_changed_at DESC, b.booking_id DESC LIMIT 1) AS latestAppointmentAt,
        (SELECT dn.outcome FROM Donation dn JOIN Booking b2 ON b2.booking_id = dn.booking_id WHERE b2.donor_account_id = d.account_id ORDER BY dn.created_at DESC, dn.donation_id DESC LIMIT 1) AS latestDonationOutcome,
        (SELECT dn.release_status FROM Donation dn JOIN Booking b2 ON b2.booking_id = dn.booking_id WHERE b2.donor_account_id = d.account_id ORDER BY dn.created_at DESC, dn.donation_id DESC LIMIT 1) AS latestReleaseStatus,
        (SELECT DATE_FORMAT(dn.collected_at, '%Y-%m-%d %H:%i:%s') FROM Donation dn JOIN Booking b2 ON b2.booking_id = dn.booking_id WHERE b2.donor_account_id = d.account_id ORDER BY dn.created_at DESC, dn.donation_id DESC LIMIT 1) AS latestCollectedAt
        FROM Donor d WHERE d.account_id = ?`, [donorId]);
      const row = contextRows[0] ?? {};
      const count = value => { const parsed = Number(value); if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error('Invalid Donor context count'); return parsed; };
      return { ...profile(rows[0]), context: { bookingCount: count(row.bookingCount), donationCount: count(row.donationCount),
        latestBooking: row.latestBookingStatus ? { bookingStatus: row.latestBookingStatus, appointmentAt: row.latestAppointmentAt } : null,
        latestDonation: row.latestDonationOutcome ? { outcome: row.latestDonationOutcome, releaseStatus: row.latestReleaseStatus,
          collectedAt: row.latestCollectedAt ? `${row.latestCollectedAt.replace(' ', 'T')}+05:30` : null } : null } };
    },
    async lockDonor(connection, id) {
      const [rows] = await connection.execute(`SELECT account_id AS accountId, full_name AS fullName,
        DATE_FORMAT(date_of_birth, '%Y-%m-%d') AS dateOfBirth, phone, address, area,
        CAST(confirmed_blood_group_id AS CHAR) AS confirmedBloodGroupId
        FROM Donor WHERE account_id = ? FOR UPDATE`, [id]);
      return rows[0] ?? null;
    },
    async lockGroup(connection, id) {
      const [rows] = await connection.execute('SELECT blood_group_id AS bloodGroupId FROM BloodGroup WHERE blood_group_id = ? FOR UPDATE', [id]);
      return rows[0] ?? null;
    },
    async unitGroupHistory(connection, donorId) {
      const [rows] = await connection.execute(`SELECT CAST(u.blood_group_id AS CHAR) AS bloodGroupId
        FROM BloodUnit u JOIN Donation d ON d.donation_id = u.donation_id
        JOIN Booking b ON b.booking_id = d.booking_id
        WHERE b.donor_account_id = ? ORDER BY u.blood_group_id, u.blood_unit_id FOR UPDATE`, [donorId]);
      return rows.map(row => String(row.bloodGroupId));
    },
    async update(connection, donorId, patch) {
      const columns = { fullName: 'full_name', dateOfBirth: 'date_of_birth', phone: 'phone', address: 'address', area: 'area', confirmedBloodGroupId: 'confirmed_blood_group_id' };
      const entries = Object.entries(patch);
      if (!entries.length || entries.some(([key]) => !Object.hasOwn(columns, key))) throw new TypeError('Invalid Donor update.');
      const [result] = await connection.execute(`UPDATE Donor SET ${entries.map(([key]) => `${columns[key]} = ?`).join(', ')},
        updated_at = CURRENT_TIMESTAMP WHERE account_id = ?`, [...entries.map(([, value]) => value), donorId]);
      return result.affectedRows;
    },
  };
}
