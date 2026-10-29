import { pool } from '../../config/database.js';
import { environment } from '../../config/environment.js';
import { createAuthService } from '../auth/service.js';
import { createAuthRepository } from '../auth/repository.js';
import { createAuditWriter } from '../audit/writer.js';
import { createBloodRequestRepository } from './repository.js';
import { createBloodRequestService } from './service.js';
import { createBloodRequestRouter } from './router.js';
import { createRequestContextAdapter } from './context.js';
import { serializeRequestTimestamp } from './timestamps.js';
import { isRequestableBloodGroup, requestAuditActions, requestTransitionReasons } from './contracts.js';

export function createOperationalBloodRequestRouter({ databasePool = pool, frontendUrl = environment.frontendUrl } = {}) {
  const authService = createAuthService({ repository: createAuthRepository(databasePool) });
  const service = databasePool ? createBloodRequestService({
    repository: createBloodRequestRepository(databasePool, {
      contextAdapter: createRequestContextAdapter({ enabled: true, reasonCodes: Object.values(requestTransitionReasons) }),
    }),
    auditWriter: createAuditWriter({ allowedActionCodes: requestAuditActions }),
    requestCreatedActionCode: 'HOSPITAL_REQUEST_CREATED', requestableBloodGroup: isRequestableBloodGroup,
    statusIntegration: { enabled: true, actionCode: 'HOSPITAL_REQUEST_STATUS_CHANGED', reasonCodes: ['REVIEW_STARTED'],
      authorizeTransition: async (_transaction, row, decision) => row.requestStatus === 'SUBMITTED' && decision === 'UNDER_REVIEW' },
    historyEnabled: true, timestampSerializer: serializeRequestTimestamp,
  }) : null;
  return createBloodRequestRouter({ authService, service, frontendUrl,
    // Registration is approved. Actual installed storage is checked on every call.
    readiness: { storageInstalled: true, readProjectionApproved: true, creationContractsApproved: true, lookupApproved: true,
      cancellationApproved: true, reviewApproved: true } });
}
