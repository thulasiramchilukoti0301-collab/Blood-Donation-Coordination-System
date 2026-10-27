import { randomUUID } from 'node:crypto';
import { HttpError } from '../../utils/httpError.js';
import { safeAccountError } from '../accounts/transaction.js';
import { requireStoredSession } from '../accounts/sessionAuthorization.js';
import { createAuditWriter } from '../audit/writer.js';
import { bookingQuery, eligibility, fields, id, overlaps, slotCreate, slotPatch, slotQuery, storedTime, todayIst } from './rules.js';

const auditCodes = ['DONATION_SLOT_CREATED', 'DONATION_SLOT_UPDATED', 'DONATION_SLOT_CLOSED',
  'DONATION_SLOT_CANCELLED', 'BOOKING_CREATED', 'BOOKING_CANCELLED_BY_DONOR', 'BOOKING_CANCELLED_BY_STAFF'];
const conflict = (code, message) => new HttpError(409, code, message);
const slotConflict = () => conflict('SLOT_CONFLICT', 'The slot changed or is no longer available. Refresh the list.');
const bookingConflict = () => conflict('BOOKING_CONFLICT', 'This booking cannot be created or cancelled. Refresh the list.');
const active = (account, role) => {
  if (!account || account.accountStatus !== 'ACTIVE') throw new HttpError(401, 'ACCOUNT_UNAVAILABLE', 'Sign in with an active account.');
  if (account.role !== role) throw new HttpError(403, 'FORBIDDEN', 'You do not have access to this resource.');
};
const future = (slot, now) => storedTime(slot.startsAt).utc > now;

