import { createRequestContextAdapter } from '../blood-requests/context.js';
import { requestTransitionReasons } from '../blood-requests/contracts.js';
import { HttpError } from '../../utils/httpError.js';

const id = value => String(value);

export function createAllocationMutationRepository(database, { contextAdapter = createRequestContextAdapter({
  enabled: true, reasonCodes: Object.values(requestTransitionReasons),
}) } = {}) {
  return {
    async allocationHint(allocationId) {
      const [rows] = await database.execute(`SELECT CAST(a.allocation_id AS CHAR) AS allocationId,
          CAST(a.request_id AS CHAR) AS requestId, CAST(a.blood_unit_id AS CHAR) AS bloodUnitId
        FROM Allocation a WHERE a.allocation_id = ?`, [allocationId]);
      return rows[0] ?? null;
    },
    async transaction(actorId, work) {
      let connection;
      let began = false;
      let committed = false;
      let committing = false;
      let destroy = false;
      let failure;
      let value;
      try {
        connection = await database.getConnection();
        // Clear pooled connection state before opening the mutation transaction.
        await contextAdapter.clear(connection);
        await connection.beginTransaction();
        began = true;
        const accounts = await withAccountLocksOnConnection(connection, actorId);
        value = await work(connection, accounts);
        committing = true;
        await connection.commit();
        committed = true;
      } catch (error) {
        failure = committing
          ? allocationError(503, 'TRANSACTION_OUTCOME_UNKNOWN', 'The transaction outcome is uncertain. Refresh the request and inventory before retrying.')
          : error;
        if (committing) destroy = true;
      } finally {
        if (connection && began && !committed) {
          try { await connection.rollback(); }
          catch {
            destroy = true;
            failure = allocationError(503, committing ? 'TRANSACTION_OUTCOME_UNKNOWN' : 'TRANSACTION_CLEANUP_FAILED',
              'The transaction could not be cleaned up safely. Refresh before retrying.');
          }
        }
        if (connection && !destroy) {
          try { await contextAdapter.clear(connection); }
          catch {
            destroy = true;
            if (!failure) failure = allocationError(503, committed ? 'TRANSACTION_OUTCOME_UNKNOWN' : 'TRANSACTION_CLEANUP_FAILED',
              'The transaction could not be cleaned up safely. Refresh before retrying.');
          }
        }
        if (connection) {
          if (destroy) {
            try { connection.destroy(); } catch { /* Never return uncertain or dirty state to the pool. */ }
          } else {
            try { connection.release(); }
            catch {
              try { connection.destroy(); } catch { /* Keep the operation result safe. */ }
              if (!failure) failure = allocationError(503, committed ? 'TRANSACTION_OUTCOME_UNKNOWN' : 'TRANSACTION_CLEANUP_FAILED',
                'The transaction could not be cleaned up safely. Refresh before retrying.');
            }
          }
        }
      }
      if (failure) throw failure;
      return value;
    },
    async lockRequest(connection, requestId) {
      const [rows] = await connection.execute(`SELECT CAST(request_id AS CHAR) AS requestId,
        CAST(hospital_account_id AS CHAR) AS hospitalAccountId,
        CAST(recipient_group_id AS CHAR) AS recipientGroupId,
        quantity_requested AS quantityRequested, request_status AS requestStatus,
        DATE_FORMAT(needed_by, '%Y-%m-%d %H:%i:%s') AS neededBy
        FROM HospitalRequest WHERE request_id = ? FOR UPDATE`, [requestId]);
      return rows[0] ?? null;
    },
    async lockBloodGroups(connection) {
      const [rows] = await connection.execute(`SELECT blood_group_id AS bloodGroupId, is_active AS isActive FROM BloodGroup
        ORDER BY blood_group_id ASC FOR UPDATE`);
      return rows.map(row => ({ bloodGroupId: String(row.bloodGroupId), isActive: row.isActive === 1 || row.isActive === true }));
    },
    async compatibleGroups(connection, recipientGroupId) {
      const [rows] = await connection.execute(`SELECT donor_group_id AS donorGroupId FROM BloodCompatibility
        WHERE recipient_group_id = ? AND is_compatible = 1 ORDER BY donor_group_id ASC`, [recipientGroupId]);
      return rows.map(row => String(row.donorGroupId));
    },
    async candidateSnapshot(connection, donorGroupIds, intendedIssueDate) {
      if (!donorGroupIds.length) return [];
      const marks = donorGroupIds.map(() => '?').join(',');
      const [rows] = await connection.execute(`SELECT CAST(u.blood_unit_id AS CHAR) AS bloodUnitId,
          CAST(u.donation_id AS CHAR) AS donationId, CAST(u.blood_group_id AS CHAR) AS bloodGroupId,
          DATE_FORMAT(u.expiry_date, '%Y-%m-%d') AS expiryDate,
          DATE_FORMAT(d.collected_at, '%Y-%m-%d %H:%i:%s') AS collectedAt,
          EXISTS (SELECT 1 FROM Allocation a WHERE a.blood_unit_id = u.blood_unit_id
            AND a.allocation_status IN ('ALLOCATED', 'ISSUED')) AS hasActiveAllocation
        FROM BloodUnit u JOIN Donation d ON d.donation_id = u.donation_id
        WHERE u.blood_group_id IN (${marks}) AND u.unit_status = 'AVAILABLE' AND u.expiry_date > ?
          AND d.outcome = 'COLLECTED' AND d.release_status = 'APPROVED'
        ORDER BY u.expiry_date, d.collected_at, u.blood_unit_id`, [...donorGroupIds, intendedIssueDate]);
      return rows;
    },
    async activeRequestUnits(connection, requestId) {
      const [rows] = await connection.execute(`SELECT CAST(u.blood_unit_id AS CHAR) AS bloodUnitId,
          a.allocation_status AS allocationStatus, u.unit_status AS unitStatus,
          DATE_FORMAT(u.expiry_date, '%Y-%m-%d') AS expiryDate
        FROM Allocation a JOIN BloodUnit u ON u.blood_unit_id = a.blood_unit_id
        WHERE a.request_id = ? AND a.allocation_status IN ('ALLOCATED','ISSUED')
        ORDER BY u.expiry_date, u.blood_unit_id`, [requestId]);
      return rows;
    },
    async unitOrderDetails(connection, bloodUnitId) {
      const [rows] = await connection.execute(`SELECT CAST(blood_unit_id AS CHAR) AS bloodUnitId,
          DATE_FORMAT(expiry_date, '%Y-%m-%d') AS expiryDate FROM BloodUnit WHERE blood_unit_id = ?`, [bloodUnitId]);
      return rows[0] ?? null;
    },
    async lockUnit(connection, bloodUnitId) {
      const [rows] = await connection.execute(`SELECT CAST(blood_unit_id AS CHAR) AS bloodUnitId,
          CAST(donation_id AS CHAR) AS donationId, CAST(blood_group_id AS CHAR) AS bloodGroupId,
          unit_status AS unitStatus, DATE_FORMAT(expiry_date, '%Y-%m-%d') AS expiryDate
        FROM BloodUnit WHERE blood_unit_id = ? FOR UPDATE`, [bloodUnitId]);
      return rows[0] ?? null;
    },
    async lockAllocations(connection, requestId, bloodUnitIds) {
      const unitClause = bloodUnitIds.length ? ` OR blood_unit_id IN (${bloodUnitIds.map(() => '?').join(',')})` : '';
      const [ids] = await connection.execute(`SELECT CAST(allocation_id AS CHAR) AS allocationId
        FROM Allocation WHERE request_id = ?${unitClause} ORDER BY allocation_id ASC`, [requestId, ...bloodUnitIds]);
      const locked = [];
      for (const row of ids) {
        const [rows] = await connection.execute(`SELECT CAST(allocation_id AS CHAR) AS allocationId,
            CAST(request_id AS CHAR) AS requestId, CAST(blood_unit_id AS CHAR) AS bloodUnitId,
            allocation_status AS allocationStatus, CAST(allocated_by_account_id AS CHAR) AS actorAccountId
          FROM Allocation WHERE allocation_id = ? FOR UPDATE`, [row.allocationId]);
        if (rows[0]) locked.push(rows[0]);
      }
      return locked;
    },
    async setRequestStatusContext(connection, actorAccountId, reasonCode) {
      await contextAdapter.set(connection, { actorAccountId, reasonCode });
    },
    async createAllocation(connection, { requestId, bloodUnitId, actorAccountId }) {
      const [result] = await connection.execute(`INSERT INTO Allocation
        (request_id, blood_unit_id, allocation_status, allocated_by_account_id)
        VALUES (?, ?, 'ALLOCATED', ?)`, [requestId, bloodUnitId, actorAccountId]);
      if (result.affectedRows !== 1) throw new Error('Allocation insert did not create one row.');
      const [rows] = await connection.execute('SELECT CAST(LAST_INSERT_ID() AS CHAR) AS allocationId');
      return String(rows[0].allocationId);
    },
    async reserveBloodUnit(connection, bloodUnitId, intendedIssueDate) {
      const [result] = await connection.execute(`UPDATE BloodUnit SET unit_status = 'ALLOCATED'
        WHERE blood_unit_id = ? AND unit_status = 'AVAILABLE' AND expiry_date > ?`, [bloodUnitId, intendedIssueDate]);
      return result.affectedRows;
    },
    async issueAllocation(connection, allocationId, handoffReference) {
      const [result] = await connection.execute(`UPDATE Allocation SET allocation_status = 'ISSUED',
          issued_at = CURRENT_TIMESTAMP, handoff_reference = ?
        WHERE allocation_id = ? AND allocation_status = 'ALLOCATED' AND issued_at IS NULL`, [handoffReference, allocationId]);
      if (result.affectedRows !== 1) return null;
      const [rows] = await connection.execute(`SELECT DATE_FORMAT(issued_at, '%Y-%m-%d %H:%i:%s') AS issuedAt
        FROM Allocation WHERE allocation_id = ?`, [allocationId]);
      return rows[0]?.issuedAt ?? null;
    },
    async issueBloodUnit(connection, bloodUnitId) {
      const [result] = await connection.execute(`UPDATE BloodUnit SET unit_status = 'ISSUED'
        WHERE blood_unit_id = ? AND unit_status = 'ALLOCATED'` , [bloodUnitId]);
      return result.affectedRows;
    },
    async updateRequestStatus(connection, requestId, oldStatus) {
      const [result] = await connection.execute(`UPDATE HospitalRequest SET request_status = 'PARTIALLY_FULFILLED',
        rejection_reason_code = NULL, updated_at = CURRENT_TIMESTAMP
        WHERE request_id = ? AND request_status = ?`, [requestId, oldStatus]);
      return result.affectedRows;
    },
    async updateFulfilledRequestStatus(connection, requestId) {
      const [result] = await connection.execute(`UPDATE HospitalRequest SET request_status = 'FULFILLED',
        rejection_reason_code = NULL, updated_at = CURRENT_TIMESTAMP
        WHERE request_id = ? AND request_status = 'PARTIALLY_FULFILLED'`, [requestId]);
      return result.affectedRows;
    },
    async setStatusContextClear(connection) { await contextAdapter.clear(connection); },
  };
}

function allocationError(status, code, message) { return new HttpError(status, code, message); }

async function withAccountLocksOnConnection(connection, actorId) {
  const [rows] = await connection.execute(`SELECT CAST(account_id AS CHAR) AS accountId,
    role, account_status AS accountStatus FROM Account WHERE account_id = ? FOR UPDATE`, [actorId]);
  return new Map([[actorId, rows[0] ?? null]]);
}
