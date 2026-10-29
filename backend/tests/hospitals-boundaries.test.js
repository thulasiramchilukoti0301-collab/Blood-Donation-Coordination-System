import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createApp } from '../src/app.js';
import { createAuthRuntime } from '../src/modules/auth/router.js';

test('Hospital profile requires authentication and unrelated Hospital endpoints remain unmounted', async () => {
  const server = createApp({ verifyDatabase: async () => { throw new Error('No database access is allowed.'); },
    authRuntime: createAuthRuntime({ env: {} }) }).listen(0, '127.0.0.1');
  try {
    await new Promise((resolve) => server.once('listening', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    for (const [method, path] of [['GET', '/api/hospitals/me'], ['PATCH', '/api/hospitals/me'],
      ['GET', '/api/admin/hospitals'], ['GET', '/api/admin/hospitals/12'],
      ['GET', '/api/blood-groups'], ['GET', '/api/hospitals/me/requests'], ['POST', '/api/hospitals/me/requests'],
      ['GET', '/api/hospitals/me/requests/90'], ['GET', '/api/admin/requests'], ['GET', '/api/admin/requests/90']]) {
      const response = await fetch(`${base}${path}`, {
        method,
        headers: { 'Content-Type': 'application/json', 'X-Account-Id': '12', 'X-Role': 'HOSPITAL', Cookie: 'bdcs.sid=forged' },
        ...(method === 'PATCH' ? { body: JSON.stringify({ phone: '123' }) } : {}),
      });
      assert.equal(response.status, 401);
      assert.deepEqual(await response.json(), {
        success: false, error: { code: 'AUTHENTICATION_REQUIRED', message: 'Sign in to continue.' },
      });
      assert.equal(response.headers.get('set-cookie'), null);
    }
    for (const [method, path] of [
      ['POST', '/api/auth/register/admins'], ['PATCH', '/api/admin/hospitals/12'],
      ['GET', '/api/hospitals/me/reports/requests'],
    ]) {
      const response = await fetch(`${base}${path}`, {
        method, headers: { 'Content-Type': 'application/json', 'X-Account-Id': '12', 'X-Role': 'ADMIN', Cookie: 'session=forged' },
        ...(method !== 'GET' ? { body: JSON.stringify({ accountId: '12', account_id: '12', role: 'ADMIN', phone: '123' }) } : {}),
      });
      assert.equal(response.status, 404, `${method} ${path}`);
      assert.deepEqual(await response.json(), { success: false, error: { code: 'NOT_FOUND', message: 'API route not found.' } });
      assert.equal(response.headers.get('set-cookie'), null);
    }
    const registration = await fetch(`${base}/api/auth/register/hospitals`, { method: 'POST' });
    assert.equal(registration.status, 503);
    assert.equal((await registration.json()).error.code, 'AUTHENTICATION_NOT_CONFIGURED');
  } finally {
    server.closeAllConnections();
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
