import { api } from './api';
import { createBloodRequestApi } from './bloodRequestApi';

export const bloodRequests = createBloodRequestApi(api, { creationEnabled: true });
export const loadRequestBloodGroups = (options) => bloodRequests.groups(options);
