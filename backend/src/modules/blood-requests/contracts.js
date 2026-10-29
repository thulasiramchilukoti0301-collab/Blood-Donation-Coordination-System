// Approved action vocabulary; unsupported actions have no HTTP or service entry point.
export const requestAuditActions = Object.freeze([
  'HOSPITAL_REQUEST_CREATED', 'HOSPITAL_REQUEST_STATUS_CHANGED', 'HOSPITAL_REQUEST_CANCELLED',
]);
export const requestTransitionReasons = Object.freeze({
  UNDER_REVIEW: 'REVIEW_STARTED', AWAITING_INVENTORY: 'INVENTORY_UNAVAILABLE',
  PARTIALLY_FULFILLED: 'ALLOCATION_UPDATED', FULFILLED: 'REQUEST_FULFILLED',
  REJECTED: 'REQUEST_REJECTED', CANCELLED: 'HOSPITAL_CANCELLED',
});
export const isRequestableBloodGroup = (group) => group?.isActive === 1 || group?.isActive === true;
