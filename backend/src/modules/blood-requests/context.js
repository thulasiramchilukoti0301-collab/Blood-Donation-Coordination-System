import { canonicalUnsignedId } from './validation.js';
import { requestDependencyUnavailable, requestValidationError } from './errors.js';

// Verified human context only. The SQL trigger independently enforces its mapping.
export function createRequestContextAdapter({ enabled = false, reasonCodes = [] } = {}) {
  const reasons = new Set(reasonCodes);
  return {
    async clear(connection) {
      if (enabled !== true) throw requestDependencyUnavailable();
      await connection.execute('SET @request_actor_account_id = NULL, @request_reason_code = NULL, @request_system_operation_id = NULL');
    },
    async set(connection, { actorAccountId, reasonCode = null }) {
      if (enabled !== true) throw requestDependencyUnavailable();
      const actor = canonicalUnsignedId(actorAccountId);
      if (typeof reasonCode !== 'string' || !reasons.has(reasonCode)
        || !reasonCode.trim() || [...reasonCode].length > 40 || /\p{Cc}/u.test(reasonCode)) throw requestValidationError();
      await connection.execute('SET @request_actor_account_id = ?, @request_reason_code = ?, @request_system_operation_id = NULL', [actor, reasonCode]);
    },
  };
}
