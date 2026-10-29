import { HttpError } from '../../utils/httpError.js';
import { canonicalUnsignedId } from '../blood-requests/validation.js';

const groups = ['O-', 'O+', 'A-', 'A+', 'B-', 'B+', 'AB-', 'AB+'];
const allocatableStatuses = new Set(['UNDER_REVIEW', 'AWAITING_INVENTORY', 'PARTIALLY_FULFILLED']);
const readError = () => new HttpError(503, 'ALLOCATION_READ_UNAVAILABLE',
  'Allocation preview data is temporarily unavailable. Check that Feature 8 storage is installed.');
const validationError = () => new HttpError(400, 'VALIDATION_ERROR', 'Allocation preview input is invalid.');

function calendarDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) throw validationError();
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (year < 1000 || year > 9999 || date.getUTCFullYear() !== year
    || date.getUTCMonth() + 1 !== month || date.getUTCDate() !== day) throw validationError();
  return value;
}

function safeDatabase(error) {
  if (error instanceof HttpError) return error;
  return readError();
}

export function validateAllocationPreviewQuery(query = {}) {
  if (!query || typeof query !== 'object' || Array.isArray(query)
    || Object.keys(query).some((key) => !['intendedIssueDate', 'candidatePage'].includes(key))) throw validationError();
  const intendedIssueDate = calendarDate(query.intendedIssueDate);
  const pageText = query.candidatePage ?? '1';
  if (typeof pageText !== 'string' || !/^[1-9][0-9]{0,5}$/u.test(pageText)) throw validationError();
  const candidatePage = Number(pageText);
  if (!Number.isSafeInteger(candidatePage) || candidatePage < 1 || candidatePage > 2622) throw validationError();
  return { intendedIssueDate, candidatePage };
}

export function createAllocationReadService(repository) {
  if (!repository) throw new TypeError('An allocation read repository is required.');
  return {
    async assertStorageReady() {
      try { await repository.assertStorageReady(); }
      catch (error) { throw safeDatabase(error); }
    },
    async compatibility() {
      try {
        const data = await repository.listCompatibility();
        if (!Array.isArray(data?.groups) || data.groups.length !== 8 || !Array.isArray(data?.pairs) || data.pairs.length !== 64
          || groups.some((code) => !data.groups.some((group) => group.code === code))
          || data.pairs.filter((pair) => pair.isCompatible === true).length !== 27) throw readError();
        return data;
      } catch (error) { throw safeDatabase(error); }
    },
    async preview(requestId, input) {
      let id;
      try { id = canonicalUnsignedId(requestId); } catch { throw validationError(); }
      const { intendedIssueDate, candidatePage } = validateAllocationPreviewQuery(input);
      try {
        const result = await repository.readPreview(id, intendedIssueDate, candidatePage);
        if (!result) throw new HttpError(404, 'REQUEST_NOT_FOUND', 'The blood request was not found.');
        return result;
      } catch (error) { throw safeDatabase(error); }
    },
  };
}

export { allocatableStatuses, groups as canonicalBloodGroups, readError as allocationReadUnavailable };
