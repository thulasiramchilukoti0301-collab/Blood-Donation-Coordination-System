// Isolated browser fixtures only. Production components/services remain real;
// this Axios adapter prevents every application API request reaching MySQL.
import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from '../../src/App';
import { api } from '../../src/services/api';
import '../../src/styles/global.css';
import { runAccountApprovalScenarios } from './account-approval-scenarios';
import { runAccountStatusScenarios } from './account-status-scenarios';
import { runBookingScenarios } from './booking-scenarios';
import { runDonationScenarios } from './donation-scenarios';
import { runReleaseScenarios } from './release-scenarios';
import { runAdminDonorScenarios } from './admin-donor-scenarios';
import { runDonorDashboardScenarios } from './donor-dashboard-scenarios';

const container = document.getElementById('hospital-test-app');
const report = document.getElementById('hospital-test-result');
let reactRoot;
let fixture;
let checks = 0;
const results = [];
const profile = (status = 'PENDING') => ({
  hospitalId: '123', organizationName: 'Isolated Browser Hospital', registrationNumber: null,
  contactName: 'Browser contact', phone: '+91 12345', address: 'Browser test address',
  createdAt: '2026-10-25T04:30:00.000Z', updatedAt: '2026-10-25T04:30:00.000Z', accountStatus: status,
});
const hospitalUser = (status = 'PENDING') => ({ accountId: '123', role: 'HOSPITAL', accountStatus: status });
const adminUser = (status = 'ACTIVE') => ({ accountId: '31', role: 'ADMIN', accountStatus: status });
const activeDonor = () => ({ accountId: '321', role: 'DONOR', accountStatus: 'ACTIVE' });
const adminDonorFixture = (index = 0, id = String(400 + index)) => ({ donorId: id, email: `donor${id}@example.test`,
  accountStatus: ['ACTIVE', 'PENDING', 'SUSPENDED'][index % 3], fullName: `Fixture Donor ${String(index + 1).padStart(2, '0')}`,
  dateOfBirth: '1990-04-12', phone: `555-${String(index + 1).padStart(4, '0')}`, address: 'Fixture address', area: index % 2 ? null : 'Fixture area',
  reportedBloodGroup: { bloodGroupId: '2', code: 'O+', displayName: 'O positive' }, confirmedBloodGroup: { bloodGroupId: '4', code: 'A+', displayName: 'A positive' },
  eligibilityAnswers: ['PRIVATE_MEDICAL_SENTINEL'], staffNotes: 'PRIVATE_STAFF_NOTE_SENTINEL', collectionReference: 'PRIVATE_COLLECTION_SENTINEL',
  createdAt: '2026-10-28T04:30:00.000Z', updatedAt: '2026-10-28T05:00:00.000Z',
  context: { bookingCount: 2, donationCount: 1, latestBooking: { bookingStatus: 'COMPLETED', appointmentAt: '2026-10-27T10:00:00+05:30' },
    latestDonation: { outcome: 'COLLECTED', releaseStatus: 'APPROVED', collectedAt: '2026-10-27T11:00:00+05:30' } } });
const bookingSlots = () => [{ slotId: '40', startsAt: '2026-11-01T10:00:00+05:30', endsAt: '2026-11-01T11:00:00+05:30',
  capacity: 1, occupied: 0, remaining: 1, slotStatus: 'OPEN', bookable: true,
  eligibility: { result: 'ELIGIBLE', reasonCode: 'NO_BLOCKING_HISTORY', evaluationDate: '2026-11-01' } }];
const approvalAccounts = () => Array.from({ length: 23 }, (_, index) => ({
  accountId: index ? String(2000 + index) : '9007199254740993',
  email: index ? `applicant${index}@example.test` : `${'long-email-'.repeat(15)}@example.test`,
  role: index % 2 ? 'HOSPITAL' : 'DONOR', accountStatus: index < 21 ? 'PENDING' : index === 21 ? 'ACTIVE' : 'SUSPENDED',
  createdAt: '2026-10-26 09:30:00', passwordHash: 'SECRET_SENTINEL_NOT_FOR_DISPLAY', sessionData: 'SECRET_SESSION_SENTINEL',
}));
const adminProfiles = () => Array.from({ length: 23 }, (_, index) => ({ ...profile(['PENDING', 'ACTIVE', 'SUSPENDED'][index % 3]),
  hospitalId: String(1000 + index), organizationName: `Isolated Admin Hospital ${String(index + 1).padStart(2, '0')}`,
  registrationNumber: index ? `TEST-${index + 1}` : null, contactName: `Isolated contact ${index + 1}`,
  passwordHash: 'SECRET_SENTINEL_NOT_FOR_DISPLAY', sessionData: 'SECRET_SESSION_SENTINEL' }));
const registrationValues = { organizationName: '  Isolated Browser Hospital  ', registrationNumber: '  ',
  contactName: ' Browser contact ', phone: ' +91 12345 ', address: ' Browser test address ',
  email: ' Browser@Example.Test ', password: 'Browser pass7!' };
