-- Read-only teaching queries for Thulasi's donor, donation, and inventory modules.
-- Caller-supplied values use mysql2-style ? placeholders; callers must bind
-- values and must enforce ownership from the authenticated server session.
-- DATETIME bounds are lower-inclusive and upper-exclusive. Expiry DATE bounds
-- in inventory-search are both inclusive. No statement mutates database state.

-- query: donor-donation-history
-- Parameters: donor account ID, lower collected_at DATETIME or NULL (twice),
--              upper collected_at DATETIME or NULL (twice).
-- Columns: donor_account_id, donor_name, booking_id, booking_status, slot_id,
--          slot_starts_at, slot_ends_at, donation_id, outcome, collected_at,
--          release_status, release_decided_at.
-- With both bounds NULL, non-collected rows with NULL collected_at are included.
-- Supplying either bound excludes those NULL collected_at rows. Ordering is
-- deterministic by collected_at descending, then donation_id descending.
SELECT
  d.account_id AS donor_account_id,
  d.full_name AS donor_name,
  b.booking_id,
  b.booking_status,
  s.slot_id,
  s.starts_at AS slot_starts_at,
  s.ends_at AS slot_ends_at,
  dn.donation_id,
  dn.outcome,
  dn.collected_at,
  dn.release_status,
  dn.release_decided_at
FROM Donor AS d
JOIN Account AS a
  ON a.account_id = d.account_id
JOIN Booking AS b
  ON b.donor_account_id = d.account_id
JOIN DonationSlot AS s
  ON s.slot_id = b.slot_id
JOIN Donation AS dn
  ON dn.booking_id = b.booking_id
WHERE d.account_id = ?
  AND (? IS NULL OR dn.collected_at >= ?)
  AND (? IS NULL OR dn.collected_at < ?)
ORDER BY dn.collected_at DESC, dn.donation_id DESC;

-- query: blood-unit-traceability
-- Parameters: blood unit ID.
-- Columns: blood_unit_id, blood_group_id, blood_group_code,
--          blood_group_name, unit_status, expiry_date, donation_id, booking_id,
--          donor_account_id, collected_at, release_status.
-- A missing unit returns no rows. No donor contact, credentials, or detailed
-- medical data is returned. The source IDs provide record traceability.
SELECT
  bu.blood_unit_id,
  bg.blood_group_id,
  bg.code AS blood_group_code,
  bg.display_name AS blood_group_name,
  bu.unit_status,
  bu.expiry_date,
  dn.donation_id,
  b.booking_id,
  d.account_id AS donor_account_id,
  dn.collected_at,
  dn.release_status
FROM BloodUnit AS bu
JOIN BloodGroup AS bg
  ON bg.blood_group_id = bu.blood_group_id
JOIN Donation AS dn
  ON dn.donation_id = bu.donation_id
JOIN Booking AS b
  ON b.booking_id = dn.booking_id
JOIN Donor AS d
  ON d.account_id = b.donor_account_id
WHERE bu.blood_unit_id = ?;

-- query: donation-search
-- Parameters: donor account ID or NULL (twice), outcome or NULL (twice),
--              lower collected_at DATETIME or NULL (twice), upper collected_at
--              DATETIME or NULL (twice).
-- Columns: donation_id, booking_id, donor_account_id, outcome, collected_at,
--          release_status, release_decided_at. Returns exactly one row per
-- Donation. Bounds are lower-inclusive/upper-exclusive; when either is set,
-- rows with NULL collected_at are excluded. Order is deterministic by
-- collected_at descending then donation_id descending.
SELECT
  dn.donation_id,
  dn.booking_id,
  b.donor_account_id,
  dn.outcome,
  dn.collected_at,
  dn.release_status,
  dn.release_decided_at
FROM Donation AS dn
JOIN Booking AS b
  ON b.booking_id = dn.booking_id
