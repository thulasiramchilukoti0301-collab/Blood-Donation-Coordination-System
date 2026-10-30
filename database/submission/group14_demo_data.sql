-- FICTIONAL GROUP 14 ACADEMIC DEMONSTRATION DATA ONLY.
-- Run only as part of group14_fresh_build.ps1 against its new dedicated schema.
-- This script is intentionally one-shot and is not a migration or workflow verifier.
-- It creates no app_session rows and does not enable any allocation/issue writer.
-- Allocation rows marked DEMO_SEED_ONLY are illustrative stored examples only.

SET time_zone = '+05:30';

INSERT INTO Account
  (account_id, email, password_hash, role, account_status, created_at, updated_at)
VALUES
  (1, 'admin@group14.demo.invalid', '$2b$12$OyiMsO8hhvTy2rzFlBVBsuUaxA3fvHma9F0y7w6g3mrZ9ZWgUguIq', 'ADMIN', 'ACTIVE', '2026-09-30 08:00:00', '2026-09-30 08:00:00'),
  (101, 'donor01@group14.demo.invalid', '$2b$12$VcqAzhu.JpXd0OZSZKs1Be7//eBqbPRvDcnGdTxXixITo/hNG7LmO', 'DONOR', 'ACTIVE', '2026-09-30 08:01:00', '2026-09-30 08:01:00'),
  (102, 'donor02@group14.demo.invalid', '$2b$12$VcqAzhu.JpXd0OZSZKs1Be7//eBqbPRvDcnGdTxXixITo/hNG7LmO', 'DONOR', 'ACTIVE', '2026-09-30 08:02:00', '2026-09-30 08:02:00'),
  (103, 'donor03@group14.demo.invalid', '$2b$12$VcqAzhu.JpXd0OZSZKs1Be7//eBqbPRvDcnGdTxXixITo/hNG7LmO', 'DONOR', 'ACTIVE', '2026-09-30 08:03:00', '2026-09-30 08:03:00'),
  (104, 'donor04@group14.demo.invalid', '$2b$12$VcqAzhu.JpXd0OZSZKs1Be7//eBqbPRvDcnGdTxXixITo/hNG7LmO', 'DONOR', 'ACTIVE', '2026-09-30 08:04:00', '2026-09-30 08:04:00'),
  (105, 'donor05@group14.demo.invalid', '$2b$12$VcqAzhu.JpXd0OZSZKs1Be7//eBqbPRvDcnGdTxXixITo/hNG7LmO', 'DONOR', 'ACTIVE', '2026-09-30 08:05:00', '2026-09-30 08:05:00'),
  (106, 'donor06@group14.demo.invalid', '$2b$12$VcqAzhu.JpXd0OZSZKs1Be7//eBqbPRvDcnGdTxXixITo/hNG7LmO', 'DONOR', 'ACTIVE', '2026-09-30 08:06:00', '2026-09-30 08:06:00'),
  (107, 'donor07@group14.demo.invalid', '$2b$12$VcqAzhu.JpXd0OZSZKs1Be7//eBqbPRvDcnGdTxXixITo/hNG7LmO', 'DONOR', 'ACTIVE', '2026-09-30 08:07:00', '2026-09-30 08:07:00'),
  (108, 'donor08@group14.demo.invalid', '$2b$12$VcqAzhu.JpXd0OZSZKs1Be7//eBqbPRvDcnGdTxXixITo/hNG7LmO', 'DONOR', 'ACTIVE', '2026-09-30 08:08:00', '2026-09-30 08:08:00'),
  (109, 'donor09@group14.demo.invalid', '$2b$12$VcqAzhu.JpXd0OZSZKs1Be7//eBqbPRvDcnGdTxXixITo/hNG7LmO', 'DONOR', 'ACTIVE', '2026-09-30 08:09:00', '2026-09-30 08:09:00'),
  (110, 'donor10@group14.demo.invalid', '$2b$12$VcqAzhu.JpXd0OZSZKs1Be7//eBqbPRvDcnGdTxXixITo/hNG7LmO', 'DONOR', 'ACTIVE', '2026-09-30 08:10:00', '2026-09-30 08:10:00'),
  (111, 'donor11@group14.demo.invalid', '$2b$12$VcqAzhu.JpXd0OZSZKs1Be7//eBqbPRvDcnGdTxXixITo/hNG7LmO', 'DONOR', 'ACTIVE', '2026-09-30 08:11:00', '2026-09-30 08:11:00'),
  (112, 'donor12@group14.demo.invalid', '$2b$12$VcqAzhu.JpXd0OZSZKs1Be7//eBqbPRvDcnGdTxXixITo/hNG7LmO', 'DONOR', 'ACTIVE', '2026-09-30 08:12:00', '2026-09-30 08:12:00'),
  (201, 'hospital01@group14.demo.invalid', '$2b$12$bZd1/uxUmyB5E6RTSF3PFeXMfLkGcTEtrl4kEiSaxgM.q5i1RLTuu', 'HOSPITAL', 'ACTIVE', '2026-09-30 08:21:00', '2026-09-30 08:21:00'),
  (202, 'hospital02@group14.demo.invalid', '$2b$12$bZd1/uxUmyB5E6RTSF3PFeXMfLkGcTEtrl4kEiSaxgM.q5i1RLTuu', 'HOSPITAL', 'ACTIVE', '2026-09-30 08:22:00', '2026-09-30 08:22:00'),
  (203, 'hospital03@group14.demo.invalid', '$2b$12$bZd1/uxUmyB5E6RTSF3PFeXMfLkGcTEtrl4kEiSaxgM.q5i1RLTuu', 'HOSPITAL', 'ACTIVE', '2026-09-30 08:23:00', '2026-09-30 08:23:00'),
  (204, 'hospital04@group14.demo.invalid', '$2b$12$bZd1/uxUmyB5E6RTSF3PFeXMfLkGcTEtrl4kEiSaxgM.q5i1RLTuu', 'HOSPITAL', 'ACTIVE', '2026-09-30 08:24:00', '2026-09-30 08:24:00'),
  (205, 'hospital05@group14.demo.invalid', '$2b$12$bZd1/uxUmyB5E6RTSF3PFeXMfLkGcTEtrl4kEiSaxgM.q5i1RLTuu', 'HOSPITAL', 'ACTIVE', '2026-09-30 08:25:00', '2026-09-30 08:25:00'),
  (206, 'hospital06@group14.demo.invalid', '$2b$12$bZd1/uxUmyB5E6RTSF3PFeXMfLkGcTEtrl4kEiSaxgM.q5i1RLTuu', 'HOSPITAL', 'ACTIVE', '2026-09-30 08:26:00', '2026-09-30 08:26:00'),
  (207, 'hospital07@group14.demo.invalid', '$2b$12$bZd1/uxUmyB5E6RTSF3PFeXMfLkGcTEtrl4kEiSaxgM.q5i1RLTuu', 'HOSPITAL', 'ACTIVE', '2026-09-30 08:27:00', '2026-09-30 08:27:00'),
  (208, 'hospital08@group14.demo.invalid', '$2b$12$bZd1/uxUmyB5E6RTSF3PFeXMfLkGcTEtrl4kEiSaxgM.q5i1RLTuu', 'HOSPITAL', 'ACTIVE', '2026-09-30 08:28:00', '2026-09-30 08:28:00'),
  (209, 'hospital09@group14.demo.invalid', '$2b$12$bZd1/uxUmyB5E6RTSF3PFeXMfLkGcTEtrl4kEiSaxgM.q5i1RLTuu', 'HOSPITAL', 'ACTIVE', '2026-09-30 08:29:00', '2026-09-30 08:29:00'),
  (210, 'hospital10@group14.demo.invalid', '$2b$12$bZd1/uxUmyB5E6RTSF3PFeXMfLkGcTEtrl4kEiSaxgM.q5i1RLTuu', 'HOSPITAL', 'ACTIVE', '2026-09-30 08:30:00', '2026-09-30 08:30:00');

