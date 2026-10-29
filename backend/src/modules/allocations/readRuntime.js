import { pool } from '../../config/database.js';
import { createAuthRepository } from '../auth/repository.js';
import { createAuthService } from '../auth/service.js';
import { createAllocationReadRepository } from './readRepository.js';
import { createAllocationReadService } from './readService.js';
import { createAllocationReadRouter } from './readRouter.js';

export function createOperationalAllocationReadRouter({ databasePool = pool } = {}) {
  const authService = createAuthService({ repository: createAuthRepository(databasePool) });
  const service = databasePool ? createAllocationReadService(createAllocationReadRepository(databasePool)) : null;
  return createAllocationReadRouter({ authService, service });
}
