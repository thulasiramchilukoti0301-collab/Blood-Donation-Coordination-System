import { HttpError } from '../utils/httpError.js';
import { sessionAuthorization } from '../modules/accounts/sessionAuthorization.js';

function destroySession(req) {
  return new Promise((resolve, reject) => {
    if (!req.session) return resolve();
    req.session.destroy((error) => error
      ? reject(new HttpError(503, 'SESSION_STORAGE_UNAVAILABLE', 'Session storage is unavailable.'))
      : resolve());
  });
}

export function requireCurrentAccount(authService) {
  return async function currentAccountGuard(req, res, next) {
    const claimed = req.session?.auth;
    if (!claimed || typeof claimed.accountId !== 'string' || !/^\d+$/u.test(claimed.accountId)) {
      return next(new HttpError(401, 'AUTHENTICATION_REQUIRED', 'Sign in to continue.'));
    }
    try {
      const authorization = sessionAuthorization(req.sessionID, claimed);
      const account = await authService.authorizeSession(authorization.sessionId, authorization.principal);
      const statusPermitted = account?.accountStatus === 'ACTIVE'
        || (account?.accountStatus === 'PENDING' && ['DONOR', 'HOSPITAL'].includes(account.role));
      if (!account || account.role !== claimed.role || account.accountStatus !== claimed.accountStatus || !statusPermitted) {
        await destroySession(req);
        return next(new HttpError(401, 'ACCOUNT_UNAVAILABLE', 'This account cannot use the current session. Sign in again if the account is active.'));
      }
      req.authAccount = account;
      Object.defineProperty(req, 'authSession', { value: authorization, enumerable: false });
      return next();
    } catch (error) {
      if (error?.status === 401 && error.code === 'ACCOUNT_UNAVAILABLE') {
        try { await destroySession(req); } catch (cleanupError) { return next(cleanupError); }
      }
      return next(error);
    }
  };
}

export function requireRole(...allowedRoles) {
  return function roleGuard(req, res, next) {
    if (!req.authAccount || !allowedRoles.includes(req.authAccount.role)) {
      return next(new HttpError(403, 'FORBIDDEN', 'You do not have access to this resource.'));
    }
    return next();
  };
}

export function requireActiveAccount(req, res, next) {
  if (!req.authAccount || req.authAccount.accountStatus !== 'ACTIVE') {
    return next(new HttpError(403, 'ACTIVE_ACCOUNT_REQUIRED', 'An active account is required for this operation.'));
  }
  return next();
}