INSERT INTO Donor
  (account_id, full_name, date_of_birth, phone, address, area, reported_blood_group_id, confirmed_blood_group_id, created_at, updated_at)
VALUES
  (101, 'Demo Donor 01', '1990-02-14', 'DEMO-DONOR-0001', 'Group 14 Demo Road 01, Fiction City', 'North', 1, 1, '2026-09-30 08:01:00', '2026-09-30 08:01:00'),
  (102, 'Demo Donor 02', '1992-06-21', 'DEMO-DONOR-0002', 'Group 14 Demo Road 02, Fiction City', 'South', 2, 2, '2026-09-30 08:02:00', '2026-09-30 08:02:00'),
  (103, 'Demo Donor 03', '1988-11-03', 'DEMO-DONOR-0003', 'Group 14 Demo Road 03, Fiction City', 'East', 4, 3, '2026-09-30 08:03:00', '2026-09-30 08:03:00'),
  (104, 'Demo Donor 04', '1995-04-09', 'DEMO-DONOR-0004', 'Group 14 Demo Road 04, Fiction City', 'West', 4, 4, '2026-09-30 08:04:00', '2026-09-30 08:04:00'),
  (105, 'Demo Donor 05', '1991-08-17', 'DEMO-DONOR-0005', 'Group 14 Demo Road 05, Fiction City', 'Central', 5, 5, '2026-09-30 08:05:00', '2026-09-30 08:05:00'),
  (106, 'Demo Donor 06', '1993-12-25', 'DEMO-DONOR-0006', 'Group 14 Demo Road 06, Fiction City', 'North', 8, 6, '2026-09-30 08:06:00', '2026-09-30 08:06:00'),
  (107, 'Demo Donor 07', '1989-03-12', 'DEMO-DONOR-0007', 'Group 14 Demo Road 07, Fiction City', 'South', 7, 7, '2026-09-30 08:07:00', '2026-09-30 08:07:00'),
  (108, 'Demo Donor 08', '1994-09-30', 'DEMO-DONOR-0008', 'Group 14 Demo Road 08, Fiction City', 'East', 8, 8, '2026-09-30 08:08:00', '2026-09-30 08:08:00'),
  (109, 'Demo Donor 09', '1987-01-28', 'DEMO-DONOR-0009', 'Group 14 Demo Road 09, Fiction City', 'West', 1, 1, '2026-09-30 08:09:00', '2026-09-30 08:09:00'),
  (110, 'Demo Donor 10', '1996-07-05', 'DEMO-DONOR-0010', 'Group 14 Demo Road 10, Fiction City', 'Central', 3, 4, '2026-09-30 08:10:00', '2026-09-30 08:10:00'),
  (111, 'Demo Donor 11', '1990-10-11', 'DEMO-DONOR-0011', 'Group 14 Demo Road 11, Fiction City', 'North', 2, 2, '2026-09-30 08:11:00', '2026-09-30 08:11:00'),
  (112, 'Demo Donor 12', '1992-12-12', 'DEMO-DONOR-0012', 'Group 14 Demo Road 12, Fiction City', 'South', 6, 6, '2026-09-30 08:12:00', '2026-09-30 08:12:00');

