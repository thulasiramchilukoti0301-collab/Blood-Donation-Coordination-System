import { pool } from '../../config/database.js';
import { createAuthRepository } from '../auth/repository.js';
import { createAuthService } from '../auth/service.js';
import { createReportsRepository } from './repository.js';
import { createReportsRouter } from './router.js';

export function createOperationalReportsRouter({ databasePool = pool } = {}) {
  const authService = createAuthService({ repository: createAuthRepository(databasePool) });
  const service = databasePool ? createReportsRepository(databasePool) : null;
  return createReportsRouter({ authService, service });
}
