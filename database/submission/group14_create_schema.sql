-- Group 14 demonstration database bootstrap.
-- Run only through group14_fresh_build.ps1, which targets this fixed new name.
-- CREATE DATABASE deliberately has no IF NOT EXISTS: an existing name is refused.
CREATE DATABASE group14_blood_donation_demo_20261030
  CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
USE group14_blood_donation_demo_20261030;
SET time_zone = '+05:30';
