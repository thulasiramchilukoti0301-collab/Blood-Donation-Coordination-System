import app from './app.js';
import { environment } from './config/environment.js';
import { verifyDatabaseConnection, closeDatabasePool } from './config/database.js';

let server;
let stopping = false;

async function shutdown(signal, exitCode = 0) {
  if (stopping) return;
  stopping = true;
  console.info(`Shutting down API (${signal}).`);
  // Bound shutdown even if a request or database driver does not finish.
  const timeout = setTimeout(() => {
    console.error('Shutdown timed out.');
    server?.closeAllConnections();
    process.exit(1);
  }, 10000);

  try {
    if (server?.listening) {
      await new Promise((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
        server.closeIdleConnections();
      });
    }
    await closeDatabasePool();
  } catch {
    console.error('Could not complete resource cleanup.');
    exitCode = 1;
  } finally {
    clearTimeout(timeout);
    process.exit(exitCode);
  }
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('uncaughtException', () => void shutdown('unexpected exception', 1));
process.on('unhandledRejection', () => void shutdown('unhandled rejection', 1));

try {
  server = app.listen(environment.port, () => {
    console.info(`Blood Donation Coordination System API listening on port ${environment.port}.`);
    // API liveness remains usable if the development database is unavailable.
    verifyDatabaseConnection()
      .then(() => console.info('Database connectivity verified.'))
      .catch(() => console.warn('Database not connected. Configure backend/.env and verify MySQL; /api/health/db returns 503 until ready.'));
  });
  server.on('error', (error) => {
    console.error(error.code === 'EADDRINUSE' ? 'API port is already in use.' : 'API could not start.');
    void shutdown('startup failure', 1);
  });
} catch {
  console.error('API could not start. Check the environment configuration.');
  void shutdown('startup failure', 1);
}
