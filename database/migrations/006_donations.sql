-- Requires Account (002) and Booking (005). Hospital (004) is not a dependency.
-- This migration stores donation outcomes and release decisions only.
-- Recording an outcome does not create a BloodUnit. Atomic, idempotent unit
-- creation after approval requires later inventory/audit schema and service work.
-- PENDING is the static release_status default for collected outcomes;
-- non-collected outcomes must explicitly store NOT_REQUIRED.
-- Actor authorization, booking/day-of eligibility, lifecycle transitions,
-- timestamp policy, and corrections remain outside this row-level DDL.

CREATE TABLE Donation (
  donation_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  booking_id BIGINT UNSIGNED NOT NULL,
  recorded_by_account_id BIGINT UNSIGNED NOT NULL,
  outcome VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  collected_at DATETIME NULL,
  collection_reference VARCHAR(80) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL,
  release_status VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'PENDING',
  release_decided_by_account_id BIGINT UNSIGNED NULL,
  release_decided_at DATETIME NULL,
  release_reason_code VARCHAR(40) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (donation_id),
  UNIQUE KEY uq_donation_booking_id (booking_id),
  UNIQUE KEY uq_donation_collection_reference (collection_reference),
  KEY ix_donation_recorded_by_account_id (recorded_by_account_id),
  KEY ix_donation_release_decided_by_account_id (release_decided_by_account_id),
  KEY ix_donation_collected_outcome_release (collected_at, outcome, release_status),
  CONSTRAINT ck_donation_outcome CHECK (outcome IN ('COLLECTED', 'INCOMPLETE', 'DEFERRED')),
  CONSTRAINT ck_donation_collected_at_matches_outcome CHECK (
    (outcome = 'COLLECTED') <=> (collected_at IS NOT NULL)
  ),
  CONSTRAINT ck_donation_release_status_for_outcome CHECK (
    outcome NOT IN ('COLLECTED', 'INCOMPLETE', 'DEFERRED')
    OR (outcome = 'COLLECTED' AND release_status IN ('PENDING', 'APPROVED', 'REJECTED'))
    OR (outcome IN ('INCOMPLETE', 'DEFERRED') AND release_status = 'NOT_REQUIRED')
  ),
  CONSTRAINT ck_donation_release_decision_timestamp CHECK (
    release_status NOT IN ('APPROVED', 'REJECTED') OR release_decided_at IS NOT NULL
  ),
  CONSTRAINT ck_donation_rejection_reason CHECK (
    release_status <> 'REJECTED' OR release_reason_code IS NOT NULL
  ),
  CONSTRAINT fk_donation_booking
    FOREIGN KEY (booking_id) REFERENCES Booking (booking_id)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_donation_recorded_by_account
    FOREIGN KEY (recorded_by_account_id) REFERENCES Account (account_id)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_donation_release_decided_by_account
    FOREIGN KEY (release_decided_by_account_id) REFERENCES Account (account_id)
    ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE=InnoDB
  DEFAULT CHARACTER SET=utf8mb4
  COLLATE=utf8mb4_0900_ai_ci;
