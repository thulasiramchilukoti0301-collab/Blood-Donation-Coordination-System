-- Approved Feature 7 history migration, reserved 2026-10-27 after branch review.
-- Apply manually after 002 and 008; API creation also requires 010 AuditEvent.
-- No automatic development setup. 009/011 retain their existing ownership.
-- Requires 002 Account and 008 HospitalRequest. Does not repurpose 010.
-- Initial NULL -> SUBMITTED history is inserted by the creation transaction.
-- This one AFTER UPDATE trigger alone inserts subsequent status events.
-- Verified human actor and controlled reason are mandatory for status changes.
-- The unverified UUID-only system bypass from the old proposal is disabled.
-- These variables are server context, never a replacement for session checks.
-- Allocation-derived counts, cancellation timing and release of reservations
-- remain caller responsibilities on the same transaction/locking strategy.

CREATE TABLE RequestStatusHistory (
  request_status_history_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  request_id BIGINT UNSIGNED NOT NULL,
  old_status VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NULL,
  new_status VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  changed_by_account_id BIGINT UNSIGNED NULL,
  reason_code VARCHAR(40) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL,
  changed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (request_status_history_id),
  KEY ix_request_history_request_changed (request_id, changed_at),
  KEY ix_request_history_actor (changed_by_account_id),
  CONSTRAINT ck_request_history_old_status CHECK (old_status IS NULL OR BINARY old_status IN (
    'SUBMITTED', 'UNDER_REVIEW', 'AWAITING_INVENTORY', 'PARTIALLY_FULFILLED', 'FULFILLED', 'REJECTED', 'CANCELLED'
  )),
  CONSTRAINT ck_request_history_new_status CHECK (BINARY new_status IN (
    'SUBMITTED', 'UNDER_REVIEW', 'AWAITING_INVENTORY', 'PARTIALLY_FULFILLED', 'FULFILLED', 'REJECTED', 'CANCELLED'
  )),
  CONSTRAINT ck_request_history_initial CHECK (old_status IS NOT NULL OR new_status = 'SUBMITTED'),
  CONSTRAINT fk_request_history_request
    FOREIGN KEY (request_id) REFERENCES HospitalRequest (request_id)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_request_history_actor
    FOREIGN KEY (changed_by_account_id) REFERENCES Account (account_id)
    ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE=InnoDB
  DEFAULT CHARACTER SET=utf8mb4
  COLLATE=utf8mb4_0900_ai_ci;

DELIMITER $$
CREATE TRIGGER trg_request_status_history_update
AFTER UPDATE ON HospitalRequest
FOR EACH ROW
BEGIN
  DECLARE actor_id BIGINT UNSIGNED DEFAULT NULL;
  DECLARE actor_text TEXT;
  DECLARE actor_role VARCHAR(16) DEFAULT NULL;
  DECLARE actor_status VARCHAR(16) DEFAULT NULL;
  DECLARE history_reason VARCHAR(40) DEFAULT NULL;
  DECLARE CONTINUE HANDLER FOR NOT FOUND SET actor_role = NULL;

  IF NOT (OLD.request_status <=> NEW.request_status) THEN
    IF @request_actor_account_id IS NULL THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Verified request actor context is required.';
    ELSE
      IF @request_system_operation_id IS NOT NULL THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Ambiguous request actor context.';
      END IF;
      SET actor_text = CAST(@request_actor_account_id AS CHAR);
      IF actor_text NOT REGEXP '^[1-9][0-9]{0,19}$' OR actor_text REGEXP '[^0-9]' THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Invalid request actor context.';
      END IF;
      IF CAST(actor_text AS DECIMAL(20,0)) > 18446744073709551615 THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Invalid request actor context.';
      END IF;
      SET actor_id = CAST(actor_text AS UNSIGNED);
      SELECT role, account_status INTO actor_role, actor_status
        FROM Account WHERE account_id = actor_id FOR UPDATE;
      IF actor_role IS NULL OR BINARY actor_status <> 'ACTIVE' THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'An active request actor is required.';
      END IF;
      IF BINARY actor_role = 'HOSPITAL' THEN
        IF actor_id <> OLD.hospital_account_id OR actor_id <> NEW.hospital_account_id OR NEW.request_status <> 'CANCELLED' THEN
          SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Hospital status change is not permitted.';
        END IF;
      ELSEIF BINARY actor_role <> 'ADMIN' OR NEW.request_status = 'CANCELLED' THEN
        -- No Admin cancellation API/partial-issue policy is approved yet.
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Request status change is not permitted.';
      END IF;
    END IF;

    IF @request_reason_code IS NULL THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Verified request reason context is required.';
    ELSE
      IF CHAR_LENGTH(CAST(@request_reason_code AS CHAR)) > 40 OR
        CHAR_LENGTH(TRIM(CAST(@request_reason_code AS CHAR))) = 0 OR
        CAST(@request_reason_code AS CHAR) REGEXP '[[:cntrl:]]' THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Invalid request reason context.';
      END IF;
      SET history_reason = CAST(@request_reason_code AS CHAR);
    END IF;
    IF NOT (
      (NEW.request_status = 'UNDER_REVIEW' AND BINARY history_reason = 'REVIEW_STARTED') OR
      (NEW.request_status = 'AWAITING_INVENTORY' AND BINARY history_reason = 'INVENTORY_UNAVAILABLE') OR
      (NEW.request_status = 'PARTIALLY_FULFILLED' AND BINARY history_reason = 'ALLOCATION_UPDATED') OR
      (NEW.request_status = 'FULFILLED' AND BINARY history_reason = 'REQUEST_FULFILLED') OR
      (NEW.request_status = 'REJECTED' AND BINARY history_reason = 'REQUEST_REJECTED') OR
      (NEW.request_status = 'CANCELLED' AND BINARY history_reason = 'HOSPITAL_CANCELLED')
    ) THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Request reason does not match the status change.';
    END IF;
    IF NEW.request_status = 'REJECTED' AND
      (history_reason IS NULL OR NOT (BINARY history_reason <=> BINARY NEW.rejection_reason_code)) THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Rejection reason context must match the request.';
    END IF;
    INSERT INTO RequestStatusHistory
      (request_id, old_status, new_status, changed_by_account_id, reason_code)
      VALUES (NEW.request_id, OLD.request_status, NEW.request_status, actor_id, history_reason);
  END IF;
END$$
DELIMITER ;
