import express from 'express';
import { requireActiveAccount, requireCurrentAccount, requireRole } from '../../middleware/auth.js';
import { requireTrustedOriginAndCsrf } from '../../middleware/csrf.js';
import { HttpError } from '../../utils/httpError.js';

export function createDonationRouter({ authService, donationService, frontendUrl }) {
  const router = express.Router();
  const current = requireCurrentAccount(authService);
  const admin = [current, requireRole('ADMIN'), requireActiveAccount];
  const donor = [current, requireRole('DONOR'), requireActiveAccount];
  router.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  router.get('/admin/donations', ...admin, async (req, res, next) => {
    try { res.json({ success: true, ...await donationService.list(req.query, { admin: true }) }); }
    catch (error) { next(error); }
  });
  router.post('/admin/donations', ...admin, requireTrustedOriginAndCsrf(frontendUrl), async (req, res, next) => {
    try {
      if (Object.keys(req.query).length) throw new HttpError(400, 'VALIDATION_ERROR', 'Unexpected query input.');
      res.status(201).json({ success: true, donation: await donationService.record(req.authAccount.accountId, req.body, req.authSession) });
    } catch (error) { next(error); }
  });
  router.get('/donors/me/donations', ...donor, async (req, res, next) => {
    try { res.json({ success: true, ...await donationService.list(req.query, { donorId: req.authAccount.accountId }) }); }
    catch (error) { next(error); }
  });
  return router;
}
