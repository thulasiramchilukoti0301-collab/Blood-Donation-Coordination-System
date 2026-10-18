-- Official Phase 3 foundation module. Run against a new, explicitly selected
-- local development database using utf8mb4_0900_ai_ci as its default collation.
-- BloodCompatibility belongs to Lathikaa's coordinated compatibility module.

CREATE TABLE BloodGroup (
  blood_group_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  code CHAR(3) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  display_name VARCHAR(12) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  PRIMARY KEY (blood_group_id),
  CONSTRAINT uq_blood_group_code UNIQUE (code),
  CONSTRAINT uq_blood_group_display_name UNIQUE (display_name),
  CONSTRAINT ck_blood_group_code CHECK (code IN ('O-', 'O+', 'A-', 'A+', 'B-', 'B+', 'AB-', 'AB+')),
  CONSTRAINT ck_blood_group_is_active CHECK (is_active IN (0, 1))
) ENGINE=InnoDB
  DEFAULT CHARACTER SET=utf8mb4
  COLLATE=utf8mb4_0900_ai_ci;