INSERT INTO Hospital
  (account_id, organization_name, registration_number, contact_name, phone, address, created_at, updated_at)
VALUES
  (201, 'Group 14 Demo Hospital 01', 'G14-DEMO-HOSP-001', 'Demo Contact 01', 'DEMO-HOSPITAL-0001', 'Group 14 Demo Avenue 01, Fiction City', '2026-09-30 08:21:00', '2026-09-30 08:21:00'),
  (202, 'Group 14 Demo Hospital 02', 'G14-DEMO-HOSP-002', 'Demo Contact 02', 'DEMO-HOSPITAL-0002', 'Group 14 Demo Avenue 02, Fiction City', '2026-09-30 08:22:00', '2026-09-30 08:22:00'),
  (203, 'Group 14 Demo Hospital 03', 'G14-DEMO-HOSP-003', 'Demo Contact 03', 'DEMO-HOSPITAL-0003', 'Group 14 Demo Avenue 03, Fiction City', '2026-09-30 08:23:00', '2026-09-30 08:23:00'),
  (204, 'Group 14 Demo Hospital 04', 'G14-DEMO-HOSP-004', 'Demo Contact 04', 'DEMO-HOSPITAL-0004', 'Group 14 Demo Avenue 04, Fiction City', '2026-09-30 08:24:00', '2026-09-30 08:24:00'),
  (205, 'Group 14 Demo Hospital 05', 'G14-DEMO-HOSP-005', 'Demo Contact 05', 'DEMO-HOSPITAL-0005', 'Group 14 Demo Avenue 05, Fiction City', '2026-09-30 08:25:00', '2026-09-30 08:25:00'),
  (206, 'Group 14 Demo Hospital 06', 'G14-DEMO-HOSP-006', 'Demo Contact 06', 'DEMO-HOSPITAL-0006', 'Group 14 Demo Avenue 06, Fiction City', '2026-09-30 08:26:00', '2026-09-30 08:26:00'),
  (207, 'Group 14 Demo Hospital 07', 'G14-DEMO-HOSP-007', 'Demo Contact 07', 'DEMO-HOSPITAL-0007', 'Group 14 Demo Avenue 07, Fiction City', '2026-09-30 08:27:00', '2026-09-30 08:27:00'),
  (208, 'Group 14 Demo Hospital 08', 'G14-DEMO-HOSP-008', 'Demo Contact 08', 'DEMO-HOSPITAL-0008', 'Group 14 Demo Avenue 08, Fiction City', '2026-09-30 08:28:00', '2026-09-30 08:28:00'),
  (209, 'Group 14 Demo Hospital 09', 'G14-DEMO-HOSP-009', 'Demo Contact 09', 'DEMO-HOSPITAL-0009', 'Group 14 Demo Avenue 09, Fiction City', '2026-09-30 08:29:00', '2026-09-30 08:29:00'),
  (210, 'Group 14 Demo Hospital 10', 'G14-DEMO-HOSP-010', 'Demo Contact 10', 'DEMO-HOSPITAL-0010', 'Group 14 Demo Avenue 10, Fiction City', '2026-09-30 08:30:00', '2026-09-30 08:30:00');

