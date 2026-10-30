import { api } from './api';
import { createAllocationMutationApi } from './allocationMutationApi';

export const allocationMutations = createAllocationMutationApi(api);
