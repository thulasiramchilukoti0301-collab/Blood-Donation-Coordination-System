import { createHash } from 'node:crypto';
import bcrypt from 'bcrypt';
import { validateAccountEmail } from './validation.js';
import { BCRYPT_WORK_FACTOR, validatePassword } from './passwordPolicy.js';

const messages = Object.freeze({
  BOOTSTRAP_CONFIGURATION_REQUIRED: 'Explicit loopback development database configuration and matching bootstrap target are required.',
  BOOTSTRAP_ARGUMENTS_NOT_ALLOWED: 'Use the interactive command without arguments. Never supply account credentials as arguments.',
  INTERACTIVE_TERMINAL_REQUIRED: 'An interactive input and output terminal are required.',
  INVALID_EMAIL: 'Enter an email address accepted by registration (maximum 254 characters).',
  INVALID_PASSWORD: 'Use at least 8 characters, including a number and punctuation or symbol; maximum 72 UTF-8 bytes, without control characters.',
  PASSWORD_CONFIRMATION_MISMATCH: 'The password confirmation does not match.',
  ADMIN_ALREADY_EXISTS: 'An Admin Account already exists. No account was changed.',
  EMAIL_CONFLICT: 'That email already belongs to an Account. No account was changed.',
  BOOTSTRAP_BUSY: 'Another bootstrap holds the database lock. No account was changed.',
  BOOTSTRAP_HASH_UNAVAILABLE: 'Password hashing could not be completed.',
  BOOTSTRAP_DATABASE_UNAVAILABLE: 'The database operation could not be completed safely.',
  BOOTSTRAP_CLEANUP_FAILED: 'Cleanup could not be confirmed. Inspect the database before retrying.',
  BOOTSTRAP_OUTCOME_UNKNOWN: 'Creation may have committed. Inspect the database before retrying; no reset or overwrite was attempted.',
  BOOTSTRAP_CANCELLED: 'Bootstrap cancelled before commit. No account creation was committed by this operation.',
});

export class FirstAdminError extends Error {
  constructor(code) {
    const safeCode = Object.hasOwn(messages, code) ? code : 'BOOTSTRAP_DATABASE_UNAVAILABLE';
    super(messages[safeCode]);
    this.code = safeCode;
  }
}

export function safeFirstAdminError(error) {
  if (error instanceof FirstAdminError) return new FirstAdminError(error.code);
  return new FirstAdminError('BOOTSTRAP_DATABASE_UNAVAILABLE');
}

export function validateFirstAdminTarget(env) {
  const name = env?.DB_NAME;
  if (env?.NODE_ENV !== 'development'
    || !['127.0.0.1', '::1'].includes(env?.DB_HOST)
    || typeof env?.DB_PORT !== 'string' || !/^[1-9][0-9]{0,4}$/u.test(env.DB_PORT)
    || Number(env.DB_PORT) > 65535
    || typeof name !== 'string' || !/^[A-Za-z][A-Za-z0-9_]{0,63}$/u.test(name)
    || ['mysql', 'sys', 'performance_schema', 'information_schema'].includes(name.toLowerCase())
    || env?.FIRST_ADMIN_BOOTSTRAP_DATABASE !== name) {
    throw new FirstAdminError('BOOTSTRAP_CONFIGURATION_REQUIRED');
  }
  return { databaseName: name };
}

export function checkBootstrapCancellation(signal) {
  if (signal?.aborted) throw new FirstAdminError('BOOTSTRAP_CANCELLED');
}

function insertId(value) {
  const id = typeof value === 'string' ? value
    : Number.isSafeInteger(value) ? String(value) : '';
  if (!/^[1-9][0-9]*$/u.test(id) || BigInt(id) > 18446744073709551615n) {
    throw new FirstAdminError('BOOTSTRAP_DATABASE_UNAVAILABLE');
  }
  return id;
}