INSERT INTO DonationSlot (slot_id, starts_at, ends_at, capacity, slot_status, created_by_account_id, created_at)
VALUES
  (1, '2026-10-01 09:00:00', '2026-10-01 12:00:00', 4, 'CLOSED', 1, '2026-09-30 09:00:00'),
  (2, '2026-10-02 09:00:00', '2026-10-02 12:00:00', 4, 'CLOSED', 1, '2026-09-30 09:01:00'),
  (3, '2026-10-03 09:00:00', '2026-10-03 12:00:00', 4, 'CLOSED', 1, '2026-09-30 09:02:00'),
  (4, '2026-10-04 09:00:00', '2026-10-04 12:00:00', 4, 'CLOSED', 1, '2026-09-30 09:03:00'),
  (5, '2026-10-05 09:00:00', '2026-10-05 12:00:00', 4, 'CLOSED', 1, '2026-09-30 09:04:00'),
  (6, '2026-10-06 09:00:00', '2026-10-06 12:00:00', 4, 'CLOSED', 1, '2026-09-30 09:05:00'),
  (7, '2026-10-07 09:00:00', '2026-10-07 12:00:00', 4, 'CLOSED', 1, '2026-09-30 09:06:00'),
  (8, '2026-10-08 09:00:00', '2026-10-08 12:00:00', 4, 'CLOSED', 1, '2026-09-30 09:07:00'),
  (9, '2026-10-09 09:00:00', '2026-10-09 12:00:00', 4, 'CLOSED', 1, '2026-09-30 09:08:00'),
  (10, '2026-10-10 09:00:00', '2026-10-10 12:00:00', 4, 'CLOSED', 1, '2026-09-30 09:09:00'),
  (11, '2026-10-11 09:00:00', '2026-10-11 12:00:00', 4, 'CLOSED', 1, '2026-09-30 09:10:00'),
  (12, '2026-10-12 09:00:00', '2026-10-12 12:00:00', 4, 'CLOSED', 1, '2026-09-30 09:11:00');

INSERT INTO Booking (booking_id, donor_account_id, slot_id, booking_status, booked_at, status_changed_at)
VALUES
  (1, 101, 1, 'COMPLETED', '2026-09-29 10:00:00', '2026-10-01 12:00:00'),
  (2, 102, 2, 'COMPLETED', '2026-09-30 10:00:00', '2026-10-02 12:00:00'),
  (3, 103, 3, 'COMPLETED', '2026-10-01 10:00:00', '2026-10-03 12:00:00'),
  (4, 104, 4, 'COMPLETED', '2026-10-02 10:00:00', '2026-10-04 12:00:00'),
  (5, 105, 5, 'COMPLETED', '2026-10-03 10:00:00', '2026-10-05 12:00:00'),
  (6, 106, 6, 'COMPLETED', '2026-10-04 10:00:00', '2026-10-06 12:00:00'),
  (7, 107, 7, 'COMPLETED', '2026-10-05 10:00:00', '2026-10-07 12:00:00'),
  (8, 108, 8, 'COMPLETED', '2026-10-06 10:00:00', '2026-10-08 12:00:00'),
  (9, 109, 9, 'COMPLETED', '2026-10-07 10:00:00', '2026-10-09 12:00:00'),
  (10, 110, 10, 'COMPLETED', '2026-10-08 10:00:00', '2026-10-10 12:00:00'),
  (11, 111, 11, 'COMPLETED', '2026-10-09 10:00:00', '2026-10-11 12:00:00'),
  (12, 112, 12, 'COMPLETED', '2026-10-10 10:00:00', '2026-10-12 12:00:00');

INSERT INTO EligibilityDecision
  (eligibility_decision_id, donor_account_id, booking_id, decided_by_account_id, decision, reason_code, deferred_until, decided_at)
VALUES
  (1, 101, 1, 1, 'ACCEPTED', 'STAFF_ACCEPTED', NULL, '2026-10-01 09:15:00'),
  (2, 102, 2, 1, 'ACCEPTED', 'STAFF_ACCEPTED', NULL, '2026-10-02 09:15:00'),
  (3, 103, 3, 1, 'ACCEPTED', 'STAFF_ACCEPTED', NULL, '2026-10-03 09:15:00'),
  (4, 104, 4, 1, 'ACCEPTED', 'STAFF_ACCEPTED', NULL, '2026-10-04 09:15:00'),
  (5, 105, 5, 1, 'ACCEPTED', 'STAFF_ACCEPTED', NULL, '2026-10-05 09:15:00'),
  (6, 106, 6, 1, 'ACCEPTED', 'STAFF_ACCEPTED', NULL, '2026-10-06 09:15:00'),
  (7, 107, 7, 1, 'ACCEPTED', 'STAFF_ACCEPTED', NULL, '2026-10-07 09:15:00'),
  (8, 108, 8, 1, 'ACCEPTED', 'STAFF_ACCEPTED', NULL, '2026-10-08 09:15:00'),
  (9, 109, 9, 1, 'ACCEPTED', 'STAFF_ACCEPTED', NULL, '2026-10-09 09:15:00'),
  (10, 110, 10, 1, 'ACCEPTED', 'STAFF_ACCEPTED', NULL, '2026-10-10 09:15:00'),
  (11, 111, 11, 1, 'TEMPORARILY_DEFERRED', 'STAFF_TEMPORARY_DEFERRAL', '2026-10-20', '2026-10-11 09:15:00'),
  (12, 112, 12, 1, 'ACCEPTED', 'STAFF_ACCEPTED', NULL, '2026-10-12 09:15:00');

