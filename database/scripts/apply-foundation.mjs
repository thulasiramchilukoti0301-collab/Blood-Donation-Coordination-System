import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { readDatabaseConfig } from '../../backend/src/config/environment.js';

const databaseDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repositoryRoot = resolve(databaseDirectory, '..');
const backendRequire = createRequire(resolve(repositoryRoot, 'backend/package.json'));
const mysql = backendRequire('mysql2/promise');
const targetDatabase = process.env.PHASE3_SETUP_DATABASE?.trim();

if (process.env.PHASE3_SETUP_EMPTY_DATABASE !== 'YES' || !targetDatabase) {
  console.error('Set PHASE3_SETUP_DATABASE and PHASE3_SETUP_EMPTY_DATABASE=YES for an explicitly selected new, empty local schema.');
  process.exit(2);
}

const configuration = readDatabaseConfig({
  ...process.env,
  DB_USER: process.env.PHASE3_SCHEMA_USER || process.env.DB_USER,
  DB_PASSWORD: process.env.PHASE3_SCHEMA_PASSWORD || process.env.DB_PASSWORD,
  DB_NAME: targetDatabase,
});
if (!configuration.options) {
  console.error('Database configuration is incomplete. Use private backend/.env or current-process environment values.');
  process.exit(2);
}
if (!['localhost', '127.0.0.1', '::1'].includes(configuration.options.host.toLowerCase())) {
  console.error('Foundation setup is restricted to a loopback MySQL server.');
  process.exit(2);
}

let connection;
try {
  connection = await mysql.createConnection({ ...configuration.options, multipleStatements: false });
  await connection.query("SET time_zone = '+05:30'");
  const [[selected]] = await connection.query('SELECT DATABASE() AS selected_database');
  if (selected.selected_database !== targetDatabase) throw new Error('Selected schema mismatch.');

  const [grantRows] = await connection.query('SHOW GRANTS');
  const grants = grantRows.map((row) => Object.values(row).join(' '));
  const globalPrivileges = new Set();
  for (const grant of grants) {
    const match = grant.match(/^GRANT\s+(.+?)\s+ON\s+`?\*`?\.\*\s+TO\s+/i);
    if (!match) continue;
    for (const privilege of match[1].replaceAll('`', '').split(/\s*,\s*/)) {
      globalPrivileges.add(privilege.toUpperCase());
    }
  }
  const requiredVisibility = ['SELECT', 'SHOW_ROUTINE', 'TRIGGER', 'EVENT'];
  if (!requiredVisibility.every((privilege) => globalPrivileges.has(privilege))) {
    throw new Error('Metadata visibility cannot be established for tables/views, routines, triggers, and events.');
  }

  const objectCounts = [];
  for (const statement of [
    'SELECT COUNT(*) AS count FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()',
    'SELECT COUNT(*) AS count FROM information_schema.ROUTINES WHERE ROUTINE_SCHEMA = DATABASE()',
    'SELECT COUNT(*) AS count FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA = DATABASE()',
    'SELECT COUNT(*) AS count FROM information_schema.EVENTS WHERE EVENT_SCHEMA = DATABASE()',
  ]) {
    const [rows] = await connection.execute(statement);
    objectCounts.push(Number(rows[0].count));
  }
  if (objectCounts.some((count) => count !== 0)) {
    throw new Error('The selected schema is not empty.');
  }

  for (const relativePath of [
    'migrations/001_foundation.sql',
    'migrations/002_auth.sql',
    'seeds/reference_data.sql',
  ]) {
    const sql = await readFile(resolve(databaseDirectory, relativePath), 'utf8');
    await connection.query(sql);
  }

  console.log('Foundation setup completed: BloodGroup, Account, and eight BloodGroup reference rows.');
} catch {
  console.error('Foundation setup failed. Confirm loopback access, required global metadata-visibility privileges, the empty schema, and local setup privileges. No cleanup or destructive retry was attempted; inspect this schema and use a fresh disposable schema for verification.');
  process.exitCode = 1;
} finally {
  await connection?.end().catch(() => {});
}