const pause = (milliseconds = 0) => new Promise((resolve) => setTimeout(resolve, milliseconds));
function assert(condition, message) { checks += 1; if (!condition) throw new Error(message); }
async function waitFor(condition, message, timeout = 3000) {
  const started = performance.now();
  while (!condition()) {
    if (performance.now() - started > timeout) throw new Error(`Timed out: ${message}; route=${location.pathname}${location.search}; heading=${container.querySelector('h1')?.textContent ?? 'none'}`);
    await pause(5);
  }
}
function text() { return container.textContent; }
function errorResponse(config, status, code, message, fields) {
  const error = new Error(message);
  error.config = config;
  error.response = { status, data: { success: false, error: { code, message, ...(fields ? { fields } : {}) } } };
  throw error;
}
function response(config, data, status = 200) { return { config, status, statusText: String(status), data, headers: {} }; }
async function mount(path, options = {}) {
  reactRoot?.unmount();
  await pause();
  container.replaceChildren();
  fixture = { user: null, profile: profile(), calls: [], csrf: 0, registrationConflict: null,
    profileFailures: 0, profileEmpty: false, holdProfile: false, loginRole: 'HOSPITAL',
    adminProfiles: adminProfiles(), adminListFailures: 0, adminDetailFailures: 0,
    adminDonors: Array.from({ length: 23 }, (_, index) => adminDonorFixture(index)), adminDonorMode: 'normal',
    holdAdminDonorCsrf: false, holdAdminDonorPatch: false,
    approvalAccounts: approvalAccounts(), queueFailures: 0, bookingSlots: bookingSlots(), bookings: [], donations: [], units: [], ...options };
  const current = fixture;
  api.defaults.adapter = async (config) => {
    const method = config.method.toLowerCase();
    const data = typeof config.data === 'string' ? JSON.parse(config.data) : config.data;
    const headers = Object.fromEntries(Object.entries(config.headers.toJSON()).map(([key, value]) => [key.toLowerCase(), value]));
    current.calls.push({ url: config.url, method, data, headers, params: config.params, signal: config.signal });
    if (config.url === '/auth/me') {
      if (current.holdIdentity) { current.holdIdentity = false; await new Promise(resolve => { current.releaseIdentity = resolve; }); }
      if (current.identityFailures > 0) { current.identityFailures--; return errorResponse(config, 503, 'DATABASE_UNAVAILABLE', 'Identity service unavailable.'); }
      return current.user ? response(config, { success: true, user: current.user })
        : errorResponse(config, 401, 'AUTHENTICATION_REQUIRED', 'Sign in to continue.');
    }
    if (config.url === '/auth/csrf') {
      if (current.holdBookingCsrf) { current.holdBookingCsrf = false; await new Promise(resolve => { current.releaseBookingCsrf = resolve; }); }
      if (current.statusCsrfFailure) { current.statusCsrfFailure = false; return errorResponse(config, 503, 'DATABASE_UNAVAILABLE', 'PRIVATE'); }
      if (current.holdApprovalCsrf) { current.holdApprovalCsrf = false; await new Promise(resolve => { current.releaseApprovalCsrf = resolve; }); }
      if (current.holdAdminDonorCsrf) { current.holdAdminDonorCsrf = false; await new Promise(resolve => { current.releaseAdminDonorCsrf = resolve; }); }
      return response(config, { success: true, csrfToken: (++current.csrf).toString(16).padStart(64, '0') });
    }
    if (config.url === '/auth/password' && method === 'post') {
      if (current.passwordMode === 'wrong') return errorResponse(config, 401, 'INVALID_CURRENT_PASSWORD', 'Current password is incorrect.');
      current.user = null;
      return response(config, { success: true, loginRequired: true });
    }
    if (config.url === '/donors/me/reports/activity' && method === 'get') {
      if (current.activityFailure) return errorResponse(config, 503, 'DATABASE_UNAVAILABLE', 'Private activity detail');
      return response(config, { success: true, activity: current.activity ?? { from: null, to: null,
        bookingCounts: [{ bookingStatus: 'BOOKED', count: 0 }], donationCounts: [{ outcome: 'COLLECTED', count: 0 }] } });
    }
    if (config.url === '/admin/donors' && method === 'get') {
      if (current.adminDonorFailure) { current.adminDonorFailure = false; return errorResponse(config, 503, 'DATABASE_UNAVAILABLE', 'Private donor read detail'); }
      const params = config.params || {};
      let rows = current.adminDonors.filter(row => (!params.accountStatus || row.accountStatus === params.accountStatus)
        && (!params.search || [row.donorId, row.fullName, row.phone, row.area || ''].some(value => value.toLowerCase().includes(params.search.toLowerCase())))
        && (!params.bloodGroupId || (params.groupMatch !== 'CONFIRMED' && row.reportedBloodGroup?.bloodGroupId === params.bloodGroupId)
          || (params.groupMatch !== 'REPORTED' && row.confirmedBloodGroup?.bloodGroupId === params.bloodGroupId)));
      rows = rows.sort((a, b) => a.fullName.localeCompare(b.fullName) || (BigInt(a.donorId) < BigInt(b.donorId) ? -1 : 1));
      const page = Number(params.page || 1);
      return response(config, { success: true, donors: structuredClone(rows.slice((page - 1) * 20, page * 20).map(({ email, dateOfBirth, address, createdAt, updatedAt, context, ...safe }) => safe)),
        pagination: { page, pageSize: 20, total: rows.length } });
    }
    if (/^\/admin\/donors\/\d+$/u.test(config.url) && method === 'get') {
      const saved = current.adminDonors.find(row => row.donorId === config.url.split('/').at(-1));
      if (!saved) return errorResponse(config, 404, 'DONOR_NOT_FOUND', 'Donor not found.');
      return response(config, { success: true, donor: structuredClone(saved) });
    }
    if (/^\/admin\/donors\/\d+$/u.test(config.url) && method === 'patch') {
      if (current.adminDonorMode === 'conflict') return errorResponse(config, 409, 'DONOR_EDIT_CONFLICT', 'Donor changed.');
      const saved = current.adminDonors.find(row => row.donorId === config.url.split('/').at(-1));
      if (!saved) return errorResponse(config, 404, 'DONOR_NOT_FOUND', 'Donor not found.');
      if (current.holdAdminDonorPatch) { current.holdAdminDonorPatch = false; await new Promise(resolve => { current.releaseAdminDonorPatch = resolve; }); }
      const { reasonCode, originalValues, confirmedBloodGroupId, ...patch } = data;
      if (!originalValues || Object.keys(originalValues).length !== Object.keys(patch).length + Number(confirmedBloodGroupId !== undefined)
        || Object.entries(originalValues).some(([field, original]) =>
          (field === 'confirmedBloodGroupId' ? saved.confirmedBloodGroup?.bloodGroupId ?? null : saved[field]) !== original)) {
        return errorResponse(config, 409, 'DONOR_EDIT_CONFLICT', 'Donor changed.');
      }
      Object.assign(saved, patch);
      if (confirmedBloodGroupId) saved.confirmedBloodGroup = { bloodGroupId: confirmedBloodGroupId,
        code: ({ '1': 'O-', '2': 'O+', '3': 'A-', '4': 'A+', '5': 'B-', '6': 'B+', '7': 'AB-', '8': 'AB+' })[confirmedBloodGroupId], displayName: 'Fixture confirmed group' };
      if (current.adminDonorMode === 'malformed') return response(config, { success: true, donor: { ...saved, donorId: '0' } });
      saved.updatedAt = new Date().toISOString();
      return response(config, { success: true, donor: structuredClone(saved) });
    }
    if (config.url === '/donors/me/eligibility' && method === 'get') return response(config, { success: true,
      eligibility: { result: 'ELIGIBLE', reasonCode: 'NO_BLOCKING_HISTORY', evaluationDate: '2026-10-27',
        nextEligibleDate: null, deferredUntil: null, latestDecision: null } });
    if (config.url === '/donation-slots' && method === 'get') {
      if (current.bookingReadFailure) { current.bookingReadFailure = false; return errorResponse(config, 503, 'DATABASE_UNAVAILABLE', 'Private details'); }
      const slots = current.bookingSlots.filter(slot => current.user?.role === 'ADMIN'
        ? (!config.params?.slotStatus || slot.slotStatus === config.params.slotStatus) : slot.slotStatus === 'OPEN');
      const page = Number(config.params?.page ?? 1);
      return response(config, { success: true, slots: structuredClone(slots.slice((page - 1) * 20, page * 20)), pagination: { page, pageSize: 20, total: slots.length } });
    }
    if (['/donors/me/bookings', '/admin/bookings'].includes(config.url) && method === 'get') {
      if (current.bookingReadAuth) { current.bookingReadAuth = false; return errorResponse(config, 401, 'ACCOUNT_UNAVAILABLE', 'Session unavailable.'); }
      if (current.bookingReadFailure) { current.bookingReadFailure = false; return errorResponse(config, 503, 'DATABASE_UNAVAILABLE', 'Private details'); }
      const admin = config.url === '/admin/bookings';
      const rows = current.bookings.filter(row => (admin || row.donorAccountId === current.user?.accountId)
        && (!config.params?.bookingStatus || row.bookingStatus === config.params.bookingStatus));
      const page = Number(config.params?.page ?? 1);
      return response(config, { success: true, bookings: structuredClone(rows.slice((page - 1) * 20, page * 20)), pagination: { page, pageSize: 20, total: rows.length } });
    }
    if (['/admin/donations', '/donors/me/donations'].includes(config.url) && method === 'get') {
      if (current.donationReadFailure) { current.donationReadFailure = false; return errorResponse(config, 503, 'DATABASE_UNAVAILABLE', 'Private'); }
      const admin = config.url === '/admin/donations';
      const rows = current.donations.filter(row => (admin || row.donorAccountId === current.user?.accountId)
        && (!config.params?.donorAccountId || row.donorAccountId === config.params.donorAccountId)
        && (!config.params?.outcome || row.outcome === config.params.outcome)
        && (!config.params?.releaseStatus || row.releaseStatus === config.params.releaseStatus)
        && (!config.params?.from || row.createdAt.slice(0, 10) >= config.params.from)
        && (!config.params?.to || row.createdAt.slice(0, 10) <= config.params.to));
      const page = Number(config.params?.page ?? 1);
      return response(config, { success: true, donations: structuredClone(rows.slice((page - 1) * 20, page * 20)),
        pagination: { page, pageSize: 20, total: rows.length }, ...(admin ? {} : { nextEligibleDate: current.nextEligibleDate ?? null }) });
    }
    if (config.url === '/admin/donations' && method === 'post') {
      if (current.holdDonationMutation) { current.holdDonationMutation = false; await new Promise(resolve => { current.releaseDonationMutation = resolve; }); }
      if (current.donationMode === 'conflict') return errorResponse(config, 409, 'DONATION_CONFLICT', 'Changed');
      if (current.donationMode === 'timeout') throw Object.assign(new Error('Controlled timeout'), { config, code: 'ECONNABORTED' });
      if (current.donationMode === 'validation') return errorResponse(config, 400, 'VALIDATION_ERROR', 'Check the donation input.');
      const booking = current.bookings.find(row => row.bookingId === data.bookingId);
      if (!booking || booking.bookingStatus !== 'CHECKED_IN') return errorResponse(config, 409, 'DONATION_CONFLICT', 'Changed');
      booking.bookingStatus = 'COMPLETED'; booking.hasDonation = true;
      const donation = { donationId: String(current.donations.length + 501), bookingId: booking.bookingId,
        donorAccountId: booking.donorAccountId, donorName: booking.donorName, slotId: booking.slotId,
        startsAt: booking.startsAt, bookingStatus: 'COMPLETED', outcome: data.outcome,
        releaseStatus: data.outcome === 'COLLECTED' ? 'PENDING' : 'NOT_REQUIRED',
        collectedAt: data.collectedAt ?? null, collectionReference: data.collectionReference ?? null,
        createdAt: `${booking.startsAt.slice(0, 10)}T10:30:00+05:30` };
      current.donations.push(donation);
      if (current.donationMode === 'malformed') donation.donationId = '0';
      if (current.failDonationRefresh) { current.failDonationRefresh = false; current.donationReadFailure = true; }
      return response(config, { success: true, donation }, 201);
    }
    if (/^\/admin\/donations\/[^/]+\/testing-decision$/u.test(config.url) && method === 'post') {
      if (current.holdReleaseMutation) { current.holdReleaseMutation = false; await new Promise(resolve => { current.releaseReleaseMutation = resolve; }); }
      if (current.releaseMode === 'conflict') return errorResponse(config, 409, 'RELEASE_CONFLICT', 'Changed');
      if (current.releaseMode === 'timeout') throw Object.assign(new Error('Controlled timeout'), { config, code: 'ECONNABORTED' });
      const donation = current.donations.find(row => row.donationId === config.url.split('/')[3]);
      if (!donation || donation.releaseStatus !== 'PENDING') return errorResponse(config, 409, 'RELEASE_CONFLICT', 'Changed');
      donation.releaseStatus = data.decision;
      let unit = null;
      if (data.decision === 'APPROVED') {
        const expiry = new Date(Date.parse(`${donation.collectedAt.slice(0, 10)}T00:00:00Z`) + 42 * 86400000).toISOString().slice(0, 10);
        unit = { bloodUnitId: String(current.units.length + 17), donationId: donation.donationId,
          bloodGroupId: data.confirmedBloodGroupId, bloodGroupCode: 'A-', expiryDate: expiry, unitStatus: 'AVAILABLE',
          collectedAt: donation.collectedAt, outcome: donation.outcome, releaseStatus: 'APPROVED',
          releaseDecidedAt: `${donation.collectedAt.slice(0, 10)}T12:00:00+05:30` };
        current.units.push(unit);
      }
      const release = { donationId: donation.donationId, decision: data.decision,
        reasonCode: data.decision === 'APPROVED' ? 'STAFF_RELEASE_APPROVED' : data.reasonCode,
        releaseDecidedAt: `${donation.collectedAt.slice(0, 10)}T12:00:00+05:30`, unit, replayed: false };
      if (current.releaseMode === 'malformed') release.unit = null;
      if (current.failReleaseRefresh) { current.failReleaseRefresh = false; current.donationReadFailure = true; }
      return response(config, { success: true, release });
    }
    if (config.url === '/inventory' && method === 'get') {
      const page = Number(config.params?.page ?? 1);
      const rows = current.units.map(unit => ({ ...unit, effectiveAvailability: unit.unitStatus === 'AVAILABLE' && unit.expiryDate > new Date().toISOString().slice(0, 10), expiryDue: unit.unitStatus === 'AVAILABLE' && unit.expiryDate <= new Date().toISOString().slice(0, 10) }));
      return response(config, { success: true, units: structuredClone(rows.slice((page - 1) * 20, page * 20)),
        pagination: { page, pageSize: 20, total: current.units.length } });
    }
    if (config.url === '/admin/inventory/expiry/run' && method === 'post') {
      if (current.inventoryMode === 'timeout') throw Object.assign(new Error('Controlled timeout'), { config, code: 'ECONNABORTED' });
      if (current.inventoryMode === 'conflict') return errorResponse(config, 409, 'ALLOCATION_COORDINATION_REQUIRED', 'Allocated unit requires coordination.');
      const runDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
      const due = current.units.filter(unit => unit.unitStatus === 'AVAILABLE' && unit.expiryDate <= runDate);
      due.forEach(unit => { unit.unitStatus = 'EXPIRED'; unit.expiryDate = unit.expiryDate; });
      return response(config, { success: true, result: { runDate, checkedCount: current.units.length,
        expiredCount: due.length, runAt: `${runDate}T10:00:00+05:30`, operationId: '00000000-0000-4000-8000-000000000001' } });
    }
    if (/^\/admin\/inventory\/[^/]+\/discard$/u.test(config.url) && method === 'post') {
      if (current.inventoryMode === 'timeout') throw Object.assign(new Error('Controlled timeout'), { config, code: 'ECONNABORTED' });
      if (current.inventoryMode === 'conflict') return errorResponse(config, 409, 'UNIT_STATUS_CONFLICT', 'Changed.');
      const unit = current.units.find(row => row.bloodUnitId === config.url.split('/').at(-2));
      if (!unit || unit.unitStatus !== 'AVAILABLE') return errorResponse(config, 409, 'UNIT_STATUS_CONFLICT', 'Changed.');
      unit.unitStatus = 'DISCARDED';
      return response(config, { success: true, discard: { bloodUnitId: unit.bloodUnitId, unitStatus: 'DISCARDED', reasonCode: data.reasonCode, discardedAt: '2026-10-29T10:00:00+05:30' } });
    }
    if (/^\/admin\/inventory\/[^/]+$/u.test(config.url) && method === 'get') {
      const unit = current.units.find(row => row.bloodUnitId === config.url.split('/').at(-1));
      return unit ? response(config, { success: true, unit: { ...unit, allocations: null } })
        : errorResponse(config, 404, 'BLOOD_UNIT_NOT_FOUND', 'Missing');
    }
    if ((config.url === '/admin/donation-slots' && method === 'post')
      || (config.url.startsWith('/admin/donation-slots/') && method === 'patch')
      || (config.url.startsWith('/admin/bookings/') && config.url.endsWith('/status') && method === 'patch')
      || (config.url.startsWith('/admin/donors/') && config.url.endsWith('/eligibility-decisions') && method === 'post')
      || (config.url === '/donors/me/bookings' && method === 'post')
      || (config.url.startsWith('/donors/me/bookings/') && method === 'post')) {
      if (current.holdBookingMutation) { current.holdBookingMutation = false; await new Promise(resolve => { current.releaseBookingMutation = resolve; }); }
      if (current.bookingMode === 'conflict') return errorResponse(config, 409, 'SLOT_CONFLICT', 'Changed');
      if (current.bookingMode === 'timeout') throw Object.assign(new Error('Controlled timeout'), { config, code: 'ECONNABORTED' });
      if (current.bookingMode === 'validation') return errorResponse(config, 400, 'VALIDATION_ERROR', 'Check the entered values.');
      let payload;
      if (config.url === '/admin/donation-slots') {
        const slot = { ...bookingSlots()[0], ...data, slotId: String(current.bookingSlots.length + 40) };
        current.bookingSlots.push(slot); payload = { slot };
      } else if (config.url.startsWith('/admin/donation-slots/')) {
        const slot = current.bookingSlots.find(item => item.slotId === config.url.split('/').at(-1));
        if (!slot) return errorResponse(config, 404, 'SLOT_NOT_FOUND', 'Missing');
        Object.assign(slot, data.slotStatus === 'CANCELLED' ? { slotStatus: 'CANCELLED', occupied: 0, remaining: slot.capacity } : data.slotStatus === 'CLOSED' ? { slotStatus: 'CLOSED' } : data);
        if (data.slotStatus === 'CANCELLED') current.bookings.filter(row => row.slotId === slot.slotId && row.bookingStatus === 'BOOKED')
          .forEach(row => { row.bookingStatus = 'CANCELLED_BY_STAFF'; });
        payload = { slot };
      } else if (config.url.startsWith('/admin/bookings/') && config.url.endsWith('/status')) {
        const id = config.url.split('/')[3]; const row = current.bookings.find(item => item.bookingId === id);
        const allowed = { CHECKED_IN: 'STAFF_CHECKED_IN', CANCELLED_BY_STAFF: 'STAFF_CANCELLED', NO_SHOW: 'STAFF_NO_SHOW' };
        if (!row || row.bookingStatus !== 'BOOKED' || allowed[data?.bookingStatus] !== data?.reason) {
          return errorResponse(config, 409, 'BOOKING_CONFLICT', 'Changed');
        }
        row.bookingStatus = data.bookingStatus;
        row.cancellationReason = data.bookingStatus === 'CANCELLED_BY_STAFF' ? data.reason : null;
        payload = { booking: { bookingId: row.bookingId, donorAccountId: row.donorAccountId,
          bookingStatus: current.bookingMode === 'malformed' ? 'BOOKED' : row.bookingStatus,
          cancellationReason: row.cancellationReason, statusChangedAt: new Date().toISOString() } };
      } else if (config.url.startsWith('/admin/donors/') && config.url.endsWith('/eligibility-decisions')) {
        const row = current.bookings.find(item => item.bookingId === String(data?.bookingId));
        if (!row || row.bookingStatus !== 'CHECKED_IN' || row.donorAccountId !== config.url.split('/')[3]) return errorResponse(config, 409, 'ELIGIBILITY_DECISION_CONFLICT', 'Changed');
        row.latestDecision = data.decision; row.latestDeferredUntil = data.deferredUntil ?? null;
        payload = { eligibilityDecision: { eligibilityDecisionId: '501', bookingId: row.bookingId, donorAccountId: row.donorAccountId,
          decision: data.decision, reasonCode: ({ ACCEPTED: 'STAFF_ACCEPTED', TEMPORARILY_DEFERRED: 'STAFF_TEMPORARY_DEFERRAL', REVIEW_REQUIRED: 'STAFF_REVIEW_REQUIRED' })[data.decision], deferredUntil: data.deferredUntil ?? null } };
        if (current.eligibilityDecisionMode === 'wrong-date') payload.eligibilityDecision.deferredUntil = '2099-12-31';
        if (current.eligibilityDecisionMode === 'missing-date') delete payload.eligibilityDecision.deferredUntil;
        if (current.eligibilityDecisionMode === 'invalid-id') payload.eligibilityDecision.eligibilityDecisionId = '0';
      } else if (config.url === '/donors/me/bookings') {
        const slot = current.bookingSlots.find(item => item.slotId === data.slotId);
        if (!slot || slot.remaining < 1) return errorResponse(config, 409, 'SLOT_CONFLICT', 'Unavailable');
        slot.occupied++; slot.remaining--;
        const booking = { bookingId: String(current.bookings.length + 1), donorAccountId: current.user.accountId,
          donorName: 'Fixture Donor', slotId: slot.slotId, bookingStatus: 'BOOKED', bookedAt: '2026-10-27T10:00:00+05:30',
          statusChangedAt: '2026-10-27T10:00:00+05:30', cancellationReason: null,
          startsAt: slot.startsAt, endsAt: slot.endsAt, slotStatus: slot.slotStatus, slot };
        current.bookings.push(booking); payload = { booking };
      } else {
        const row = current.bookings.find(item => item.bookingId === config.url.split('/')[4]);
        if (!row || row.bookingStatus !== 'BOOKED') return errorResponse(config, 409, 'BOOKING_CONFLICT', 'Changed');
        row.bookingStatus = 'CANCELLED_BY_DONOR'; current.bookingSlots.find(slot => slot.slotId === row.slotId).remaining++;
        payload = { booking: { bookingId: row.bookingId, bookingStatus: row.bookingStatus } };
      }
      if (current.bookingMode === 'malformed') payload = { booking: { bookingId: 'wrong' } };
      if (current.failBookingRefresh) { current.failBookingRefresh = false; current.bookingReadFailure = true; }
      return response(config, { success: true, ...payload }, config.url === '/admin/donation-slots' || config.url === '/donors/me/bookings'
        || config.url.endsWith('/eligibility-decisions') ? 201 : 200);
    }
    if (config.url === '/admin/accounts' && method === 'get') {
      if (current.expireAccounts) return errorResponse(config, 401, 'ACCOUNT_UNAVAILABLE', 'Session no longer available.');
      if (current.queueFailures > 0) { current.queueFailures--; return errorResponse(config, 503, 'DATABASE_UNAVAILABLE', 'PRIVATE service information'); }
      const { role, accountStatus = 'PENDING', search = '', page = 1 } = config.params || {};
      const rows = current.approvalAccounts.filter(row => (!role || row.role === role) && row.accountStatus === accountStatus && row.email.toLowerCase().includes(search.toLowerCase()));
      const payload = { success: true, accounts: structuredClone(rows.slice((page - 1) * 20, page * 20)), pagination: { page, pageSize: 20, total: rows.length } };
      if (current.holdQueue) { current.holdQueue = false; await new Promise(resolve => { current.releaseQueue = resolve; }); }
      return response(config, payload);
    }
    if (config.url.startsWith('/admin/accounts/') && method === 'patch') {
      if (current.holdApproval) { current.holdApproval = false; await new Promise(resolve => { current.releaseApproval = resolve; }); }
      if (current.oldApprovalUnauthorized) return errorResponse(config, 401, 'ACCOUNT_UNAVAILABLE', 'Old session is unavailable.');
      const row = current.approvalAccounts.find(row => row.accountId === config.url.split('/').at(-1));
      const mappings = { REGISTRATION_REVIEWED: ['PENDING', 'ACTIVE'], ACCESS_RESTRICTED: ['ACTIVE', 'SUSPENDED'], ACCESS_RESTORED: ['SUSPENDED', 'ACTIVE'] };
      const transition = mappings[data?.reason];
      if (!row) return errorResponse(config, 404, 'ACCOUNT_NOT_FOUND', 'Missing account.');
      if (!transition || Object.keys(data).length !== 2 || data.accountStatus !== transition[1]) return errorResponse(config, 400, 'VALIDATION_ERROR', 'Invalid fixture action.');
      const conflict = data.reason === 'REGISTRATION_REVIEWED' ? 'ACCOUNT_APPROVAL_CONFLICT' : 'ACCOUNT_STATUS_CONFLICT';
      if (current.approvalMode === 'conflict') { row.accountStatus = transition[1]; return errorResponse(config, 409, conflict, 'Account changed.'); }
      if (row.accountStatus !== transition[0]) return errorResponse(config, 409, conflict, 'Account source changed.');
      row.accountStatus = transition[1];
      if (current.approvalMode === 'timeout') throw Object.assign(new Error('Controlled timeout'), { config, code: 'ECONNABORTED' });
      if (current.approvalMode === 'unknown') return errorResponse(config, 503, 'TRANSACTION_OUTCOME_UNKNOWN', 'PRIVATE transaction detail');
      if (current.approvalMode === 'malformed') return response(config, { success: true, accountId: 'invalid', accountStatus: transition[1] });
      if (current.approvalMode === 'wrong-status') return response(config, { success: true, accountId: row.accountId, accountStatus: transition[0] });
      if (current.failRefreshAfterApproval) { current.failRefreshAfterApproval = false; current.queueFailures = 1; }
      return response(config, { success: true, accountId: row.accountId, accountStatus: transition[1] });
    }
    if (config.url.startsWith('/admin/hospitals')) {
      if (current.expireAdmin) { current.user = null; return errorResponse(config, 401, 'ACCOUNT_UNAVAILABLE', 'This account cannot use the current session.'); }
      if (current.user?.role !== 'ADMIN' || current.user.accountStatus !== 'ACTIVE') return errorResponse(config, 403, 'FORBIDDEN', 'An active Admin account is required.');
      if (config.url === '/admin/hospitals') {
        if (current.holdAdminList) await new Promise((resolve) => { current.releaseAdminList = resolve; });
        if (current.adminListFailures > 0) { current.adminListFailures -= 1; return errorResponse(config, 503, 'DATABASE_UNAVAILABLE', 'Raw service information must not be displayed.'); }
        const { search = '', accountStatus, page = 1 } = config.params || {};
        const rows = current.adminProfiles.filter((item) => (!accountStatus || item.accountStatus === accountStatus)
          && ['organizationName', 'registrationNumber', 'contactName', 'phone'].some((key) => String(item[key] || '').toLowerCase().includes(search.toLowerCase())));
        return response(config, { success: true, hospitals: rows.slice((page - 1) * 20, page * 20), pagination: { page, pageSize: 20, total: rows.length } });
      }
      if (current.holdAdminDetail) await new Promise((resolve) => { current.releaseAdminDetail = resolve; });
      if (current.adminDetailForbidden) return errorResponse(config, 403, 'FORBIDDEN', 'Access denied.');
      if (current.adminDetailFailures > 0) { current.adminDetailFailures -= 1; return errorResponse(config, 503, 'DATABASE_UNAVAILABLE', 'Raw service information must not be displayed.'); }
      const saved = current.adminProfiles.find((item) => item.hospitalId === config.url.split('/').at(-1));
      if (!saved || current.adminDetailMissing) return errorResponse(config, 404, 'HOSPITAL_NOT_FOUND', 'Hospital profile not found.');
      return response(config, { success: true, profile: saved });
    }
    if (config.url === '/auth/register/hospitals') {
      if (current.holdRegistration) await new Promise((resolve) => { current.releaseRegistration = resolve; });
      if (current.registrationConflict) return errorResponse(config, 409, current.registrationConflict, 'That registration detail is already in use.');
      return response(config, { success: true, accountId: '123', hospitalId: '123', accountStatus: 'PENDING', profile: current.profile }, 201);
    }
    if (config.url === '/hospitals/me' && method === 'get') {
      if (current.profileForbidden) return errorResponse(config, 403, 'FORBIDDEN', 'Hospital profile access is denied.');
      if (current.holdProfile) await new Promise((resolve) => { current.releaseProfile = resolve; });
      if (current.profileFailures > 0) { current.profileFailures -= 1; return errorResponse(config, 503, 'DATABASE_UNAVAILABLE', 'Profile service unavailable.'); }
      if (current.expireProfile) { current.user = null; return errorResponse(config, 401, 'ACCOUNT_UNAVAILABLE', 'This account cannot use the current session.'); }
      return response(config, { success: true, profile: current.profileEmpty ? null : current.profile });
    }
    if (config.url === '/hospitals/me' && method === 'patch') {
      if (current.patchCsrfFailure) return errorResponse(config, 403, 'CSRF_TOKEN_INVALID', 'Refresh the page and try again.');
      if (current.expirePatch) { current.user = null; return errorResponse(config, 401, 'ACCOUNT_UNAVAILABLE', 'This account cannot use the current session.'); }
      current.profile = { ...current.profile, ...data, updatedAt: '2026-10-25T05:00:00.000Z' };
      return response(config, { success: true, profile: current.profile });
    }
    if (config.url === '/auth/register/donors') return response(config, { success: true, accountId: '321', donorId: '321', accountStatus: 'PENDING' }, 201);
    if (config.url === '/auth/login') {
      current.user = current.loginRole === 'ADMIN' ? { ...adminUser(), accountId: current.loginAccountId || '31' } : { accountId: current.loginRole === 'DONOR' ? '321' : '123', role: current.loginRole, accountStatus: 'PENDING' };
      return response(config, { success: true, user: current.user });
    }
    if (config.url === '/auth/logout') { current.user = null; return response(config, { success: true, message: 'You have been signed out.' }); }
    if (config.url === '/donors/me') return response(config, { success: true, profile: {
      accountId: '321', email: 'donor@example.test', accountStatus: current.user?.accountStatus ?? 'PENDING', fullName: 'Isolated Browser Donor',
      dateOfBirth: '1990-01-01', phone: '123', address: 'Browser address', area: null, reportedBloodGroup: null, confirmedBloodGroup: null,
    } });
    return errorResponse(config, 404, 'NOT_FOUND', 'Unexpected isolated test API request.');
  };
  history.replaceState({}, '', path);
  reactRoot = createRoot(container);
  reactRoot.render(<BrowserRouter><App /></BrowserRouter>);
  await pause();
  return current;
}
function input(name) { return container.querySelector(`[name="${name}"]`); }
async function fill(values) {
  for (const [name, value] of Object.entries(values)) {
    const element = input(name);
    assert(Boolean(element), `Input ${name} exists`);
    const prototype = element.tagName === 'SELECT' ? HTMLSelectElement.prototype : element.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value').set.call(element, value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
    await pause();
  }
}
function button(label) {
  return [...container.querySelectorAll('button')].find((element) => element.textContent.trim().toLowerCase() === label.toLowerCase());
}
async function submit() { container.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); await pause(); }
function noOverflow() { assert(document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1, `No horizontal overflow at ${innerWidth}px`); }
function labels() {
  for (const element of container.querySelectorAll('input,textarea,select')) {
    assert(Boolean(element.labels?.length || (element.id && container.querySelector(`label[for="${element.id}"]`))), `Accessible label for ${element.name}`);
  }
}
async function run(name, work) {
  try { await work(); results.push({ name, passed: true }); }
  catch (error) { results.push({ name, passed: false, error: error.message }); }
}

