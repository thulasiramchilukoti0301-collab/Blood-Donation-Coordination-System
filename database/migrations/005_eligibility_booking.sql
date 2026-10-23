-- Requires 001_foundation.sql, 002_auth.sql, reference_data.sql, and
-- 003_donors.sql. Hospital migration 004 is not a dependency.
-- This migration creates storage only. Capacity, donor overlap, schedule edits,
-- actor/account state, evaluation-date, and lifecycle rules remain
-- transactional/service concerns. It adds no location field or overlap ban.
-- Booking evaluation date, REVIEW_REQUIRED blocking, and indefinite-review
-- semantics remain open decisions and do not change this storage contract.

CREATE TABLE DonationSlot (
  slot_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  starts_at DATETIME NOT NULL,
  ends_at DATETIME NOT NULL,
  capacity SMALLINT UNSIGNED NOT NULL,
  slot_status VARCHAR(12) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'OPEN',
  created_by_account_id BIGINT UNSIGNED NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (slot_id),
  KEY ix_donation_slot_status_starts_at (slot_status, starts_at),
  KEY ix_donation_slot_created_by_account_id (created_by_account_id),
  CONSTRAINT ck_donation_slot_time_order CHECK (ends_at > starts_at),
  CONSTRAINT ck_donation_slot_capacity_positive CHECK (capacity > 0),
  CONSTRAINT ck_donation_slot_status CHECK (slot_status IN ('OPEN', 'CLOSED', 'CANCELLED')),
  CONSTRAINT fk_donation_slot_created_by_account
    FOREIGN KEY (created_by_account_id) REFERENCES Account (account_id)
    ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE=InnoDB
  DEFAULT CHARACTER SET=utf8mb4
  COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE Booking (
  booking_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  donor_account_id BIGINT UNSIGNED NOT NULL,
  slot_id BIGINT UNSIGNED NOT NULL,
  booking_status VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'BOOKED',
  booked_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  status_changed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  cancellation_reason VARCHAR(160) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL,
  PRIMARY KEY (booking_id),
  UNIQUE KEY uq_booking_donor_slot (donor_account_id, slot_id),
  UNIQUE KEY uq_booking_booking_donor (booking_id, donor_account_id),
  KEY ix_booking_donor_account_status (donor_account_id, booking_status),
  KEY ix_booking_slot_status (slot_id, booking_status),
  CONSTRAINT ck_booking_status CHECK (booking_status IN (
    'BOOKED', 'CANCELLED_BY_DONOR', 'CANCELLED_BY_STAFF',
    'CHECKED_IN', 'NO_SHOW', 'COMPLETED'
  )),
  CONSTRAINT fk_booking_donor
    FOREIGN KEY (donor_account_id) REFERENCES Donor (account_id)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_booking_slot
    FOREIGN KEY (slot_id) REFERENCES DonationSlot (slot_id)
    ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE=InnoDB
  DEFAULT CHARACTER SET=utf8mb4
  COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE EligibilityDecision (
  eligibility_decision_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  donor_account_id BIGINT UNSIGNED NOT NULL,
  booking_id BIGINT UNSIGNED NULL,
  decided_by_account_id BIGINT UNSIGNED NOT NULL,
  decision VARCHAR(24) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  reason_code VARCHAR(40) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL,
  deferred_until DATE NULL,
  decided_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (eligibility_decision_id),
  KEY ix_eligibility_decision_donor_decided_at (donor_account_id, decided_at),
  KEY ix_eligibility_decision_booking_donor (booking_id, donor_account_id),
  KEY ix_eligibility_decision_decided_by_account_id (decided_by_account_id),
  CONSTRAINT ck_eligibility_decision_value CHECK (decision IN (
    'ACCEPTED', 'TEMPORARILY_DEFERRED', 'REVIEW_REQUIRED'
  )),
  CONSTRAINT ck_eligibility_temporary_deferral_date CHECK (
    decision <> 'TEMPORARILY_DEFERRED' OR deferred_until IS NOT NULL
  ),
  CONSTRAINT fk_eligibility_decision_donor
    FOREIGN KEY (donor_account_id) REFERENCES Donor (account_id)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_eligibility_decision_booking_donor
    FOREIGN KEY (booking_id, donor_account_id)
    REFERENCES Booking (booking_id, donor_account_id)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_eligibility_decision_decided_by_account
    FOREIGN KEY (decided_by_account_id) REFERENCES Account (account_id)
    ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE=InnoDB
  DEFAULT CHARACTER SET=utf8mb4
  COLLATE=utf8mb4_0900_ai_ci;
