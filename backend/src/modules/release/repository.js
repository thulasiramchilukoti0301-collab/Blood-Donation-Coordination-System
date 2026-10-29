import { withAccountLocks } from '../accounts/transaction.js';

const id = value => {
  const text = String(value);
  if (!/^[1-9][0-9]{0,19}$/u.test(text) || BigInt(text) > 18446744073709551615n) throw new Error('Invalid identifier');
  return text;
};
const time = value => value === null || value === undefined ? null : `${String(value).replace(' ', 'T')}+05:30`;
const size = 20;

export function createReleaseRepository(database) {
  return {
    transaction(actorId, donorId, work) { return withAccountLocks(database, [actorId, donorId], work); },
    async hint(donationId) {
      const [rows] = await database.execute(`SELECT CAST(b.donor_account_id AS CHAR) AS donorAccountId,
        CAST(b.slot_id AS CHAR) AS slotId, CAST(b.booking_id AS CHAR) AS bookingId
        FROM Donation d JOIN Booking b ON b.booking_id = d.booking_id WHERE d.donation_id = ?`, [donationId]);
      return rows[0] ?? null;
    },
    async donor(connection, donorId) {
      const [rows] = await connection.execute(`SELECT CAST(account_id AS CHAR) AS accountId,
        CAST(confirmed_blood_group_id AS CHAR) AS confirmedBloodGroupId
        FROM Donor WHERE account_id = ? FOR UPDATE`, [donorId]);
      return rows[0] ?? null;
    },
    async slot(connection, slotId) {
      const [rows] = await connection.execute('SELECT CAST(slot_id AS CHAR) AS slotId FROM DonationSlot WHERE slot_id = ? FOR UPDATE', [slotId]);
      return rows[0] ?? null;
    },
    async booking(connection, bookingId) {
      const [rows] = await connection.execute(`SELECT CAST(booking_id AS CHAR) AS bookingId,
        CAST(donor_account_id AS CHAR) AS donorAccountId, CAST(slot_id AS CHAR) AS slotId,
        booking_status AS bookingStatus FROM Booking WHERE booking_id = ? FOR UPDATE`, [bookingId]);
      return rows[0] ?? null;
    },
    async donation(connection, donationId) {
      const [rows] = await connection.execute(`SELECT CAST(donation_id AS CHAR) AS donationId,
        CAST(booking_id AS CHAR) AS bookingId, outcome, release_status AS releaseStatus,
        CAST(release_decided_by_account_id AS CHAR) AS releaseDecidedByAccountId,
        release_reason_code AS releaseReasonCode,
        DATE_FORMAT(release_decided_at, '%Y-%m-%d %H:%i:%s') AS releaseDecidedAt,
        DATE_FORMAT(collected_at, '%Y-%m-%d %H:%i:%s') AS collectedAt
        FROM Donation WHERE donation_id = ? FOR UPDATE`, [donationId]);
      return rows[0] ?? null;
    },
    async group(connection, groupId) {
      const [rows] = await connection.execute(`SELECT CAST(blood_group_id AS CHAR) AS bloodGroupId,
        code, is_active AS isActive FROM BloodGroup WHERE blood_group_id = ? FOR UPDATE`, [groupId]);
      return rows[0] ?? null;
    },
    async unit(connection, donationId) {
      const [rows] = await connection.execute(`SELECT CAST(blood_unit_id AS CHAR) AS bloodUnitId,
        CAST(donation_id AS CHAR) AS donationId, CAST(blood_group_id AS CHAR) AS bloodGroupId,
        DATE_FORMAT(expiry_date, '%Y-%m-%d') AS expiryDate, unit_status AS unitStatus
        FROM BloodUnit WHERE donation_id = ? FOR UPDATE`, [donationId]);
      return rows[0] ?? null;
    },
    async decide(connection, donationId, actorId, input, now) {
      const [result] = await connection.execute(`UPDATE Donation SET release_status = ?,
        release_decided_by_account_id = ?, release_decided_at = ?, release_reason_code = ?
        WHERE donation_id = ? AND outcome = 'COLLECTED' AND release_status = 'PENDING'`,
      [input.decision, actorId, now, input.reasonCode, donationId]);
      return result.affectedRows;
    },
    async insertUnit(connection, donationId, groupId, expiryDate, status, now) {
      const [result] = await connection.execute(`INSERT INTO BloodUnit
        (donation_id, blood_group_id, expiry_date, unit_status, expired_at)
        VALUES (?, ?, ?, ?, ?)`, [donationId, groupId, expiryDate, status, status === 'EXPIRED' ? now : null]);
      if (result.affectedRows !== 1) throw new Error('Unit insert count');
      return id(result.insertId);
    },
    async list(query, today) {
      const where = [], args = [];
      const add = (clause, value) => { if (value !== undefined) { where.push(clause); args.push(value); } };
      add('u.blood_group_id = ?', query.bloodGroupId);
      add('u.unit_status = ?', query.unitStatus);
      if (query.availableOnly) { where.push("u.unit_status = 'AVAILABLE' AND u.expiry_date > ? AND d.release_status = 'APPROVED'"); args.push(today); }
      add('DATE(d.collected_at) >= ?', query.collectedFrom);
      add('DATE(d.collected_at) <= ?', query.collectedTo);
      add('u.expiry_date >= ?', query.expiresFrom);
      add('u.expiry_date <= ?', query.expiresTo);
      const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
      const source = 'FROM BloodUnit u JOIN Donation d ON d.donation_id = u.donation_id JOIN BloodGroup g ON g.blood_group_id = u.blood_group_id';
      const [counts] = await database.execute(`SELECT COUNT(*) AS total ${source} ${clause}`, args);
      const total = Number(counts[0]?.total);
      if (!Number.isSafeInteger(total)) throw new Error('Invalid unit count');
      const [rows] = await database.execute(`SELECT CAST(u.blood_unit_id AS CHAR) AS bloodUnitId,
        CAST(u.donation_id AS CHAR) AS donationId, CAST(u.blood_group_id AS CHAR) AS bloodGroupId,
        g.code AS bloodGroupCode, u.unit_status AS unitStatus,
        DATE_FORMAT(u.expiry_date, '%Y-%m-%d') AS expiryDate,
        DATE_FORMAT(d.collected_at, '%Y-%m-%d %H:%i:%s') AS collectedAt,
        d.release_status AS releaseStatus ${source} ${clause}
        ORDER BY u.expiry_date ASC, u.blood_unit_id ASC LIMIT ? OFFSET ?`,
      [...args, size, (query.page - 1) * size]);
      return { units: rows.map(row => ({ ...row, bloodUnitId: id(row.bloodUnitId), donationId: id(row.donationId),
        bloodGroupId: id(row.bloodGroupId), collectedAt: time(row.collectedAt),
        effectiveAvailability: row.unitStatus === 'AVAILABLE' && row.releaseStatus === 'APPROVED' && row.expiryDate > today,
        expiryDue: row.unitStatus === 'AVAILABLE' && row.expiryDate <= today })),
      pagination: { page: query.page, pageSize: size, total } };
    },
    async detail(bloodUnitId) {
      const [rows] = await database.execute(`SELECT CAST(u.blood_unit_id AS CHAR) AS bloodUnitId,
        CAST(u.donation_id AS CHAR) AS donationId, CAST(u.blood_group_id AS CHAR) AS bloodGroupId,
        g.code AS bloodGroupCode, u.unit_status AS unitStatus,
        DATE_FORMAT(u.expiry_date, '%Y-%m-%d') AS expiryDate,
        DATE_FORMAT(u.expired_at, '%Y-%m-%d %H:%i:%s') AS expiredAt,
        DATE_FORMAT(u.discarded_at, '%Y-%m-%d %H:%i:%s') AS discardedAt,
        u.discard_reason_code AS discardReasonCode,
        DATE_FORMAT(u.created_at, '%Y-%m-%d %H:%i:%s') AS createdAt,
        DATE_FORMAT(d.collected_at, '%Y-%m-%d %H:%i:%s') AS collectedAt,
        d.outcome, d.release_status AS releaseStatus,
        DATE_FORMAT(d.release_decided_at, '%Y-%m-%d %H:%i:%s') AS releaseDecidedAt
        FROM BloodUnit u JOIN Donation d ON d.donation_id = u.donation_id
        JOIN BloodGroup g ON g.blood_group_id = u.blood_group_id WHERE u.blood_unit_id = ?`, [bloodUnitId]);
      const row = rows[0];
      return row ? { ...row, bloodUnitId: id(row.bloodUnitId), donationId: id(row.donationId),
        bloodGroupId: id(row.bloodGroupId), collectedAt: time(row.collectedAt),
        releaseDecidedAt: time(row.releaseDecidedAt), createdAt: time(row.createdAt), expiredAt: time(row.expiredAt),
        discardedAt: time(row.discardedAt), allocations: null } : null;
    },
    async lifecycleTransaction(actorId, work) { return withAccountLocks(database, [actorId], work); },
    async lockDueUnits(connection) {
      const [rows] = await connection.execute(`SELECT CAST(blood_unit_id AS CHAR) AS bloodUnitId,
        unit_status AS unitStatus, DATE_FORMAT(expiry_date, '%Y-%m-%d') AS expiryDate
        FROM BloodUnit WHERE unit_status IN ('AVAILABLE', 'ALLOCATED')
        ORDER BY expiry_date ASC, blood_unit_id ASC FOR UPDATE`);
      return rows.map(row => ({ ...row, bloodUnitId: id(row.bloodUnitId) }));
    },
    async lockLifecycleUnit(connection, bloodUnitId) {
      const [rows] = await connection.execute(`SELECT CAST(blood_unit_id AS CHAR) AS bloodUnitId,
        unit_status AS unitStatus, DATE_FORMAT(expiry_date, '%Y-%m-%d') AS expiryDate
        FROM BloodUnit WHERE blood_unit_id = ? FOR UPDATE`, [bloodUnitId]);
      return rows[0] ? { ...rows[0], bloodUnitId: id(rows[0].bloodUnitId) } : null;
    },
    async expireUnit(connection, bloodUnitId, today, expiredAt) {
      const [result] = await connection.execute(`UPDATE BloodUnit SET unit_status = 'EXPIRED', expired_at = ?
        WHERE blood_unit_id = ? AND unit_status = 'AVAILABLE' AND expiry_date <= ?`, [expiredAt, bloodUnitId, today]);
      return result.affectedRows;
    },
    async discardUnit(connection, bloodUnitId, reasonCode, discardedAt, today) {
      const [result] = await connection.execute(`UPDATE BloodUnit SET unit_status = 'DISCARDED', discarded_at = ?, discard_reason_code = ?
        WHERE blood_unit_id = ? AND unit_status = 'AVAILABLE' AND expiry_date > ?`, [discardedAt, reasonCode, bloodUnitId, today]);
      return result.affectedRows;
    },
  };
}
