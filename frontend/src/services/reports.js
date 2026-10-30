import { api } from './api.js';

export function normalizeReportFilters(filters = {}) {
  const params = { ...filters };
  for (const key of ['from', 'to']) {
    if (typeof params[key] === 'string' && params[key].trim() === '') delete params[key];
  }
  return params;
}

export function createReportsApi(client = api) {
  return {
    adminDashboard: async ({ signal } = {}) => (await client.get('/admin/dashboard', { signal })).data,
    hospitalDashboard: async ({ signal } = {}) => (await client.get('/hospitals/me/dashboard', { signal })).data,
    inventory: async ({ signal } = {}) => (await client.get('/admin/reports/inventory', { signal })).data,
    donations: async (filters, { signal } = {}) => (await client.get('/admin/reports/donations', { params: normalizeReportFilters(filters), signal })).data,
    requests: async (filters, { signal } = {}) => (await client.get('/admin/reports/requests', { params: normalizeReportFilters(filters), signal })).data,
  };
}

export const reportsApi = createReportsApi(api);
