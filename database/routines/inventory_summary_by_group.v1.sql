-- Read-only academic demonstration routine, version 1.
-- Requires BloodGroup and BloodUnit in the selected schema.
-- Stored unit status is reported as stored; effective unexpired availability
-- remains a separate concept represented by v_available_inventory_by_group.
DELIMITER $$
CREATE PROCEDURE sp_inventory_summary_by_group()
READS SQL DATA
SQL SECURITY INVOKER
BEGIN
  SELECT bg.blood_group_id,
         bg.code AS blood_group_code,
         bg.display_name,
         bu.unit_status AS stored_unit_status,
         COUNT(bu.blood_unit_id) AS stored_unit_count
  FROM BloodUnit AS bu
  JOIN BloodGroup AS bg
    ON bg.blood_group_id = bu.blood_group_id
  GROUP BY bg.blood_group_id, bg.code, bg.display_name, bu.unit_status
  ORDER BY bg.blood_group_id, bu.unit_status;
END$$
DELIMITER ;
