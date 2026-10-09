import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';

// Resolve from this file so startup does not depend on the shell's directory.
dotenv.config({ path: fileURLToPath(new URL('../../.env', import.meta.url)), quiet: true });

function port(value, fallback, name) {
  const result = Number(value ?? fallback);
  if (!Number.isInteger(result) || result < 1 || result > 65535) {
    throw new Error(`${name} must be an integer between 1 and 65535.`);
  }
  return result;
}

const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
const origin = new URL(frontendUrl);
if (!['http:', 'https:'].includes(origin.protocol) || origin.origin !== frontendUrl) {
  throw new Error('FRONTEND_URL must be an exact HTTP(S) origin without a trailing slash.');
}

export const environment = Object.freeze({
  port: port(process.env.PORT, 5000, 'PORT'),
  nodeEnv: process.env.NODE_ENV || 'development',
  frontendUrl,
});

export function readDatabaseConfig(env = process.env) {
  const required = ['DB_HOST', 'DB_USER', 'DB_PASSWORD', 'DB_NAME'];
  if (required.some((name) => !env[name]?.trim())) {
    return { options: null, issue: 'DATABASE_NOT_CONFIGURED' };
  }
  try {
    return {
      issue: null,
      options: {
        host: env.DB_HOST,
        port: port(env.DB_PORT, 3306, 'DB_PORT'),
        user: env.DB_USER,
        password: env.DB_PASSWORD,
        database: env.DB_NAME,
        timezone: '+05:30',
        waitForConnections: false,
        connectionLimit: 10,
        connectTimeout: 5000,
        enableKeepAlive: true,
        multipleStatements: false,
      },
    };
  } catch {
    return { options: null, issue: 'DATABASE_NOT_CONFIGURED' };
  }
}
