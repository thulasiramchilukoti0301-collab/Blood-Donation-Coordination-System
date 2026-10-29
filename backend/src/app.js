import express from 'express';
import cors from 'cors';
import { environment } from './config/environment.js';
import { verifyDatabaseConnection } from './config/database.js';
import { createHealthRouter } from './routes/health.js';
import { errorHandler } from './middleware/errorHandler.js';
import { HttpError } from './utils/httpError.js';
import { createAuthRuntime } from './modules/auth/router.js';
import { createHospitalRouter } from './modules/hospitals/router.js';
import { createOperationalBloodRequestRouter } from './modules/blood-requests/runtime.js';
import { createOperationalAllocationReadRouter } from './modules/allocations/readRuntime.js';
import { createOperationalAuditReadRouter } from './modules/audit/readRuntime.js';

export function createApp({
  verifyDatabase = verifyDatabaseConnection,
  authRuntime = createAuthRuntime(),
  hospitalRouter = createHospitalRouter(),
  bloodRequestRouter = createOperationalBloodRequestRouter(),
  allocationReadRouter = createOperationalAllocationReadRouter(),
  auditReadRouter = createOperationalAuditReadRouter(),
} = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.use(cors({
    credentials: true,
    origin(origin, callback) {
      if (!origin || origin === environment.frontendUrl) return callback(null, true);
      callback(new HttpError(403, 'ORIGIN_NOT_ALLOWED', 'Request origin is not allowed.'));
    },
    methods: ['GET', 'HEAD', 'POST', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Accept', 'Content-Type', 'X-CSRF-Token'],
  }));
  app.use(express.json({ limit: '100kb' }));

  app.use('/api/health', createHealthRouter(verifyDatabase));
  if (authRuntime.middleware) app.use('/api', authRuntime.middleware);
  app.use('/api', authRuntime.router);
  app.use('/api', hospitalRouter);
  app.use('/api', bloodRequestRouter);
  app.use('/api', allocationReadRouter);
  app.use('/api', auditReadRouter);
  app.use((req, res, next) => next(new HttpError(404, 'NOT_FOUND', 'API route not found.')));
  app.use(errorHandler);
  return app;
}

export default createApp();
