// INFORMATION_SCHEMA.CHECK_CLAUSE may escape its SQL quote delimiters.
// Normalize that representation only; keep names and the expression intact.
export function auditCheckExpression(value) {
  if (typeof value !== 'string') throw new TypeError('Expected CHECK metadata text.');
  return value.replace(/\\'/gu, "'");
}
