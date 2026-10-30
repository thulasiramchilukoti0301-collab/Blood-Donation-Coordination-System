-- Read-only Group 14 demonstration verification and report queries.
-- Run only after the fresh build succeeds. Every statement below is SELECT.
USE group14_blood_donation_demo_20261030;
SET time_zone = '+05:30';

-- Academic row-count requirement: 12 major tables, each expected >= 10.
SELECT 'Account' AS table_name, COUNT(*) AS row_count FROM Account
UNION ALL SELECT 'Donor', COUNT(*) FROM Donor
UNION ALL SELECT 'Hospital', COUNT(*) FROM Hospital
UNION ALL SELECT 'DonationSlot', COUNT(*) FROM DonationSlot
UNION ALL SELECT 'Booking', COUNT(*) FROM Booking
UNION ALL SELECT 'EligibilityDecision', COUNT(*) FROM EligibilityDecision
UNION ALL SELECT 'Donation', COUNT(*) FROM Donation
UNION ALL SELECT 'BloodUnit', COUNT(*) FROM BloodUnit
UNION ALL SELECT 'HospitalRequest', COUNT(*) FROM HospitalRequest
UNION ALL SELECT 'RequestStatusHistory', COUNT(*) FROM RequestStatusHistory
UNION ALL SELECT 'Allocation', COUNT(*) FROM Allocation
UNION ALL SELECT 'AuditEvent', COUNT(*) FROM AuditEvent
ORDER BY table_name;

-- Exact reference-table sizes required by the project design.
SELECT COUNT(*) AS canonical_blood_group_rows,
       SUM(is_active = TRUE) AS active_canonical_blood_groups
FROM BloodGroup;
SELECT COUNT(*) AS directed_compatibility_pairs,
       SUM(is_compatible = TRUE) AS compatible_pairs
FROM BloodCompatibility;

-- Role/state distribution and the deliberately empty session store.
SELECT role, account_status, COUNT(*) AS accounts
FROM Account GROUP BY role, account_status ORDER BY role, account_status;
SELECT COUNT(*) AS demo_sessions_expected_zero FROM app_session;

-- Donation, release, inventory, request and history coverage for screenshots.
SELECT outcome, release_status, COUNT(*) AS donation_count
FROM Donation GROUP BY outcome, release_status ORDER BY outcome, release_status;
SELECT unit_status, COUNT(*) AS unit_count FROM BloodUnit GROUP BY unit_status ORDER BY unit_status;
SELECT request_status, priority, COUNT(*) AS request_count
FROM HospitalRequest GROUP BY request_status, priority ORDER BY request_status, priority;
SELECT new_status, COUNT(*) AS history_rows
FROM RequestStatusHistory GROUP BY new_status ORDER BY new_status;
SELECT action_code, reason_code, COUNT(*) AS event_count
FROM AuditEvent GROUP BY action_code, reason_code ORDER BY action_code, reason_code;

-- Relationship-consistency checks: each returned violation count should be zero.
SELECT 'Donor/account role mismatch' AS check_name, COUNT(*) AS violations
FROM Donor d LEFT JOIN Account a ON a.account_id = d.account_id
WHERE a.account_id IS NULL OR a.role <> 'DONOR'
UNION ALL SELECT 'Hospital/account role mismatch', COUNT(*)
FROM Hospital h LEFT JOIN Account a ON a.account_id = h.account_id
WHERE a.account_id IS NULL OR a.role <> 'HOSPITAL'
UNION ALL SELECT 'Booking donor/slot missing', COUNT(*)
FROM Booking b LEFT JOIN Donor d ON d.account_id = b.donor_account_id
LEFT JOIN DonationSlot s ON s.slot_id = b.slot_id
WHERE d.account_id IS NULL OR s.slot_id IS NULL
UNION ALL SELECT 'Eligibility booking owner mismatch', COUNT(*)
FROM EligibilityDecision e LEFT JOIN Booking b
  ON b.booking_id = e.booking_id AND b.donor_account_id = e.donor_account_id
WHERE e.booking_id IS NOT NULL AND b.booking_id IS NULL
UNION ALL SELECT 'Donation is not completed booking', COUNT(*)
FROM Donation d JOIN Booking b ON b.booking_id = d.booking_id
WHERE b.booking_status <> 'COMPLETED'
UNION ALL SELECT 'Approved unit group differs from confirmed donor group', COUNT(*)
FROM BloodUnit u JOIN Donation n ON n.donation_id = u.donation_id
JOIN Booking b ON b.booking_id = n.booking_id
JOIN Donor d ON d.account_id = b.donor_account_id
WHERE n.outcome <> 'COLLECTED' OR n.release_status <> 'APPROVED'
   OR d.confirmed_blood_group_id IS NULL OR u.blood_group_id <> d.confirmed_blood_group_id
