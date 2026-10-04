# Relational Schema (Logical)

This is relational notation, not SQL. `PK`, `FK`, `UQ`, `NN`, `CK`, and `DF` are constraint annotations. All identifiers use unsigned generated integer keys except the explicit composite key.

```text
ACCOUNT(
  account_id PK,
  email UQ NN,
  password_hash NN,
  role CK NN,
  account_status CK NN DF 'PENDING',
  created_at NN DF current_timestamp,
  updated_at NN DF current_timestamp
)

DONOR(
  account_id PK FK -> ACCOUNT.account_id,
  full_name NN, date_of_birth NN, phone NN,
  address NN, area NULL,
  reported_blood_group_id NULL FK -> BLOOD_GROUP.blood_group_id,
  confirmed_blood_group_id NULL FK -> BLOOD_GROUP.blood_group_id,
  created_at NN, updated_at NN
)

HOSPITAL(
  account_id PK FK -> ACCOUNT.account_id,
  organization_name NN, registration_number NULL UQ,
  contact_name NN, phone NN, address NN,
  created_at NN, updated_at NN
)

BLOOD_GROUP(
  blood_group_id PK, code CHAR(3) UQ NN CK,
  display_name UQ NN, is_active NN DF TRUE
)

BLOOD_COMPATIBILITY(
  donor_group_id PK FK -> BLOOD_GROUP.blood_group_id,
  recipient_group_id PK FK -> BLOOD_GROUP.blood_group_id,
  is_compatible NN,
  PK(donor_group_id, recipient_group_id)
)

DONATION_SLOT(
  slot_id PK, starts_at NN, ends_at NN CK, capacity NN CK,
  slot_status CK NN DF 'OPEN',
  created_by_account_id NN FK -> ACCOUNT.account_id,
  created_at NN
)

BOOKING(
  booking_id PK,
  donor_account_id NN FK -> DONOR.account_id,
  slot_id NN FK -> DONATION_SLOT.slot_id,
  booking_status CK NN DF 'BOOKED', booked_at NN,
  status_changed_at NN, cancellation_reason NULL,
  UQ(donor_account_id, slot_id),
  UQ(booking_id, donor_account_id)
)

ELIGIBILITY_DECISION(
  eligibility_decision_id PK,
  donor_account_id NN FK -> DONOR.account_id,
  booking_id NULL,
  decided_by_account_id NN FK -> ACCOUNT.account_id,
  decision CK NN, reason_code NULL, deferred_until NULL,
  decided_at NN,
  FK(booking_id, donor_account_id) -> BOOKING(booking_id, donor_account_id)
)

DONATION(
  donation_id PK,
  booking_id UQ NN FK -> BOOKING.booking_id,
  recorded_by_account_id NN FK -> ACCOUNT.account_id,
  outcome CK NN, collected_at NULL,
  collection_reference NULL UQ,
  release_status CK NN,
  release_decided_by_account_id NULL FK -> ACCOUNT.account_id,
  release_decided_at NULL, release_reason_code NULL,
  created_at NN
)

BLOOD_UNIT(
  blood_unit_id PK,
  donation_id UQ NN FK -> DONATION.donation_id,
  blood_group_id NN FK -> BLOOD_GROUP.blood_group_id,
  expiry_date NN,
  unit_status CK NN DF 'AVAILABLE',
  discarded_at NULL, discard_reason_code NULL, expired_at NULL,
  created_at NN
)

HOSPITAL_REQUEST(
  request_id PK,
  hospital_account_id NN FK -> HOSPITAL.account_id,
  recipient_group_id NN FK -> BLOOD_GROUP.blood_group_id,
  quantity_requested NN CK, priority CK NN DF 'NORMAL', needed_by NN,
  request_note NULL, request_status CK NN DF 'SUBMITTED',
  rejection_reason_code NULL, created_at NN, updated_at NN
)

REQUEST_STATUS_HISTORY(
  request_status_history_id PK,
  request_id NN FK -> HOSPITAL_REQUEST.request_id,
  old_status NULL, new_status NN,
  changed_by_account_id NULL FK -> ACCOUNT.account_id,
  reason_code NULL, changed_at NN
)

ALLOCATION(
  allocation_id PK,
  request_id NN FK -> HOSPITAL_REQUEST.request_id,
  blood_unit_id NN FK -> BLOOD_UNIT.blood_unit_id,
  allocation_status CK NN DF 'ALLOCATED',
  allocated_by_account_id NN FK -> ACCOUNT.account_id,
  allocated_at NN, issued_at NULL, handoff_reference NULL,
  cancelled_at NULL, cancellation_reason_code NULL,
  active_blood_unit_id BIGINT UNSIGNED GENERATED AS
    (CASE WHEN allocation_status IN ('ALLOCATED', 'ISSUED') THEN blood_unit_id ELSE NULL END) UQ
)

AUDIT_EVENT(
  audit_event_id PK,
  actor_account_id NULL FK -> ACCOUNT.account_id,
  action_code NN, subject_type CK NN, subject_id NULL,
  occurred_at NN, reason_code NULL,
  change_summary VARCHAR(1000) NULL, operation_id CHAR(36) NULL
)
```

## Derived values

- Donor next-eligible date = last successful collected donation date + configured 56 days, subject to any active staff deferral. It is not stored as a donor attribute.
- Unit collection date = date portion of its source Donation.collected_at. It is not duplicated on BloodUnit.
- Unit available count is derived from unit status, expiry, donation approval, and current date (view).
- Request allocated/issued/outstanding totals derive from Allocation rows; never store independently maintained copies.
- Account profile role matching (Donor has one Donor row; Hospital has one Hospital row; Admin has neither) requires a transaction/service invariant because simple FKs cannot enforce conditional one-to-one subtype completeness.
