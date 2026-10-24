import mysql from 'mysql2/promise';
import session from 'express-session';
import { readDatabaseConfig } from './environment.js';
import { HttpError } from '../utils/httpError.js';

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
        callback(null, JSON.parse(row.session_data));
      } catch {
        return this.destroy(sessionId, (error) => callback(error, null));
      }
    })().catch(() => this.#storageError(callback));
  }

  set(sessionId, value, callback = () => {}) {
    const now = Date.now();
    const cookieExpiry = value.cookie?.expires ? new Date(value.cookie.expires).getTime() : now + this.ttlMilliseconds;
    const expiresAt = Math.min(cookieExpiry, now + this.ttlMilliseconds);
    void this.databasePool.execute(
      `INSERT INTO ${SESSION_TABLE} (session_id, expires_at, session_data, revoked_at)
       VALUES (?, ?, ?, NULL)
       ON DUPLICATE KEY UPDATE
         session_data = IF(revoked_at IS NULL AND expires_at > ?, VALUES(session_data), session_data),
         expires_at = IF(revoked_at IS NULL AND expires_at > ?, VALUES(expires_at), expires_at)`,
      [sessionId, expiresAt, JSON.stringify(value), now, now],
    ).then(() => callback(null), () => this.#storageError(callback));
  }

  touch(sessionId, value, callback = () => {}) {
    const now = Date.now();
    const cookieExpiry = value.cookie?.expires ? new Date(value.cookie.expires).getTime() : now + this.ttlMilliseconds;
    const expiresAt = Math.min(cookieExpiry, now + this.ttlMilliseconds);
    void this.databasePool.execute(
      `UPDATE ${SESSION_TABLE} SET expires_at = ?
       WHERE session_id = ? AND revoked_at IS NULL AND expires_at > ?`,
      [expiresAt, sessionId, now],
    ).then(() => callback(null), () => this.#storageError(callback));
  }

  destroy(sessionId, callback = () => {}) {
    const revokedAt = Date.now();
    void this.databasePool.execute(
      `INSERT INTO ${SESSION_TABLE} (session_id, expires_at, session_data, revoked_at)
       VALUES (?, ?, NULL, ?)
       ON DUPLICATE KEY UPDATE session_data = NULL,
         revoked_at = COALESCE(revoked_at, VALUES(revoked_at))`,
      [sessionId, revokedAt + this.ttlMilliseconds, revokedAt],
    ).then(() => callback(null), () => this.#storageError(callback));
  }

  revokeAccountSessions(accountId) {
    return this.databasePool.execute(
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
