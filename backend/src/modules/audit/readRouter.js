import express from 'express';
import { requireActiveAccount, requireCurrentAccount, requireRole } from '../../middleware/auth.js';
import { HttpError } from '../../utils/httpError.js';
import { validateAuditQuery } from './readValidation.js';

const unavailable = () => new HttpError(503, 'AUDIT_READ_UNAVAILABLE', 'Audit history is temporarily unavailable.');

export function createAuditReadRouter({ authService, service } = {}) {
  const router = express.Router();
  if (!authService) return router;
  router.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  const validate = (req, _res, next) => { try { validateAuditQuery(req.query); next(); } catch (error) { next(error); } };
  router.get('/admin/audit-events', requireCurrentAccount(authService), requireRole('ADMIN'), requireActiveAccount, validate,
    async (req, res, next) => {
      try {
        if (!service) throw unavailable();
        await service.assertStorageReady();
        res.json({ success: true, ...await service.list(req.query) });
      } catch (error) { next(error); }
    });
  return router;
}