UNION ALL SELECT 'Allocation/unit status mismatch', COUNT(*)
FROM Allocation a JOIN BloodUnit u ON u.blood_unit_id = a.blood_unit_id
WHERE (a.allocation_status = 'ALLOCATED' AND u.unit_status <> 'ALLOCATED')
   OR (a.allocation_status = 'ISSUED' AND u.unit_status <> 'ISSUED')
   OR (a.allocation_status = 'CANCELLED' AND u.unit_status <> 'AVAILABLE')
UNION ALL SELECT 'Request latest history mismatch', COUNT(*)
FROM HospitalRequest r
LEFT JOIN (
  SELECT ranked.request_id, ranked.request_status_history_id, ranked.new_status
  FROM (
    SELECT h.request_id, h.request_status_history_id, h.new_status,
           ROW_NUMBER() OVER (
             PARTITION BY h.request_id
             ORDER BY h.changed_at DESC, h.request_status_history_id DESC
           ) AS row_rank
    FROM RequestStatusHistory h
  ) ranked
  WHERE ranked.row_rank = 1
) latest_history ON latest_history.request_id = r.request_id
WHERE latest_history.request_status_history_id IS NULL
   OR latest_history.new_status <> r.request_status;

-- Allocation-derived status/quantity display. Allocated and issued are separate.
SELECT r.request_id, r.request_status, r.quantity_requested,
       COALESCE(SUM(a.allocation_status = 'ALLOCATED'), 0) AS allocated_quantity,
       COALESCE(SUM(a.allocation_status = 'ISSUED'), 0) AS issued_quantity,
       CASE
         WHEN r.request_status IN ('FULFILLED', 'REJECTED', 'CANCELLED') THEN 'TERMINAL_SAMPLE'
         WHEN r.request_status IN ('SUBMITTED', 'UNDER_REVIEW') THEN r.request_status
         WHEN COALESCE(SUM(a.allocation_status = 'ISSUED'), 0) = r.quantity_requested THEN 'FULFILLED_BY_ISSUED_COUNT'
         WHEN COALESCE(SUM(a.allocation_status IN ('ALLOCATED', 'ISSUED')), 0) = 0 THEN 'AWAITING_INVENTORY'
         WHEN COALESCE(SUM(a.allocation_status IN ('ALLOCATED', 'ISSUED')), 0) > 0 THEN 'PARTIALLY_FULFILLED'
         ELSE 'REVIEW_REQUIRED'
       END AS quantity_derived_state
FROM HospitalRequest r LEFT JOIN Allocation a ON a.request_id = r.request_id
GROUP BY r.request_id, r.request_status, r.quantity_requested
ORDER BY r.request_id;

-- Existing read-only availability view and report-ready aggregates.
SELECT * FROM v_available_inventory_by_group ORDER BY blood_group_id;
SELECT DATE_FORMAT(collected_at, '%Y-%m') AS collection_month, outcome, COUNT(*) AS donation_count
FROM Donation GROUP BY collection_month, outcome ORDER BY collection_month, outcome;
SELECT DATE_FORMAT(created_at, '%Y-%m') AS request_month, priority, request_status,
       COUNT(*) AS requests, SUM(quantity_requested) AS requested_units
FROM HospitalRequest GROUP BY request_month, priority, request_status
ORDER BY request_month, priority, request_status;
SELECT bg.code, bu.unit_status, COUNT(*) AS units
FROM BloodUnit bu JOIN BloodGroup bg ON bg.blood_group_id = bu.blood_group_id
GROUP BY bg.code, bu.unit_status ORDER BY bg.code, bu.unit_status;
SELECT h.organization_name, r.request_status, COUNT(*) AS requests,
       SUM(r.quantity_requested) AS requested_units
FROM HospitalRequest r JOIN Hospital h ON h.account_id = r.hospital_account_id
GROUP BY h.organization_name, r.request_status
ORDER BY h.organization_name, r.request_status;

-- The seeded examples demonstrate stored rows and report queries only. These
-- SELECTs do not invoke allocation/issue writers or establish their behavior.
