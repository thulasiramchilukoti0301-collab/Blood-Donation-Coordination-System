import { verifyDatabaseConnection, closeDatabasePool } from '../config/database.js';

try {
  await verifyDatabaseConnection();
  console.info('Database connectivity verified (SELECT 1). No schema changes performed.');
} catch (error) {
  console.error(`${error.code}: ${error.message}`);
  process.exitCode = 1;
} finally {
  await closeDatabasePool();
}
