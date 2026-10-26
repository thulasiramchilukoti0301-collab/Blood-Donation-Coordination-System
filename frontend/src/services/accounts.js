import { api } from './api';
import { createAccountApprovalApi } from './accountApprovalApi';

export const { listAccounts, approveAccount } = createAccountApprovalApi(api);
