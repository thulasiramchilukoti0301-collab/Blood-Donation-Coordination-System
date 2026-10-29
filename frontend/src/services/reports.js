import { api } from './api';

export const reportsApi = {
  adminDashboard: async ({ signal } = {}) => (await api.get('/admin/dashboard', { signal })).data,
  hospitalDashboard: async ({ signal } = {}) => (await api.get('/hospitals/me/dashboard', { signal })).data,
  inventory: async ({ signal } = {}) => (await api.get('/admin/reports/inventory', { signal })).data,
  donations: async (filters, { signal } = {}) => (await api.get('/admin/reports/donations', { params: filters, signal })).data,
  requests: async (filters, { signal } = {}) => (await api.get('/admin/reports/requests', { params: filters, signal })).data,
};
