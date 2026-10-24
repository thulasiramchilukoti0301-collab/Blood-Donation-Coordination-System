CREATE SQL SECURITY INVOKER VIEW v_available_inventory_by_group AS
SELECT
  bg.blood_group_id,
  bg.code,
  bg.display_name,
  COUNT(bu.blood_unit_id) AS available_unit_count
FROM BloodUnit AS bu
JOIN Donation AS d
  ON d.donation_id = bu.donation_id
JOIN BloodGroup AS bg
  ON bg.blood_group_id = bu.blood_group_id
WHERE bu.unit_status = 'AVAILABLE'
  AND bu.expiry_date > CURRENT_DATE()
  AND d.outcome = 'COLLECTED'
  AND d.release_status = 'APPROVED'
GROUP BY bg.blood_group_id, bg.code, bg.display_name;
