import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { resolve, relative, isAbsolute, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..'); const tempRoot = resolve(root, '.tmp', 'audit-browser-tests');
const browser = ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'].find(existsSync);
function launch(url, profile, width) { return new Promise((resolveOutput, reject) => {
  const child = spawn(browser, ['--headless=new', '--no-sandbox', '--disable-gpu', '--disable-extensions', '--no-first-run', '--disable-background-networking', '--host-resolver-rules=MAP fonts.googleapis.com ~NOTFOUND, MAP fonts.gstatic.com ~NOTFOUND', '--dump-dom', '--virtual-time-budget=18000', `--window-size=${width},1300`, `--user-data-dir=${profile}`, url], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '', stderr = ''; const timeout = setTimeout(() => { child.kill(); reject(new Error('Browser exceeded 35 seconds')); }, 35000);
  child.stdout.on('data', (chunk) => { stdout += chunk; }); child.stderr.on('data', (chunk) => { stderr += chunk; });
  child.on('error', reject); child.on('close', (code) => { clearTimeout(timeout); code === 0 ? resolveOutput(stdout) : reject(new Error(stderr.slice(-1000))); });
}); }
test('Feature 9 Admin Audit Log supports filters, retry, pagination and responsive access checks', { timeout: 180000 }, async () => {
  assert.ok(browser, 'Installed Chrome or Edge required');
  const server = await createServer({ root, configFile: false, envDir: false, plugins: [react()], logLevel: 'error', server: { host: '127.0.0.1', port: 0, hmr: false } });
  await server.listen(); await mkdir(tempRoot, { recursive: true });
  try { for (const width of [1280, 768, 390]) {
    const profile = await mkdtemp(resolve(tempRoot, 'profile-'));
    try {
      const url = `http://127.0.0.1:${server.httpServer.address().port}/tests/browser/audit.html`;
      const output = await launch(url, profile, width); const raw = output.match(/<pre id="audit-test-result"[^>]*>([\s\S]*?)<\/pre>/u)?.[1];
      assert.ok(raw, `Browser report at ${width}px`); const result = JSON.parse(raw.replaceAll('&quot;', '"').replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&amp;', '&'));
      assert.equal(result.done, true); assert.equal(result.passed, true, JSON.stringify(result.results));
      if (width === 768) assert.ok(result.width >= 620 && result.width < 900, 'Tablet viewport');
      if (width === 390) assert.ok(result.width >= 320 && result.width < 620, 'Mobile viewport');
      if (width === 1280) assert.ok(result.width >= 1000, 'Desktop viewport');
      console.log(`Feature 9 browser ${result.width}px: ${result.checks} assertions passed`);
    } finally { const within = relative(tempRoot, resolve(profile)); assert.ok(within && !within.startsWith('..') && !isAbsolute(within)); await rm(resolve(profile), { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); }
  } } finally { await server.close(); }
});
