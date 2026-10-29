import { withAccountLocks } from '../accounts/transaction.js';
import { createBookingRepository } from '../booking/repository.js';

const positiveId = value => {
  const id = String(value);
  if (!/^[1-9][0-9]{0,19}$/u.test(id) || BigInt(id) > 18446744073709551615n) throw new Error('Invalid database identifier');
  return id;
};
const iso = value => value ? `${String(value).replace(' ', 'T')}+05:30` : null;
const pageSize = 20;

export function createDonationRepository(database) {
  const booking = createBookingRepository(database);
  return {
    transaction(actor, donor, work) { return withAccountLocks(database, [actor, donor], work); },
    bookingHint: booking.bookingOwnerHint,
    donorExists: booking.donorExists,
    lockSlot: booking.lockSlot,
    async lockBooking(connection, bookingId) {
      const [rows] = await connection.execute(`SELECT CAST(booking_id AS CHAR) AS bookingId,
        CAST(donor_account_id AS CHAR) AS donorAccountId, CAST(slot_id AS CHAR) AS slotId,
        booking_status AS bookingStatus,
        DATE_FORMAT(status_changed_at, '%Y-%m-%d %H:%i:%s') AS statusChangedAt
        FROM Booking WHERE booking_id = ? FOR UPDATE`, [bookingId]);
      return rows[0] ?? null;
    },
    bookingHasDonation: booking.bookingHasDonation,
    async latestVisitDecision(connection, bookingId) {
      const [rows] = await connection.execute(`SELECT CAST(eligibility_decision_id AS CHAR) AS decisionId,
        CAST(donor_account_id AS CHAR) AS donorAccountId, CAST(booking_id AS CHAR) AS bookingId,
        decision, DATE_FORMAT(decided_at, '%Y-%m-%d %H:%i:%s') AS decidedAt
        FROM EligibilityDecision WHERE booking_id = ?
        ORDER BY decided_at DESC, eligibility_decision_id DESC LIMIT 1 FOR UPDATE`, [bookingId]);
      return rows[0] ?? null;
    },
    async latestDonorDecision(connection, donorId) {
      const [rows] = await connection.execute(`SELECT decision,
        DATE_FORMAT(deferred_until, '%Y-%m-%d') AS deferredUntil
        FROM EligibilityDecision WHERE donor_account_id = ?
        ORDER BY decided_at DESC, eligibility_decision_id DESC LIMIT 1 FOR UPDATE`, [donorId]);
      return rows[0] ?? null;
    },
    async latestCollected(connection, donorId) {
      const [rows] = await connection.execute(`SELECT DATE_FORMAT(d.collected_at, '%Y-%m-%d') AS lastCollectedDate
        FROM Donation d JOIN Booking b ON b.booking_id = d.booking_id
        WHERE b.donor_account_id = ? AND d.outcome = 'COLLECTED'
        ORDER BY d.collected_at DESC, d.donation_id DESC LIMIT 1 FOR UPDATE`, [donorId]);
      return rows[0]?.lastCollectedDate ?? null;
    },
    async insertDonation(connection, actor, input) {
      const [result] = await connection.execute(`INSERT INTO Donation
        (booking_id, recorded_by_account_id, outcome, collected_at, collection_reference, release_status)
        VALUES (?, ?, ?, ?, ?, ?)`, [input.bookingId, actor, input.outcome,
        input.collectedAt?.local ?? null, input.collectionReference, input.releaseStatus]);
      if (result.affectedRows !== 1) throw new Error('Donation insert count');
      return positiveId(result.insertId);
    },
    async completeBooking(connection, bookingId) {
      const [result] = await connection.execute(`UPDATE Booking SET booking_status = 'COMPLETED',
        status_changed_at = CURRENT_TIMESTAMP WHERE booking_id = ? AND booking_status = 'CHECKED_IN'`, [bookingId]);
      return result.affectedRows;
    },
    async donationSummary(connection, donationId) {
      const [rows] = await connection.execute(`SELECT CAST(d.donation_id AS CHAR) AS donationId,
        CAST(d.booking_id AS CHAR) AS bookingId, CAST(b.donor_account_id AS CHAR) AS donorAccountId,
        b.booking_status AS bookingStatus, d.outcome, d.release_status AS releaseStatus,
        DATE_FORMAT(d.collected_at, '%Y-%m-%d %H:%i:%s') AS collectedAt,
        d.collection_reference AS collectionReference,
        DATE_FORMAT(d.created_at, '%Y-%m-%d %H:%i:%s') AS createdAt
        FROM Donation d JOIN Booking b ON b.booking_id = d.booking_id WHERE d.donation_id = ?`, [donationId]);
      const row = rows[0];
      return row ? { ...row, donationId: positiveId(row.donationId), bookingId: positiveId(row.bookingId),
        donorAccountId: positiveId(row.donorAccountId), collectedAt: iso(row.collectedAt), createdAt: iso(row.createdAt) } : null;
    },
    async list(query, donorId = null) {
      const admin = donorId === null;
      const where = []; const values = [];
      const owner = donorId ?? query.donorAccountId;
      if (owner) { where.push('b.donor_account_id = ?'); values.push(owner); }
      if (query.outcome) { where.push('d.outcome = ?'); values.push(query.outcome); }
      if (query.releaseStatus) { where.push('d.release_status = ?'); values.push(query.releaseStatus); }
      if (query.from) { where.push('d.created_at >= ?'); values.push(`${query.from} 00:00:00`); }
      if (query.to) { where.push('d.created_at <= ?'); values.push(`${query.to} 23:59:59`); }
      const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
      const joins = `FROM Donation d JOIN Booking b ON b.booking_id = d.booking_id
        JOIN DonationSlot s ON s.slot_id = b.slot_id${admin ? ' JOIN Donor donor ON donor.account_id = b.donor_account_id' : ''}`;
      const [counts] = await database.execute(`SELECT COUNT(*) AS total ${joins} ${clause}`, values);
      const total = Number(counts[0]?.total);
      if (!Number.isSafeInteger(total)) throw new Error('Invalid donation count');
      const [rows] = await database.execute(`SELECT CAST(d.donation_id AS CHAR) AS donationId,
        CAST(d.booking_id AS CHAR) AS bookingId, CAST(b.donor_account_id AS CHAR) AS donorAccountId,
        CAST(b.slot_id AS CHAR) AS slotId, b.booking_status AS bookingStatus,
        d.outcome, d.release_status AS releaseStatus,
        DATE_FORMAT(d.collected_at, '%Y-%m-%d %H:%i:%s') AS collectedAt,
        DATE_FORMAT(d.created_at, '%Y-%m-%d %H:%i:%s') AS createdAt,
        DATE_FORMAT(s.starts_at, '%Y-%m-%d %H:%i:%s') AS startsAt
        ${admin ? ', donor.full_name AS donorName' : ''}
        ${joins} ${clause} ORDER BY d.created_at DESC, d.donation_id DESC LIMIT ? OFFSET ?`,
      [...values, pageSize, (query.page - 1) * pageSize]);
      return { donations: rows.map(row => ({ donationId: positiveId(row.donationId), bookingId: positiveId(row.bookingId),
        ...(admin ? { donorAccountId: positiveId(row.donorAccountId), donorName: row.donorName } : {}),
        slotId: positiveId(row.slotId), bookingStatus: row.bookingStatus, outcome: row.outcome,
        releaseStatus: row.releaseStatus, collectedAt: iso(row.collectedAt), createdAt: iso(row.createdAt),
        startsAt: iso(row.startsAt) })), pagination: { page: query.page, pageSize, total } };
    },
    async donorLastCollected(donorId) {
      const [rows] = await database.execute(`SELECT DATE_FORMAT(d.collected_at, '%Y-%m-%d') AS lastCollectedDate
        FROM Donation d JOIN Booking b ON b.booking_id = d.booking_id
        WHERE b.donor_account_id = ? AND d.outcome = 'COLLECTED'
        ORDER BY d.collected_at DESC, d.donation_id DESC LIMIT 1`, [donorId]);
      return rows[0]?.lastCollectedDate ?? null;
    },
  };
}
