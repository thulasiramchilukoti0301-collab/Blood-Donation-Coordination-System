-- Account identity only. Donor/Hospital profile completeness is enforced by
-- later coordinated profile modules and atomic application workflows.
-- updated_at is application-maintained; this table intentionally has no trigger.

CREATE TABLE Account (
  account_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  email VARCHAR(254) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL,
  password_hash VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL,
  role VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  account_status VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'PENDING',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (account_id),
  CONSTRAINT uq_account_email UNIQUE (email),
  CONSTRAINT ck_account_role CHECK (role IN ('ADMIN', 'HOSPITAL', 'DONOR')),
  CONSTRAINT ck_account_status CHECK (account_status IN ('PENDING', 'ACTIVE', 'SUSPENDED'))
) ENGINE=InnoDB
  DEFAULT CHARACTER SET=utf8mb4
  COLLATE=utf8mb4_0900_ai_ci;
