-- MySQL client script for this bounded official Phase 3 milestone only.
-- Start the mysql client with database/ as its working directory, connect to
-- the intended server without selecting a database, then run: source setup.sql
-- CREATE DATABASE refuses an existing schema; this wrapper never drops or
-- overwrites a populated schema. Migrations use plain CREATE/INSERT statements.
CREATE DATABASE blood_donation_coordination
  CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
USE blood_donation_coordination;
SET time_zone = '+05:30';
SOURCE migrations/001_foundation.sql;
SOURCE migrations/002_auth.sql;
SOURCE seeds/reference_data.sql;
