import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { bootstrapFirstAdmin, checkBootstrapCancellation, FirstAdminError,
  safeFirstAdminError, validateFirstAdminTarget } from '../modules/auth/firstAdmin.js';
import { createFirstAdminPrompts } from './firstAdminPrompts.js';

async function loadConfiguredRuntime() {
  // Only an explicit, interactive invocation reaches normal private config.
  const { readDatabaseConfig } = await import('../config/environment.js');
  validateFirstAdminTarget(process.env);
  if (!readDatabaseConfig().options) throw new FirstAdminError('BOOTSTRAP_CONFIGURATION_REQUIRED');
  const env = Object.fromEntries(['NODE_ENV', 'DB_HOST', 'DB_PORT', 'DB_NAME', 'FIRST_ADMIN_BOOTSTRAP_DATABASE']
    .map((name) => [name, process.env[name]]));
  const { pool, closeDatabasePool } = await import('../config/database.js');
  return { databasePool: pool, env, close: closeDatabasePool };
}

export async function runFirstAdminCli({ args = process.argv.slice(2), input = process.stdin,
  output = process.stdout, errorOutput = process.stderr, signals = process,
  loadRuntime = loadConfiguredRuntime, promptFactory = createFirstAdminPrompts } = {}) {
  const controller = new AbortController();
  const cancel = () => controller.abort();
  let runtime;
  let prompts;
  let password;
  let confirmation;
  let result;
  let failure;
  let listening = false;
  try {
    if (args.length) throw new FirstAdminError('BOOTSTRAP_ARGUMENTS_NOT_ALLOWED');
    if (!input.isTTY || !output.isTTY || typeof input.setRawMode !== 'function') {
      throw new FirstAdminError('INTERACTIVE_TERMINAL_REQUIRED');
    }
    signals.on('SIGINT', cancel);
    signals.on('SIGTERM', cancel);
    listening = true;
    runtime = await loadRuntime();
    validateFirstAdminTarget(runtime.env);
    checkBootstrapCancellation(controller.signal);
    prompts = promptFactory({ input, output, signal: controller.signal, cancel });
    const email = await prompts.ask('New Admin email (input hidden): ');
    checkBootstrapCancellation(controller.signal);
    password = await prompts.ask('New Admin password (input hidden; preserved exactly): ');
    checkBootstrapCancellation(controller.signal);
    confirmation = await prompts.ask('Confirm Admin password (input hidden): ');
    checkBootstrapCancellation(controller.signal);
    if (password !== confirmation) throw new FirstAdminError('PASSWORD_CONFIRMATION_MISMATCH');
    prompts.close();
    prompts = undefined;
    result = await bootstrapFirstAdmin({ databasePool: runtime.databasePool, env: runtime.env,
      email, password, signal: controller.signal });
  } catch (error) {
    failure = safeFirstAdminError(error);
  } finally {
    password = undefined;
    confirmation = undefined;
    try { prompts?.close(); }
    catch { failure = new FirstAdminError(result ? 'BOOTSTRAP_OUTCOME_UNKNOWN' : 'BOOTSTRAP_CLEANUP_FAILED'); }
    try { await runtime?.close(); }
    catch { failure = new FirstAdminError(result ? 'BOOTSTRAP_OUTCOME_UNKNOWN' : 'BOOTSTRAP_CLEANUP_FAILED'); }
    if (listening) {
      signals.removeListener('SIGINT', cancel);
      signals.removeListener('SIGTERM', cancel);
    }
  }
  if (failure) {
    errorOutput.write(`${failure.code}: ${failure.message}\n`);
    return failure.code === 'BOOTSTRAP_CANCELLED' ? 130 : 1;
  }
  output.write(`First Admin created. ${JSON.stringify(result)}\n`);
  return 0;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  process.exitCode = await runFirstAdminCli();
}
