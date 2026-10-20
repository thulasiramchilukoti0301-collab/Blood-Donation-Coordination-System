-- MySQL client wrapper for the foundation only; it does not include Donor.
-- It uses nested SOURCE commands. Do not assume an error in a sourced file
-- stops all later statements. For guarded setup use apply-foundation.mjs; for
-- manual fail-fast setup, use the direct --skip-force --execute batch in
-- database/README.md and check the mysql process exit code.
-- CREATE DATABASE refuses an existing schema; this wrapper never drops or
-- overwrites a populated schema. Migrations use plain CREATE/INSERT statements.
CREATE DATABASE blood_donation_coordination
  CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
USE blood_donation_coordination;
SET time_zone = '+05:30';
SOURCE migrations/001_foundation.sql;
SOURCE migrations/002_auth.sql;
SOURCE seeds/reference_data.sql;