async function scenarios() {
  await runDonorDashboardScenarios({ mount, waitFor, assert, text, button, fill, submit, noOverflow, labels,
    container, activeDonor, getFixture: () => fixture, run });
  await runAdminDonorScenarios({ mount, waitFor, assert, text, button, fill, submit, pause, noOverflow, labels,
    container, adminUser, getFixture: () => fixture, run });
  await runAccountApprovalScenarios({ mount, waitFor, assert, text, button, fill, submit, pause, noOverflow, labels,
    container, adminUser, hospitalUser, run });
  await runAccountStatusScenarios({ mount, waitFor, assert, text, button, fill, submit, pause, noOverflow, labels,
    container, adminUser, hospitalUser, run });
  await runBookingScenarios({ mount, waitFor, assert, text, button, fill, submit, pause, noOverflow, labels,
    container, adminUser, activeDonor, run });
  await runDonationScenarios({ mount, waitFor, assert, text, button, fill, pause, noOverflow, labels,
    container, adminUser, activeDonor, run });
  await runReleaseScenarios({ mount, waitFor, assert, text, button, fill, pause, noOverflow, labels,
    container, adminUser, activeDonor, run });
  await run('ACTIVE Admin list, Mint styling, pagination, scoped navigation and approved data only', async () => {
    await mount('/admin/hospitals', { user: adminUser() });
    await waitFor(() => container.querySelectorAll('.mint-admin-table tbody tr').length === 20, 'first Admin page');
    assert(text().includes('1–20 of 23 Hospitals') && button('Previous').disabled && !button('Next').disabled, 'First page totals and controls');
    assert(container.querySelector('a[href="/admin/hospitals"][aria-current="page"]'), 'Admin management navigation active');
    assert(!container.querySelector('a[href="/hospital/profile"],a[href="/donor/profile"]'), 'No other-role profile links');
    assert(getComputedStyle(container.querySelector('.mint-app-shell')).backgroundColor === 'rgb(241, 250, 246)', 'Admin uses exact Mint background');
    assert(getComputedStyle(container.querySelector('h1')).fontFamily.includes('Sora') && getComputedStyle(input('search')).fontFamily.includes('Nunito Sans'), 'Admin heading and control fonts');
    assert(!text().includes('SECRET_') && !/approve|suspend hospital|request summary/i.test(text()), 'No secret fields, mutation controls or fabricated request summary');
    labels(); noOverflow();
    button('Next').click();
    await waitFor(() => text().includes('21–23 of 23 Hospitals'), 'second Admin page');
    assert(container.querySelectorAll('.mint-admin-table tbody tr').length === 3 && button('Next').disabled, 'Last page size and forward boundary');
    assert(fixture.calls.filter((call) => call.url === '/admin/hospitals').at(-1).params.page === 2, 'Second page calls API');
    button('Previous').click(); await waitFor(() => text().includes('1–20 of 23 Hospitals'), 'previous page');
  });
  await run('Admin search/status filters reset pagination, validate input, and show real empty state', async () => {
    await mount('/admin/hospitals', { user: adminUser() }); await waitFor(() => button('Next'), 'Admin results');
    button('Next').click(); await waitFor(() => text().includes('21–23'), 'second page');
    await fill({ search: ' TEST-3 ', accountStatus: 'SUSPENDED' }); await submit();
    await waitFor(() => text().includes('1–1 of 1 Hospitals'), 'filtered result');
    const call = fixture.calls.filter((item) => item.url === '/admin/hospitals').at(-1);
    assert(JSON.stringify(call.params) === JSON.stringify({ search: 'TEST-3', accountStatus: 'SUSPENDED', page: 1 }), 'Only approved normalized query, page reset');
    assert(text().includes('Isolated Admin Hospital 03') && !text().includes('Isolated Admin Hospital 01'), 'Filter response replaces old rows');
    const requests = fixture.calls.length;
    await fill({ search: 'x'.repeat(181) }); await submit();
    await waitFor(() => input('search').getAttribute('aria-invalid') === 'true', 'search length validation');
    assert(fixture.calls.length === requests && document.activeElement === input('search'), 'Invalid filters do not request data and receive focus');
    await fill({ search: 'No such registered Hospital' }); await submit();
    await waitFor(() => text().includes('No Hospitals found'), 'empty result');
    assert(!container.querySelector('.mint-admin-table') && text().includes('0 Hospitals match'), 'No fallback records');
    button('Clear filters').click(); await waitFor(() => text().includes('1–20 of 23'), 'cleared filters');
    assert(input('search').value === '' && input('accountStatus').value === '', 'Filters clear together'); noOverflow();
  });
  await run('Admin detail loads selected Hospital including SUSPENDED status and remains read-only', async () => {
    const current = await mount('/admin/hospitals', { user: adminUser(), holdAdminDetail: true });
    await waitFor(() => container.querySelectorAll('.mint-admin-table tbody tr').length === 20, 'Admin results');
    container.querySelectorAll('.mint-admin-table tbody button')[2].click();
    await waitFor(() => text().includes('Loading Hospital details…') && current.releaseAdminDetail, 'detail loading');
    assert(document.activeElement.id === 'admin-hospital-detail-heading', 'Detail receives keyboard focus');
    current.releaseAdminDetail();
    await waitFor(() => container.querySelector('#admin-hospital-detail dl'), 'saved detail');
    const details = container.querySelector('#admin-hospital-detail');
    assert(details.textContent.includes('Isolated Admin Hospital 03') && details.textContent.includes('SUSPENDED'), 'Selected saved identity and status');
    assert(details.textContent.includes('1002') && details.textContent.includes('Browser test address'), 'Approved ID and address displayed');
    assert(details.textContent.includes('read-only') && !details.querySelector('input,textarea,select'), 'No profile/status edit fields');
    assert(!details.textContent.includes('SECRET_') && !/request summary|approve|reactivate/i.test(details.textContent), 'No secrets, fabricated summaries or approval actions');
    assert(current.calls.some((call) => call.url === '/admin/hospitals/1002' && call.method === 'get'), 'Detail calls selected API ID');
    noOverflow(); button('Close details').click();
    await waitFor(() => !container.querySelector('#admin-hospital-detail'), 'close detail');
    assert(document.activeElement.getAttribute('aria-label') === 'View details for Isolated Admin Hospital 03', 'Close restores triggering button focus');
  });
  await run('Admin list loading/error/retry and detail missing/error/retry discard stale records', async () => {
    const current = await mount('/admin/hospitals', { user: adminUser(), holdAdminList: true, adminListFailures: 1 });
    await waitFor(() => text().includes('Loading Hospitals') && current.releaseAdminList, 'list loading');
    assert(!container.querySelector('.mint-admin-table'), 'Loading has no stale/fallback rows');
    current.holdAdminList = false; current.releaseAdminList();
    await waitFor(() => text().includes('Could not load Hospitals'), 'list error');
    assert(!text().includes('Raw service information') && button('Try again'), 'Safe list error and retry');
    button('Try again').click(); await waitFor(() => button('View details'), 'list retry');
    current.adminDetailMissing = true; button('View details').click();
    await waitFor(() => text().includes('This Hospital profile is no longer available.'), 'missing detail');
    assert(!container.querySelector('#admin-hospital-detail dl'), 'Missing details show no fabricated profile');
    current.adminDetailMissing = false; current.adminDetailFailures = 1; button('Try again').click();
    await waitFor(() => text().includes('Hospital details are temporarily unavailable.'), 'safe detail error');
    assert(!text().includes('Raw service information'), 'Raw backend message not exposed');
    button('Try again').click(); await waitFor(() => container.querySelector('#admin-hospital-detail dl'), 'detail retry');
  });
  await run('Admin route rejects signed-out, other roles and non-ACTIVE Admin without directory reads', async () => {
    await mount('/admin/hospitals'); await waitFor(() => location.pathname === '/login' && input('email'), 'signed-out Admin redirect');
    assert(!fixture.calls.some((item) => item.url.startsWith('/admin/')), 'Signed-out users never request directory');
    for (const user of [hospitalUser(), hospitalUser('ACTIVE'), { accountId: '321', role: 'DONOR', accountStatus: 'ACTIVE' }, adminUser('PENDING'), adminUser('SUSPENDED')]) {
      await mount('/admin/hospitals', { user }); await waitFor(() => location.pathname === '/unauthorized', 'unauthorized Admin redirect');
      assert(!fixture.calls.some((item) => item.url.startsWith('/admin/')), `${user.role}/${user.accountStatus} blocked before directory request`);
    }
  });
  await run('Admin forbidden detail clears directory without retry loops; session expiry clears protected data', async () => {
    const current = await mount('/admin/hospitals', { user: adminUser(), adminDetailForbidden: true });
    await waitFor(() => button('View details'), 'Admin results'); button('View details').click();
    await waitFor(() => text().includes('An active Admin account is required.'), 'forbidden detail'); await pause(100);
    assert(!container.querySelector('.mint-admin-table,#admin-hospital-detail') && !text().includes('Isolated Admin Hospital'), 'Forbidden clears list and detail');
    assert(current.calls.filter((item) => item.url.startsWith('/admin/hospitals/')).length === 1
      && current.calls.filter((item) => item.url === '/auth/me').length === 1, 'No protected retry/restoration loop');
    current.adminDetailForbidden = false; button('Try again').click(); await waitFor(() => button('View details'), 'manual list recovery');
    current.expireAdmin = true; button('Clear filters').click();
    await waitFor(() => location.pathname === '/login' && input('email'), 'expired Admin session login');
    assert(!text().includes('Isolated Admin Hospital') && !container.querySelector('#admin-hospital-detail'), 'Expired session removes protected data');
  });
  await run('Shared ACTIVE Admin login lands on management using existing authentication', async () => {
    await mount('/login', { loginRole: 'ADMIN' }); await waitFor(() => input('email'), 'shared login');
    await fill({ email: 'admin@example.test', password: 'Admin test pass7!' }); await submit();
    await waitFor(() => location.pathname === '/admin/hospitals' && button('View details'), 'Admin landing');
    assert(fixture.calls.some((call) => call.url === '/auth/login') && fixture.calls.some((call) => call.url === '/admin/hospitals'), 'Shared login and real directory service sequence');
  });
  await run('Hospital registration rendering, required fields, labels, focus, scoped Mint and responsive layout', async () => {
    await mount('/login?register=hospital');
    await waitFor(() => input('organizationName'), 'registration form');
    assert(container.querySelectorAll('nav').length === 1, 'One shared navigation bar');
    assert(container.querySelector('.mint-app-shell') && !container.querySelector('.rose-app-shell'), 'Hospital uses only Mint shell');
    assert(getComputedStyle(container.querySelector('.mint-app-shell')).backgroundColor === 'rgb(241, 250, 246)', 'Exact Mint background');
    assert(getComputedStyle(container.querySelector('h1')).fontFamily.includes('Sora'), 'Sora heading');
    assert(getComputedStyle(input('email')).fontFamily.includes('Nunito Sans'), 'Nunito Sans input');
    assert(getComputedStyle(button('Register hospital')).backgroundColor === 'rgb(30, 138, 113)', 'Deep teal primary button');
    assert(!input('registrationNumber').required, 'Registration number optional');
    for (const name of ['organizationName', 'contactName', 'phone', 'address', 'email', 'password']) assert(input(name).required, `${name} required`);
    labels(); noOverflow();
    await submit();
    await waitFor(() => input('organizationName').getAttribute('aria-invalid') === 'true', 'required validation');
    assert(!fixture.calls.some((call) => call.url === '/auth/register/hospitals'), 'Invalid form does not call registration');
    assert(document.activeElement === input('organizationName'), 'Validation focuses first invalid field');
    assert(getComputedStyle(document.activeElement).outlineStyle !== 'none', 'Visible focus outline');
  });
  await run('Hospital 201 success, exact allowlist/normalization, CSRF and no automatic login', async () => {
    const current = await mount('/login?register=hospital', { holdRegistration: true }); await waitFor(() => input('email'), 'registration form');
    await fill(registrationValues); await submit();
    await waitFor(() => typeof current.releaseRegistration === 'function', 'registration request in progress');
    await waitFor(() => button('Registering…')?.disabled, 'registration busy control');
    await submit();
    assert(current.calls.filter((item) => item.url === '/auth/register/hospitals').length === 1, 'Repeated submit is blocked while registering');
    current.releaseRegistration();
    await waitFor(() => text().includes('Your Hospital account is ready to sign in'), 'registration confirmation');
    const call = fixture.calls.find((item) => item.url === '/auth/register/hospitals');
    assert(JSON.stringify(Object.keys(call.data).sort()) === JSON.stringify(Object.keys(registrationValues).sort()), 'Exact registration field allowlist');
    assert(call.data.email === 'browser@example.test' && call.data.registrationNumber === null, 'Normalized email and optional null');
    assert(call.data.password === registrationValues.password, 'Exact password preserved');
    assert(call.headers['x-csrf-token'] === '1'.padStart(64, '0'), 'Fresh session CSRF token submitted');
    assert(!fixture.calls.some((item) => item.url === '/auth/login'), 'No automatic login request');
    assert(text().includes('Pending approval') && text().includes('not been signed in automatically'), 'PENDING and explicit-login confirmation');
    assert(container.querySelector('a[href="/login"]'), 'Return to shared login');
    assert(!input('password'), 'Password form discarded after success'); noOverflow();
    container.querySelector('.mint-registration-success .mint-primary-button').click();
    await waitFor(() => input('email') && button('Sign in'), 'explicit sign-in after registration');
    await fill({ email: 'browser@example.test', password: registrationValues.password }); await submit();
    await waitFor(() => location.pathname === '/hospital/profile' && button('Edit contact information'), 'Hospital login lands on Profile');
    assert(current.calls.some((item) => item.url === '/auth/login'), 'Login occurs only after the explicit sign-in submission');
    assert(container.querySelector('a[href="/hospital/profile"]'), 'Hospital-only Profile navigation');
    await mount('/hospital/profile', { user: current.user, profile: current.profile });
    await waitFor(() => button('Edit contact information'), 'Profile session restoration after remount');
    assert(fixture.calls[0].url === '/auth/me' && fixture.calls.some((item) => item.url === '/hospitals/me'), 'Refresh restores identity and reloads saved data');
  });
  for (const [code, name] of [['EMAIL_CONFLICT', 'email'], ['HOSPITAL_REGISTRATION_CONFLICT', 'registrationNumber']]) {
    await run(`${code} maps to the corresponding registration field`, async () => {
      await mount('/login?register=hospital', { registrationConflict: code }); await waitFor(() => input('email'), 'registration form');
      await fill({ ...registrationValues, registrationNumber: 'REAL-TEST-ONLY' }); await submit();
      await waitFor(() => input(name)?.getAttribute('aria-invalid') === 'true', 'duplicate field error');
      assert(document.activeElement === input(name), 'Duplicate conflict receives focus');
      assert(!fixture.calls.some((item) => item.url === '/auth/login'), 'Conflict never logs in');
    });
  }
  await run('Hospital Profile loading, real GET projection and contact-only PATCH with fresh CSRF', async () => {
    const current = await mount('/hospital/profile', { user: hospitalUser(), holdProfile: true });
    await waitFor(() => text().includes('Retrieving your saved Hospital'), 'profile loading state');
    await waitFor(() => typeof current.releaseProfile === 'function', 'profile request in progress');
    current.releaseProfile();
    await waitFor(() => button('Edit contact information'), 'saved profile');
    assert(text().includes(current.profile.organizationName) && text().includes('Not provided'), 'Saved organization and nullable registration displayed');
    assert(text().includes('PENDING') && text().includes('Awaiting approval'), 'PENDING text and restrictions');
    assert(!container.querySelector('input,textarea'), 'Read-only details are not editable fields');
    assert(!container.querySelector('a[href*="requests"]'), 'No operational request navigation');
    button('Edit contact information').click(); await waitFor(() => input('phone'), 'contact edit');
    assert(JSON.stringify([...container.querySelectorAll('input,textarea')].map((item) => item.name).sort()) === JSON.stringify(['address', 'contactName', 'phone']), 'Only three editable fields');
    labels(); await fill({ phone: ' +91 98765 ' }); await submit();
    await waitFor(() => text().includes('Your contact information has been saved.'), 'save confirmation');
    const patch = current.calls.find((item) => item.method === 'patch');
    assert(JSON.stringify(patch.data) === JSON.stringify({ phone: '+91 98765' }), 'PATCH sends changed contact field only');
    assert(patch.headers['x-csrf-token'] === '1'.padStart(64, '0'), 'PATCH gets fresh CSRF');
    assert(text().includes('+91 98765') && text().includes('PENDING'), 'Saved response displayed with unchanged PENDING status');
    noOverflow();
  });
  await run('ACTIVE Hospital edit and cancel preserve saved values', async () => {
    await mount('/hospital/profile', { user: hospitalUser('ACTIVE'), profile: profile('ACTIVE') });
    await waitFor(() => button('Edit contact information'), 'ACTIVE profile');
    assert(text().includes('Active account') && !text().includes('Awaiting approval'), 'ACTIVE status has explicit text');
    button('Edit contact information').click(); await waitFor(() => input('address'), 'edit');
    await fill({ address: 'Unsaved isolated test address' }); button('Cancel').click();
    await waitFor(() => button('Edit contact information'), 'cancel');
    assert(text().includes('Browser test address') && !text().includes('Unsaved isolated test address'), 'Cancel discards draft');
    assert(!fixture.calls.some((item) => item.method === 'patch'), 'Cancel sends no mutation');
    button('Edit contact information').click(); await waitFor(() => input('address'), 'ACTIVE edit again');
    await fill({ address: 'Saved active Hospital address' }); await submit();
    await waitFor(() => text().includes('Your contact information has been saved.'), 'ACTIVE save');
    assert(text().includes('Saved active Hospital address') && text().includes('ACTIVE'), 'ACTIVE Hospital can save contact data without a status change');
  });
  await run('Profile failure and empty states retry without fabricated records', async () => {
    await mount('/hospital/profile', { user: hospitalUser(), profileFailures: 1 });
    await waitFor(() => text().includes('Profile service unavailable.'), 'error state');
    assert(!text().includes('Isolated Browser Hospital'), 'Error does not show fallback Hospital');
    button('Try again').click(); await waitFor(() => button('Edit contact information'), 'retry profile');
    assert(fixture.calls.filter((item) => item.url === '/hospitals/me').length === 2, 'Retry performs another real service GET');
    await mount('/hospital/profile', { user: hospitalUser(), profileEmpty: true });
    await waitFor(() => text().includes('Profile unavailable'), 'empty profile');
    assert(!button('Edit contact information') && button('Try again'), 'Missing profile has retry without edit/fabricated data');
  });
  await run('Signed-out, DONOR, ADMIN and SUSPENDED route guards reject Hospital access', async () => {
    await mount('/hospital/profile'); await waitFor(() => location.pathname === '/login' && input('email'), 'signed-out redirect');
    assert(!fixture.calls.some((item) => item.url === '/hospitals/me'), 'Signed-out route never requests protected data');
    for (const user of [{ accountId: '321', role: 'DONOR', accountStatus: 'ACTIVE' }, { accountId: '31', role: 'ADMIN', accountStatus: 'ACTIVE' }, hospitalUser('SUSPENDED')]) {
      await mount('/hospital/profile', { user }); await waitFor(() => location.pathname === '/unauthorized', 'wrong-role redirect');
      assert(!fixture.calls.some((item) => item.url === '/hospitals/me'), `${user.role}/${user.accountStatus} cannot request Hospital self-profile`);
    }
  });
  await run('Session expiry during save clears protected data and follows shared login flow', async () => {
    await mount('/hospital/profile', { user: hospitalUser(), expirePatch: true });
    await waitFor(() => button('Edit contact information'), 'profile'); button('Edit contact information').click();
    await waitFor(() => input('phone'), 'edit'); await fill({ phone: '987' }); await submit();
    await waitFor(() => location.pathname === '/login' && input('email'), 'expired session login');
    assert(!text().includes('Isolated Browser Hospital'), 'Expired profile data cleared');
  });
  await run('Persistent Profile 403 remains an explicit retry state without an account-restoration loop', async () => {
    const current = await mount('/hospital/profile', { user: hospitalUser(), profileForbidden: true });
    await waitFor(() => text().includes('Hospital profile access is denied.'), 'profile forbidden response');
    await pause(100);
    assert(!text().includes('Isolated Browser Hospital'), 'Forbidden profile data cleared');
    assert(current.calls.filter((item) => item.url === '/hospitals/me').length === 1, 'No automatic protected GET retry');
    assert(current.calls.filter((item) => item.url === '/auth/me').length === 1, 'No repeated account restoration');
    assert(button('Try again'), 'Explicit retry available');
    current.profileForbidden = false;
    button('Try again').click();
    await waitFor(() => button('Edit contact information'), 'explicit retry recovers');
  });
  await run('PATCH CSRF failure keeps the edit form and does not resubmit or invalidate the account', async () => {
    const current = await mount('/hospital/profile', { user: hospitalUser(), patchCsrfFailure: true });
    await waitFor(() => button('Edit contact information'), 'profile');
    button('Edit contact information').click(); await waitFor(() => input('phone'), 'contact edit');
    await fill({ phone: '987' }); await submit();
    await waitFor(() => text().includes('Refresh the page and try again.'), 'CSRF feedback');
    await pause(100);
    assert(input('phone')?.value === '987', 'Draft retained after CSRF rejection');
    assert(current.calls.filter((item) => item.method === 'patch').length === 1, 'No automatic PATCH retry');
    assert(current.calls.filter((item) => item.url === '/auth/me').length === 1, 'CSRF failure does not restore account repeatedly');
    current.patchCsrfFailure = false;
    await submit(); await waitFor(() => text().includes('Your contact information has been saved.'), 'manual save recovery');
    assert(current.csrf === 2, 'Manual retry obtains another fresh CSRF token');
  });
  await run('Hospital entry from Donor registration returns to actual sign-in mode', async () => {
    await mount('/login'); await waitFor(() => input('email'), 'shared login');
    button('Create a donor account').click(); await waitFor(() => input('fullName'), 'Donor form');
    container.querySelector('a[href="/login?register=hospital"]').click();
    await waitFor(() => input('organizationName'), 'Hospital form mode');
    container.querySelector('.mint-nav a[href="/login"]').click();
    await waitFor(() => input('email') && button('Sign in'), 'return to shared sign-in');
    assert(!input('fullName') && !input('organizationName'), 'Registration modes do not remain active on return');
  });
  await run('Existing shared Donor registration, login and Rose styling remain intact', async () => {
    await mount('/login', { loginRole: 'DONOR' }); await waitFor(() => input('email'), 'shared login');
    assert(container.querySelector('.rose-app-shell') && !container.querySelector('.mint-app-shell'), 'Login remains Rose styled');
    assert(getComputedStyle(container.querySelector('.rose-app-shell')).backgroundColor === 'rgb(255, 246, 247)', 'Shared Rose background not globally overwritten');
    assert(container.querySelector('a[href="/login?register=hospital"]'), 'Visible Hospital entry in shared login');
    button('Create a donor account').click(); await waitFor(() => input('fullName'), 'Donor form');
    await fill({ fullName: 'Isolated Browser Donor', email: 'donor@example.test', dateOfBirth: '1990-01-01', phone: '123', address: 'Browser address', password: 'Donor pass7!' });
    await submit(); await waitFor(() => text().includes('Your Donor account is registered'), 'Donor pending confirmation');
    const donorCall = fixture.calls.find((item) => item.url === '/auth/register/donors');
    assert(donorCall && !fixture.calls.some((item) => item.url === '/auth/register/hospitals'), 'Donor request route unchanged');
    assert(!fixture.calls.some((item) => item.url === '/auth/login'), 'Donor does not automatically log in');
    await fill({ email: 'donor@example.test', password: 'Donor pass7!' }); await submit();
    await waitFor(() => location.pathname === '/donor/profile' && text().includes('Isolated Browser Donor'), 'Donor login/profile');
    assert(container.querySelector('a[href="/donor/profile"]') && !container.querySelector('a[href="/hospital/profile"]'), 'Donor navigation remains role-specific');
  });
}

