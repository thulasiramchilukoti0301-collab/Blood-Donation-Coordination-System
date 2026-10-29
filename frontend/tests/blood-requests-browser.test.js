import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { resolve, relative, isAbsolute, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const tempRoot = resolve(root, '.tmp', 'request-browser-tests');
const browser = ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'].find(existsSync);
function launch(url, profile, width, screenshot) {
  return new Promise((resolveResult, reject) => {
    const child = spawn(browser, ['--headless=new', '--no-sandbox', '--disable-gpu', '--disable-extensions', '--disable-ipc-flooding-protection', '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--disable-sync',
      '--host-resolver-rules=MAP fonts.googleapis.com ~NOTFOUND, MAP fonts.gstatic.com ~NOTFOUND', '--dump-dom', '--virtual-time-budget=30000', `--window-size=${width},1300`, `--user-data-dir=${profile}`, ...(screenshot ? [`--screenshot=${screenshot}`] : []), url], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    const timeout = setTimeout(() => { child.kill(); reject(new Error('Browser exceeded 55 seconds')); }, 55000);
    child.stdout.on('data', (data) => { stdout += data; }); child.stderr.on('data', (data) => { stderr += data; });
    child.on('error', (error) => { clearTimeout(timeout); reject(error); });
    child.on('close', (code) => { clearTimeout(timeout); code === 0 ? resolveResult(stdout) : reject(new Error(stderr.slice(-1000))); });
  });
}
test('Sky Pipeline routes, API integration, access, stale responses, accessibility and responsive layouts in a real browser', { timeout: 240000 }, async () => {
  assert.ok(browser, 'Installed Chrome or Edge required');
  const server = await createServer({ root, configFile: false, envDir: false, plugins: [react()], logLevel: 'error', server: { host: '127.0.0.1', port: 0, hmr: false } });
  await server.listen();
  await mkdir(tempRoot, { recursive: true });
  async function run(width, preview) {
    const profile = await mkdtemp(resolve(tempRoot, 'profile-'));
    try {
      const url = new URL(`http://127.0.0.1:${server.httpServer.address().port}/tests/browser/requests.html`);
      if (width < 1000) url.searchParams.set('frame', width);
      if (preview) url.searchParams.set('preview', preview);
      const screenshot = preview ? resolve(tempRoot, `${preview}-${width}.png`) : undefined;
      return await launch(url.href, profile, Math.max(width, 1100), screenshot);
    } finally {
      const resolved = resolve(profile); const within = relative(tempRoot, resolved);
      assert.ok(within && !within.startsWith('..') && !isAbsolute(within), 'Cleanup remains inside explicit test directory');
      await rm(resolved, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  }
  try {
    for (const width of [1280, 768, 390, 337]) {
      const output = await run(width);
      const raw = output.match(/<pre id="request-test-result"[^>]*>([\s\S]*?)<\/pre>/u)?.[1];
      assert.ok(raw, 'Browser produced report');
      const result = JSON.parse(raw.replaceAll('&quot;', '"').replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&amp;', '&'));
      assert.equal(result.done, true);
      if (width < 1000) assert.equal(result.width, width);
      else assert.ok(result.width >= 1000, 'Desktop browser viewport');
      assert.equal(result.passed, true, JSON.stringify(result.results.filter((item) => !item.passed)));
      assert.ok(result.checks > 80);
      console.log(`Sky Pipeline ${result.width}px: ${result.results.length} scenarios, ${result.checks} assertions passed`);
    }
    if (process.env.FEATURE7_CAPTURE === 'YES') for (const width of [1280, 390]) for (const screen of ['create', 'list', 'detail', 'admin']) await run(width, screen);
  } finally { await server.close(); }
});