INSERT INTO Donation
  (donation_id, booking_id, recorded_by_account_id, outcome, collected_at, collection_reference, release_status,
   release_decided_by_account_id, release_decided_at, release_reason_code, created_at)
VALUES
  (1, 1, 1, 'COLLECTED', '2026-10-01 10:00:00', 'G14-DEMO-COL-0001', 'APPROVED', 1, '2026-10-01 13:00:00', 'STAFF_RELEASE_APPROVED', '2026-10-01 12:05:00'),
  (2, 2, 1, 'COLLECTED', '2026-10-02 10:00:00', 'G14-DEMO-COL-0002', 'APPROVED', 1, '2026-10-02 13:00:00', 'STAFF_RELEASE_APPROVED', '2026-10-02 12:05:00'),
  (3, 3, 1, 'COLLECTED', '2026-10-03 10:00:00', 'G14-DEMO-COL-0003', 'APPROVED', 1, '2026-10-03 13:00:00', 'STAFF_RELEASE_APPROVED', '2026-10-03 12:05:00'),
  (4, 4, 1, 'COLLECTED', '2026-10-04 10:00:00', 'G14-DEMO-COL-0004', 'APPROVED', 1, '2026-10-04 13:00:00', 'STAFF_RELEASE_APPROVED', '2026-10-04 12:05:00'),
  (5, 5, 1, 'COLLECTED', '2026-10-05 10:00:00', 'G14-DEMO-COL-0005', 'APPROVED', 1, '2026-10-05 13:00:00', 'STAFF_RELEASE_APPROVED', '2026-10-05 12:05:00'),
  (6, 6, 1, 'COLLECTED', '2026-10-06 10:00:00', 'G14-DEMO-COL-0006', 'APPROVED', 1, '2026-10-06 13:00:00', 'STAFF_RELEASE_APPROVED', '2026-10-06 12:05:00'),
  (7, 7, 1, 'COLLECTED', '2026-10-07 10:00:00', 'G14-DEMO-COL-0007', 'APPROVED', 1, '2026-10-07 13:00:00', 'STAFF_RELEASE_APPROVED', '2026-10-07 12:05:00'),
  (8, 8, 1, 'COLLECTED', '2026-10-08 10:00:00', 'G14-DEMO-COL-0008', 'APPROVED', 1, '2026-10-08 13:00:00', 'STAFF_RELEASE_APPROVED', '2026-10-08 12:05:00'),
  (9, 9, 1, 'COLLECTED', '2026-10-09 10:00:00', 'G14-DEMO-COL-0009', 'APPROVED', 1, '2026-10-09 13:00:00', 'STAFF_RELEASE_APPROVED', '2026-10-09 12:05:00'),
  (10, 10, 1, 'COLLECTED', '2026-10-10 10:00:00', 'G14-DEMO-COL-0010', 'APPROVED', 1, '2026-10-10 13:00:00', 'STAFF_RELEASE_APPROVED', '2026-10-10 12:05:00'),
  (11, 11, 1, 'DEFERRED', NULL, NULL, 'NOT_REQUIRED', NULL, NULL, NULL, '2026-10-11 12:05:00'),
  (12, 12, 1, 'INCOMPLETE', NULL, NULL, 'NOT_REQUIRED', NULL, NULL, NULL, '2026-10-12 12:05:00');

INSERT INTO BloodUnit
  (blood_unit_id, donation_id, blood_group_id, expiry_date, unit_status, created_at)
VALUES
  (1, 1, 1, '2026-11-12', 'ISSUED', '2026-10-01 13:00:00'),
  (2, 2, 2, '2026-11-13', 'ALLOCATED', '2026-10-02 13:00:00'),
  (3, 3, 3, '2026-11-14', 'ALLOCATED', '2026-10-03 13:00:00'),
  (4, 4, 4, '2026-11-15', 'ISSUED', '2026-10-04 13:00:00'),
  (5, 5, 5, '2026-11-16', 'ALLOCATED', '2026-10-05 13:00:00'),
  (6, 6, 6, '2026-11-17', 'ALLOCATED', '2026-10-06 13:00:00'),
  (7, 7, 7, '2026-11-18', 'ALLOCATED', '2026-10-07 13:00:00'),
  (8, 8, 8, '2026-11-19', 'ALLOCATED', '2026-10-08 13:00:00'),
  (9, 9, 1, '2026-11-20', 'ISSUED', '2026-10-09 13:00:00'),
  (10, 10, 4, '2026-11-21', 'ALLOCATED', '2026-10-10 13:00:00');

INSERT INTO HospitalRequest
  (request_id, hospital_account_id, recipient_group_id, quantity_requested, priority, needed_by,
   request_note, created_at, updated_at)
