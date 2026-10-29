import express from 'express';
import { requireActiveAccount, requireCurrentAccount, requireRole } from '../../middleware/auth.js';
import { requireTrustedOriginAndCsrf } from '../../middleware/csrf.js';
import { requestDependencyUnavailable, requestValidationError, safeBloodRequestError } from './errors.js';
import { validateCreateRequest, validateRequestId, validateRequestListQuery } from './validation.js';

// The low-level factory stays injectable; the approved runtime enables the bounded subset.
export function createBloodRequestRouter({ authService, service, frontendUrl, readiness = {} } = {}) {
  const router = express.Router();
  if (!authService) return router;
  router.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  const current = requireCurrentAccount(authService);
  const guard = (role) => [current, requireRole(role), requireActiveAccount];
  const principal = (req) => ({ accountId: req.authAccount.accountId, session: req.authSession });
  const handler = (work, status = 200) => async (req, res, next) => {
    try {
      if (!service) throw requestDependencyUnavailable();
      if (typeof service.assertStorageReady === 'function') await service.assertStorageReady();
      res.status(status).json({ success: true, ...await work(req) });
    } catch (error) { next(safeBloodRequestError(error)); }
  };
  const noQuery = (req) => { if (Object.keys(req.query).length) throw requestValidationError(); };
  if (readiness.lookupApproved === true) {
    router.get('/blood-groups', current, requireRole('HOSPITAL', 'ADMIN'), requireActiveAccount, handler(async (req) => {
      noQuery(req);
      return { bloodGroups: await service.listRequestableBloodGroups(principal(req), req.query) };
    }));
  }
  if (readiness.storageInstalled === true && readiness.readProjectionApproved === true) {
    for (const [base, role, list, detail] of [
      ['/hospitals/me/requests', 'HOSPITAL', 'listHospitalRequests', 'getHospitalRequest'],
      ['/admin/requests', 'ADMIN', 'listAdminRequests', 'getAdminRequestRecord'],
    ]) {
      router.get(base, ...guard(role), handler(async (req) => {
        validateRequestListQuery(req.query, { admin: role === 'ADMIN' });
        return service[list](principal(req), req.query);
      }));
      router.get(`${base}/:requestId`, ...guard(role), handler(async (req) => {
        noQuery(req);
        const id = validateRequestId(req.params.requestId);
        return { request: await service[detail](principal(req), id) };
      }));
    }
  }
  if (readiness.storageInstalled === true && readiness.creationContractsApproved === true) {
    router.post('/hospitals/me/requests', ...guard('HOSPITAL'), requireTrustedOriginAndCsrf(frontendUrl), handler(async (req) => {
      noQuery(req);
      validateCreateRequest(req.body);
      return service.createHospitalRequest(principal(req), req.body);
    }, 201));
  }
  if (readiness.cancellationApproved === true) {
    router.post('/hospitals/me/requests/:requestId/cancellation', ...guard('HOSPITAL'), requireTrustedOriginAndCsrf(frontendUrl), handler(async (req) => {
      noQuery(req);
      if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body) || Object.keys(req.body).length) throw requestValidationError();
      const id = validateRequestId(req.params.requestId);
      return service.cancelHospitalRequest(principal(req), id);
    }));
  }
  if (readiness.reviewApproved === true) {
    router.post('/admin/requests/:requestId/review', ...guard('ADMIN'), requireTrustedOriginAndCsrf(frontendUrl), handler(async (req) => {
      noQuery(req);
      if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)
        || Object.keys(req.body).length !== 1 || !Object.hasOwn(req.body, 'decision')
        || req.body.decision !== 'UNDER_REVIEW') throw requestValidationError();
      const id = validateRequestId(req.params.requestId);
      return service.reviewRequest(principal(req), id, { decision: req.body.decision });
    }));
  }
  return router;
}
