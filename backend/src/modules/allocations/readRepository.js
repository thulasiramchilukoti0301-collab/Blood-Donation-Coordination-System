import { HttpError } from '../../utils/httpError.js';
import { allocationReadUnavailable } from './readService.js';

const candidatePageSize = 25;
const allocatableStatuses = ['UNDER_REVIEW', 'AWAITING_INVENTORY', 'PARTIALLY_FULFILLED'];
const canonicalGroups = ['O-', 'O+', 'A-', 'A+', 'B-', 'B+', 'AB-', 'AB+'];

export function createAllocationReadRepository(database) {
  if (!database || typeof database.execute !== 'function') throw new TypeError('A mysql2 database dependency is required.');
  async function execute(sql, values = []) {
    try { return await database.execute(sql, values); }
    catch { throw allocationReadUnavailable(); }
  }
  return {
    async assertStorageReady() {
      const [tables] = await execute(`SELECT TABLE_NAME AS name FROM information_schema.TABLES
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE'
          AND TABLE_NAME IN ('BloodGroup','BloodCompatibility','HospitalRequest','Hospital','BloodUnit','Donation','Allocation')`);
      const expected = new Set(['BloodGroup','BloodCompatibility','HospitalRequest','Hospital','BloodUnit','Donation','Allocation']);
      if (tables.length !== expected.size || tables.some((row) => !expected.delete(row.name))) throw allocationReadUnavailable();
      const [constraints] = await execute(`SELECT TABLE_NAME AS tableName, CONSTRAINT_NAME AS name, CONSTRAINT_TYPE AS type
        FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE()
          AND ((TABLE_NAME = 'BloodCompatibility' AND CONSTRAINT_NAME IN ('PRIMARY','fk_compatibility_donor','fk_compatibility_recipient'))
            OR (TABLE_NAME = 'Allocation' AND CONSTRAINT_NAME IN ('PRIMARY','uq_allocation_active_blood_unit','fk_allocation_request','fk_allocation_unit','fk_allocation_actor')))`);
      const required = new Set(['BloodCompatibility:PRIMARY:PRIMARY KEY', 'BloodCompatibility:fk_compatibility_donor:FOREIGN KEY',
        'BloodCompatibility:fk_compatibility_recipient:FOREIGN KEY', 'Allocation:PRIMARY:PRIMARY KEY',
        'Allocation:uq_allocation_active_blood_unit:UNIQUE', 'Allocation:fk_allocation_request:FOREIGN KEY',
        'Allocation:fk_allocation_unit:FOREIGN KEY', 'Allocation:fk_allocation_actor:FOREIGN KEY']);
      for (const row of constraints) required.delete(`${row.tableName}:${row.name}:${row.type}`);
      const [generated] = await execute(`SELECT EXTRA AS extra FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Allocation' AND COLUMN_NAME = 'active_blood_unit_id'`);
      if (required.size || generated.length !== 1 || !/STORED GENERATED/u.test(generated[0].extra)) throw allocationReadUnavailable();
    },
    async listCompatibility() {
      const [groupRows] = await execute(`SELECT CAST(blood_group_id AS CHAR) AS bloodGroupId, code, display_name AS displayName
        FROM BloodGroup ORDER BY blood_group_id`);
      const [rows] = await execute(`SELECT donor.code AS donorGroupCode, recipient.code AS recipientGroupCode,
          c.is_compatible AS isCompatible
        FROM BloodCompatibility c JOIN BloodGroup donor ON donor.blood_group_id = c.donor_group_id
        JOIN BloodGroup recipient ON recipient.blood_group_id = c.recipient_group_id
        ORDER BY c.donor_group_id, c.recipient_group_id`);
      if (groupRows.length !== 8 || groupRows.some((row) => !canonicalGroups.includes(row.code))) throw allocationReadUnavailable();
      return { groups: groupRows, pairs: rows.map((row) => ({ donorGroupCode: row.donorGroupCode,
        recipientGroupCode: row.recipientGroupCode, isCompatible: row.isCompatible === 1 || row.isCompatible === true })) };
    },
    async readPreview(requestId, intendedIssueDate, candidatePage) {
      const [requests] = await execute(`SELECT CAST(r.request_id AS CHAR) AS requestId,
          CAST(r.recipient_group_id AS CHAR) AS recipientGroupId, g.code AS recipientGroupCode,
          g.display_name AS recipientGroupName, r.quantity_requested AS quantityRequested,
          r.request_status AS requestStatus, h.organization_name AS hospitalName
        FROM HospitalRequest r JOIN Hospital h ON h.account_id = r.hospital_account_id
        JOIN BloodGroup g ON g.blood_group_id = r.recipient_group_id WHERE r.request_id = ?`, [requestId]);
      const request = requests[0];
      if (!request) return null;
      const [[allocationCounts]] = await execute(`SELECT
          COALESCE(SUM(allocation_status = 'ALLOCATED'), 0) AS allocated,
          COALESCE(SUM(allocation_status = 'ISSUED'), 0) AS issued
        FROM Allocation WHERE request_id = ? AND allocation_status IN ('ALLOCATED','ISSUED')`, [requestId]);
      const allocated = Number(allocationCounts.allocated);
      const issued = Number(allocationCounts.issued);
      const outstanding = Number(request.quantityRequested) - allocated - issued;
      if (!Number.isSafeInteger(outstanding) || outstanding < 0) throw allocationReadUnavailable();
      const eligibleForAllocation = allocatableStatuses.includes(request.requestStatus) && outstanding > 0;
      let availableCandidateCount = 0;
      let allocatableCount = 0;
      let candidates = [];
      let candidatePages = 0;
      if (eligibleForAllocation) {
        const filters = `u.unit_status = 'AVAILABLE' AND u.expiry_date > ? AND d.outcome = 'COLLECTED'
          AND d.release_status = 'APPROVED' AND c.is_compatible = 1
          AND NOT EXISTS (SELECT 1 FROM Allocation a WHERE a.blood_unit_id = u.blood_unit_id
            AND a.allocation_status IN ('ALLOCATED','ISSUED'))`;
        const values = [request.recipientGroupId, intendedIssueDate];
        const [[count]] = await execute(`SELECT COUNT(*) AS total FROM BloodUnit u
          JOIN Donation d ON d.donation_id = u.donation_id
          JOIN BloodCompatibility c ON c.donor_group_id = u.blood_group_id AND c.recipient_group_id = ?
          WHERE ${filters}`, values);
        availableCandidateCount = Number(count.total);
        if (!Number.isSafeInteger(availableCandidateCount) || availableCandidateCount < 0) throw allocationReadUnavailable();
        allocatableCount = Math.min(availableCandidateCount, outstanding);
        candidatePages = Math.ceil(allocatableCount / candidatePageSize);
        if (candidatePage <= candidatePages) {
          const offset = (candidatePage - 1) * candidatePageSize;
          const limit = Math.min(candidatePageSize, allocatableCount - offset);
          const [rows] = await execute(`SELECT CAST(u.blood_unit_id AS CHAR) AS bloodUnitId,
              donor.code AS donorGroupCode, DATE_FORMAT(u.expiry_date,'%Y-%m-%d') AS expiryDate,
              DATE_FORMAT(d.collected_at,'%Y-%m-%d %H:%i:%s') AS collectedAt
            FROM BloodUnit u JOIN Donation d ON d.donation_id = u.donation_id
            JOIN BloodGroup donor ON donor.blood_group_id = u.blood_group_id
            JOIN BloodCompatibility c ON c.donor_group_id = u.blood_group_id AND c.recipient_group_id = ?
            WHERE ${filters} ORDER BY u.expiry_date, d.collected_at, u.blood_unit_id LIMIT ? OFFSET ?`,
          [...values, limit, offset]);
          candidates = rows;
        }
      }
      return { request: { requestId: request.requestId, recipientGroupId: request.recipientGroupId,
        recipientGroupCode: request.recipientGroupCode, recipientGroupName: request.recipientGroupName,
        quantityRequested: Number(request.quantityRequested), requestStatus: request.requestStatus,
        hospitalName: request.hospitalName }, eligibleForAllocation, intendedIssueDate,
      counts: { allocated, issued, outstanding, availableCandidateCount, allocatableCount }, candidates,
      candidatePagination: { page: candidatePage, pageSize: candidatePageSize, total: allocatableCount, pageCount: candidatePages },
      isBinding: false };
    },
  };
}
