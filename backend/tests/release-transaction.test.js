import assert from 'node:assert/strict';
import { test } from 'node:test';
import { withAccountLocks } from '../src/modules/accounts/transaction.js';

function fixture({ commitFails = false, rollbackFails = false, workFails = false } = {}) {
  const state = { provisional: [], durable: [], released: 0, destroyed: 0, rolledBack: 0 };
  const connection = {
    async beginTransaction() {},
    async execute(sql) { if (sql.includes('FROM Account')) return [[{ accountId: '1', role: 'ADMIN', accountStatus: 'ACTIVE' }]];
      throw new Error('Unexpected query'); },
    async commit() { if (commitFails) throw new Error('Synthetic uncertain commit');
      state.durable = [...state.provisional]; },
    async rollback() { state.rolledBack++; if (rollbackFails) throw new Error('Synthetic rollback failure');
      state.provisional = []; },
    release() { state.released++; },
    destroy() { state.destroyed++; },
  };
  const database = { getConnection: async () => connection };
  const run = () => withAccountLocks(database, ['1', '10'], async () => {
    state.provisional.push('Donation release', 'BloodUnit', 'Donation audit', 'BloodUnit audit');
    if (workFails) throw new Error('Synthetic audit failure');
    return 'saved';
  });
  return { state, run };
}

test('shared release transaction wrapper returns only after commit and safe release', async () => {
  const f = fixture(); assert.equal(await f.run(), 'saved');
  assert.equal(f.state.durable.length, 4);
  assert.equal(f.state.released, 1); assert.equal(f.state.destroyed, 0);
});

test('audit failure rolls back all provisional rows; uncertain commit and cleanup never report saved', async () => {
  const failed = fixture({ workFails: true });
  await assert.rejects(failed.run(), error => error.code === 'DATABASE_UNAVAILABLE');
  assert.deepEqual(failed.state.durable, []); assert.deepEqual(failed.state.provisional, []);
  const unknown = fixture({ commitFails: true });
  await assert.rejects(unknown.run(), error => error.code === 'TRANSACTION_OUTCOME_UNKNOWN');
  assert.equal(unknown.state.rolledBack, 1);
  const cleanup = fixture({ workFails: true, rollbackFails: true });
  await assert.rejects(cleanup.run(), error => error.code === 'TRANSACTION_CLEANUP_FAILED');
  assert.equal(cleanup.state.released, 0); assert.equal(cleanup.state.destroyed, 1);
});
