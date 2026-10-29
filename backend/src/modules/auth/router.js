import { randomBytes } from 'node:crypto';
import express from 'express';
import { createAuthRepository } from './repository.js';
import { createAuthService } from './service.js';
import { createDonorRepository } from '../donors/repository.js';
import { createDonorProfileService } from '../donors/service.js';
import { createAccountAdminRepository } from '../accounts/repository.js';
import { createAccountAdminService } from '../accounts/service.js';
import { createAccountAdminRouter } from '../accounts/router.js';
import { createBookingRepository } from '../booking/repository.js';
import { createBookingService } from '../booking/service.js';
import { createBookingRouter } from '../booking/router.js';
import { createDonationRepository } from '../donations/repository.js';
import { createDonationService } from '../donations/service.js';
import { createDonationRouter } from '../donations/router.js';
import { createReleaseRepository } from '../release/repository.js';
import { createReleaseService } from '../release/service.js';
import { createReleaseRouter } from '../release/router.js';
import { createAdminDonorRepository } from '../adminDonors/repository.js';
import { createAdminDonorService } from '../adminDonors/service.js';
import { createAdminDonorRouter } from '../adminDonors/router.js';
import { validateDonorRegistration, validateHospitalRegistration, validateLogin } from './validation.js';
import { requireCurrentAccount, requireRole } from '../../middleware/auth.js';
import { requireTrustedOriginAndCsrf } from '../../middleware/csrf.js';
import { createRateLimiter } from '../../middleware/rateLimit.js';
import { HttpError } from '../../utils/httpError.js';
import { createSessionMiddleware, pool } from '../../config/database.js';
import { environment, readSessionConfig } from '../../config/environment.js';

function callbackPromise(target, method) {
  return new Promise((resolve, reject) => target[method]((error) => error ? reject(error) : resolve()));
}

function unavailableRouter() {
  const router = express.Router();
  router.use((req, res, next) => {
    const supported = (req.method === 'GET' && ['/auth/csrf', '/auth/me', '/donors/me'].includes(req.path))
      || (req.method === 'GET' && req.path === '/admin/accounts')
      || (req.method === 'GET' && ['/admin/donors', '/admin/donors/'].includes(req.path))
      || (['GET', 'PATCH'].includes(req.method) && /^\/admin\/donors\/[^/]+$/u.test(req.path))
      || (req.method === 'GET' && ['/donors/me/eligibility', '/donation-slots', '/donors/me/bookings', '/admin/bookings'].includes(req.path))
      || (req.method === 'GET' && ['/admin/donations', '/donors/me/donations'].includes(req.path))
      || (req.method === 'GET' && req.path === '/inventory')
      || (req.method === 'GET' && /^\/admin\/inventory\/[^/]+$/u.test(req.path))
      || (req.method === 'POST' && req.path === '/admin/inventory/expiry/run')
      || (req.method === 'POST' && /^\/admin\/inventory\/[^/]+\/discard$/u.test(req.path))
      || (req.method === 'POST' && /^\/admin\/donations\/[^/]+\/testing-decision$/u.test(req.path))
      || (req.method === 'POST' && req.path === '/admin/donations')
      || (req.method === 'POST' && ['/admin/donation-slots', '/donors/me/bookings'].includes(req.path))
      || (req.method === 'PATCH' && /^\/admin\/donation-slots\/[^/]+$/u.test(req.path))
      || (req.method === 'POST' && /^\/donors\/me\/bookings\/[^/]+\/cancellation$/u.test(req.path))
      || (req.method === 'PATCH' && /^\/admin\/accounts\/[^/]+$/u.test(req.path))
      || (req.method === 'PATCH' && req.path === '/donors/me')
      || (req.method === 'POST' && ['/auth/register/donors', '/auth/register/hospitals', '/auth/login', '/auth/logout'].includes(req.path));
    if (!supported) return next();
    return next(new HttpError(
      503,
      'AUTHENTICATION_NOT_CONFIGURED',
      'Authentication is unavailable. Configure the database, session secret, and session table.',
    ));
  });
  return router;
}

