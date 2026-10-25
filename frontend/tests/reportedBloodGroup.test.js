import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { registrationReportedGroupId, reportedBloodGroupChoices } from '../src/features/donors/bloodGroups.js';
import { changedFields, draftErrors, draftFrom } from '../src/features/donors/profileDraft.js';

test('shared frontend choices match all eight stable reference seed IDs, codes, and names', () => {
  const seed = readFileSync(fileURLToPath(new URL('../../database/seeds/reference_data.sql', import.meta.url)), 'utf8');
  const rows = [...seed.matchAll(/\(\s*(\d+),\s*'([^']+)',\s*'([^']+)',\s*TRUE\s*\)/gu)]
    .map((match) => ({ id: match[1], code: match[2], displayName: match[3] }));
  assert.equal(rows.length, 8);
  assert.deepEqual(reportedBloodGroupChoices, rows);
});

test('profile draft selects, changes, clears, and omits reported group without touching confirmation', () => {
  assert.equal(registrationReportedGroupId(''), null);
  assert.equal(registrationReportedGroupId('4'), '4');
  const profile = {
    fullName: 'Donor', phone: '123', address: 'Road', area: null,
    reportedBloodGroup: { id: '4', code: 'A+' }, confirmedBloodGroup: { id: '2', code: 'O+' },
  };
  const draft = draftFrom(profile);
  assert.equal(draft.reportedBloodGroupId, '4');
  assert.deepEqual(changedFields(draft, profile), {});
  assert.deepEqual(changedFields({ ...draft, reportedBloodGroupId: '2' }, profile), { reportedBloodGroupId: '2' });
  assert.deepEqual(changedFields({ ...draft, reportedBloodGroupId: '' }, profile), { reportedBloodGroupId: null });
  assert.deepEqual(changedFields({ ...draft, phone: '456' }, profile), { phone: '456' });
  assert.deepEqual(changedFields(draftFrom({ ...profile, reportedBloodGroup: null }), { ...profile, reportedBloodGroup: null }), {});
  assert.deepEqual(draftErrors({ reportedBloodGroupId: '999' }), {
    reportedBloodGroupId: 'Choose a listed blood group or leave it blank.',
  });
  assert.deepEqual(draftErrors({ reportedBloodGroupId: '2' }), {});
});
