import { api } from './api';
import { createReleaseApi, inventoryMutation as sendInventoryMutation, releaseMutation as sendMutation } from './releaseContracts';

export const releaseApi = createReleaseApi(api);
export const releaseMutation = (captured, current, signal) => sendMutation(captured, current, signal, api);
export const inventoryMutation = (kind, captured, current, signal) => sendInventoryMutation(kind, captured, current, signal, api);