WHERE (? IS NULL OR b.donor_account_id = ?)
  AND (? IS NULL OR dn.outcome = ?)
  AND (? IS NULL OR dn.collected_at >= ?)
  AND (? IS NULL OR dn.collected_at < ?)
ORDER BY dn.collected_at DESC, dn.donation_id DESC;

-- query: inventory-search
-- Parameters: blood group ID or NULL (twice), unit status or NULL (twice),
--              inclusive lower expiry DATE or NULL (twice), inclusive upper
--              expiry DATE or NULL (twice).
-- Columns: blood_unit_id, blood_group_id, blood_group_code,
--          blood_group_name, expiry_date, unit_status, donation_id,
--          donation_outcome, release_status. General inventory search includes
-- every stored unit status; it does not silently mean available-only.
-- Ordering is deterministic by expiry_date, blood_group_id, blood_unit_id.
SELECT
  bu.blood_unit_id,
  bg.blood_group_id,
  bg.code AS blood_group_code,
  bg.display_name AS blood_group_name,
  bu.expiry_date,
  bu.unit_status,
  dn.donation_id,
  dn.outcome AS donation_outcome,
  dn.release_status
FROM BloodUnit AS bu
JOIN BloodGroup AS bg
  ON bg.blood_group_id = bu.blood_group_id
JOIN Donation AS dn
  ON dn.donation_id = bu.donation_id
WHERE (? IS NULL OR bu.blood_group_id = ?)
  AND (? IS NULL OR bu.unit_status = ?)
  AND (? IS NULL OR bu.expiry_date >= ?)
  AND (? IS NULL OR bu.expiry_date <= ?)
ORDER BY bu.expiry_date, bg.blood_group_id, bu.blood_unit_id;

-- query: donation-outcome-counts
-- Parameters: lower collected_at DATETIME or NULL (twice), upper collected_at
--              DATETIME or NULL (twice).
-- Columns: outcome, donation_count. Bounds are lower-inclusive/upper-exclusive;
-- setting either bound excludes non-collected rows whose collected_at is NULL.
-- Outcomes are grouped by their exact stored code; order is alphabetical.
SELECT
  dn.outcome,
  COUNT(*) AS donation_count
FROM Donation AS dn
WHERE (? IS NULL OR dn.collected_at >= ?)
  AND (? IS NULL OR dn.collected_at < ?)
GROUP BY dn.outcome
ORDER BY dn.outcome;

-- query: inventory-status-counts
-- Parameters: none.
-- Columns: blood_group_id, blood_group_code, blood_group_name, unit_status,
--          unit_count. Groups with no BloodUnit rows do not appear. Ordering is
-- deterministic by blood_group_id then exact unit_status code.
SELECT
  bg.blood_group_id,
  bg.code AS blood_group_code,
  bg.display_name AS blood_group_name,
  bu.unit_status,
  COUNT(*) AS unit_count
FROM BloodUnit AS bu
JOIN BloodGroup AS bg
  ON bg.blood_group_id = bu.blood_group_id
GROUP BY bg.blood_group_id, bg.code, bg.display_name, bu.unit_status
ORDER BY bg.blood_group_id, bu.unit_status;

-- query: approved-collection-to-release-duration
-- Parameters: none.
-- Columns: eligible_donation_count, average_elapsed_hours. Only COLLECTED /
--          APPROVED donations with both timestamps are included. Elapsed
--          seconds are divided by 3600.0 to preserve fractional hours. With
--          no eligible rows COUNT is zero and AVG is NULL.
SELECT
  COUNT(*) AS eligible_donation_count,
  AVG(TIMESTAMPDIFF(SECOND, dn.collected_at, dn.release_decided_at) / 3600.0)
    AS average_elapsed_hours
FROM Donation AS dn
WHERE dn.outcome = 'COLLECTED'
  AND dn.release_status = 'APPROVED'
  AND dn.collected_at IS NOT NULL
  AND dn.release_decided_at IS NOT NULL;
