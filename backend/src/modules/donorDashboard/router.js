import express from 'express';
import { requireActiveAccount, requireCurrentAccount, requireRole } from '../../middleware/auth.js';

export function createDonorActivityRouter({ authService, activityService }) {
  const router = express.Router();
  router.get('/donors/me/reports/activity', requireCurrentAccount(authService), requireRole('DONOR'), requireActiveAccount,
    async (req, res, next) => {
      try {
        res.set('Cache-Control', 'no-store');
        res.json({ success: true, activity: await activityService.activity(req.authAccount.accountId, req.query) });
      } catch (error) { next(error); }
    });
  return router;
}
