-- Stable reference identifiers shared by all developers' local databases.
-- Do not renumber or silently overwrite these canonical values.
INSERT INTO BloodGroup (blood_group_id, code, display_name, is_active) VALUES
  (1, 'O-',  'O negative',  TRUE),
  (2, 'O+',  'O positive',  TRUE),
  (3, 'A-',  'A negative',  TRUE),
  (4, 'A+',  'A positive',  TRUE),
  (5, 'B-',  'B negative',  TRUE),
  (6, 'B+',  'B positive',  TRUE),
  (7, 'AB-', 'AB negative', TRUE),
  (8, 'AB+', 'AB positive', TRUE);
