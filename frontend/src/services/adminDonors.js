import { api } from './api.js';
import { bookingMutation } from './bookingApi.js';
import { readAdminDonor, readAdminDonorPage } from '../features/donors/adminDonors.js';

export function createAdminDonorApi(client = api) {
  return {
    async list(filters, page, { signal } = {}) {
      const apiClient = client;
      const params = { page, ...(filters.search ? { search: filters.search } : {}),
        ...(filters.accountStatus !== 'ANY' ? { accountStatus: filters.accountStatus } : {}),
        ...(filters.bloodGroupId ? { bloodGroupId: filters.bloodGroupId, groupMatch: filters.groupMatch } : {}) };
      const { status, data } = await apiClient.get('/admin/donors', { params, signal });
      const result = status === 200 && data?.success === true ? readAdminDonorPage(data, page) : null;
      if (!result) throw new Error('Donor list response could not be confirmed.');
      return result;
    },
    async detail(donorId, { signal } = {}) {
      const apiClient = client;
      const { status, data } = await apiClient.get(`/admin/donors/${encodeURIComponent(donorId)}`, { signal });
      const result = status === 200 && data?.success === true ? readAdminDonor(data.donor, donorId) : null;
      if (!result) throw new Error('Donor detail response could not be confirmed.');
      return result;
    },
    async update(confirmation, { signal, isCurrent } = {}) {
      const apiClient = client;
      const { donor, patch, originalValues, reasonCode } = confirmation;
      const body = { ...patch, ...(Object.hasOwn(patch, 'area') && patch.area === '' ? { area: null } : {}),
        originalValues, reasonCode };
      const expected = data => {
        const saved = readAdminDonor(data.donor, donor.donorId);
        if (!saved) return false;
        return Object.entries(patch).every(([field, value]) => field === 'confirmedBloodGroupId'
          ? saved.confirmedBloodGroup?.bloodGroupId === value
          : field === 'area' ? saved.area === (value === '' ? null : value) : saved[field] === value);
      };
      const data = await bookingMutation({ method: 'PATCH', path: `/admin/donors/${encodeURIComponent(donor.donorId)}`,
        body, expected, signal, isCurrent }, apiClient);
      return readAdminDonor(data.donor, donor.donorId);
    },
  };
}
const donorApi = createAdminDonorApi();
export const listAdminDonors = (...args) => donorApi.list(...args);
export const getAdminDonor = (...args) => donorApi.detail(...args);
export const updateAdminDonor = (...args) => donorApi.update(...args);
