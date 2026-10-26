-- HospitalRequest storage only. Requires 001 BloodGroup, 002 Account and
-- 004 Hospital. AuditEvent (010) is a separate backend-operation dependency.
-- No history table, allocation storage, audit write or API is created here.
-- updated_at is application-maintained. Cross-row allocation-derived status,
-- ownership/session authorization and audit atomicity belong to the caller.

CREATE TABLE HospitalRequest (
  request_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  hospital_account_id BIGINT UNSIGNED NOT NULL,
  recipient_group_id BIGINT UNSIGNED NOT NULL,
  quantity_requested SMALLINT UNSIGNED NOT NULL,
  priority VARCHAR(10) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'NORMAL',
  needed_by DATETIME NOT NULL,
  request_note VARCHAR(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL,
  request_status VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'SUBMITTED',
  rejection_reason_code VARCHAR(40) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (request_id),
  KEY ix_request_status_priority_needed_created (request_status, priority, needed_by, created_at),
  KEY ix_request_hospital_created (hospital_account_id, created_at),
  KEY ix_request_recipient_group (recipient_group_id),
  CONSTRAINT ck_request_quantity CHECK (quantity_requested > 0),
  CONSTRAINT ck_request_priority CHECK (BINARY priority IN ('EMERGENCY', 'URGENT', 'NORMAL')),
  CONSTRAINT ck_request_status CHECK (BINARY request_status IN (
    'SUBMITTED', 'UNDER_REVIEW', 'AWAITING_INVENTORY', 'PARTIALLY_FULFILLED',
    'FULFILLED', 'REJECTED', 'CANCELLED'
  )),
  CONSTRAINT ck_request_rejection_reason CHECK (
    request_status <> 'REJECTED' OR rejection_reason_code IS NOT NULL
  ),
  CONSTRAINT fk_request_hospital
    FOREIGN KEY (hospital_account_id) REFERENCES Hospital (account_id)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_request_recipient_group
    FOREIGN KEY (recipient_group_id) REFERENCES BloodGroup (blood_group_id)
    ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE=InnoDB
  DEFAULT CHARACTER SET=utf8mb4
  COLLATE=utf8mb4_0900_ai_ci;

DELIMITER $$
CREATE TRIGGER trg_request_initial_status
BEFORE INSERT ON HospitalRequest
FOR EACH ROW
BEGIN
  IF NEW.request_status <> 'SUBMITTED' THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'New requests must begin SUBMITTED.';
  END IF;
END$$

CREATE TRIGGER trg_request_update_guard
BEFORE UPDATE ON HospitalRequest
FOR EACH ROW
BEGIN
  IF NOT (NEW.quantity_requested <=> OLD.quantity_requested) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Requested quantity is immutable.';
  END IF;
  IF NOT (NEW.request_status <=> OLD.request_status) THEN
    IF OLD.request_status IN ('FULFILLED', 'REJECTED', 'CANCELLED') THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Terminal requests cannot change status.';
    END IF;
    IF NOT (
      (OLD.request_status = 'SUBMITTED' AND NEW.request_status IN ('UNDER_REVIEW', 'CANCELLED')) OR
      (OLD.request_status = 'UNDER_REVIEW' AND NEW.request_status IN (
        'AWAITING_INVENTORY', 'PARTIALLY_FULFILLED', 'REJECTED', 'CANCELLED')) OR
      (OLD.request_status = 'AWAITING_INVENTORY' AND NEW.request_status IN ('PARTIALLY_FULFILLED', 'CANCELLED')) OR
      (OLD.request_status = 'PARTIALLY_FULFILLED' AND NEW.request_status IN ('FULFILLED', 'AWAITING_INVENTORY', 'CANCELLED'))
    ) THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Invalid request status transition.';
    END IF;
  END IF;
END$$
DELIMITER ;
