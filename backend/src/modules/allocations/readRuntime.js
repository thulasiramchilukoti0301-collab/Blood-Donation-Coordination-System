import { pool } from '../../config/database.js';
import { createAuthRepository } from '../auth/repository.js';
import { createAuthService } from '../auth/service.js';
import { createAllocationReadRepository } from './readRepository.js';
import { createAllocationReadService } from './readService.js';
import { createAllocationReadRouter } from './readRouter.js';
import { createAllocationMutationRepository } from './mutationRepository.js';
import { createAllocationMutationService } from './mutationService.js';
import { createRequestContextAdapter } from '../blood-requests/context.js';
import { createAuditWriter } from '../audit/writer.js';
import { environment } from '../../config/environment.js';

export function createOperationalAllocationReadRouter({ databasePool = pool } = {}) {
  const authService = createAuthService({ repository: createAuthRepository(databasePool) });
  const service = databasePool ? createAllocationReadService(createAllocationReadRepository(databasePool)) : null;
  const contextAdapter = createRequestContextAdapter({ enabled: true, reasonCodes: ['ALLOCATION_UPDATED', 'REQUEST_FULFILLED'] });
  const mutationRepository = databasePool ? createAllocationMutationRepository(databasePool, { contextAdapter }) : null;
  const mutationService = mutationRepository ? createAllocationMutationService({
    repository: mutationRepository,
    auditWriter: createAuditWriter({ allowedActionCodes: ['ALLOCATION_CREATED', 'ALLOCATION_ISSUED', 'HOSPITAL_REQUEST_STATUS_CHANGED'] }),
  }) : null;
  return createAllocationReadRouter({ authService, service, mutationService, frontendUrl: environment.frontendUrl });
}
