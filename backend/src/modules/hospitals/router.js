import express from 'express';
import { pool } from '../../config/database.js';
import { environment } from '../../config/environment.js';
import { requireActiveAccount, requireCurrentAccount, requireRole } from '../../middleware/auth.js';
import { requireTrustedOriginAndCsrf } from '../../middleware/csrf.js';
import { HttpError } from '../../utils/httpError.js';
import { createAuthRepository } from '../auth/repository.js';
import { createAuthService } from '../auth/service.js';
import { createHospitalRepository } from './repository.js';
import { createHospitalService } from './service.js';

export function createHospitalRouter({
  databasePool = pool,
  authService = createAuthService({ repository: createAuthRepository(databasePool) }),
  hospitalService = databasePool ? createHospitalService({ repository: createHospitalRepository(databasePool) }) : null,
  frontendUrl = environment.frontendUrl,
} = {}) {
  const router = express.Router();
  // The app supplies the established shared session middleware. These guards
  // reload Account before passing its verified identity to the domain service.
  const currentAccount = requireCurrentAccount(authService);
  const hospitalRole = requireRole('HOSPITAL');
  const adminRole = requireRole('ADMIN');
  const csrf = requireTrustedOriginAndCsrf(frontendUrl);

  function service() {
    if (!hospitalService) throw new HttpError(503, 'DATABASE_NOT_CONFIGURED', 'Database is not configured.');
    return hospitalService;
  }

  router.get('/hospitals/me', currentAccount, hospitalRole, async (req, res, next) => {
    try {
      const profile = await service().getOwnProfile({ accountId: req.authAccount.accountId });
      res.set('Cache-Control', 'no-store');
      res.json({ success: true, profile });
    } catch (error) { next(error); }
  });

  router.patch('/hospitals/me', currentAccount, hospitalRole, csrf, async (req, res, next) => {
    try {
      const profile = await service().updateOwnProfile({ accountId: req.authAccount.accountId }, req.body);
      res.set('Cache-Control', 'no-store');
      res.json({ success: true, profile });
    } catch (error) { next(error); }
  });

  router.get('/admin/hospitals', currentAccount, adminRole, requireActiveAccount, async (req, res, next) => {
    try {
      const { hospitals, pagination } = await service().listHospitals({ accountId: req.authAccount.accountId }, req.query);
      res.set('Cache-Control', 'no-store');
      res.json({ success: true, hospitals, pagination });
    } catch (error) { next(error); }
  });

  router.get('/admin/hospitals/:hospitalId', currentAccount, adminRole, requireActiveAccount, async (req, res, next) => {
    try {
      const profile = await service().getHospitalProfileForAdmin({ accountId: req.authAccount.accountId }, req.params.hospitalId);
      res.set('Cache-Control', 'no-store');
      // Request summaries are omitted until HospitalRequest storage/services exist.
      res.json({ success: true, profile });
    } catch (error) { next(error); }
  });

  return router;
}
