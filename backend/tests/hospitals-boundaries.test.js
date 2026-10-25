import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createApp } from '../src/app.js';

test('Hospital endpoints remain unmounted even with forged identities or session cookies', async () => {
  const server = createApp({ verifyDatabase: async () => { throw new Error('No database access is allowed.'); } }).listen(0, '127.0.0.1');
  try {
    await new Promise((resolve) => server.once('listening', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    for (const [method, path] of [
      ['GET', '/api/hospitals/me'], ['PATCH', '/api/hospitals/me'],
      ['GET', '/api/admin/hospitals'], ['GET', '/api/admin/hospitals/12'],
      ['POST', '/api/auth/register/hospitals'], ['PATCH', '/api/admin/hospitals/12'],
    ]) {
      const response = await fetch(`${base}${path}`, {
        method, headers: { 'Content-Type': 'application/json', 'X-Account-Id': '12', 'X-Role': 'ADMIN', Cookie: 'session=forged' },
        ...(method !== 'GET' ? { body: JSON.stringify({ accountId: '12', account_id: '12', role: 'ADMIN', phone: '123' }) } : {}),
      });
      assert.equal(response.status, 404, `${method} ${path}`);
      assert.deepEqual(await response.json(), { success: false, error: { code: 'NOT_FOUND', message: 'API route not found.' } });
      assert.equal(response.headers.get('set-cookie'), null);
    }
  } finally {
    server.closeAllConnections();
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
