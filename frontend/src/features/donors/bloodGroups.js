// Stable IDs and codes from database/seeds/reference_data.sql.
export const reportedBloodGroupChoices = Object.freeze([
  { id: '1', code: 'O-', displayName: 'O negative' },
  { id: '2', code: 'O+', displayName: 'O positive' },
  { id: '3', code: 'A-', displayName: 'A negative' },
  { id: '4', code: 'A+', displayName: 'A positive' },
  { id: '5', code: 'B-', displayName: 'B negative' },
  { id: '6', code: 'B+', displayName: 'B positive' },
  { id: '7', code: 'AB-', displayName: 'AB negative' },
  { id: '8', code: 'AB+', displayName: 'AB positive' },
]);

export function isReportedBloodGroupChoice(id) {
  return id === '' || reportedBloodGroupChoices.some((group) => group.id === id);
}

export function registrationReportedGroupId(selection) {
  return selection || null;
}
