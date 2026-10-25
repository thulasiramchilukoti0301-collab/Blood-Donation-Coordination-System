-- AuditEvent storage only; requires Account from 002_auth.sql.
-- Authored dependency-plan amendment for Thulasi review before application:
-- this Account-only module may precede 008; it contains no request dependency.
-- RequestStatusHistory and its trigger require a later coordinated migration
-- whose number is unassigned. Do not append them to this migration later.
-- No production action/reason vocabulary or application workflow is installed.

CREATE TABLE AuditEvent (
  audit_event_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  actor_account_id BIGINT UNSIGNED NULL,
  action_code VARCHAR(48) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  subject_type VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  subject_id BIGINT UNSIGNED NULL,
  occurred_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reason_code VARCHAR(40) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL,
  change_summary VARCHAR(1000) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL,
  operation_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  PRIMARY KEY (audit_event_id),
  KEY ix_audit_event_subject (subject_type, subject_id, occurred_at),
  KEY ix_audit_event_actor (actor_account_id, occurred_at),
  CONSTRAINT fk_audit_event_actor
    FOREIGN KEY (actor_account_id) REFERENCES Account (account_id)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT ck_audit_event_subject_type CHECK (subject_type IN (
    'Account', 'Donor', 'Hospital', 'BloodGroup', 'BloodCompatibility',
    'DonationSlot', 'Booking', 'EligibilityDecision', 'Donation', 'BloodUnit',
    'HospitalRequest', 'RequestStatusHistory', 'Allocation', 'AuditEvent', 'SYSTEM_TASK'
  )),
  CONSTRAINT ck_audit_event_subject_id CHECK (
    (subject_type = 'SYSTEM_TASK') <=> (subject_id IS NULL)
  )
) ENGINE=InnoDB
  DEFAULT CHARACTER SET=utf8mb4
  COLLATE=utf8mb4_0900_ai_ci;
