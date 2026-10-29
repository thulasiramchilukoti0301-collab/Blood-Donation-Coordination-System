// Read-only, internal candidate query. Callers must re-run under the agreed
// write locks before a future commit; this query grants no reservation.
export async function readAllocationPreview(connection, requestId, intendedIssueDate) {
  const [requests] = await connection.execute(`SELECT CAST(request_id AS CHAR) AS requestId,
      recipient_group_id AS recipientGroupId, quantity_requested AS quantityRequested,
      request_status AS requestStatus FROM HospitalRequest WHERE request_id = ?`, [requestId]);
  if (requests.length !== 1) return null;
  const request = requests[0];
  const [allocations] = await connection.execute(`SELECT allocation_status AS allocationStatus
    FROM Allocation WHERE request_id = ? AND allocation_status IN ('ALLOCATED', 'ISSUED')`, [requestId]);
  const [units] = await connection.execute(`SELECT CAST(u.blood_unit_id AS CHAR) AS bloodUnitId,
      u.unit_status AS unitStatus, DATE_FORMAT(u.expiry_date, '%Y-%m-%d') AS expiryDate,
      DATE_FORMAT(d.collected_at, '%Y-%m-%d %H:%i:%s') AS collectedAt,
      d.outcome AS donationOutcome, d.release_status AS releaseStatus,
      c.is_compatible AS isCompatible, EXISTS (
        SELECT 1 FROM Allocation a WHERE a.blood_unit_id = u.blood_unit_id
          AND a.allocation_status IN ('ALLOCATED', 'ISSUED')) AS hasActiveAllocation
    FROM BloodUnit u JOIN Donation d ON d.donation_id = u.donation_id
    JOIN BloodCompatibility c ON c.donor_group_id = u.blood_group_id
      AND c.recipient_group_id = ? AND c.is_compatible = 1
    WHERE u.unit_status = 'AVAILABLE' AND u.expiry_date > ?
      AND d.outcome = 'COLLECTED' AND d.release_status = 'APPROVED'
    ORDER BY u.expiry_date, d.collected_at, u.blood_unit_id`,
  [request.recipientGroupId, intendedIssueDate]);
  return { request, allocations, units };
}
