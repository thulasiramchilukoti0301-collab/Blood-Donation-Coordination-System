const registrationFields = ['email', 'password', 'organizationName', 'registrationNumber', 'contactName', 'phone', 'address'];
const contactFields = ['contactName', 'phone', 'address'];

function selectFields(values, fields) {
  return Object.fromEntries(fields.filter((field) => Object.hasOwn(values, field)).map((field) => [field, values[field]]));
}

export function createHospitalApi(client) {
  async function csrfConfig(signal) {
    const { data } = await client.get('/auth/csrf', { signal });
    if (!data?.success || typeof data.csrfToken !== 'string' || !/^[a-f0-9]{64}$/u.test(data.csrfToken)) {
      throw new Error('Could not verify the security token. Please try again.');
    }
    return { signal, headers: { 'X-CSRF-Token': data.csrfToken } };
  }

  return {
    async registerHospital(values, { signal } = {}) {
      const config = await csrfConfig(signal);
      const { status, data } = await client.post('/auth/register/hospitals', selectFields(values, registrationFields), config);
      if (status !== 201 || data?.success !== true || data.accountStatus !== 'PENDING'
        || typeof data.accountId !== 'string' || data.hospitalId !== data.accountId
        || data.profile?.hospitalId !== data.accountId || data.profile?.accountStatus !== 'PENDING'
        || typeof data.profile?.organizationName !== 'string') {
        throw new Error('The registration response could not be confirmed. Check your account before submitting again.');
      }
      return data;
    },
    async getHospitalProfile({ signal } = {}) {
      const { data } = await client.get('/hospitals/me', { signal });
      if (data?.success !== true) throw new Error('The Hospital profile response could not be confirmed.');
      return data.profile ?? null;
    },
    async updateHospitalProfile(patch, { signal } = {}) {
      const values = selectFields(patch, contactFields);
      if (!Object.keys(values).length) throw new Error('Change a contact detail before saving.');
      const config = await csrfConfig(signal);
      const { data } = await client.patch('/hospitals/me', values, config);
      if (data?.success !== true || !data.profile) throw new Error('The saved profile response could not be confirmed. Refresh to check your details.');
      return data.profile;
    },
    async listAdminHospitals(query = {}, { signal } = {}) {
      const params = selectFields(query, ['search', 'accountStatus', 'page']);
      const { data } = await client.get('/admin/hospitals', { params, signal });
      const pagination = data?.pagination;
      if (data?.success !== true || !Array.isArray(data.hospitals) || !pagination
        || !Number.isSafeInteger(pagination.page) || pagination.page < 1 || pagination.pageSize !== 20
        || !Number.isSafeInteger(pagination.total) || pagination.total < 0) {
        throw new Error('The Hospital list response could not be confirmed. Please try again.');
      }
      return { hospitals: data.hospitals, pagination };
    },
    async getAdminHospitalProfile(hospitalId, { signal } = {}) {
      if (typeof hospitalId !== 'string' || !/^[1-9][0-9]{0,19}$/u.test(hospitalId)
        || BigInt(hospitalId) > 18446744073709551615n) {
        throw new Error('Choose a valid Hospital record.');
      }
      const { data } = await client.get(`/admin/hospitals/${encodeURIComponent(hospitalId)}`, { signal });
      if (data?.success !== true || !data.profile) throw new Error('The Hospital detail response could not be confirmed.');
      return data.profile;
    },
  };
}