VALUES
  (1, 201, 1, 2, 'NORMAL', '2026-11-05 12:00:00', 'Fictional routine demonstration request.', '2026-10-20 09:00:00', '2026-10-20 09:00:00'),
  (2, 202, 4, 3, 'URGENT', '2026-11-04 12:00:00', 'Fictional request awaiting review.', '2026-10-20 09:10:00', '2026-10-20 09:10:00'),
  (3, 203, 6, 2, 'NORMAL', '2026-11-07 12:00:00', 'Fictional request awaiting suitable inventory.', '2026-10-20 09:20:00', '2026-10-20 09:20:00'),
  (4, 204, 8, 4, 'EMERGENCY', '2026-11-01 12:00:00', 'Fictional partially fulfilled request.', '2026-10-20 09:30:00', '2026-10-20 09:30:00'),
  (5, 205, 8, 2, 'URGENT', '2026-11-02 12:00:00', 'Fictional fully issued request.', '2026-10-20 09:40:00', '2026-10-20 09:40:00'),
  (6, 206, 2, 5, 'NORMAL', '2026-11-08 12:00:00', 'Fictional request rejected in the demonstration dataset.', '2026-10-20 09:50:00', '2026-10-20 09:50:00'),
  (7, 207, 3, 1, 'NORMAL', '2026-11-09 12:00:00', 'Fictional hospital-cancelled request.', '2026-10-20 10:00:00', '2026-10-20 10:00:00'),
  (8, 208, 8, 2, 'EMERGENCY', '2026-11-03 12:00:00', 'Fictional request with one issued unit.', '2026-10-20 10:10:00', '2026-10-20 10:10:00'),
  (9, 209, 8, 3, 'URGENT', '2026-11-06 12:00:00', 'Fictional request returned to inventory wait after seeded holds were cancelled.', '2026-10-20 10:20:00', '2026-10-20 10:20:00'),
  (10, 210, 5, 1, 'NORMAL', '2026-11-10 12:00:00', 'Fictional request under review.', '2026-10-20 10:30:00', '2026-10-20 10:30:00');

INSERT INTO RequestStatusHistory
  (request_id, old_status, new_status, changed_by_account_id, reason_code, changed_at)
SELECT request_id, NULL, 'SUBMITTED', hospital_account_id, NULL, created_at
FROM HospitalRequest;

-- Generate legitimate trigger-owned history paths for report examples.
SET @request_actor_account_id = 1, @request_reason_code = 'REVIEW_STARTED', @request_system_operation_id = NULL;
UPDATE HospitalRequest SET request_status = 'UNDER_REVIEW', updated_at = '2026-10-21 09:00:00' WHERE request_id IN (2,3,4,5,6,8,9,10);

SET @request_reason_code = 'INVENTORY_UNAVAILABLE';
UPDATE HospitalRequest SET request_status = 'AWAITING_INVENTORY', updated_at = '2026-10-21 10:00:00' WHERE request_id IN (3,4,8,9);

-- Seeded Allocation examples only: no allocation/issue workflow is installed or implied.
INSERT INTO Allocation
  (allocation_id, request_id, blood_unit_id, allocation_status, allocated_by_account_id, allocated_at,
   issued_at, handoff_reference, cancelled_at, cancellation_reason_code)
VALUES
  (1, 4, 1, 'ISSUED', 1, '2026-10-22 09:00:00', '2026-10-22 10:00:00', 'G14-DEMO-HANDOFF-0001', NULL, NULL),
  (2, 4, 2, 'ALLOCATED', 1, '2026-10-22 09:05:00', NULL, NULL, NULL, NULL),
  (3, 4, 3, 'ALLOCATED', 1, '2026-10-22 09:10:00', NULL, NULL, NULL, NULL),
  (4, 5, 4, 'ISSUED', 1, '2026-10-22 11:00:00', '2026-10-22 12:00:00', 'G14-DEMO-HANDOFF-0004', NULL, NULL),
  (5, 5, 5, 'ALLOCATED', 1, '2026-10-22 11:05:00', NULL, NULL, NULL, NULL),
  (6, 9, 6, 'ALLOCATED', 1, '2026-10-22 13:00:00', NULL, NULL, NULL, NULL),
  (7, 9, 7, 'ALLOCATED', 1, '2026-10-22 13:05:00', NULL, NULL, NULL, NULL),
  (8, 9, 8, 'ALLOCATED', 1, '2026-10-22 13:10:00', NULL, NULL, NULL, NULL),
  (9, 8, 9, 'ISSUED', 1, '2026-10-22 14:00:00', '2026-10-22 15:00:00', 'G14-DEMO-HANDOFF-0009', NULL, NULL),
  (10, 9, 10, 'ALLOCATED', 1, '2026-10-22 14:05:00', NULL, NULL, NULL, NULL);

SET @request_reason_code = 'ALLOCATION_UPDATED';
UPDATE HospitalRequest SET request_status = 'PARTIALLY_FULFILLED', updated_at = '2026-10-23 10:00:00' WHERE request_id IN (4,5,8,9);

-- Keep the illustrative request history consistent with allocation quantities:
-- request 5 becomes fully issued only after its second seeded unit is issued.
UPDATE Allocation SET allocation_status = 'ISSUED', issued_at = '2026-10-23 10:30:00',
  handoff_reference = 'G14-DEMO-HANDOFF-0005'
