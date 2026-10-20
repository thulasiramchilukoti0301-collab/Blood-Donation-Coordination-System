-- Donor profile only; requires 001_foundation.sql, 002_auth.sql, and the
-- BloodGroup reference seed to have been applied first.
--
-- Account/profile role matching and atomic registration are future
-- transaction/service invariants. Future dates of birth are rejected by
-- application validation. Authorization for editing confirmed blood group is
-- a future staff/service rule. updated_at is maintained explicitly by future
-- application operations; this table has no automatic-update clause/trigger.

CREATE TABLE Donor (
  account_id BIGINT UNSIGNED NOT NULL,
  full_name VARCHAR(120) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL,
  date_of_birth DATE NOT NULL,
  phone VARCHAR(30) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL,
  address VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL,
  area VARCHAR(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL,
  reported_blood_group_id BIGINT UNSIGNED NULL,
  confirmed_blood_group_id BIGINT UNSIGNED NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (account_id),
  KEY ix_donor_confirmed_blood_group_id (confirmed_blood_group_id),
  KEY ix_donor_full_name (full_name),
  KEY ix_donor_reported_blood_group_id (reported_blood_group_id),
  CONSTRAINT fk_donor_account
    FOREIGN KEY (account_id) REFERENCES Account (account_id)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_donor_reported_blood_group
    FOREIGN KEY (reported_blood_group_id) REFERENCES BloodGroup (blood_group_id)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_donor_confirmed_blood_group
    FOREIGN KEY (confirmed_blood_group_id) REFERENCES BloodGroup (blood_group_id)
    ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE=InnoDB
  DEFAULT CHARACTER SET=utf8mb4
  COLLATE=utf8mb4_0900_ai_ci;
