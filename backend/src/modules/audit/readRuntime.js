import { pool } from '../../config/database.js';
import { createAuthRepository } from '../auth/repository.js';
import { createAuthService } from '../auth/service.js';
import { createAuditReadRepository } from './readRepository.js';
import { createAuditReadService } from './readService.js';
import { createAuditReadRouter } from './readRouter.js';

export function createOperationalAuditReadRouter({ databasePool = pool } = {}) {
  const authService = createAuthService({ repository: createAuthRepository(databasePool) });
  const service = databasePool ? createAuditReadService(createAuditReadRepository(databasePool)) : null;
  return createAuditReadRouter({ authService, service });
}
