-- Requires 001, 002, reference_data.sql, 003, 005, and 006 in dependency order.
-- Hospital migration 004 is not a dependency.
-- This migration creates BloodUnit storage only; it does not create units from
-- donation approval or implement inventory lifecycle operations.
-- Approval/unit creation must eventually be atomic and idempotent with the
-- required audit infrastructure. Authorization, confirmed-group validation,
-- expiry calculation/source-date validation, allocation, issue, discard,
-- expiry, concurrency, and audit writes remain future service/routine work.
-- expired_at is intentionally nullable without an EXPIRED-only CHECK rule.

CREATE TABLE BloodUnit (
  blood_unit_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  donation_id BIGINT UNSIGNED NOT NULL,
  blood_group_id BIGINT UNSIGNED NOT NULL,
  expiry_date DATE NOT NULL,
  unit_status VARCHAR(12) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'AVAILABLE',
  discarded_at DATETIME NULL,
  discard_reason_code VARCHAR(40) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL,
  expired_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (blood_unit_id),
  CONSTRAINT uq_blood_unit_donation_id UNIQUE (donation_id),
  KEY ix_blood_unit_group_status_expiry_id (blood_group_id, unit_status, expiry_date, blood_unit_id),
  CONSTRAINT ck_blood_unit_status CHECK (
    unit_status IN ('AVAILABLE', 'ALLOCATED', 'ISSUED', 'EXPIRED', 'DISCARDED')
  ),
  CONSTRAINT ck_blood_unit_discarded_at_matches_status CHECK (
    (unit_status = 'DISCARDED') <=> (discarded_at IS NOT NULL)
  ),
  CONSTRAINT ck_blood_unit_discard_reason_matches_status CHECK (
    (unit_status = 'DISCARDED') <=> (discard_reason_code IS NOT NULL)
  ),
  CONSTRAINT fk_blood_unit_donation
    FOREIGN KEY (donation_id) REFERENCES Donation (donation_id)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_blood_unit_blood_group
    FOREIGN KEY (blood_group_id) REFERENCES BloodGroup (blood_group_id)
    ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE=InnoDB
  DEFAULT CHARACTER SET=utf8mb4
  COLLATE=utf8mb4_0900_ai_ci;
