import mysql from 'mysql2/promise';
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
    if (rows[0]?.connected !== 1) throw new Error('Connectivity check failed.');
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
