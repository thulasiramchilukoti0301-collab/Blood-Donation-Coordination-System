import express from 'express';
import { requireActiveAccount, requireCurrentAccount, requireRole } from '../../middleware/auth.js';
import { requireTrustedOriginAndCsrf } from '../../middleware/csrf.js';
import { HttpError } from '../../utils/httpError.js';

export function createBookingRouter({ authService, bookingService, frontendUrl }) {
  const router = express.Router();
  const current = requireCurrentAccount(authService);
  const donor = [current, requireRole('DONOR'), requireActiveAccount];
  const admin = [current, requireRole('ADMIN'), requireActiveAccount];
  const csrf = requireTrustedOriginAndCsrf(frontendUrl);
  router.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  const noQuery = req => { if (Object.keys(req.query).length) throw new HttpError(400, 'VALIDATION_ERROR', 'Unexpected query input.'); };
  router.get('/donors/me/eligibility', ...donor, async (req, res, next) => {
    try { noQuery(req); res.json({ success: true, eligibility: await bookingService.preview(req.authAccount.accountId) }); }
    catch (error) { next(error); }
  });
  router.get('/donation-slots', current, requireActiveAccount, requireRole('DONOR', 'ADMIN'), async (req, res, next) => {
    try { res.json({ success: true, ...await bookingService.slots(req.query,
      { admin: req.authAccount.role === 'ADMIN', donorId: req.authAccount.accountId }) }); }
    catch (error) { next(error); }
  });
  router.post('/admin/donation-slots', ...admin, csrf, async (req, res, next) => {
    try { noQuery(req); res.status(201).json({ success: true,
      slot: await bookingService.createSlot(req.authAccount.accountId, req.body, req.authSession) }); }
    catch (error) { next(error); }
  });
  router.patch('/admin/donation-slots/:slotId', ...admin, csrf, async (req, res, next) => {
    try { noQuery(req); res.json({ success: true,
      slot: await bookingService.updateSlot(req.authAccount.accountId, req.params.slotId, req.body, req.authSession) }); }
    catch (error) { next(error); }
  });
  router.get('/donors/me/bookings', ...donor, async (req, res, next) => {
    try { res.json({ success: true, ...await bookingService.bookings(req.query, { donorId: req.authAccount.accountId }) }); }
    catch (error) { next(error); }
  });
  router.post('/donors/me/bookings', ...donor, csrf, async (req, res, next) => {
    try { noQuery(req); res.status(201).json({ success: true,
      booking: await bookingService.createBooking(req.authAccount.accountId, req.body, req.authSession) }); }
    catch (error) { next(error); }
  });
  router.post('/donors/me/bookings/:bookingId/cancellation', ...donor, csrf, async (req, res, next) => {
    try { noQuery(req); res.json({ success: true,
      booking: await bookingService.cancelBooking(req.authAccount.accountId, req.params.bookingId, req.body, req.authSession) }); }
    catch (error) { next(error); }
  });
  router.get('/admin/bookings', ...admin, async (req, res, next) => {
    try { res.json({ success: true, ...await bookingService.bookings(req.query, { admin: true }) }); }
    catch (error) { next(error); }
  });
  router.patch('/admin/bookings/:bookingId/status', ...admin, csrf, async (req, res, next) => {
    try { noQuery(req); res.json({ success: true,
      booking: await bookingService.updateAdminBookingStatus(req.authAccount.accountId, req.params.bookingId, req.body, req.authSession) }); }
    catch (error) { next(error); }
  });
  router.post('/admin/donors/:donorId/eligibility-decisions', ...admin, csrf, async (req, res, next) => {
    try { noQuery(req); res.status(201).json({ success: true,
      eligibilityDecision: await bookingService.recordEligibilityDecision(req.authAccount.accountId,
        req.params.donorId, req.body, req.authSession) }); }
    catch (error) { next(error); }
  });
  return router;
}
