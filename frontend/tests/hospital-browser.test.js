import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';

const frontendRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const tempRoot = resolve(frontendRoot, '.tmp', 'hospital-browser-tests');
const browser = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
].find(existsSync);

async function browserDom(url, width, profileDirectory) {
  return new Promise((resolveResult, reject) => {
    // Many isolated mount/navigation scenarios intentionally exceed Chrome's
    // rapid history IPC limit. Disable that test-driver throttle in this fresh
    // temporary profile; production routing and every assertion stay unchanged.
    const child = spawn(browser, ['--headless=new', '--no-sandbox', '--disable-gpu', '--disable-extensions', '--disable-ipc-flooding-protection',
      '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--disable-sync',
      '--host-resolver-rules=MAP fonts.googleapis.com ~NOTFOUND, MAP fonts.gstatic.com ~NOTFOUND',
      '--dump-dom', '--virtual-time-budget=25000', `--window-size=${width},1100`,
      `--user-data-dir=${profileDirectory}`, url], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    let errors = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error('Isolated Chrome browser exceeded 55 seconds.')); }, 55000);
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { output += chunk; });
    child.stderr.on('data', (chunk) => { errors += chunk; });
    child.on('error', (error) => { clearTimeout(timer); reject(error); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) reject(new Error(`Isolated browser exited ${code}: ${errors.slice(-600)}`));
      else resolveResult(output);
    });
  });
}

test('real browser Admin management, Hospital registration/Profile and shared auth work at desktop/mobile sizes', { timeout: 120000 }, async () => {
  assert.ok(browser, 'An installed Chrome or Edge executable is required for the isolated browser tests.');
  const server = await createServer({ root: frontendRoot, configFile: false, envDir: false, plugins: [react()],
    server: { host: '127.0.0.1', port: 0, hmr: false }, logLevel: 'error' });
  await server.listen();
  const address = server.httpServer.address();
  await mkdir(tempRoot, { recursive: true });
  try {
    for (const width of [1280, 768, 390, 337]) {
      const profileDirectory = await mkdtemp(resolve(tempRoot, 'profile-'));
      try {
        const target = new URL(`http://127.0.0.1:${address.port}/tests/browser/index.html`);
        if (width < 1000) target.searchParams.set('frame', width);
        const output = await browserDom(target.href, width < 1000 ? 1100 : width, profileDirectory);
        const raw = output.match(/<pre id="hospital-test-result"[^>]*>([\s\S]*?)<\/pre>/u)?.[1];
        assert.ok(raw, 'Browser emitted an isolated test report.');
        const result = JSON.parse(raw.replace(/&quot;/gu, '"').replace(/&lt;/gu, '<').replace(/&gt;/gu, '>').replace(/&amp;/gu, '&'));
        assert.equal(result.done, true, 'Browser scenarios completed.');
        if (width < 1000) assert.equal(result.width, width, 'Responsive checks use the actual requested iframe viewport.');
        assert.equal(result.passed, true, `${width}px browser failures: ${JSON.stringify(result.results.filter((item) => !item.passed))}`);
        assert.ok(result.checks >= 60, 'Browser exercised DOM, requests, auth boundaries and styles.');
        console.log(`Hospital browser ${result.width}px (${result.clientWidth}px content): ${result.results.length} scenarios, ${result.checks} assertions passed.`);
      } finally {
        // Resolve and validate before recursive cleanup; never touch user profiles.
        const target = resolve(profileDirectory);
        const within = relative(tempRoot, target);
        assert.ok(within && !within.startsWith('..') && !isAbsolute(within), 'Cleanup target remains inside the explicit workspace test root.');
        await rm(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
      }
    }
  } finally { await server.close(); }
});
