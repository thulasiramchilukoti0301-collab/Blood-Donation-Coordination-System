import { api } from './api';
import { createAllocationReadApi } from './allocationReadApi';

export const allocationReads = createAllocationReadApi(api);
