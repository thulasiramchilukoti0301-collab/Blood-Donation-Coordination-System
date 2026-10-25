// Test-only dependency replacement. The real environment module remains intact,
// but dotenv.config cannot open a private file. Use a child process with only
// explicitly whitelisted environment variables; see hospitals/README.md.
const environmentUrl = new URL('../../src/config/environment.js', import.meta.url).href;
export async function resolve(specifier, context, nextResolve) {
  if (specifier === 'dotenv' && context.parentURL === environmentUrl) {
    return { url: 'data:text/javascript,export default { config() { return {}; } };', shortCircuit: true };
  }
  return nextResolve(specifier, context);
}
