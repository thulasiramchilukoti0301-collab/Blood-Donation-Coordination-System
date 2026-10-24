import { randomBytes } from 'node:crypto';
import express from 'express';
import { createAuthRepository } from './repository.js';
import { createAuthService } from './service.js';
import { validateDonorRegistration, validateLogin } from './validation.js';
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
      || (req.method === 'POST' && ['/auth/register/donors', '/auth/login', '/auth/logout'].includes(req.path));
    if (!supported) return next();
    return next(new HttpError(
      503,
      'AUTHENTICATION_NOT_CONFIGURED',
      'Authentication is unavailable. Configure the database, session secret, and session table.',
    ));
  });
  return router;
}

export function createAuthRouter({ authService, sessionStore, frontendUrl = environment.frontendUrl, cookieSecure = false }) {
  const router = express.Router();
  const csrf = requireTrustedOriginAndCsrf(frontendUrl);
  const loginLimiter = createRateLimiter();
  const registrationLimiter = createRateLimiter();
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

  router.post('/auth/login', loginLimiter, csrf, async (req, res, next) => {
    try {
      const credentials = validateLogin(req.body);
      const account = await authService.authenticate(credentials.email, credentials.password);
      await callbackPromise(req.session, 'regenerate');
      req.session.auth = { accountId: account.accountId, role: account.role };
      req.session.csrfToken = randomBytes(32).toString('hex');
      await callbackPromise(req.session, 'save');
      res.set('Cache-Control', 'no-store');
      res.json({ success: true, user: account });
    } catch (error) {
      if (error?.code === 'SESSION_STORAGE_UNAVAILABLE') return next(error);
      next(error);
    }
  });

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

  router.get('/donors/me', currentAccount, requireRole('DONOR'), async (req, res, next) => {
    try {
      const profile = await authService.donorProfile(req.authAccount.accountId);
      if (!profile) throw new HttpError(503, 'DONOR_PROFILE_UNAVAILABLE', 'The donor profile is unavailable.');
      res.set('Cache-Control', 'no-store');
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
  return {
    middleware: persistentSessions.middleware,
    router: createAuthRouter({ authService, sessionStore, frontendUrl, cookieSecure: sessionConfig.options.cookieSecure }),
    sessionStore,
  };
}
