import express from 'express';
import { requireActiveAccount, requireCurrentAccount, requireRole } from '../../middleware/auth.js';
import { requireTrustedOriginAndCsrf } from '../../middleware/csrf.js';
import { HttpError } from '../../utils/httpError.js';

export function createAdminDonorRouter({ authService, donorService, frontendUrl }) {
  const router = express.Router();
  const admin = [requireCurrentAccount(authService), requireRole('ADMIN'), requireActiveAccount];
  const noStore = (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); };
  const noUnexpectedQuery = req => {
    if (Object.keys(req.query).length) throw new HttpError(400, 'VALIDATION_ERROR', 'Unexpected Donor query input.');
  };
  router.use('/admin/donors', noStore);
  router.get('/admin/donors', ...admin, async (req, res, next) => {
    try { res.json({ success: true, ...await donorService.list(req.authAccount.accountId, req.query) }); }
    catch (error) { next(error); }
  });
  router.get('/admin/donors/:donorId', ...admin, async (req, res, next) => {
    try {
      noUnexpectedQuery(req);
      res.json({ success: true, donor: await donorService.detail(req.authAccount.accountId, req.params.donorId) });
    } catch (error) { next(error); }
  });
  router.patch('/admin/donors/:donorId', ...admin, requireTrustedOriginAndCsrf(frontendUrl), async (req, res, next) => {
    try {
      noUnexpectedQuery(req);
      const donor = await donorService.update(req.authAccount.accountId, req.params.donorId, req.body, req.authSession);
      res.json({ success: true, donor });
    } catch (error) { next(error); }
  });
  return router;
}
