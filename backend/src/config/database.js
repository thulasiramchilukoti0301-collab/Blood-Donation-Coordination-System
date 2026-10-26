import mysql from 'mysql2/promise';
import session from 'express-session';
import { AsyncLocalStorage } from 'node:async_hooks';
import { readDatabaseConfig } from './environment.js';
import { HttpError } from '../utils/httpError.js';
import { withAccountLocks } from '../modules/accounts/transaction.js';

const { options } = readDatabaseConfig();

// No connection attempt, default root account, or schema creation when unconfigured.
export const pool = options ? mysql.createPool(options) : null;

if (pool) {
  // Apply the documented project timezone to every new physical connection.
  pool.on('connection', (connection) => {
    connection.query("SET time_zone = '+05:30'", (error) => {
      if (error) connection.destroy();
    });
  });
}

export async function verifyDatabaseConnection(databasePool = pool) {
  if (!databasePool) {
    throw new HttpError(503, 'DATABASE_NOT_CONFIGURED', 'Database is not configured. Set the backend database environment variables.');
  }

  let connection;
  try {
    connection = await databasePool.getConnection();
    const [rows] = await connection.query({ sql: 'SELECT 1 AS connected', timeout: 5000 });
    const connected = rows[0]?.connected;
    if (connected !== 1 && connected !== '1') {
      throw new Error('Connectivity check failed.');
    }
    return true;
  } catch {
    // Driver errors can contain usernames, hosts, SQL, and credentials. Never forward them.
    throw new HttpError(503, 'DATABASE_UNAVAILABLE', 'Database is unavailable. Check local MySQL and the backend configuration.');
  } finally {
    connection?.release();
  }
}

export async function closeDatabasePool() {
  if (pool) await pool.end();
}

const SESSION_TABLE = 'app_session';

export class MysqlSessionStore extends session.Store {
  #login = new AsyncLocalStorage();
  constructor(databasePool, ttlMilliseconds) {
    super();
    if (!databasePool || !Number.isInteger(ttlMilliseconds) || ttlMilliseconds < 1) {
      throw new TypeError('A database pool and finite session lifetime are required.');
    }
    this.databasePool = databasePool;
    this.ttlMilliseconds = ttlMilliseconds;
  }