export function createBookingService({ repository, auditWriter = createAuditWriter({ allowedActionCodes: auditCodes }),
  operationId = randomUUID, clock = () => Date.now() }) {
  if (!repository) throw new TypeError('A booking repository is required.');
  const audit = (connection, actor, actionCode, subjectType, subjectId, reasonCode, changeSummary) => auditWriter.write(connection,
    { actorAccountId: actor, actionCode, subjectType, subjectId, reasonCode, changeSummary, operationId: operationId() });
  async function transaction(actorId, role, authorization, work) {
    const actor = id(actorId);
    return repository.transaction(actor, async (connection, accounts) => {
      const account = accounts.get(actor);
      active(account, role);
      await requireStoredSession(connection, authorization, account);
      // The Account and SID stay locked while domain rows are acquired. Re-read
      // that already-held SID immediately before writes so time spent waiting
      // for domain locks cannot authorize a now-expired session.
      return work(connection, actor, () => requireStoredSession(connection, authorization, account));
    });
  }
  async function ownHistory(donorId) {
    if (!await repository.donorExists(donorId)) throw new HttpError(503, 'DONOR_PROFILE_UNAVAILABLE', 'The donor profile is unavailable.');
    return repository.history(donorId);
  }
  return {
    async preview(donorId) {
      try {
        const history = await ownHistory(id(donorId));
        const now = clock();
        return { ...eligibility(history, todayIst(now)), checkedAt: new Date(now).toISOString(), advisory: true };
      } catch (error) { throw safeAccountError(error); }
    },
    async slots(query, { admin = false, donorId = null } = {}) {
      try {
        const input = slotQuery(query, admin);
        const result = await repository.listSlots(input, admin);
        if (admin) return result;
        const history = await ownHistory(id(donorId));
        return { ...result, slots: result.slots.map(slot => ({ ...slot,
          eligibility: eligibility(history, storedTime(slot.startsAt).date),
          bookable: slot.slotStatus === 'OPEN' && slot.remaining > 0 && future(slot, clock())
            && eligibility(history, storedTime(slot.startsAt).date).result === 'ELIGIBLE' })) };
      } catch (error) { throw safeAccountError(error); }
    },
    async bookings(query, { admin = false, donorId = null } = {}) {
      try { return await repository.listBookings(bookingQuery(query, admin), admin ? null : id(donorId)); }
      catch (error) { throw safeAccountError(error); }
    },
    async createSlot(actorId, body, authorization) {
      const input = slotCreate(body, clock());
      return transaction(actorId, 'ADMIN', authorization, async (connection, actor, authorizeMutation) => {
        await authorizeMutation();
        if (input.start.utc <= clock()) throw slotConflict();
        const slotId = await repository.insertSlot(connection, actor, input);
        await audit(connection, actor, 'DONATION_SLOT_CREATED', 'DonationSlot', slotId,
          'SLOT_SCHEDULED', 'Donation slot created');
        return { slotId, slotStatus: 'OPEN', startsAt: input.start.iso, endsAt: input.end.iso,
          capacity: input.capacity, occupied: 0, remaining: input.capacity };
      });
    },
    async updateSlot(actorId, slotIdValue, body, authorization) {
      const slotId = id(slotIdValue); const patch = slotPatch(body);
      return transaction(actorId, 'ADMIN', authorization, async (connection, actor, authorizeMutation) => {
        const slot = await repository.lockSlot(connection, slotId);
        if (!slot) throw new HttpError(404, 'SLOT_NOT_FOUND', 'The slot was not found.');
        const bookings = await repository.slotBookings(connection, slotId);
        if (!future(slot, clock()) || slot.slotStatus === 'CANCELLED') throw slotConflict();
        const occupied = bookings.filter(row => ['BOOKED', 'CHECKED_IN'].includes(row.bookingStatus)).length;
        if (patch.status) {
          if (patch.status === slot.slotStatus) throw slotConflict();
          if (patch.status === 'CANCELLED' && bookings.some(row => row.bookingStatus === 'CHECKED_IN')) {
            throw conflict('CHECKED_IN_BOOKINGS', 'Resolve checked-in attendance before cancelling this slot.');
          }
          await authorizeMutation();
          if (!future(slot, clock())) throw slotConflict();
          if (await repository.updateSlot(connection, slotId, patch) !== 1) throw slotConflict();
          if (patch.status === 'CANCELLED') {
            for (const row of bookings.filter(value => value.bookingStatus === 'BOOKED')) {
              if (await repository.updateBooking(connection, row.bookingId, 'CANCELLED_BY_STAFF', 'SLOT_CANCELLED_BY_STAFF') !== 1) throw slotConflict();
              await audit(connection, actor, 'BOOKING_CANCELLED_BY_STAFF', 'Booking', row.bookingId,
                'SLOT_CANCELLED_BY_STAFF', 'Booking cancelled because its slot was cancelled');
            }
          }
          await audit(connection, actor, patch.status === 'CLOSED' ? 'DONATION_SLOT_CLOSED' : 'DONATION_SLOT_CANCELLED',
            'DonationSlot', slotId, patch.reason, patch.status === 'CLOSED' ? 'Donation slot closed' : 'Donation slot cancelled');
          return { ...slot, slotStatus: patch.status, occupied: patch.status === 'CANCELLED' ? 0 : occupied,
            remaining: slot.capacity - (patch.status === 'CANCELLED' ? 0 : occupied) };
        }
        if (slot.slotStatus !== 'OPEN' && (patch.start || patch.end)) throw slotConflict();
        if (bookings.length && (patch.start || patch.end)) throw slotConflict();
        const start = patch.start ?? storedTime(slot.startsAt), end = patch.end ?? storedTime(slot.endsAt);
        if (start.utc <= clock() || end.utc <= start.utc) throw slotConflict();
        const nextCapacity = patch.capacity ?? slot.capacity;
        if (nextCapacity < occupied) throw conflict('CAPACITY_OCCUPIED', 'Capacity cannot be below occupied bookings.');
        await authorizeMutation();
        if (start.utc <= clock()) throw slotConflict();
        if (await repository.updateSlot(connection, slotId, patch) !== 1) throw slotConflict();
        await audit(connection, actor, 'DONATION_SLOT_UPDATED', 'DonationSlot', slotId,
          'SLOT_DETAILS_UPDATED', 'Donation slot capacity or schedule updated');
        return { ...slot, startsAt: start.iso, endsAt: end.iso, capacity: nextCapacity,
          occupied, remaining: nextCapacity - occupied };
      });
    },
    async createBooking(donorId, body, authorization) {
      fields(body, ['slotId'], ['slotId']); const slotId = id(body.slotId);
      return transaction(donorId, 'DONOR', authorization, async (connection, actor, authorizeMutation) => {
        if (!await repository.donorExists(actor, connection)) throw new HttpError(503, 'DONOR_PROFILE_UNAVAILABLE', 'The donor profile is unavailable.');
        const slot = await repository.lockSlot(connection, slotId);
        if (!slot) throw new HttpError(404, 'SLOT_NOT_FOUND', 'The slot was not found.');
        const rows = await repository.slotBookings(connection, slotId);
        const activeBookings = await repository.donorActiveBookings(connection, actor);
        const history = await repository.history(actor, connection);
        const now = clock();
        if (slot.slotStatus !== 'OPEN' || !future(slot, now)
          || rows.filter(row => ['BOOKED', 'CHECKED_IN'].includes(row.bookingStatus)).length >= slot.capacity) throw slotConflict();
        if (eligibility(history, storedTime(slot.startsAt).date).result !== 'ELIGIBLE') {
          throw conflict('DONOR_NOT_ELIGIBLE', 'Booking eligibility did not pass for this appointment date.');
        }
        if (activeBookings.some(row => overlaps(storedTime(row.startsAt).utc, storedTime(row.endsAt).utc,
          storedTime(slot.startsAt).utc, storedTime(slot.endsAt).utc))) throw bookingConflict();
        let bookingId;
        await authorizeMutation();
        if (!future(slot, clock())) throw slotConflict();
        try { bookingId = await repository.insertBooking(connection, actor, slotId); }
        catch (error) { if (error?.code === 'ER_DUP_ENTRY') throw bookingConflict(); throw error; }
        await audit(connection, actor, 'BOOKING_CREATED', 'Booking', bookingId, 'DONOR_RESERVED', 'Donation booking created');
        return { bookingId, bookingStatus: 'BOOKED', slot: { ...slot,
          occupied: rows.filter(row => ['BOOKED', 'CHECKED_IN'].includes(row.bookingStatus)).length + 1,
          remaining: slot.capacity - rows.filter(row => ['BOOKED', 'CHECKED_IN'].includes(row.bookingStatus)).length - 1 } };
      });
    },
    async cancelBooking(donorId, bookingIdValue, body, authorization) {
      const bookingId = id(bookingIdValue);
      fields(body, ['reasonCode']);
      if (body.reasonCode !== undefined && body.reasonCode !== 'DONOR_REQUESTED') {
        throw new HttpError(400, 'VALIDATION_ERROR', 'Only the supported cancellation reason is accepted.');
      }
      return transaction(donorId, 'DONOR', authorization, async (connection, actor, authorizeMutation) => {
        const slotId = await repository.bookingSlotId(connection, bookingId, actor);
        if (!slotId) throw new HttpError(404, 'BOOKING_NOT_FOUND', 'The booking was not found.');
        const slot = await repository.lockSlot(connection, slotId);
        const row = await repository.lockBooking(connection, bookingId, actor);
        if (!slot || !row || row.slotId !== slotId) throw bookingConflict();
        if (row.bookingStatus !== 'BOOKED' || !future(slot, clock())) throw bookingConflict();
        await authorizeMutation();
        if (!future(slot, clock())) throw bookingConflict();
        if (await repository.updateBooking(connection, bookingId, 'CANCELLED_BY_DONOR', 'DONOR_REQUESTED') !== 1) throw bookingConflict();
        await audit(connection, actor, 'BOOKING_CANCELLED_BY_DONOR', 'Booking', bookingId,
          'DONOR_REQUESTED', 'Donor cancelled booking');
        return { bookingId, bookingStatus: 'CANCELLED_BY_DONOR', cancelledAt: new Date(clock()).toISOString() };
      });
    },
  };
}
