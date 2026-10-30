import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createReportsApi, normalizeReportFilters } from '../src/services/reports.js';

function fixture() {
  const calls = [];
  const client = { async get(path, options) { calls.push({ path, options }); return { data: { success: true } }; } };
  return { api: createReportsApi(client), calls };
}

test('initial and cleared report filters omit blank dates while retaining interval', async () => {
  const { api, calls } = fixture();
  await api.donations({ from: '', to: '', interval: 'DAY' });
  await api.requests({ from: '', to: '', interval: 'DAY' });
  assert.deepEqual(calls.map(({ options }) => options.params), [
    { interval: 'DAY' }, { interval: 'DAY' },
  ]);
  assert.deepEqual(normalizeReportFilters({ from: '  ', interval: 'WEEK' }), { interval: 'WEEK' });
});

test('report query keeps a supplied one-sided date and omits the blank side', async () => {
  const { api, calls } = fixture();
  await api.donations({ from: '2026-10-01', to: '', interval: 'WEEK' });
  await api.requests({ from: '', to: '2026-10-31', interval: 'MONTH' });
  assert.deepEqual(calls.map(({ options }) => options.params), [
    { from: '2026-10-01', interval: 'WEEK' },
    { to: '2026-10-31', interval: 'MONTH' },
  ]);
});

test('report query preserves complete date ranges and interval unchanged', async () => {
  const { api, calls } = fixture();
  const filters = { from: '2026-10-01', to: '2026-10-31', interval: 'MONTH' };
  await api.donations(filters);
  await api.requests(filters);
  assert.deepEqual(calls.map(({ options }) => options.params), [filters, filters]);
  assert.deepEqual(filters, { from: '2026-10-01', to: '2026-10-31', interval: 'MONTH' });
});

test('absent date fields stay absent and supplied date strings are preserved', () => {
  assert.deepEqual(normalizeReportFilters({ interval: 'DAY' }), { interval: 'DAY' });
  assert.deepEqual(normalizeReportFilters({ from: ' 2026-10-01 ', to: 42 }), { from: ' 2026-10-01 ', to: 42 });
});
