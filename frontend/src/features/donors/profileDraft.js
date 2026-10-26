import { isReportedBloodGroupChoice } from './bloodGroups.js';

const editableFields = ['fullName', 'phone', 'address', 'area'];
const maxLengths = { fullName: 120, phone: 30, address: 255, area: 100 };

export function draftFrom(profile) {
  return {
    ...Object.fromEntries(editableFields.map((field) => [field, profile[field] ?? ''])),
    reportedBloodGroupId: profile.reportedBloodGroup?.id ?? '',
  };
}

export function changedFields(draft, profile) {
  const patch = {};
  for (const field of editableFields) {
    const value = draft[field].trim();
    if (value !== (profile[field] ?? '')) patch[field] = field === 'area' && !value ? null : value;
  }
  if (draft.reportedBloodGroupId !== (profile.reportedBloodGroup?.id ?? '')) {
    patch.reportedBloodGroupId = draft.reportedBloodGroupId || null;
  }
  return patch;
}

export function draftErrors(patch) {
  const errors = {};
  for (const [field, value] of Object.entries(patch)) {
    if (field === 'reportedBloodGroupId') {
      if (value !== null && !isReportedBloodGroupChoice(value)) errors[field] = 'Choose a listed blood group or leave it blank.';
      continue;
    }
    if (field === 'area' && value === null) continue;
    if (!value || [...value].length > maxLengths[field] || /\p{Cc}/u.test(value)) {
      errors[field] = `Enter ${field === 'area' ? 'up to' : 'between 1 and'} ${maxLengths[field]} characters without control characters.`;
    }
  }
  return errors;
}
