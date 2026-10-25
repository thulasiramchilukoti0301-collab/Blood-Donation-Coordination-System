import assert from 'node:assert/strict';
import { test } from 'node:test';
import axios from 'axios';
import { createHospitalApi } from '../src/services/hospitalApi.js';
import { accountHome } from '../src/features/auth/accountHome.js';

const profile = { hospitalId: '12', organizationName: 'Isolated test organization', accountStatus: 'PENDING' };
const registered = { success: true, accountId: '12', hospitalId: '12', accountStatus: 'PENDING', profile };

function clientWith(handle) {
  const calls = [];
  const client = axios.create({ withCredentials: true, adapter: async (config) => {
    calls.push(config);
    const result = await handle(config);
    return { status: 200, statusText: 'OK', headers: {}, config, ...result };
  } });
  return { client, calls, hospital: createHospitalApi(client) };
}

test('Hospital registration obtains CSRF and sends only approved fields without logging in', async () => {
  const { hospital, calls } = clientWith((config) => config.url === '/auth/csrf'
    ? { data: { success: true, csrfToken: 'a'.repeat(64) } } : { status: 201, data: registered });
  const values = { email: 'hospital@example.test', password: ' exact pass7! ', organizationName: 'Organization', registrationNumber: null,
    contactName: 'Contact', phone: '123', address: 'Address' };
  assert.deepEqual(await hospital.registerHospital({ ...values, accountId: '31', role: 'ADMIN', accountStatus: 'ACTIVE', updatedAt: 'forged' }), registered);
  assert.deepEqual(calls.map((config) => [config.method, config.url]), [['get', '/auth/csrf'], ['post', '/auth/register/hospitals']]);
  assert.deepEqual(JSON.parse(calls[1].data), values);
  assert.equal(calls[1].headers.get('X-CSRF-Token'), 'a'.repeat(64));
  assert.equal(calls[1].withCredentials, true);
});

test('Hospital mutation never proceeds with an invalid CSRF response', async () => {
  const { hospital, calls } = clientWith(() => ({ data: { success: true, csrfToken: 'invalid' } }));
  await assert.rejects(hospital.registerHospital({}), /security token/);
  await assert.rejects(hospital.updateHospitalProfile({ phone: '123' }), /security token/);
  assert.ok(calls.every((config) => config.method === 'get'));
});

test('registration accepts only confirmed HTTP 201/PENDING responses and matching string identities', async () => {
  for (const result of [{ status: 200, data: registered }, { status: 201, data: { ...registered, accountStatus: 'ACTIVE' } },
    { status: 201, data: { ...registered, hospitalId: '31' } }, { status: 201, data: { ...registered, profile: null } }]) {
    const { hospital } = clientWith((config) => config.url === '/auth/csrf'
      ? { data: { success: true, csrfToken: 'a'.repeat(64) } } : result);
    await assert.rejects(hospital.registerHospital({}), /could not be confirmed/);
  }
});

test('Hospital GET preserves abort signals and uses no browser-selected identity', async () => {
  const { hospital, calls } = clientWith(() => ({ data: { success: true, profile } }));
  const controller = new AbortController();
  assert.deepEqual(await hospital.getHospitalProfile({ signal: controller.signal, accountId: '31' }), profile);
  assert.equal(calls[0].url, '/hospitals/me');
  assert.equal(calls[0].signal, controller.signal);
  assert.equal(calls[0].params, undefined);
});

test('Hospital PATCH fetches fresh CSRF and filters every read-only/identity property', async () => {
  let tokens = 0;
  const { hospital, calls } = clientWith((config) => config.url === '/auth/csrf'
    ? { data: { success: true, csrfToken: (++tokens === 1 ? 'a' : 'b').repeat(64) } }
    : { data: { success: true, profile } });
  await hospital.updateHospitalProfile({ phone: '123', organizationName: 'forged', registrationNumber: 'forged', accountId: '31', role: 'ADMIN' });
  await hospital.updateHospitalProfile({ address: 'Changed' });
  assert.deepEqual(calls.map((config) => config.url), ['/auth/csrf', '/hospitals/me', '/auth/csrf', '/hospitals/me']);
  assert.deepEqual(JSON.parse(calls[1].data), { phone: '123' });
  assert.deepEqual(JSON.parse(calls[3].data), { address: 'Changed' });
  assert.equal(calls[1].headers.get('X-CSRF-Token'), 'a'.repeat(64));
  assert.equal(calls[3].headers.get('X-CSRF-Token'), 'b'.repeat(64));
  assert.equal(calls[1].withCredentials, true);
});

