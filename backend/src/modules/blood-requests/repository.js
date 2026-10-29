import { HttpError } from '../../utils/httpError.js';
import { requireStoredSession } from '../accounts/sessionAuthorization.js';
import { safeBloodRequestError } from './errors.js';
import { requestPageSize } from './validation.js';

const requestSelect = `SELECT CAST(r.request_id AS CHAR) AS requestId,
  CAST(r.hospital_account_id AS CHAR) AS hospitalId,
  CAST(r.recipient_group_id AS CHAR) AS recipientGroupId,
  g.code AS recipientBloodGroupCode, g.display_name AS recipientBloodGroupName,
  r.quantity_requested AS quantityRequested, r.priority,
  DATE_FORMAT(r.needed_by, '%Y-%m-%d %H:%i:%s') AS neededBy,
  r.request_note AS note, r.request_status AS requestStatus,
  r.rejection_reason_code AS rejectionReasonCode,
  DATE_FORMAT(r.created_at, '%Y-%m-%d %H:%i:%s') AS createdAt,
  DATE_FORMAT(r.updated_at, '%Y-%m-%d %H:%i:%s') AS updatedAt`;

function requestFrom(row) {
  return row ?? null;
}

function whereClause(scope, accountId, filters) {
  const conditions = [];
  const values = [];
  if (scope === 'HOSPITAL') {
    conditions.push('r.hospital_account_id = ?');
    values.push(accountId);
  }
  if (filters.hospitalId) {
    conditions.push('r.hospital_account_id = ?');
    values.push(filters.hospitalId);
  }
  if (filters.requestStatus) {
    conditions.push('r.request_status = ?');
    values.push(filters.requestStatus);
  }
  if (filters.priority) {
    conditions.push('r.priority = ?');
    values.push(filters.priority);
  }
  if (filters.recipientGroupId) {
    conditions.push('r.recipient_group_id = ?');
    values.push(filters.recipientGroupId);
  }
  if (filters.submittedFrom) {
    conditions.push('r.created_at >= ?');
    values.push(`${filters.submittedFrom} 00:00:00`);
  }
  if (filters.submittedTo) {
    conditions.push('r.created_at < DATE_ADD(?, INTERVAL 1 DAY)');
    values.push(`${filters.submittedTo} 00:00:00`);
  }
  if (filters.neededByFrom) {
    conditions.push('r.needed_by >= ?');
    values.push(`${filters.neededByFrom} 00:00:00`);
  }
  if (filters.neededByTo) {
    conditions.push('r.needed_by < DATE_ADD(?, INTERVAL 1 DAY)');
    values.push(`${filters.neededByTo} 00:00:00`);
  }
  return { sql: conditions.length ? `WHERE ${conditions.join(' AND ')}` : '', values };
}

function totalCount(value) {
  const total = Number(value);
  if (!Number.isSafeInteger(total) || total < 0) throw new HttpError(503, 'DATABASE_UNAVAILABLE', 'Blood request data is temporarily unavailable.');
  return total;
}

