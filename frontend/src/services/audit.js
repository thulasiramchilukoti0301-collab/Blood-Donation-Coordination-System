import { api } from './api';
import { createAuditApi } from './auditApi';

export const auditApi = createAuditApi(api);