test('empty PATCH and malformed success envelopes do not fabricate saved data', async () => {
  const { hospital, calls } = clientWith(() => ({ data: { success: false } }));
  await assert.rejects(hospital.updateHospitalProfile({ accountId: '31' }), /Change a contact/);
  assert.equal(calls.length, 0);
  await assert.rejects(hospital.getHospitalProfile(), /could not be confirmed/);
  const missing = clientWith(() => ({ data: { success: true, profile: null } }));
  assert.equal(await missing.hospital.getHospitalProfile(), null);
});

test('safe backend conflicts and session errors propagate to existing frontend error handling', async () => {
  for (const [status, code] of [[409, 'EMAIL_CONFLICT'], [409, 'HOSPITAL_REGISTRATION_CONFLICT'], [401, 'ACCOUNT_UNAVAILABLE'], [403, 'CSRF_TOKEN_INVALID']]) {
    const failure = Object.assign(new Error('Isolated HTTP failure'), { response: { status, data: { error: { code, message: 'Safe message.' } } } });
    const { hospital } = clientWith((config) => {
      if (config.url === '/auth/csrf') return { data: { success: true, csrfToken: 'a'.repeat(64) } };
      throw failure;
    });
    await assert.rejects(hospital.registerHospital({}), (error) => error === failure);
  }
});

test('role landing routes Hospital and ACTIVE Admin while preserving Donor and status destinations', () => {
  assert.equal(accountHome({ role: 'HOSPITAL', accountStatus: 'PENDING' }), '/hospital/profile');
  assert.equal(accountHome({ role: 'HOSPITAL', accountStatus: 'ACTIVE' }), '/hospital/profile');
  assert.equal(accountHome({ role: 'DONOR' }), '/donor/profile');
  assert.equal(accountHome({ role: 'ADMIN' }), '/account/status');
  assert.equal(accountHome({ role: 'ADMIN', accountStatus: 'ACTIVE' }), '/admin/hospitals');
});

test('Admin Hospital list sends only approved query filters using credentialed GET', async () => {
  const payload = { hospitals: [profile], pagination: { page: 2, pageSize: 20, total: 21 } };
  const { hospital, calls } = clientWith(() => ({ data: { success: true, ...payload } }));
  const controller = new AbortController();
  assert.deepEqual(await hospital.listAdminHospitals({ search: '50% hospital', accountStatus: 'PENDING', page: 2,
    role: 'ADMIN', accountId: '31', pageSize: 100 }, { signal: controller.signal }), payload);
  assert.equal(calls[0].url, '/admin/hospitals');
  assert.equal(calls[0].method, 'get');
  assert.equal(calls[0].withCredentials, true);
  assert.equal(calls[0].signal, controller.signal);
  assert.deepEqual(calls[0].params, { search: '50% hospital', accountStatus: 'PENDING', page: 2 });
});

test('Admin detail preserves unsigned BIGINT strings and rejects invalid IDs before any request', async () => {
  const { hospital, calls } = clientWith(() => ({ data: { success: true, profile } }));
  for (const id of ['', '0', '01', '-1', '1 OR 1=1', '18446744073709551616', 12, null]) {
    await assert.rejects(hospital.getAdminHospitalProfile(id), /valid Hospital/);
  }
  assert.equal(calls.length, 0);
  assert.deepEqual(await hospital.getAdminHospitalProfile('18446744073709551615'), profile);
  assert.equal(calls[0].url, '/admin/hospitals/18446744073709551615');
  assert.equal(calls[0].method, 'get');
});

test('Admin list/detail malformed envelopes fail without invented records or request summaries', async () => {
  for (const data of [{ success: true, hospitals: [], pagination: { page: 1, pageSize: 100, total: 0 } },
    { success: true, hospitals: [], pagination: { page: 0, pageSize: 20, total: -1 } }, { success: true, hospitals: null }]) {
    const { hospital } = clientWith(() => ({ data }));
    await assert.rejects(hospital.listAdminHospitals(), /could not be confirmed/);
    await assert.rejects(hospital.getAdminHospitalProfile('12'), /could not be confirmed/);
  }
});
