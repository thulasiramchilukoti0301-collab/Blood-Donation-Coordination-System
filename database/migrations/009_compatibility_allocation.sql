-- Feature 8 storage. Apply once manually after 001-008 and canonical BloodGroup seed.
-- Preflight the eight canonical BloodGroup IDs/codes before application.

CREATE TEMPORARY TABLE feature8_seed_guard (
  valid TINYINT NOT NULL,
  CONSTRAINT ck_feature8_seed_guard CHECK (valid = 1)
);
INSERT INTO feature8_seed_guard (valid)
SELECT COUNT(*) = 8 AND COALESCE(SUM(CASE
  WHEN blood_group_id = 1 AND code = 'O-' THEN 1
  WHEN blood_group_id = 2 AND code = 'O+' THEN 1
  WHEN blood_group_id = 3 AND code = 'A-' THEN 1
  WHEN blood_group_id = 4 AND code = 'A+' THEN 1
  WHEN blood_group_id = 5 AND code = 'B-' THEN 1
  WHEN blood_group_id = 6 AND code = 'B+' THEN 1
  WHEN blood_group_id = 7 AND code = 'AB-' THEN 1
  WHEN blood_group_id = 8 AND code = 'AB+' THEN 1
  ELSE 0 END), 0) = 8
FROM BloodGroup;

CREATE TABLE BloodCompatibility (
  donor_group_id BIGINT UNSIGNED NOT NULL,
  recipient_group_id BIGINT UNSIGNED NOT NULL,
  is_compatible BOOLEAN NOT NULL,
  PRIMARY KEY (donor_group_id, recipient_group_id),
  KEY ix_compatibility_recipient_compatible_donor (recipient_group_id, is_compatible, donor_group_id),
  CONSTRAINT ck_compatibility_boolean CHECK (is_compatible IN (0, 1)),
  CONSTRAINT fk_compatibility_donor FOREIGN KEY (donor_group_id) REFERENCES BloodGroup (blood_group_id)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_compatibility_recipient FOREIGN KEY (recipient_group_id) REFERENCES BloodGroup (blood_group_id)
    ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Complete directed red-cell matrix; existing BloodGroup rows are never changed.
INSERT INTO BloodCompatibility (donor_group_id, recipient_group_id, is_compatible)
SELECT donor.blood_group_id, recipient.blood_group_id,
  CASE
    WHEN donor.code = 'O-' THEN 1
    WHEN donor.code = 'O+' THEN recipient.code IN ('O+', 'A+', 'B+', 'AB+')
    WHEN donor.code = 'A-' THEN recipient.code IN ('A-', 'A+', 'AB-', 'AB+')
    WHEN donor.code = 'A+' THEN recipient.code IN ('A+', 'AB+')
    WHEN donor.code = 'B-' THEN recipient.code IN ('B-', 'B+', 'AB-', 'AB+')
    WHEN donor.code = 'B+' THEN recipient.code IN ('B+', 'AB+')
    WHEN donor.code = 'AB-' THEN recipient.code IN ('AB-', 'AB+')
    WHEN donor.code = 'AB+' THEN recipient.code = 'AB+'
  END
FROM BloodGroup AS donor CROSS JOIN BloodGroup AS recipient
WHERE donor.blood_group_id BETWEEN 1 AND 8 AND recipient.blood_group_id BETWEEN 1 AND 8;

INSERT INTO feature8_seed_guard (valid)
SELECT COUNT(*) = 64 AND COALESCE(SUM(is_compatible), 0) = 27 FROM BloodCompatibility;
DROP TEMPORARY TABLE feature8_seed_guard;

CREATE TABLE Allocation (
  allocation_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  request_id BIGINT UNSIGNED NOT NULL,
  blood_unit_id BIGINT UNSIGNED NOT NULL,
  allocation_status VARCHAR(12) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'ALLOCATED',
  allocated_by_account_id BIGINT UNSIGNED NOT NULL,
  allocated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  issued_at DATETIME NULL,
  handoff_reference VARCHAR(80) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL,
  cancelled_at DATETIME NULL,
  cancellation_reason_code VARCHAR(40) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL,
  active_blood_unit_id BIGINT UNSIGNED GENERATED ALWAYS AS
    (CASE WHEN allocation_status IN ('ALLOCATED', 'ISSUED') THEN blood_unit_id ELSE NULL END) STORED,
  PRIMARY KEY (allocation_id),
  UNIQUE KEY uq_allocation_active_blood_unit (active_blood_unit_id),
  KEY ix_allocation_request_status (request_id, allocation_status),
  KEY ix_allocation_blood_unit (blood_unit_id),
  KEY ix_allocation_actor (allocated_by_account_id),
  CONSTRAINT ck_allocation_status CHECK (allocation_status IN ('ALLOCATED', 'ISSUED', 'CANCELLED')),
  CONSTRAINT ck_allocation_issued_at CHECK ((allocation_status = 'ISSUED') <=> (issued_at IS NOT NULL)),
  CONSTRAINT ck_allocation_cancelled_at CHECK ((allocation_status = 'CANCELLED') <=> (cancelled_at IS NOT NULL)),
  CONSTRAINT ck_allocation_cancel_reason CHECK ((allocation_status = 'CANCELLED') <=> (cancellation_reason_code IS NOT NULL)),
  CONSTRAINT fk_allocation_request FOREIGN KEY (request_id) REFERENCES HospitalRequest (request_id)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_allocation_unit FOREIGN KEY (blood_unit_id) REFERENCES BloodUnit (blood_unit_id)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_allocation_actor FOREIGN KEY (allocated_by_account_id) REFERENCES Account (account_id)
    ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