  #storageError(callback) {
    callback(new HttpError(503, 'SESSION_STORAGE_UNAVAILABLE', 'Session storage is unavailable.'));
  }

  withLoginTransaction(connection, account, work) {
    return this.#login.run({ connection, account }, work);
  }

  #identity(value) {
    const auth = value?.auth;
    const id = typeof auth?.accountId === 'string' ? /^[1-9][0-9]{0,19}$/u.exec(auth.accountId) : null;
    if (!id || id[0] !== auth.accountId || BigInt(auth.accountId) > 18446744073709551615n
      || !['DONOR', 'HOSPITAL', 'ADMIN'].includes(auth.role)
      || !(auth.accountStatus === 'ACTIVE' || (auth.accountStatus === 'PENDING' && auth.role !== 'ADMIN'))) {
      throw new Error('Invalid session principal.');
    }
    return auth;
  }

  #expiry(value, now) {
    const expiry = value.cookie?.expires ? new Date(value.cookie.expires).getTime() : now + this.ttlMilliseconds;
    if (!Number.isFinite(expiry)) throw new Error('Invalid session expiry.');
    return Math.min(expiry, now + this.ttlMilliseconds);
  }

  async #authenticatedWrite(sessionId, value, touch) {
    const auth = this.#identity(value);
    const context = this.#login.getStore();
    if (context) {
      const expiry = this.#expiry(value, Date.now());
      const expected = context.account;
      if (touch || auth.accountId !== expected.accountId || auth.role !== expected.role
        || auth.accountStatus !== expected.accountStatus) throw new Error('Invalid login persistence.');
      // New authenticated IDs can be inserted ONLY while login holds Account's
      // lock, on that same transaction connection. Never upsert authentication.
      const [inserted] = await context.connection.execute(`INSERT INTO ${SESSION_TABLE}
        (session_id, expires_at, session_data, revoked_at) VALUES (?, ?, ?, NULL)`,
      [sessionId, expiry, JSON.stringify(value)]);
      if (inserted.affectedRows !== 1) throw new Error('Session not inserted.');
      return;
    }
    await withAccountLocks(this.databasePool, [auth.accountId], async (connection, accounts) => {
      const current = accounts.get(auth.accountId);
      if (!current || current.role !== auth.role || current.accountStatus !== auth.accountStatus) return;
      // Account first, then the session row: either lock may wait past expiry.
      // Read the clock only after both are held; the UPDATE cannot then wait on
      // this row and use an expiry predicate captured before that wait.
      const [rows] = await connection.execute(`SELECT expires_at FROM ${SESSION_TABLE}
        WHERE session_id = ? FOR UPDATE`, [sessionId]);
      const now = Date.now();
      if (!rows[0] || !(Number(rows[0].expires_at) > now)) return;
      const expiry = this.#expiry(value, now);
      const predicates = `session_id = ? AND revoked_at IS NULL AND expires_at > ?
        AND JSON_UNQUOTE(JSON_EXTRACT(session_data, '$.auth.accountId')) = ?
        AND JSON_UNQUOTE(JSON_EXTRACT(session_data, '$.auth.role')) = ?
        AND JSON_UNQUOTE(JSON_EXTRACT(session_data, '$.auth.accountStatus')) = ?`;
      const values = [sessionId, now, auth.accountId, auth.role, auth.accountStatus];
      // Express may call set/touch again at response end. These UPDATEs cannot
      // insert a missing SID, revive a tombstone or upgrade a stored principal.
      if (touch) await connection.execute(`UPDATE ${SESSION_TABLE} SET expires_at = ? WHERE ${predicates}`, [expiry, ...values]);
      else await connection.execute(`UPDATE ${SESSION_TABLE} SET session_data = ?, expires_at = ? WHERE ${predicates}`,
        [JSON.stringify(value), expiry, ...values]);
    });
  }

  get(sessionId, callback) {
    void (async () => {
      const [rows] = await this.databasePool.execute(
        `SELECT session_data, expires_at, revoked_at FROM ${SESSION_TABLE} WHERE session_id = ? LIMIT 1`,
        [sessionId],
      );
      const row = rows[0];
      if (!row || row.revoked_at !== null || row.session_data === null) return callback(null, null);
      if (Number(row.expires_at) <= Date.now()) {
        return this.destroy(sessionId, (error) => callback(error, null));
      }
      try {
        const value = JSON.parse(row.session_data);
        if (value.auth) this.#identity(value);
        callback(null, value);
      } catch {
        return this.destroy(sessionId, (error) => callback(error, null));
      }
    })().catch(() => this.#storageError(callback));
  }

  set(sessionId, value, callback = () => {}) {
    void (async () => {
      if (value.auth) return this.#authenticatedWrite(sessionId, value, false);
      if (this.#login.getStore()) throw new Error('Login session principal required.');
      const now = Date.now();
      const expiresAt = this.#expiry(value, now);
      return this.databasePool.execute(
        `INSERT INTO ${SESSION_TABLE} (session_id, expires_at, session_data, revoked_at)
         VALUES (?, ?, ?, NULL)
         ON DUPLICATE KEY UPDATE
           session_data = IF(revoked_at IS NULL AND expires_at > ? AND JSON_EXTRACT(session_data, '$.auth') IS NULL, VALUES(session_data), session_data),
           expires_at = IF(revoked_at IS NULL AND expires_at > ?, VALUES(expires_at), expires_at)`,
        [sessionId, expiresAt, JSON.stringify(value), now, now],
      );
    })().then(() => callback(null), () => this.#storageError(callback));
  }

  touch(sessionId, value, callback = () => {}) {
    void (async () => {
      if (value.auth) return this.#authenticatedWrite(sessionId, value, true);
      const now = Date.now();
      const expiresAt = this.#expiry(value, now);
      return this.databasePool.execute(
        `UPDATE ${SESSION_TABLE} SET expires_at = ?
         WHERE session_id = ? AND revoked_at IS NULL AND expires_at > ?`,
        [expiresAt, sessionId, now],
      );
    })().then(() => callback(null), () => this.#storageError(callback));
  }

  destroy(sessionId, callback = () => {}) {
    const revokedAt = Date.now();
    const database = this.#login.getStore()?.connection ?? this.databasePool;
    void database.execute(
      `INSERT INTO ${SESSION_TABLE} (session_id, expires_at, session_data, revoked_at)
       VALUES (?, ?, NULL, ?)
       ON DUPLICATE KEY UPDATE session_data = NULL,
         revoked_at = COALESCE(revoked_at, VALUES(revoked_at))`,
      [sessionId, revokedAt + this.ttlMilliseconds, revokedAt],
    ).then(() => callback(null), () => this.#storageError(callback));
  }

  revokeAccountSessions(accountId, connection = this.databasePool) {
    return connection.execute(
      `UPDATE ${SESSION_TABLE} SET session_data = NULL, revoked_at = ?
       WHERE revoked_at IS NULL
         AND JSON_UNQUOTE(JSON_EXTRACT(session_data, '$.auth.accountId')) = ?`,
      [Date.now(), String(accountId)],
    ).catch(() => {
      throw new HttpError(503, 'SESSION_STORAGE_UNAVAILABLE', 'Session storage is unavailable.');
    });
  }
}

export function createSessionMiddleware({ databasePool = pool, config, env = process.env } = {}) {
  const sessionConfig = config ?? readSessionConfig(env).options;
  if (!databasePool || !sessionConfig) return null;
  const store = new MysqlSessionStore(databasePool, sessionConfig.ttlMilliseconds);
  return {
    store,
    middleware: session({
      name: 'bdcs.sid',
      secret: sessionConfig.secret,
      store,
      resave: false,
      saveUninitialized: false,
      rolling: false,
      unset: 'destroy',
      cookie: {
        httpOnly: true,
        secure: sessionConfig.cookieSecure,
        sameSite: 'lax',
        path: '/',
        maxAge: sessionConfig.ttlMilliseconds,
      },
    }),
  };
}
