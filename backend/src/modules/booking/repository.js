import { withAccountLocks } from '../accounts/transaction.js';

const slotProjection = `CAST(s.slot_id AS CHAR) AS slotId,
  DATE_FORMAT(s.starts_at, '%Y-%m-%d %H:%i:%s') AS startsAt,
  DATE_FORMAT(s.ends_at, '%Y-%m-%d %H:%i:%s') AS endsAt,
  s.capacity, s.slot_status AS slotStatus,
  (SELECT COUNT(*) FROM Booking b WHERE b.slot_id = s.slot_id
    AND b.booking_status IN ('BOOKED','CHECKED_IN')) AS occupied`;
const bookingProjection = `CAST(b.booking_id AS CHAR) AS bookingId,
  CAST(b.donor_account_id AS CHAR) AS donorAccountId,
  CAST(b.slot_id AS CHAR) AS slotId, b.booking_status AS bookingStatus,
  DATE_FORMAT(b.booked_at, '%Y-%m-%d %H:%i:%s') AS bookedAt,
  DATE_FORMAT(b.status_changed_at, '%Y-%m-%d %H:%i:%s') AS statusChangedAt,
  b.cancellation_reason AS cancellationReason,
  DATE_FORMAT(s.starts_at, '%Y-%m-%d %H:%i:%s') AS startsAt,
  DATE_FORMAT(s.ends_at, '%Y-%m-%d %H:%i:%s') AS endsAt,
  s.slot_status AS slotStatus,
  a.account_status AS donorAccountStatus,
  EXISTS (SELECT 1 FROM Donation dx WHERE dx.booking_id = b.booking_id) AS hasDonation,
  (SELECT ed.decision FROM EligibilityDecision ed WHERE ed.booking_id = b.booking_id
    ORDER BY ed.decided_at DESC, ed.eligibility_decision_id DESC LIMIT 1) AS latestDecision,
  (SELECT DATE_FORMAT(ed.deferred_until, '%Y-%m-%d') FROM EligibilityDecision ed WHERE ed.booking_id = b.booking_id
    ORDER BY ed.decided_at DESC, ed.eligibility_decision_id DESC LIMIT 1) AS latestDeferredUntil,
  (SELECT DATE_FORMAT(ed.decided_at, '%Y-%m-%d %H:%i:%s') FROM EligibilityDecision ed WHERE ed.booking_id = b.booking_id
    ORDER BY ed.decided_at DESC, ed.eligibility_decision_id DESC LIMIT 1) AS latestDecisionAt`;
const pageSize = 20;
const maximumId = 18446744073709551615n;
function persistedId(value) {
  const text = typeof value === 'number' && Number.isSafeInteger(value) ? String(value) : value;
  if (typeof text !== 'string' || !/^[1-9][0-9]{0,19}$/u.test(text) || BigInt(text) > maximumId) {
    throw new Error('Invalid inserted identifier');
  }
  return text;
}
const timestamp = value => `${value.replace(' ', 'T')}+05:30`;
const slot = row => ({ slotId: String(row.slotId), startsAt: timestamp(row.startsAt), endsAt: timestamp(row.endsAt),
  capacity: Number(row.capacity), occupied: Number(row.occupied), remaining: Number(row.capacity) - Number(row.occupied),
  slotStatus: row.slotStatus });
const booking = (row, admin) => ({ bookingId: String(row.bookingId), ...(admin ? { donorAccountId: String(row.donorAccountId),
  donorName: row.donorName, donorAccountStatus: row.donorAccountStatus } : {}), slotId: String(row.slotId), bookingStatus: row.bookingStatus,
  bookedAt: timestamp(row.bookedAt), statusChangedAt: timestamp(row.statusChangedAt),
  cancellationReason: row.cancellationReason, startsAt: timestamp(row.startsAt), endsAt: timestamp(row.endsAt),
  slotStatus: row.slotStatus, hasDonation: row.hasDonation === true || row.hasDonation === 1 || row.hasDonation === '1', latestDecision: row.latestDecision ?? null,
  latestDeferredUntil: row.latestDeferredUntil ?? null, latestDecisionAt: row.latestDecisionAt ? timestamp(row.latestDecisionAt) : null });