export function createAuthRouter({ authService, donorService, donorAdminService, accountService, bookingService, donationService, releaseService, sessionStore, frontendUrl = environment.frontendUrl, cookieSecure = false }) {
  const router = express.Router();
  const csrf = requireTrustedOriginAndCsrf(frontendUrl);
  const loginLimiter = createRateLimiter();
  const registrationLimiter = createRateLimiter();
  const hospitalRegistrationLimiter = createRateLimiter();
  const currentAccount = requireCurrentAccount(authService);

  router.get('/auth/csrf', (req, res, next) => {
    req.session.csrfToken ??= randomBytes(32).toString('hex');
    res.set('Cache-Control', 'no-store');
    req.session.save((error) => {
      if (error) return next(new HttpError(503, 'SESSION_STORAGE_UNAVAILABLE', 'Session storage is unavailable.'));
      return res.json({ success: true, csrfToken: req.session.csrfToken });
    });
  });

  router.post('/auth/register/donors', registrationLimiter, csrf, async (req, res, next) => {
    try {
      const donor = validateDonorRegistration(req.body);
      const result = await authService.registerDonor(donor);
      res.status(201).json({ success: true, ...result });
    } catch (error) { next(error); }
  });

  router.post('/auth/register/hospitals', hospitalRegistrationLimiter, csrf, async (req, res, next) => {
    try {
      const hospital = validateHospitalRegistration(req.body);
      const result = await authService.registerHospital(hospital);
      res.set('Cache-Control', 'no-store');
      res.status(201).json({ success: true, ...result });
    } catch (error) { next(error); }
  });

  router.post('/auth/login', loginLimiter, csrf, async (req, res, next) => {
    let persisting = false;
    try {
      const credentials = validateLogin(req.body);
      const account = await authService.establishSession(credentials.email, credentials.password, async (principal, connection) => {
        persisting = true;
        await sessionStore.withLoginTransaction(connection, principal, async () => {
          await callbackPromise(req.session, 'regenerate');
          req.session.auth = { ...principal };
          req.session.csrfToken = randomBytes(32).toString('hex');
          await callbackPromise(req.session, 'save');
        });
      });
      res.set('Cache-Control', 'no-store');
      res.json({ success: true, user: account });
    } catch (error) {
      if (persisting) {
        // Prevent Express's response-time save from authenticating a failed or
        // uncertain login. unset:destroy tombstones this SID outside the failed TX.
        req.session = null;
        res.clearCookie('bdcs.sid', { httpOnly: true, secure: cookieSecure, sameSite: 'lax', path: '/' });
      }
      next(error);
    }
  });

  if (accountService) router.use(createAccountAdminRouter({ authService, accountService, frontendUrl }));
  if (bookingService) router.use(createBookingRouter({ authService, bookingService, frontendUrl }));
  if (donationService) router.use(createDonationRouter({ authService, donationService, frontendUrl }));
  if (releaseService) router.use(createReleaseRouter({ authService, releaseService, frontendUrl }));
  if (donorAdminService) router.use(createAdminDonorRouter({ authService, donorService: donorAdminService, frontendUrl }));

  router.get('/auth/me', currentAccount, (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json({ success: true, user: req.authAccount });
  });

  router.post('/auth/logout', csrf, currentAccount, async (req, res, next) => {
    try {
      await callbackPromise(req.session, 'destroy');
      res.clearCookie('bdcs.sid', { httpOnly: true, secure: cookieSecure, sameSite: 'lax', path: '/' });
      res.set('Cache-Control', 'no-store');
      res.json({ success: true, message: 'You have been signed out.' });
    } catch {
      next(new HttpError(503, 'SESSION_STORAGE_UNAVAILABLE', 'Session storage is unavailable.'));
    }
  });

  router.use('/donors/me', (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  router.get('/donors/me', currentAccount, requireRole('DONOR'), async (req, res, next) => {
    try {
      const profile = await authService.donorProfile(req.authAccount.accountId);
      if (!profile) throw new HttpError(503, 'DONOR_PROFILE_UNAVAILABLE', 'The donor profile is unavailable.');
      res.json({ success: true, profile });
    } catch (error) { next(error); }
  });

  router.patch('/donors/me', currentAccount, requireRole('DONOR'), csrf, async (req, res, next) => {
    try {
      if (!donorService) throw new HttpError(503, 'DONOR_PROFILE_UNAVAILABLE', 'The donor profile is unavailable.');
      const profile = await donorService.updateOwnProfile(req.authAccount.accountId, req.body, req.authSession);
      res.json({ success: true, profile });
    } catch (error) { next(error); }
  });

  // The store is exposed for future audited suspension/password operations.
  Object.defineProperty(router, 'sessionStore', { value: sessionStore, enumerable: false });
  return router;
}

export function createAuthRuntime({ databasePool = pool, env = process.env, frontendUrl = environment.frontendUrl } = {}) {
  const sessionConfig = readSessionConfig(env);
  const persistentSessions = sessionConfig.options
    ? createSessionMiddleware({ databasePool, config: sessionConfig.options })
    : null;
  if (!persistentSessions) return { middleware: null, router: unavailableRouter(), sessionStore: null };

  const sessionStore = persistentSessions.store;
  const repository = createAuthRepository(databasePool);
  const authService = createAuthService({ repository });
  const donorService = createDonorProfileService({ repository: createDonorRepository(databasePool) });
  const donorAdminService = createAdminDonorService({ repository: createAdminDonorRepository(databasePool) });
  const accountService = createAccountAdminService({ repository: createAccountAdminRepository(databasePool), sessionStore });
  const bookingService = createBookingService({ repository: createBookingRepository(databasePool) });
  const donationService = createDonationService({ repository: createDonationRepository(databasePool) });
  const releaseService = createReleaseService({ repository: createReleaseRepository(databasePool) });
  return {
    middleware: persistentSessions.middleware,
    router: createAuthRouter({ authService, donorService, donorAdminService, accountService, bookingService, donationService, releaseService, sessionStore, frontendUrl, cookieSecure: sessionConfig.options.cookieSecure }),
    sessionStore,
  };
}
