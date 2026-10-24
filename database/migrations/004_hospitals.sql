-- Hospital profile storage only; requires Account from 002_auth.sql.
-- Use the reviewed foundation assembly (001, 002, reference_data.sql) first.
-- Account/profile role matching and atomic registration are future shared
-- service invariants. The FK guarantees existence, not the HOSPITAL role.
-- updated_at is application-maintained; no automatic-update clause or trigger.

CREATE TABLE Hospital (
  account_id BIGINT UNSIGNED NOT NULL,
  organization_name VARCHAR(180) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL,
  registration_number VARCHAR(80) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL,
  contact_name VARCHAR(120) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL,
  phone VARCHAR(30) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL,
  address VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (account_id),
  CONSTRAINT uq_hospital_registration_number UNIQUE (registration_number),
  CONSTRAINT fk_hospital_account
    FOREIGN KEY (account_id) REFERENCES Account (account_id)
    ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE=InnoDB
  DEFAULT CHARACTER SET=utf8mb4
  COLLATE=utf8mb4_0900_ai_ci;
