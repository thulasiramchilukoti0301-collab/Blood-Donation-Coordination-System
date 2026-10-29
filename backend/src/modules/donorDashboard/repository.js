const bookingStatuses = ['BOOKED', 'CANCELLED_BY_DONOR', 'CANCELLED_BY_STAFF', 'CHECKED_IN', 'NO_SHOW', 'COMPLETED'];
const outcomes = ['COLLECTED', 'INCOMPLETE', 'DEFERRED'];

export function createDonorActivityRepository(database) {
  return {
    async activity(donorId, { from, to }) {
      const bookingWhere = ['b.donor_account_id = ?'];
      const bookingArgs = [donorId];
      const donationWhere = ['b.donor_account_id = ?'];
      const donationArgs = [donorId];
      if (from) {
        bookingWhere.push('s.starts_at >= ?'); bookingArgs.push(`${from} 00:00:00`);
        donationWhere.push('d.created_at >= ?'); donationArgs.push(`${from} 00:00:00`);
      }
      if (to) {
        bookingWhere.push('s.starts_at < DATE_ADD(?, INTERVAL 1 DAY)'); bookingArgs.push(`${to} 00:00:00`);
        donationWhere.push('d.created_at < DATE_ADD(?, INTERVAL 1 DAY)'); donationArgs.push(`${to} 00:00:00`);
      }
      const [bookings] = await database.execute(`SELECT b.booking_status AS bookingStatus, COUNT(*) AS count
        FROM Booking b JOIN DonationSlot s ON s.slot_id = b.slot_id
        WHERE ${bookingWhere.join(' AND ')} GROUP BY b.booking_status`, bookingArgs);
      const [donations] = await database.execute(`SELECT d.outcome, COUNT(*) AS count
        FROM Donation d JOIN Booking b ON b.booking_id = d.booking_id
        WHERE ${donationWhere.join(' AND ')} GROUP BY d.outcome`, donationArgs);
      const numeric = value => { const result = Number(value); if (!Number.isSafeInteger(result) || result < 0) throw new Error('Invalid activity count'); return result; };
      const bookingMap = new Map(bookings.map(row => [row.bookingStatus, numeric(row.count)]));
      const donationMap = new Map(donations.map(row => [row.outcome, numeric(row.count)]));
      if (bookings.some(row => !bookingStatuses.includes(row.bookingStatus)) || donations.some(row => !outcomes.includes(row.outcome))) throw new Error('Invalid activity status');
      return { from: from ?? null, to: to ?? null,
        bookingCounts: bookingStatuses.map(bookingStatus => ({ bookingStatus, count: bookingMap.get(bookingStatus) ?? 0 })),
        donationCounts: outcomes.map(outcome => ({ outcome, count: donationMap.get(outcome) ?? 0 })) };
    },
  };
}