WHERE allocation_id = 5;
UPDATE BloodUnit SET unit_status = 'ISSUED' WHERE blood_unit_id = 5;

SET @request_reason_code = 'REQUEST_FULFILLED';
UPDATE HospitalRequest SET request_status = 'FULFILLED', updated_at = '2026-10-23 11:00:00' WHERE request_id = 5;

-- Request 9 returns to inventory wait after its four illustrative holds are
-- cancelled and the associated units return to AVAILABLE.
UPDATE Allocation SET allocation_status = 'CANCELLED', cancelled_at = CASE allocation_id
  WHEN 6 THEN '2026-10-23 10:15:00' WHEN 7 THEN '2026-10-23 10:20:00'
  WHEN 8 THEN '2026-10-23 10:25:00' ELSE '2026-10-23 10:30:00' END,
  cancellation_reason_code = 'DEMO_SEED_ONLY'
WHERE allocation_id IN (6,7,8,10);
UPDATE BloodUnit SET unit_status = 'AVAILABLE' WHERE blood_unit_id IN (6,7,8,10);

SET @request_reason_code = 'INVENTORY_UNAVAILABLE';
UPDATE HospitalRequest SET request_status = 'AWAITING_INVENTORY', updated_at = '2026-10-24 09:00:00' WHERE request_id = 9;

SET @request_reason_code = 'REQUEST_REJECTED';
UPDATE HospitalRequest SET request_status = 'REJECTED', rejection_reason_code = 'REQUEST_REJECTED', updated_at = '2026-10-24 10:00:00' WHERE request_id = 6;

SET @request_actor_account_id = 207, @request_reason_code = 'HOSPITAL_CANCELLED';
UPDATE HospitalRequest SET request_status = 'CANCELLED', updated_at = '2026-10-24 11:00:00' WHERE request_id = 7;
SET @request_actor_account_id = NULL, @request_reason_code = NULL, @request_system_operation_id = NULL;

-- Preserve a plausible history timeline; all timestamps are IST wall-clock DATETIME values.
UPDATE RequestStatusHistory SET changed_at = CASE
  WHEN request_id = 2 AND new_status = 'UNDER_REVIEW' THEN '2026-10-21 09:00:00'
  WHEN request_id = 3 AND new_status = 'UNDER_REVIEW' THEN '2026-10-21 09:00:00'
  WHEN request_id = 3 AND new_status = 'AWAITING_INVENTORY' THEN '2026-10-21 10:00:00'
  WHEN request_id = 4 AND new_status = 'UNDER_REVIEW' THEN '2026-10-21 09:00:00'
  WHEN request_id = 4 AND new_status = 'AWAITING_INVENTORY' THEN '2026-10-21 10:00:00'
  WHEN request_id = 4 AND new_status = 'PARTIALLY_FULFILLED' THEN '2026-10-23 10:00:00'
  WHEN request_id = 5 AND new_status = 'UNDER_REVIEW' THEN '2026-10-21 09:00:00'
  WHEN request_id = 5 AND new_status = 'PARTIALLY_FULFILLED' THEN '2026-10-23 10:00:00'
  WHEN request_id = 5 AND new_status = 'FULFILLED' THEN '2026-10-23 11:00:00'
  WHEN request_id = 6 AND new_status = 'UNDER_REVIEW' THEN '2026-10-21 09:00:00'
  WHEN request_id = 6 AND new_status = 'REJECTED' THEN '2026-10-24 10:00:00'
  WHEN request_id = 7 AND new_status = 'CANCELLED' THEN '2026-10-24 11:00:00'
  WHEN request_id = 8 AND new_status = 'UNDER_REVIEW' THEN '2026-10-21 09:00:00'
  WHEN request_id = 8 AND new_status = 'AWAITING_INVENTORY' THEN '2026-10-21 10:00:00'
  WHEN request_id = 8 AND new_status = 'PARTIALLY_FULFILLED' THEN '2026-10-23 10:00:00'
  WHEN request_id = 9 AND new_status = 'UNDER_REVIEW' THEN '2026-10-21 09:00:00'
  WHEN request_id = 9 AND old_status = 'UNDER_REVIEW' AND new_status = 'AWAITING_INVENTORY' THEN '2026-10-21 10:00:00'
  WHEN request_id = 9 AND old_status = 'PARTIALLY_FULFILLED' AND new_status = 'AWAITING_INVENTORY' THEN '2026-10-24 09:00:00'
  WHEN request_id = 9 AND new_status = 'PARTIALLY_FULFILLED' THEN '2026-10-23 10:00:00'
  WHEN request_id = 10 AND new_status = 'UNDER_REVIEW' THEN '2026-10-21 09:00:00'
  ELSE changed_at END
WHERE old_status IS NOT NULL;

