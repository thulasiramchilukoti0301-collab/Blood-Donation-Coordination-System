import express from 'express';
import { requireActiveAccount, requireCurrentAccount, requireRole } from '../../middleware/auth.js';
import { requireTrustedOriginAndCsrf } from '../../middleware/csrf.js';
import { HttpError } from '../../utils/httpError.js';
import { validateAllocationPreviewQuery } from './readService.js';

const idPattern = /^[1-9][0-9]{0,19}$/u;
const maximumId = 18446744073709551615n;
const unavailable = () => new HttpError(503, 'ALLOCATION_READ_UNAVAILABLE',
  'Allocation preview data is temporarily unavailable. Check that Feature 8 storage is installed.');
const invalid = () => new HttpError(400, 'VALIDATION_ERROR', 'Allocation preview input is invalid.');

export function createAllocationReadRouter({ authService, service, mutationService, frontendUrl } = {}) {
  const router = express.Router();
  if (!authService) return router;
  router.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  const current = requireCurrentAccount(authService);
  const admin = [current, requireRole('ADMIN'), requireActiveAccount];
  const handle = (work) => async (req, res, next) => {
    try {
      if (!service) throw unavailable();
      await service.assertStorageReady();
      res.json({ success: true, ...await work(req) });
    } catch (error) { next(error); }
  };
  router.get('/admin/blood-compatibility', ...admin, handle(async (req) => {
    if (Object.keys(req.query).length) throw invalid();
    return service.compatibility();
  }));
  const validatePreview = (req, _res, next) => {
    try { validateAllocationPreviewQuery(req.query); next(); } catch (error) { next(error); }
  };
  router.get('/admin/requests/:requestId/allocation-preview', ...admin, validatePreview, handle(async (req) => {
    if (!idPattern.test(req.params.requestId) || BigInt(req.params.requestId) > maximumId) throw invalid();
    return { preview: await service.preview(req.params.requestId, req.query) };
  }));
  router.post('/admin/requests/:requestId/allocations', ...admin, requireTrustedOriginAndCsrf(frontendUrl), async (req, res, next) => {
    try {
      if (!service || !mutationService) throw unavailable();
      await service.assertStorageReady();
      if (!idPattern.test(req.params.requestId) || BigInt(req.params.requestId) > maximumId) throw invalid();
      res.status(201).json({ success: true, allocation: await mutationService.allocate(
        req.params.requestId, req.authAccount.accountId, req.body, req.authSession) });
    } catch (error) { next(error); }
  });
  router.post('/admin/allocations/:allocationId/issue', ...admin, requireTrustedOriginAndCsrf(frontendUrl), async (req, res, next) => {
    try {
      if (!service || !mutationService) throw unavailable();
      await service.assertStorageReady();
      if (!idPattern.test(req.params.allocationId) || BigInt(req.params.allocationId) > maximumId
        || Object.keys(req.query).length) throw invalid();
      res.json({ success: true, issue: await mutationService.issue(
        req.params.allocationId, req.authAccount.accountId, req.body, req.authSession) });
    } catch (error) { next(error); }
  });
  return router;
}