const parameters = new URLSearchParams(location.search);
const preview = parameters.get('preview');
const frameWidth = Number(parameters.get('frame'));
if (frameWidth >= 320 && frameWidth <= 1000 && window.parent === window) {
  // A CSS-sized iframe gives an exact layout viewport even when Windows Chrome
  // enforces a minimum top-level headless window width. This remains test-only.
  const frame = document.createElement('iframe');
  frame.title = 'Isolated responsive Hospital checks';
  frame.style.cssText = `display:block;width:${frameWidth}px;height:${preview ? 2000 : 1100}px;border:0;`;
  const destination = new URL('/tests/browser/index.html', location.origin);
  if (preview) { destination.searchParams.set('preview', preview); report.hidden = true; }
  frame.src = destination.href;
  window.addEventListener('message', (event) => {
    if (event.source === frame.contentWindow && event.origin === location.origin && event.data?.type === 'hospital-browser-result') {
      report.textContent = JSON.stringify(event.data.result);
    }
  });
  container.replaceChildren(frame);
} else if (preview) {
  report.hidden = true;
  await mount(preview === 'admin' ? '/admin/hospitals' : preview === 'profile' ? '/hospital/profile' : '/login?register=hospital',
    preview === 'admin' ? { user: adminUser() } : preview === 'profile' ? { user: hospitalUser() } : {});
} else {
  try { await scenarios(); }
  catch (error) { results.push({ name: 'browser harness', passed: false, error: error.message }); }
  const result = { done: true, width: innerWidth, clientWidth: document.documentElement.clientWidth,
    checks, results, passed: results.every((item) => item.passed) };
  report.textContent = JSON.stringify(result);
  if (window.parent !== window) window.parent.postMessage({ type: 'hospital-browser-result', result }, location.origin);
}