// Imported only by the explicit CLI/tests, never by the server or an HTTP route.
export async function bootstrapFirstAdmin({ databasePool, env, email, password, signal, passwordHasher = bcrypt }) {
  const { databaseName } = validateFirstAdminTarget(env);
  let normalizedEmail;
  try { normalizedEmail = validateAccountEmail(email); }
  catch { throw new FirstAdminError('INVALID_EMAIL'); }
  if (!validatePassword(password).valid) throw new FirstAdminError('INVALID_PASSWORD');
  checkBootstrapCancellation(signal);
  let passwordHash;
  try { passwordHash = await passwordHasher.hash(password, BCRYPT_WORK_FACTOR); }
  catch { throw new FirstAdminError('BOOTSTRAP_HASH_UNAVAILABLE'); }
  checkBootstrapCancellation(signal);
  if (typeof passwordHash !== 'string' || !/^\$2[ab]\$12\$[./A-Za-z0-9]{53}$/u.test(passwordHash)) {
    throw new FirstAdminError('BOOTSTRAP_HASH_UNAVAILABLE');
  }

  // MySQL named locks are connection-scoped, not released by commit/rollback.
  // Lowercasing also serializes Windows schema aliases; at most 64 ASCII chars.
  const lockName = `bdcs:first-admin:${createHash('sha256').update(databaseName.toLowerCase()).digest('hex').slice(0, 40)}`;
  let connection;
  let lockUncertain = false;
  let locked = false;
  let transactionAttempted = false;
  let commitAttempted = false;
  let committed = false;
  let result;
  let failure;
  const execute = (sql, values = []) => connection.execute({ sql, timeout: 10_000 }, values);
  try {
    connection = await databasePool.getConnection();
    checkBootstrapCancellation(signal);
    const [selected] = await execute('SELECT DATABASE() AS database_name');
    if (selected[0]?.database_name !== databaseName) throw new FirstAdminError('BOOTSTRAP_CONFIGURATION_REQUIRED');
    const [tables] = await execute(`SELECT ENGINE FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE() AND LOWER(TABLE_NAME) = 'account' AND TABLE_TYPE = 'BASE TABLE'`);
    if (tables.length !== 1 || tables[0].ENGINE !== 'InnoDB') throw new FirstAdminError('BOOTSTRAP_DATABASE_UNAVAILABLE');
    checkBootstrapCancellation(signal);
    lockUncertain = true;
    const [locks] = await execute('SELECT GET_LOCK(?, 5) AS acquired', [lockName]);
    const acquired = locks[0]?.acquired;
    if (acquired === 0 || acquired === '0') {
      lockUncertain = false;
      throw new FirstAdminError('BOOTSTRAP_BUSY');
    }
    if (acquired !== 1 && acquired !== '1') throw new FirstAdminError('BOOTSTRAP_DATABASE_UNAVAILABLE');
    lockUncertain = false;
    locked = true;
    checkBootstrapCancellation(signal);
    // Start only after acquiring the lock, so a waiter reads the winner's commit.
    transactionAttempted = true;
    await connection.beginTransaction();
    const [admins] = await execute('SELECT account_id FROM Account WHERE role = ? LIMIT 1 FOR UPDATE', ['ADMIN']);
    if (admins.length) throw new FirstAdminError('ADMIN_ALREADY_EXISTS');
    checkBootstrapCancellation(signal);
    const [inserted] = await execute(`INSERT INTO Account (email, password_hash, role, account_status)
      VALUES (?, ?, ?, ?)`, [normalizedEmail, passwordHash, 'ADMIN', 'ACTIVE']);
    if (inserted.affectedRows !== 1) throw new FirstAdminError('BOOTSTRAP_DATABASE_UNAVAILABLE');
    result = { accountId: insertId(inserted.insertId), email: normalizedEmail, role: 'ADMIN', accountStatus: 'ACTIVE' };
    checkBootstrapCancellation(signal);
    // Cancellation cannot undo an already-sent COMMIT. Finish cleanup and report
    // success or an uncertain outcome instead of falsely reporting cancellation.
    commitAttempted = true;
    await connection.commit();
    committed = true;
  } catch (error) {
    failure = commitAttempted ? new FirstAdminError('BOOTSTRAP_OUTCOME_UNKNOWN')
      : error?.code === 'ER_DUP_ENTRY' ? new FirstAdminError('EMAIL_CONFLICT') : safeFirstAdminError(error);
  } finally {
    if (connection) {
      let dispose = lockUncertain;
      let cleanupFailed = false;
      if (transactionAttempted && !committed) {
        try { await connection.rollback(); }
        catch { dispose = true; cleanupFailed = true; }
      }
      if (locked && !dispose) {
        try {
          const [released] = await execute('SELECT RELEASE_LOCK(?) AS released', [lockName]);
          if (released[0]?.released !== 1 && released[0]?.released !== '1') throw new Error();
        } catch { dispose = true; cleanupFailed = true; }
      }
      if (dispose) {
        try { connection.destroy(); } catch { cleanupFailed = true; }
      } else {
        try { connection.release(); }
        catch {
          cleanupFailed = true;
          try { connection.destroy(); } catch { /* Never expose a disposal error. */ }
        }
      }
      if (cleanupFailed) failure = new FirstAdminError(commitAttempted ? 'BOOTSTRAP_OUTCOME_UNKNOWN' : 'BOOTSTRAP_CLEANUP_FAILED');
    }
  }
  if (failure) throw failure;
  return result;
}
