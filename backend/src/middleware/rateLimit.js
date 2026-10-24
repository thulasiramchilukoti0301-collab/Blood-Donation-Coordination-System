import { HttpError } from '../utils/httpError.js';

export function createRateLimiter({ limit = 5, windowMilliseconds = 15 * 60_000, maxKeys = 10_000, now = Date.now } = {}) {
  const clients = new Map();
  return function boundedRateLimit(req, res, next) {
    const key = typeof req.ip === 'string' && req.ip ? req.ip : 'unknown';
    const timestamp = now();
    let entry = clients.get(key);
    if (!entry || timestamp - entry.startedAt >= windowMilliseconds) {
      entry = { startedAt: timestamp, count: 0 };
      clients.delete(key);
      clients.set(key, entry);
    }
    entry.count += 1;
    if (clients.size > maxKeys) {
      for (const [candidate, value] of clients) {
        if (timestamp - value.startedAt >= windowMilliseconds || clients.size > maxKeys) clients.delete(candidate);
        if (clients.size <= maxKeys) break;
      }
    }
    if (entry.count > limit) {
      const retrySeconds = Math.max(1, Math.ceil((windowMilliseconds - (timestamp - entry.startedAt)) / 1000));
      res.set('Retry-After', String(retrySeconds));
      return next(new HttpError(429, 'RATE_LIMITED', 'Too many attempts. Wait before trying again.'));
    }
    return next();
  };
}
