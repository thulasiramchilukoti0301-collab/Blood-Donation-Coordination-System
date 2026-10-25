import express from 'express';
import { requireCurrentAccount, requireRole, requireActiveAccount } from '../../middleware/auth.js';
import { requireTrustedOriginAndCsrf } from '../../middleware/csrf.js';
import { HttpError } from '../../utils/httpError.js';

export function createAccountAdminRouter({ authService, accountService, frontendUrl }) {
  const router = express.Router();
  const guards = [requireCurrentAccount(authService), requireRole('ADMIN'), requireActiveAccount];
  const noStore = (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); };
  router.get('/admin/accounts', noStore, ...guards, async (req, res, next) => {
    try { res.json({ success: true, ...await accountService.list(req.authAccount.accountId, req.query) }); }
    catch (error) { next(error); }
  });
  router.patch('/admin/accounts/:accountId', noStore, ...guards, requireTrustedOriginAndCsrf(frontendUrl), async (req, res, next) => {
    try {
      if (Object.keys(req.query).length) throw new HttpError(400, 'VALIDATION_ERROR', 'Account query or approval input is invalid.');
      const result = await accountService.approve(req.authAccount.accountId, req.params.accountId, req.body);
      res.json({ success: true, ...result });
    } catch (error) { next(error); }
  });
  return router;
}
