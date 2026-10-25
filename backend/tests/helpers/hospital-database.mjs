import assert from 'node:assert/strict';
import bcrypt from 'bcrypt';

export const testPassword = 'hospital test7!';
const passwordHash = bcrypt.hashSync(testPassword, 4);

// Test-only mysql2-shaped dependency. It has no network or filesystem access.
// Unexpected statements fail instead of reaching any real database.
export function hospitalDatabase() {
  const accounts = new Map([
    ['12', { accountId: '12', role: 'HOSPITAL', accountStatus: 'PENDING' }],
    ['9007199254740993', { accountId: '9007199254740993', role: 'HOSPITAL', accountStatus: 'ACTIVE' }],
    ['14', { accountId: '14', role: 'HOSPITAL', accountStatus: 'ACTIVE' }],
    ['21', { accountId: '21', role: 'DONOR', accountStatus: 'ACTIVE' }],
    ['31', { accountId: '31', role: 'ADMIN', accountStatus: 'ACTIVE' }],
  ]);
  const profiles = new Map(['12', '9007199254740993'].map((id) => [id, {
    hospitalId: id, organizationName: `Isolated Hospital ${id}`, registrationNumber: null,
    contactName: 'Test contact', phone: '+91 12345', address: 'Test address',
    createdAt: new Date('2026-10-24T04:30:00.000Z'), updatedAt: new Date('2026-10-24T04:30:00.000Z'),
  }]));
  const sessions = new Map();
  const calls = [];
  const transactions = { begun: 0, committed: 0, rolledBack: 0, released: 0 };
  const database = {
    accounts, profiles, sessions, calls, transactions, failSql: null, beforeTransaction: null,
    async execute(sql, values = []) {
      const query = sql.replace(/\s+/gu, ' ').trim();
      calls.push({ sql: query, values: [...values] });
      if (database.failSql?.(query)) throw new Error('private-driver-detail SELECT password_hash');

      if (query.startsWith('SELECT session_data,')) return [[sessions.get(values[0])].filter(Boolean)];
      if (query.startsWith('INSERT INTO app_session')) {
        const [id, expiresAt, data] = values;
        const row = sessions.get(id);
        if (query.includes('VALUES (?, ?, NULL, ?)')) {
          sessions.set(id, { expires_at: row?.expires_at ?? expiresAt, session_data: null,
            revoked_at: row?.revoked_at ?? data });
        } else if (!row || (row.revoked_at === null && row.expires_at > values[4])) {
          sessions.set(id, { expires_at: expiresAt, session_data: data, revoked_at: null });
        }
        return [{ affectedRows: 1 }];
      }
      if (query.startsWith('UPDATE app_session SET expires_at')) {
        const [expiresAt, id, now] = values;
        const row = sessions.get(id);
        if (row?.revoked_at === null && row.expires_at > now) row.expires_at = expiresAt;
        return [{ affectedRows: 1 }];
      }
      if (query.includes('FROM Account WHERE email = ?')) {
        const account = [...accounts.values()].find(({ accountId }) => `${accountId}@example.test` === values[0]);
        return [account ? [{ account_id: account.accountId, role: account.role,
          account_status: account.accountStatus, password_hash: passwordHash }] : []];
      }
      if (query.includes('FROM Account WHERE account_id = ?')) {
        const account = accounts.get(values[0]);
        return [account ? [query.includes('AS accountId') ? { ...account } : {
          account_id: account.accountId, role: account.role, account_status: account.accountStatus,
        }] : []];
      }
      if (query.includes('FROM Hospital h JOIN Account')) {
        const profile = profiles.get(values[0]);
        const account = accounts.get(values[0]);
        return [profile && account?.role === 'HOSPITAL'
          ? [{ ...profile, accountStatus: account.accountStatus }] : []];
      }
      if (query.startsWith('UPDATE Hospital SET')) {
        const profile = profiles.get(values.at(-1));
        const columns = { contact_name: 'contactName', phone: 'phone', address: 'address' };
        const fields = [...query.matchAll(/\b(contact_name|phone|address) = \?/gu)];
        assert.ok(fields.length > 0);
        if (profile) {
          fields.forEach((match, index) => { profile[columns[match[1]]] = values[index]; });
          profile.updatedAt = new Date('2026-10-25T04:30:00.000Z');
        }
        return [{ affectedRows: profile ? 1 : 0 }];
      }
      throw new Error(`Unexpected isolated-test statement: ${query}`);
    },
    async getConnection() {
      let snapshot;
      return {
        execute: database.execute,
        async beginTransaction() {
          database.beforeTransaction?.();
          snapshot = structuredClone(profiles);
          transactions.begun += 1;
        },
        async commit() { transactions.committed += 1; },
        async rollback() {
          profiles.clear();
          for (const [id, profile] of snapshot) profiles.set(id, profile);
          transactions.rolledBack += 1;
        },
        release() { transactions.released += 1; },
      };
    },
  };
  return database;
}
