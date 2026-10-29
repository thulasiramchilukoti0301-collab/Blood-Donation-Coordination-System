import express from 'express';
import { requireActiveAccount, requireCurrentAccount, requireRole } from '../../middleware/auth.js';
import { HttpError } from '../../utils/httpError.js';
import { validateReportQuery } from './validation.js';
const unavailable = () => new HttpError(503, 'REPORTS_UNAVAILABLE', 'Report data is temporarily unavailable.');

export function createReportsRouter({ authService, service } = {}) {
  const router = express.Router();
  if (!authService) return router;
  router.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  const admin = [requireCurrentAccount(authService), requireRole('ADMIN'), requireActiveAccount];
  const hospital = [requireCurrentAccount(authService), requireRole('HOSPITAL')];
  const noQuery = (req) => { if (Object.keys(req.query).length) throw new HttpError(400, 'VALIDATION_ERROR', 'Report filters are invalid.'); };
  const handler = (work) => async (req, res, next) => {
    try { if (!service) throw unavailable(); res.json({ success: true, ...await work(req) }); }
    catch (error) { next(error instanceof HttpError ? error : unavailable()); }
  };
  router.get('/admin/dashboard', ...admin, handler((req) => { noQuery(req); return service.adminDashboard(); }));
  router.get('/hospitals/me/dashboard', ...hospital, handler((req) => { noQuery(req); return service.hospitalDashboard(req.authAccount.accountId); }));
  router.get('/admin/reports/inventory', ...admin, handler(async (req) => { noQuery(req); return { inventory: await service.inventoryReport() }; }));
  router.get('/admin/reports/donations', ...admin, handler(async (req) => ({ donations: await service.donationReport(validateReportQuery(req.query)) })));
  router.get('/admin/reports/requests', ...admin, handler((req) => service.requestReport(validateReportQuery(req.query))));
  return router;
}