-- These rows are clearly seeded examples, not evidence that the corresponding
-- web workflows ran. Allocation has no production audit action/writer in scope.
INSERT INTO AuditEvent
  (actor_account_id, action_code, subject_type, subject_id, occurred_at, reason_code, change_summary, operation_id)
SELECT b.donor_account_id, 'BOOKING_CREATED', 'Booking', b.booking_id, b.booked_at,
  'DONOR_RESERVED', 'Donation booking created',
  CONCAT('00000000-0000-4000-8000-', LPAD(b.booking_id, 12, '0'))
FROM Booking b;

INSERT INTO AuditEvent
  (actor_account_id, action_code, subject_type, subject_id, occurred_at, reason_code, change_summary, operation_id)
SELECT e.decided_by_account_id, 'ELIGIBILITY_DECISION_RECORDED', 'EligibilityDecision', e.eligibility_decision_id,
  e.decided_at, e.reason_code, 'Day-of eligibility decision recorded',
  CONCAT('00000000-0000-4000-8000-', LPAD(e.eligibility_decision_id + 100, 12, '0'))
FROM EligibilityDecision e;

INSERT INTO AuditEvent
  (actor_account_id, action_code, subject_type, subject_id, occurred_at, reason_code, change_summary, operation_id)
SELECT d.recorded_by_account_id, 'DONATION_RECORDED', 'Donation', d.donation_id, d.created_at,
  CASE d.outcome WHEN 'COLLECTED' THEN 'COLLECTION_RECORDED'
    WHEN 'INCOMPLETE' THEN 'INCOMPLETE_ATTEMPT_RECORDED' ELSE 'DEFERRED_VISIT_RECORDED' END,
  CASE d.outcome WHEN 'COLLECTED' THEN 'Successful collection recorded'
    WHEN 'INCOMPLETE' THEN 'Incomplete collection attempt recorded' ELSE 'Deferred visit recorded without collection' END,
  CONCAT('00000000-0000-4000-8000-', LPAD(d.donation_id + 200, 12, '0'))
FROM Donation d;

INSERT INTO AuditEvent
  (actor_account_id, action_code, subject_type, subject_id, occurred_at, reason_code, change_summary, operation_id)
SELECT d.recorded_by_account_id, 'BOOKING_COMPLETED', 'Booking', d.booking_id, d.created_at,
  'DONATION_OUTCOME_RECORDED', 'CHECKED_IN -> COMPLETED',
  CONCAT('00000000-0000-4000-8000-', LPAD(d.donation_id + 200, 12, '0'))
FROM Donation d;

INSERT INTO AuditEvent
  (actor_account_id, action_code, subject_type, subject_id, occurred_at, reason_code, change_summary, operation_id)
SELECT d.release_decided_by_account_id, 'DONATION_RELEASE_DECIDED', 'Donation', d.donation_id, d.release_decided_at,
  'STAFF_RELEASE_APPROVED', 'PENDING -> APPROVED',
  CONCAT('00000000-0000-4000-8000-', LPAD(d.donation_id + 300, 12, '0'))
FROM Donation d WHERE d.release_status = 'APPROVED';

INSERT INTO AuditEvent
  (actor_account_id, action_code, subject_type, subject_id, occurred_at, reason_code, change_summary, operation_id)
SELECT d.release_decided_by_account_id, 'BLOOD_UNIT_CREATED', 'BloodUnit', u.blood_unit_id, d.release_decided_at,
  'APPROVED_DONATION', CONCAT('Created ', u.unit_status, ' unit from approved donation'),
  CONCAT('00000000-0000-4000-8000-', LPAD(d.donation_id + 300, 12, '0'))
FROM BloodUnit u JOIN Donation d ON d.donation_id = u.donation_id;

INSERT INTO AuditEvent
  (actor_account_id, action_code, subject_type, subject_id, occurred_at, reason_code, change_summary, operation_id)
SELECT r.hospital_account_id, 'HOSPITAL_REQUEST_CREATED', 'HospitalRequest', r.request_id, r.created_at,
  NULL, 'Hospital request created',
  CONCAT('00000000-0000-4000-8000-', LPAD(r.request_id + 400, 12, '0'))
FROM HospitalRequest r;

INSERT INTO AuditEvent
  (actor_account_id, action_code, subject_type, subject_id, occurred_at, reason_code, change_summary, operation_id)
SELECT h.changed_by_account_id,
  CASE WHEN h.new_status = 'CANCELLED' THEN 'HOSPITAL_REQUEST_CANCELLED' ELSE 'HOSPITAL_REQUEST_STATUS_CHANGED' END,
  'HospitalRequest', h.request_id, h.changed_at, h.reason_code,
  CASE WHEN h.new_status = 'CANCELLED' THEN 'Hospital request cancelled'
    ELSE CONCAT('Request status changed: ', h.old_status, ' -> ', h.new_status) END,
  CONCAT('00000000-0000-4000-8000-', LPAD(h.request_status_history_id + 500, 12, '0'))
FROM RequestStatusHistory h WHERE h.old_status IS NOT NULL;
