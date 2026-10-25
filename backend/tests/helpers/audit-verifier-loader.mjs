// Redirect only the actual verifier's createRequire dependency. No application
// module or installed mysql2 file is changed by these subprocess-only probes.
const verifierUrl = new URL('../../../database/tests/verify-audit.mjs', import.meta.url).href;
const databaseDoubleUrl = new URL('./audit-verifier-database.mjs', import.meta.url).href;

export async function resolve(specifier, context, nextResolve) {
  if (specifier === 'node:module' && context.parentURL === verifierUrl) {
    return { url: databaseDoubleUrl, shortCircuit: true };
  }
  return nextResolve(specifier, context);
}
