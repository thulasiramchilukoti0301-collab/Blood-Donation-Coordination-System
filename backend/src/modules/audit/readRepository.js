import { HttpError } from '../../utils/httpError.js';

const unavailable = () => new HttpError(503, 'AUDIT_READ_UNAVAILABLE', 'Audit history is temporarily unavailable.');

export function createAuditReadRepository(database) {
  if (!database || typeof database.execute !== 'function') throw new TypeError('A mysql2 database dependency is required.');
  async function execute(sql, values = []) {
    try { return await database.execute(sql, values); } catch { throw unavailable(); }
  }
  return {
    async assertStorageReady() {
      const [tables] = await execute(`SELECT TABLE_NAME AS name FROM information_schema.TABLES
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE' AND TABLE_NAME = 'AuditEvent'`);
      const [indexes] = await execute(`SELECT INDEX_NAME AS name FROM information_schema.STATISTICS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'AuditEvent'
          AND INDEX_NAME IN ('PRIMARY','ix_audit_event_actor','ix_audit_event_subject') GROUP BY INDEX_NAME`);
      const names = new Set(indexes.map((row) => row.name));
      if (tables.length !== 1 || !['PRIMARY', 'ix_audit_event_actor', 'ix_audit_event_subject'].every((name) => names.has(name))) throw unavailable();
    },
    async list(filters) {
      const conditions = [];
      const values = [];
      const add = (column, value) => { if (value !== undefined) { conditions.push(`${column} = ?`); values.push(value); } };
      add('actor_account_id', filters.actorAccountId);
      add('action_code', filters.actionCode);
      add('subject_type', filters.subjectType);
      add('subject_id', filters.subjectId);
      if (filters.from !== undefined) { conditions.push('occurred_at >= ?'); values.push(`${filters.from} 00:00:00`); }
      if (filters.to !== undefined) { conditions.push('occurred_at < DATE_ADD(?, INTERVAL 1 DAY)'); values.push(`${filters.to} 00:00:00`); }
      const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
      const [[count]] = await execute(`SELECT COUNT(*) AS total FROM AuditEvent ${where}`, values);
      const total = Number(count?.total);
      if (!Number.isSafeInteger(total) || total < 0) throw unavailable();
      const [rows] = await execute(`SELECT CAST(audit_event_id AS CHAR) AS eventId,
          CAST(actor_account_id AS CHAR) AS actorAccountId, action_code AS actionCode,
          subject_type AS subjectType, CAST(subject_id AS CHAR) AS subjectId,
          DATE_FORMAT(occurred_at, '%Y-%m-%d %H:%i:%s') AS occurredAt,
          reason_code AS reasonCode, change_summary AS changeSummary
        FROM AuditEvent ${where}
        ORDER BY occurred_at DESC, audit_event_id DESC LIMIT ? OFFSET ?`,
      [...values, filters.pageSize, (filters.page - 1) * filters.pageSize]);
      return { rows, pagination: { page: filters.page, pageSize: filters.pageSize, total } };
    },
  };
}

export { unavailable as auditReadUnavailable };
