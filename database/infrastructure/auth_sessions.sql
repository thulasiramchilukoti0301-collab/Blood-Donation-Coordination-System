-- Persistent express-session infrastructure for the web application.
-- Apply manually after selecting the intended local schema. This is not a
-- domain migration, does not consume a reserved migration number, and is not
-- part of the academic entity/sample-row count. Runtime schema creation is off.

CREATE TABLE app_session (
  session_id VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  expires_at BIGINT UNSIGNED NOT NULL,
  session_data MEDIUMTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL,
  revoked_at BIGINT UNSIGNED NULL,
  PRIMARY KEY (session_id),
  KEY ix_app_session_expires_at (expires_at)
) ENGINE=InnoDB
  DEFAULT CHARACTER SET=utf8mb4
  COLLATE=utf8mb4_0900_ai_ci;
