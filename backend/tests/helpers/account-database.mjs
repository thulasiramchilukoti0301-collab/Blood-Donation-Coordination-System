import assert from 'node:assert/strict';
import bcrypt from 'bcrypt';

export const approvalPassword = 'approval test7!';
const passwordHash = bcrypt.hashSync(approvalPassword, 4);
const privateFailure = () => new Error('PRIVATE SQL connection password_hash');

// SQL-shaped, in-memory test dependency. No mysql2/config/network imports.
// Row locks and staged transaction writes permit controlled interleavings.
export function accountDatabase() {
  const accounts = new Map([
    ['1', 'ADMIN', 'ACTIVE'], ['30', 'ADMIN', 'ACTIVE'], ['10', 'DONOR', 'PENDING'],
    ['20', 'HOSPITAL', 'PENDING'], ['11', 'DONOR', 'ACTIVE'], ['12', 'HOSPITAL', 'SUSPENDED'],
  ].map(([accountId, role, accountStatus]) => [accountId, { accountId, email: `${accountId}@example.test`,
    role, accountStatus, passwordHash, createdAt: '2026-10-26 09:00:00' }]));
  const sessions = new Map();
  const donors = new Map(['10', '11'].map(id => [id, { fullName: 'Disposable Donor', phone: '123', address: 'Test address', area: null }]));
  const hospitals = new Map(['20', '12'].map(id => [id, { hospitalId: id, organizationName: 'Disposable Hospital', registrationNumber: null,
    contactName: 'Test contact', phone: '123', address: 'Test address', createdAt: '2026-10-26 09:00:00', updatedAt: '2026-10-26 09:00:00' }]));
  const audits = [];
  const calls = [];
  const events = [];
  const locks = new Map();
  let connectionId = 0;
  const db = { accounts, sessions, donors, hospitals, audits, calls, events, failures: new Set(), hooks: {}, connections: [] };
  function fail(stage) { if (db.failures.has(stage)) throw privateFailure(); }
  async function execute(connection, sql, values = []) {
    const query = sql.replace(/\s+/gu, ' ').trim();
    calls.push({ connection: connection?.id ?? null, sql: query, values: structuredClone(values) });
    const allSessions = new Map([...sessions, ...(connection?.sessionWrites ?? [])]);
    const account = (id) => connection?.accountWrites.get(id) ?? accounts.get(id);
    const writeSession = (id, row) => (connection?.sessionWrites ?? sessions).set(id, row);
    if (query.includes('FROM Account WHERE account_id = ? FOR UPDATE')) {
      fail('lock'); assert.ok(connection?.active);
      const id = values[0];
      await db.hooks.beforeLock?.(id, connection);
      if (!connection.held.has(id)) {
        const existing = locks.get(id);
        if (existing) {
          events.push(`${connection.id}:wait:${id}`);
          await new Promise((resolve) => existing.waiters.push(resolve));
        }
        locks.set(id, { owner: connection.id, waiters: locks.get(id)?.waiters ?? [] });
        connection.held.add(id);
      }
      events.push(`${connection.id}:lock:${id}`);
      await db.hooks.lock?.(id, connection);
      const locked = account(id);
      return [locked ? [query.includes('AS account_id') ? { account_id: id, role: locked.role, account_status: locked.accountStatus } : { ...locked }] : []];
    }
    if (query.includes('FROM Account WHERE email = ?')) {
      const row = [...accounts.values()].find((a) => a.email === values[0]);
      return [row ? [{ account_id: row.accountId, email: row.email, password_hash: row.passwordHash,
        role: row.role, account_status: row.accountStatus }] : []];
    }
    if (query.includes('FROM Account WHERE account_id = ?')) {
      const row = account(values[0]);
      return [row ? [query.includes('AS accountId') ? { ...row } : { account_id: row.accountId,
        role: row.role, account_status: row.accountStatus }] : []];
    }
    if (query.startsWith('SELECT') && query.includes("role IN ('DONOR', 'HOSPITAL')")) {
      let n = 0;
      const status = values[n++];
      const role = query.includes('AND role = ?') ? values[n++] : undefined;
      const search = query.includes('LIKE ?') ? values[n++].slice(1, -1).replace(/!([!%_])/gu, '$1').toLowerCase() : '';
      let rows = [...accounts.values()].filter((a) => ['DONOR', 'HOSPITAL'].includes(a.role)
        && a.accountStatus === status && (!role || a.role === role) && a.email.toLowerCase().includes(search));
      if (query.startsWith('SELECT COUNT')) return [[{ total: String(rows.length) }]];
      assert.match(query, /ORDER BY created_at, account_id LIMIT \? OFFSET \?$/u);
      rows.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || (BigInt(a.accountId) < BigInt(b.accountId) ? -1 : 1));
      rows = rows.slice(values[n + 1], values[n + 1] + values[n]);
      return [rows.map((a) => ({ ...a, privateProfile: 'PRIVATE' }))];
    }
    if (query.startsWith('UPDATE Account')) {
      fail('approve'); fail('mutation');
      const [to, id, from] = values;
      assert.ok(connection?.active && connection.held.has(id));
      const row = account(id);
      assert.match(query, /updated_at = CURRENT_TIMESTAMP/u);
      const valid = row?.accountStatus === from && ['DONOR', 'HOSPITAL'].includes(row.role);
      if (valid) connection.accountWrites.set(id, { ...row, accountStatus: to });
      return [{ affectedRows: valid ? 1 : 0 }];
    }
    if (query.startsWith('INSERT INTO AuditEvent')) {
      fail('audit'); assert.ok(connection?.active);
      connection.auditWrites.push([...values]);
      return [{ affectedRows: 1, insertId: String(audits.length + 1) }];
    }
    if (query.startsWith('SELECT expires_at FROM app_session')) {
      assert.match(query, /WHERE session_id = \? FOR UPDATE$/u);
      assert.ok(connection?.active && connection.held.size > 0, 'Account must be locked before the session row.');
      await db.hooks.sessionLock?.(values[0], connection);
      // A locking read observes the row after its possible lock wait.
      const row = connection.sessionWrites.get(values[0]) ?? sessions.get(values[0]);
      return [row ? [{ expires_at: row.expires_at }] : []];
    }
    if (query.startsWith('SELECT session_data')) {
      if (query.endsWith('FOR UPDATE')) {
        fail('session-authorize'); assert.ok(connection?.active && connection.held.size > 0);
        await db.hooks.authorizeSession?.(values[0], connection);
      }
      const row = connection?.sessionWrites.get(values[0]) ?? sessions.get(values[0]);
      return [row ? [{ ...row }] : []];
    }
    if (query.startsWith('INSERT INTO app_session')) {
      const [id, expiresAt, data] = values;
      const row = allSessions.get(id);
      if (query.includes('VALUES (?, ?, NULL, ?)')) {
        writeSession(id, { expires_at: row?.expires_at ?? expiresAt, session_data: null, revoked_at: row?.revoked_at ?? data });
      } else if (!query.includes('ON DUPLICATE KEY')) {
        fail('session-insert'); assert.ok(connection?.active, 'Authenticated INSERT must be inside login transaction.');
        const auth = JSON.parse(data).auth;
        assert.ok(connection.held.has(auth.accountId));
        if (row) throw privateFailure();
        await db.hooks.sessionInsert?.(connection);
        writeSession(id, { expires_at: expiresAt, session_data: data, revoked_at: null });
      } else if (!row || (row.revoked_at === null && row.expires_at > values[3]
        && !JSON.parse(row.session_data)?.auth)) {
        writeSession(id, { expires_at: expiresAt, session_data: data, revoked_at: null });
      }
      return [{ affectedRows: 1 }];
    }
    if (query.startsWith('UPDATE app_session SET session_data = NULL')) {
      fail('revoke'); assert.ok(connection?.held.has(values[1]));
      let affectedRows = 0;
      for (const [id, row] of allSessions) if (row.revoked_at === null && JSON.parse(row.session_data)?.auth?.accountId === values[1]) {
        writeSession(id, { ...row, session_data: null, revoked_at: values[0] }); affectedRows++;
      }
      return [{ affectedRows }];
    }
    if (query.startsWith('UPDATE app_session')) {
      fail('session-update');
      const touch = query.startsWith('UPDATE app_session SET expires_at');
      const [data, expiry, id, now, accountId, role, status] = touch ? [null, ...values] : values;
      const row = allSessions.get(id);
      const auth = row?.session_data ? JSON.parse(row.session_data).auth : null;
      if (accountId) assert.ok(connection?.held.has(accountId));
      const valid = row?.revoked_at === null && row.expires_at > now
        && (!accountId || (auth?.accountId === accountId && auth.role === role && auth.accountStatus === status));
      if (valid) writeSession(id, { ...row, expires_at: expiry, session_data: touch ? row.session_data : data });
      return [{ affectedRows: valid ? 1 : 0 }];
    }
    if (query.includes('FROM Donor WHERE account_id = ? FOR UPDATE')) {
      assert.ok(connection?.held.has(values[0]));
      return [donors.has(values[0]) ? [{ account_id: values[0] }] : []];
    }
    if (query.includes('FROM Donor AS d')) {
      const id = values[0]; const donor = connection?.profileWrites.get('D:' + id) ?? donors.get(id);
      return [donor ? [{ account_id: id, email: account(id).email, account_status: account(id).accountStatus,
        full_name: donor.fullName, date_of_birth: '1990-01-01', phone: donor.phone, address: donor.address, area: donor.area,
        reported_blood_group_id: null, confirmed_blood_group_id: null }] : []];
    }
    if (query.includes('FROM Hospital h JOIN Account')) {
      const id = values[0]; const hospital = connection?.profileWrites.get('H:' + id) ?? hospitals.get(id);
      return [hospital ? [{ ...hospital, accountStatus: account(id).accountStatus }] : []];
    }
    if (/^UPDATE (Donor|Hospital) SET/u.test(query)) {
      fail('profile'); const id = values.at(-1); assert.ok(connection?.held.has(id));
      const donor = query.startsWith('UPDATE Donor');
      const key = (donor ? 'D:' : 'H:') + id;
      const previous = connection.profileWrites.get(key) ?? (donor ? donors : hospitals).get(id);
      const updated = { ...previous };
      const columns = { full_name: 'fullName', contact_name: 'contactName', phone: 'phone', address: 'address', area: 'area' };
      [...query.matchAll(/\b(full_name|contact_name|phone|address|area) = \?/gu)].forEach((match,index) => { updated[columns[match[1]]] = values[index]; });
      connection.profileWrites.set(key, updated);
      return [{ affectedRows: 1 }];
    }
    assert.fail('Unexpected isolated Account statement.');
  }
  db.execute = (sql, values) => execute(null, sql, values);
  db.getConnection = async () => {
    fail('acquire');
    const connection = { id: ++connectionId, held: new Set(), active: false, accountWrites: new Map(),
      sessionWrites: new Map(), profileWrites: new Map(), auditWrites: [], released: false, destroyed: false };
    function unlock() {
      for (const id of connection.held) {
        const lock = locks.get(id);
        const next = lock.waiters.shift();
        if (next) { lock.owner = null; next(); } else locks.delete(id);
      }
      connection.held.clear();
    }
    function commitWrites() {
      for (const [id, row] of connection.accountWrites) accounts.set(id, row);
      for (const [id, row] of connection.sessionWrites) sessions.set(id, row);
      for (const [key, row] of connection.profileWrites) (key.startsWith('D:') ? donors : hospitals).set(key.slice(2), row);
      audits.push(...connection.auditWrites);
      connection.active = false; unlock();
    }
    Object.assign(connection, {
      execute: (sql, values) => execute(connection, sql, values),
      async beginTransaction() { events.push(`${connection.id}:begin`); fail('begin'); connection.active = true; },
      async commit() {
        events.push(`${connection.id}:commit`); await db.hooks.commit?.(connection); fail('commit');
        commitWrites(); if (db.failures.has('commit-after')) throw privateFailure();
      },
      async rollback() {
        events.push(`${connection.id}:rollback`); fail('rollback');
        connection.accountWrites.clear(); connection.sessionWrites.clear(); connection.auditWrites.length = 0;
        connection.profileWrites.clear();
        connection.active = false; unlock();
      },
      release() { fail('release'); assert.equal(connection.active, false); connection.released = true; },
      destroy() {
        connection.destroyed = true; connection.active = false; unlock(); fail('destroy');
      },
    });
    db.connections.push(connection);
    return connection;
  };
  return db;
}