export function createBookingRepository(database) {
  if (!database) throw new TypeError('A database pool is required.');
  return {
    transaction(actorId, work, targetAccountIds = []) { return withAccountLocks(database, [actorId, ...targetAccountIds], work); },
    async bookingOwnerHint(bookingId) {
      const [rows] = await database.execute(`SELECT CAST(donor_account_id AS CHAR) AS donorAccountId,
        CAST(slot_id AS CHAR) AS slotId
        FROM Booking WHERE booking_id = ? LIMIT 1`, [bookingId]);
      return rows[0] ? { donorAccountId: rows[0].donorAccountId, slotId: rows[0].slotId } : null;
    },
    async history(donorId, connection = database) {
      const [donations] = await connection.execute(`SELECT DATE_FORMAT(d.collected_at, '%Y-%m-%d') AS lastCollectedDate
        FROM Donation d JOIN Booking b ON b.booking_id = d.booking_id
        WHERE b.donor_account_id = ? AND d.outcome = 'COLLECTED'
        ORDER BY d.collected_at DESC, d.donation_id DESC LIMIT 1`, [donorId]);
      const [decisions] = await connection.execute(`SELECT decision,
        DATE_FORMAT(deferred_until, '%Y-%m-%d') AS deferredUntil,
        DATE_FORMAT(decided_at, '%Y-%m-%d %H:%i:%s') AS decidedAt,
        CAST(eligibility_decision_id AS CHAR) AS decisionId
        FROM EligibilityDecision WHERE donor_account_id = ?
        ORDER BY decided_at DESC, eligibility_decision_id DESC LIMIT 1`, [donorId]);
      return { lastCollectedDate: donations[0]?.lastCollectedDate ?? null, decision: decisions[0] ?? null };
    },
    async donorExists(donorId, connection = database) {
      const [rows] = await connection.execute('SELECT account_id FROM Donor WHERE account_id = ? LIMIT 1 FOR UPDATE', [donorId]);
      return Boolean(rows.length);
    },
    async lockSlot(connection, slotId) {
      const [rows] = await connection.execute(`SELECT CAST(slot_id AS CHAR) AS slotId,
        DATE_FORMAT(starts_at, '%Y-%m-%d %H:%i:%s') AS startsAt,
        DATE_FORMAT(ends_at, '%Y-%m-%d %H:%i:%s') AS endsAt,
        capacity, slot_status AS slotStatus FROM DonationSlot
        WHERE slot_id = ? FOR UPDATE`, [slotId]);
      return rows[0] ? { ...slot({ ...rows[0], occupied: 0 }) } : null;
    },
    async slotBookings(connection, slotId) {
      const [rows] = await connection.execute(`SELECT CAST(booking_id AS CHAR) AS bookingId,
        CAST(donor_account_id AS CHAR) AS donorAccountId, booking_status AS bookingStatus
        FROM Booking WHERE slot_id = ? ORDER BY booking_id FOR UPDATE`, [slotId]);
      return rows;
    },
    async donorActiveBookings(connection, donorId) {
      // Account row serialization protects this donor; locking/current Booking
      // reads avoid an earlier REPEATABLE READ snapshot after a slot wait.
      const [rows] = await connection.execute(`SELECT CAST(booking_id AS CHAR) AS bookingId,
        CAST(slot_id AS CHAR) AS slotId FROM Booking
        WHERE donor_account_id = ? AND booking_status IN ('BOOKED','CHECKED_IN')
        ORDER BY booking_id FOR UPDATE`, [donorId]);
      if (!rows.length) return [];
      const [windows] = await connection.execute(`SELECT CAST(slot_id AS CHAR) AS slotId,
        DATE_FORMAT(starts_at, '%Y-%m-%d %H:%i:%s') AS startsAt,
        DATE_FORMAT(ends_at, '%Y-%m-%d %H:%i:%s') AS endsAt
        FROM DonationSlot WHERE slot_id IN (${rows.map(() => '?').join(',')})`, rows.map(row => row.slotId));
      return windows;
    },
    async bookingSlotId(connection, bookingId, donorId) {
      const [rows] = await connection.execute(`SELECT CAST(slot_id AS CHAR) AS slotId FROM Booking
        WHERE booking_id = ? AND donor_account_id = ?`, [bookingId, donorId]);
      return rows[0]?.slotId ?? null;
    },
    async lockBooking(connection, bookingId, donorId) {
      const [rows] = await connection.execute(`SELECT CAST(booking_id AS CHAR) AS bookingId,
        CAST(slot_id AS CHAR) AS slotId, booking_status AS bookingStatus
        FROM Booking WHERE booking_id = ? AND donor_account_id = ? FOR UPDATE`, [bookingId, donorId]);
      return rows[0] ?? null;
    },
    async lockAdminBooking(connection, bookingId) {
      const [rows] = await connection.execute(`SELECT CAST(booking_id AS CHAR) AS bookingId,
        CAST(donor_account_id AS CHAR) AS donorAccountId, CAST(slot_id AS CHAR) AS slotId,
        booking_status AS bookingStatus FROM Booking WHERE booking_id = ? FOR UPDATE`, [bookingId]);
      return rows[0] ?? null;
    },
    async bookingHasDonation(connection, bookingId) {
      const [rows] = await connection.execute('SELECT donation_id FROM Donation WHERE booking_id = ? FOR UPDATE', [bookingId]);
      return rows.length > 0;
    },
    async latestBookingDecision(connection, bookingId) {
      const [rows] = await connection.execute(`SELECT decision,
        DATE_FORMAT(deferred_until, '%Y-%m-%d') AS deferredUntil
        FROM EligibilityDecision WHERE booking_id = ?
        ORDER BY decided_at DESC, eligibility_decision_id DESC LIMIT 1 FOR UPDATE`, [bookingId]);
      return rows[0] ?? null;
    },
    async insertSlot(connection, actorId, input) {
      const [result] = await connection.execute(`INSERT INTO DonationSlot
        (starts_at, ends_at, capacity, created_by_account_id) VALUES (?, ?, ?, ?)`, [input.start.local, input.end.local, input.capacity, actorId]);
      return persistedId(result.insertId);
    },
    async updateSlot(connection, slotId, changes) {
      const columns = [];
      const values = [];
      for (const [key, column] of [['start', 'starts_at'], ['end', 'ends_at'], ['capacity', 'capacity'], ['status', 'slot_status']]) {
        if (changes[key] !== undefined) { columns.push(`${column} = ?`); values.push(changes[key]?.local ?? changes[key]); }
      }
      const [result] = await connection.execute(`UPDATE DonationSlot SET ${columns.join(', ')} WHERE slot_id = ?`, [...values, slotId]);
      return result.affectedRows;
    },
    async insertBooking(connection, donorId, slotId) {
      const [result] = await connection.execute(`INSERT INTO Booking (donor_account_id, slot_id) VALUES (?, ?)`, [donorId, slotId]);
      return persistedId(result.insertId);
    },
    async updateBooking(connection, bookingId, status, reason) {
      const [result] = await connection.execute(`UPDATE Booking SET booking_status = ?, cancellation_reason = ?,
        status_changed_at = CURRENT_TIMESTAMP WHERE booking_id = ? AND booking_status = 'BOOKED'`, [status, reason, bookingId]);
      return result.affectedRows;
    },
    async insertEligibilityDecision(connection, donorId, bookingId, actorId, decision, reasonCode, deferredUntil) {
      const [result] = await connection.execute(`INSERT INTO EligibilityDecision
        (donor_account_id, booking_id, decided_by_account_id, decision, reason_code, deferred_until)
        VALUES (?, ?, ?, ?, ?, ?)`, [donorId, bookingId, actorId, decision, reasonCode, deferredUntil]);
      return persistedId(result.insertId);
    },
    async listSlots(query, admin) {
      const where = [admin ? '1=1' : "s.slot_status = 'OPEN'", admin ? '1=1' : 's.starts_at > NOW()'];
      const values = [];
      if (query.slotStatus) { where.push('s.slot_status = ?'); values.push(query.slotStatus); }
      if (query.from) { where.push('DATE(s.starts_at) >= ?'); values.push(query.from); }
      if (query.to) { where.push('DATE(s.starts_at) <= ?'); values.push(query.to); }
      const condition = where.join(' AND ');
      const [totalRows] = await database.execute(`SELECT COUNT(*) AS total FROM DonationSlot s WHERE ${condition}`, values);
      const [rows] = await database.execute(`SELECT ${slotProjection} FROM DonationSlot s WHERE ${condition}
        ORDER BY s.starts_at, s.slot_id LIMIT ? OFFSET ?`, [...values, pageSize, (query.page - 1) * pageSize]);
      const total = Number(totalRows[0]?.total);
      if (!Number.isSafeInteger(total)) throw new Error('Invalid count');
      return { slots: rows.map(slot), pagination: { page: query.page, pageSize, total } };
    },
    async listBookings(query, donorId = null) {
      const admin = donorId === null;
      const where = []; const values = [];
      if (donorId || query.donor) { where.push('b.donor_account_id = ?'); values.push(donorId ?? query.donor); }
      if (query.bookingStatus) { where.push('b.booking_status = ?'); values.push(query.bookingStatus); }
      if (query.from) { where.push('DATE(s.starts_at) >= ?'); values.push(query.from); }
      if (query.to) { where.push('DATE(s.starts_at) <= ?'); values.push(query.to); }
      const condition = where.length ? `WHERE ${where.join(' AND ')}` : '';
      const join = `FROM Booking b JOIN DonationSlot s ON s.slot_id = b.slot_id JOIN Account a ON a.account_id = b.donor_account_id${admin ? ' JOIN Donor d ON d.account_id = b.donor_account_id' : ''}`;
      const [totalRows] = await database.execute(`SELECT COUNT(*) AS total ${join} ${condition}`, values);
      const [rows] = await database.execute(`SELECT ${bookingProjection}${admin ? ', d.full_name AS donorName' : ''}
        ${join} ${condition} ORDER BY s.starts_at DESC, b.booking_id DESC LIMIT ? OFFSET ?`,
      [...values, pageSize, (query.page - 1) * pageSize]);
      const total = Number(totalRows[0]?.total);
      if (!Number.isSafeInteger(total)) throw new Error('Invalid count');
      return { bookings: rows.map(row => booking(row, admin)), pagination: { page: query.page, pageSize, total } };
    },
  };
}
