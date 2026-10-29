import express from 'express';
import { requireActiveAccount, requireCurrentAccount, requireRole } from '../../middleware/auth.js';
import { requireTrustedOriginAndCsrf } from '../../middleware/csrf.js';
import { HttpError } from '../../utils/httpError.js';

export function createReleaseRouter({ authService, releaseService, frontendUrl }) {
  const router = express.Router();
  const admin = [requireCurrentAccount(authService), requireRole('ADMIN'), requireActiveAccount];
  router.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  router.post('/admin/donations/:donationId/testing-decision', ...admin, requireTrustedOriginAndCsrf(frontendUrl), async (req, res, next) => {
    try {
      if (Object.keys(req.query).length) throw new HttpError(400, 'VALIDATION_ERROR', 'Unexpected query input.');
      res.json({ success: true, release: await releaseService.decide(req.params.donationId,
        req.authAccount.accountId, req.body, req.authSession) });
    } catch (error) { next(error); }
  });
  router.get('/inventory', ...admin, async (req, res, next) => {
    try { res.json({ success: true, ...await releaseService.list(req.query) }); } catch (error) { next(error); }
  });
  router.get('/admin/inventory/:bloodUnitId', ...admin, async (req, res, next) => {
    try {
      if (Object.keys(req.query).length) throw new HttpError(400, 'VALIDATION_ERROR', 'Unexpected query input.');
      res.json({ success: true, unit: await releaseService.detail(req.params.bloodUnitId) });
    } catch (error) { next(error); }
  });
  router.post('/admin/inventory/expiry/run', ...admin, requireTrustedOriginAndCsrf(frontendUrl), async (req, res, next) => {
    try {
      if (Object.keys(req.query).length) throw new HttpError(400, 'VALIDATION_ERROR', 'Unexpected query input.');
      res.json({ success: true, result: await releaseService.reconcileExpiry(req.authAccount.accountId, req.body, req.authSession) });
    } catch (error) { next(error); }
  });
  router.post('/admin/inventory/:bloodUnitId/discard', ...admin, requireTrustedOriginAndCsrf(frontendUrl), async (req, res, next) => {
    try {
      if (Object.keys(req.query).length) throw new HttpError(400, 'VALIDATION_ERROR', 'Unexpected query input.');
      res.json({ success: true, discard: await releaseService.discardUnit(req.authAccount.accountId, req.params.bloodUnitId, req.body, req.authSession) });
    } catch (error) { next(error); }
  });
  return router;
}
