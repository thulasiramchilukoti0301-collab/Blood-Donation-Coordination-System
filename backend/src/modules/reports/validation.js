import { HttpError } from '../../utils/httpError.js';

const invalid = () => new HttpError(400, 'VALIDATION_ERROR', 'Report filters are invalid.');
const date = (value) => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) throw invalid();
  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (year < 1000 || parsed.getUTCFullYear() !== year || parsed.getUTCMonth() + 1 !== month || parsed.getUTCDate() !== day) throw invalid();
  return value;
};
export function validateReportQuery(query = {}) {
  const allowed = new Set(['from', 'to', 'interval']);
  if (!query || Array.isArray(query) || typeof query !== 'object' || Object.keys(query).some((key) => !allowed.has(key))) throw invalid();
  const filters = { interval: query.interval ?? 'DAY' };
  if (!['DAY', 'WEEK', 'MONTH'].includes(filters.interval)) throw invalid();
  if (query.from !== undefined) filters.from = date(query.from);
  if (query.to !== undefined) filters.to = date(query.to);
  if (filters.from && filters.to && filters.from > filters.to) throw invalid();
  if (filters.from && filters.to && (Date.parse(`${filters.to}T00:00:00Z`) - Date.parse(`${filters.from}T00:00:00Z`)) / 86400000 > 366) throw invalid();
  return filters;
}