// Receives the configured mysql2 pool, or the caller's transaction connection.
// This module never imports environment configuration or opens a connection.
export function createBloodRequestRepository(database, { contextAdapter = null } = {}) {
  if (!database || typeof database.execute !== 'function') throw new TypeError('A mysql2 database dependency is required.');

  async function execute(sql, values = []) {
    try {
      return await database.execute(sql, values);
    } catch (error) {
      throw safeBloodRequestError(error);
    }
  }

  async function findRequest(sql, values) {
    const [rows] = await execute(sql, values);
    return requestFrom(rows[0]);
  }

  async function list(scope, accountId, filters) {
    const from = scope === 'ADMIN'
      ? 'FROM HospitalRequest r JOIN Hospital h ON h.account_id = r.hospital_account_id JOIN BloodGroup g ON g.blood_group_id = r.recipient_group_id'
      : 'FROM HospitalRequest r JOIN BloodGroup g ON g.blood_group_id = r.recipient_group_id';
    const where = whereClause(scope, accountId, filters);
    const [[countRow]] = await execute(`SELECT COUNT(*) AS total ${from} ${where.sql}`, where.values);
    const ordering = scope === 'ADMIN'
      ? `ORDER BY CASE r.priority WHEN 'EMERGENCY' THEN 1 WHEN 'URGENT' THEN 2 ELSE 3 END,
          r.needed_by ASC, r.created_at ASC, r.request_id ASC`
      : 'ORDER BY r.created_at DESC, r.request_id DESC';
    const adminProjection = scope === 'ADMIN' ? ', h.organization_name AS organizationName' : '';
    const [rows] = await execute(`${requestSelect}${adminProjection} ${from} ${where.sql} ${ordering} LIMIT ? OFFSET ?`,
    [...where.values, requestPageSize, (filters.page - 1) * requestPageSize]);
    return {
      records: rows,
      pagination: { page: filters.page, pageSize: requestPageSize, total: totalCount(countRow?.total) },
    };
  }

  return {
    async assertStorageReady() {
      const [rows] = await execute(`SELECT TABLE_NAME AS name FROM information_schema.TABLES
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE'
        AND TABLE_NAME IN ('HospitalRequest', 'RequestStatusHistory', 'AuditEvent')`);
      const [triggers] = await execute(`SELECT TRIGGER_NAME AS name, ACTION_TIMING AS timing, EVENT_MANIPULATION AS event
        FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA = DATABASE() AND EVENT_OBJECT_TABLE = 'HospitalRequest'`);
      const expected = { trg_request_initial_status: 'BEFORE:INSERT', trg_request_update_guard: 'BEFORE:UPDATE', trg_request_status_history_update: 'AFTER:UPDATE' };
      if (rows.length !== 3 || triggers.length !== 3 || triggers.some((row) => expected[row.name] !== `${row.timing}:${row.event}`)) {
        throw new HttpError(503, 'REQUEST_STORAGE_UNAVAILABLE', 'Blood request setup is incomplete.');
      }
    },
    async listActiveBloodGroups() {
      const [rows] = await execute(`SELECT CAST(blood_group_id AS CHAR) AS bloodGroupId, code, display_name AS displayName
        FROM BloodGroup WHERE is_active = 1 ORDER BY blood_group_id ASC`);
      return rows;
    },
    async setStatusContext(context) {
      if (!contextAdapter) throw new HttpError(503, 'REQUEST_FEATURE_NOT_READY', 'Blood request operation is not available.');
      await contextAdapter.set(database, context);
    },
    async lockRequest(requestId) {
      return findRequest(`SELECT CAST(request_id AS CHAR) AS requestId, request_status AS requestStatus
        FROM HospitalRequest WHERE request_id = ? FOR UPDATE`, [requestId]);
    },
    async updateStatus(requestId, oldStatus, newStatus, reasonCode) {
      const [result] = await execute(`UPDATE HospitalRequest SET request_status = ?, rejection_reason_code = ?,
        updated_at = CURRENT_TIMESTAMP WHERE request_id = ? AND request_status = ?`,
      [newStatus, newStatus === 'REJECTED' ? reasonCode : null, requestId, oldStatus]);
      if (result?.affectedRows !== 1) throw new HttpError(409, 'INVALID_REQUEST_TRANSITION', 'The request has changed.');
      // The AFTER UPDATE trigger writes history; never insert it here.
    },
    authorizeSession(authorization, account) {
      return requireStoredSession(database, authorization, account);
    },
    async findAccountById(id, { forUpdate = false } = {}) {
      return findRequest(`SELECT CAST(account_id AS CHAR) AS accountId, role, account_status AS accountStatus
        FROM Account WHERE account_id = ?${forUpdate ? ' FOR UPDATE' : ''}`, [id]);
    },
    async findHospitalByAccountId(id, { forUpdate = false } = {}) {
      return findRequest(`SELECT CAST(account_id AS CHAR) AS hospitalId
        FROM Hospital WHERE account_id = ?${forUpdate ? ' FOR UPDATE' : ''}`, [id]);
    },
    async findBloodGroupById(id, { forUpdate = false } = {}) {
      return findRequest(`SELECT CAST(blood_group_id AS CHAR) AS bloodGroupId, code, display_name AS displayName,
        is_active AS isActive FROM BloodGroup WHERE blood_group_id = ?${forUpdate ? ' FOR UPDATE' : ''}`, [id]);
    },
    async insertRequest({ hospitalAccountId, recipientGroupId, quantityRequested, priority, neededBy, note }) {
      const [result] = await execute(`INSERT INTO HospitalRequest
        (hospital_account_id, recipient_group_id, quantity_requested, priority, needed_by, request_note, request_status)
        VALUES (?, ?, ?, ?, ?, ?, 'SUBMITTED')`,
      [hospitalAccountId, recipientGroupId, quantityRequested, priority, neededBy, note]);
      if (result?.affectedRows !== 1) throw new HttpError(503, 'DATABASE_UNAVAILABLE', 'Blood request could not be stored.');
      // CAST avoids losing precision when mysql2 receives an unsigned BIGINT insert ID.
      return findRequest('SELECT CAST(LAST_INSERT_ID() AS CHAR) AS requestId', []);
    },
    async insertInitialStatusHistory({ requestId, actorAccountId }) {
      await execute(`INSERT INTO RequestStatusHistory
        (request_id, old_status, new_status, changed_by_account_id)
        VALUES (?, NULL, 'SUBMITTED', ?)`, [requestId, actorAccountId]);
    },
    async listHospitalRequests(accountId, filters) {
      return list('HOSPITAL', accountId, filters);
    },
    async listAdminRequests(filters) {
      return list('ADMIN', null, filters);
    },
    async findHospitalRequest(accountId, requestId) {
      return findRequest(`${requestSelect} FROM HospitalRequest r
        JOIN BloodGroup g ON g.blood_group_id = r.recipient_group_id
        WHERE r.hospital_account_id = ? AND r.request_id = ? LIMIT 1`, [accountId, requestId]);
    },
    async findAdminRequest(requestId) {
      return findRequest(`${requestSelect}, h.organization_name AS organizationName FROM HospitalRequest r
        JOIN Hospital h ON h.account_id = r.hospital_account_id
        JOIN BloodGroup g ON g.blood_group_id = r.recipient_group_id
        WHERE r.request_id = ? LIMIT 1`, [requestId]);
    },
    async findStatusHistory(requestId, { hospitalAccountId = null } = {}) {
      const [rows] = await execute(`SELECT s.old_status AS oldStatus, s.new_status AS newStatus,
        DATE_FORMAT(s.changed_at, '%Y-%m-%d %H:%i:%s') AS changedAt
        FROM RequestStatusHistory s JOIN HospitalRequest r ON r.request_id = s.request_id
        WHERE s.request_id = ?${hospitalAccountId ? ' AND r.hospital_account_id = ?' : ''}
        ORDER BY s.changed_at ASC, s.request_status_history_id ASC`, hospitalAccountId ? [requestId, hospitalAccountId] : [requestId]);
      return rows;
    },
    async withTransaction(work) {
      let connection;
      let began = false;
      let committing = false;
      let committed = false;
      let result;
      let failure;
      let uncertain = false;
      try {
        if (typeof database.getConnection !== 'function') throw new Error('Transaction pool is unavailable.');
        connection = await database.getConnection();
        if (contextAdapter) await contextAdapter.clear(connection);
        began = true;
        await connection.beginTransaction();
        result = await work(createBloodRequestRepository(connection, { contextAdapter }), connection);
        committing = true;
        await connection.commit();
        committed = true;
      } catch (error) {
        uncertain = committing || !began;
        failure = committing
          ? new HttpError(503, 'TRANSACTION_OUTCOME_UNKNOWN', 'The transaction outcome is uncertain. Refresh before retrying.')
          : safeBloodRequestError(error);
      } finally {
        if (connection) {
          let destroy = uncertain;
          if (began && !committed) {
            try { await connection.rollback(); } catch { destroy = true; }
          }
          if (contextAdapter && !destroy) {
            try { await contextAdapter.clear(connection); }
            catch {
              destroy = true;
              if (!failure) failure = new HttpError(503,
                committed ? 'TRANSACTION_OUTCOME_UNKNOWN' : 'TRANSACTION_CLEANUP_FAILED',
                'The transaction could not be cleaned up safely. Refresh before retrying.');
            }
          }
          if (destroy) {
            try { connection.destroy(); } catch { /* Preserve the original safe failure and never release. */ }
            if (!failure) failure = new HttpError(503, 'TRANSACTION_CLEANUP_FAILED', 'The transaction could not be cleaned up safely.');
          } else {
            try { connection.release(); }
            catch {
              try { connection.destroy(); } catch { /* Never release and destroy the same connection. */ }
              if (!failure) failure = new HttpError(503,
                committed ? 'TRANSACTION_OUTCOME_UNKNOWN' : 'TRANSACTION_CLEANUP_FAILED',
                'The transaction could not be cleaned up safely.');
            }
          }
        }
      }
      if (failure) throw failure;
      return result;
    },
  };
}

export { whereClause as buildRequestWhereClause };
