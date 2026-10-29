export async function runBookingScenarios({ mount, waitFor, assert, text, button, fill, submit, pause, noOverflow, labels,
  container, adminUser, activeDonor, run }) {
  const confirmation = () => container.querySelector('.booking-confirm');
  await run('ACTIVE Donor eligibility preview is advisory, dated in IST and Rose styled', async () => {
    const f = await mount('/donor/eligibility', { user: activeDonor() });
    await waitFor(() => text().includes('NO BLOCKING HISTORY'), 'eligibility result');
    assert(text().includes('2026-10-27') && text().includes('appointment date'), 'Preview and booking dates are distinguished');
    assert(container.querySelector('.rose-app-shell'), 'Donor theme remains Rose');
    assert(f.calls.some(call => call.url === '/donors/me/eligibility'), 'Owner-scoped eligibility GET');
    labels(); noOverflow();
  });
  await run('PENDING Donor and Hospital cannot use operational pages', async () => {
    await mount('/donor/slots', { user: { ...activeDonor(), accountStatus: 'PENDING' } });
    await waitFor(() => location.pathname === '/unauthorized', 'pending Donor denied');
    await mount('/admin/bookings', { user: { accountId: '123', role: 'HOSPITAL', accountStatus: 'ACTIVE' } });
    await waitFor(() => location.pathname === '/unauthorized', 'Hospital denied Admin booking list');
  });
  await run('Donor slot booking confirmation can cancel, then sends fixed payload and refreshes capacity', async () => {
    const f = await mount('/donor/slots', { user: activeDonor() });
    await waitFor(() => button('Book'), 'future slot');
    assert(text().includes('Remaining: 1') && text().includes('Appointment-date eligibility'), 'Capacity and per-slot advisory status displayed');
    button('Book').click(); await waitFor(() => confirmation(), 'booking confirmation');
    assert(text().includes('cannot be rebooked'), 'Unique-key consequence is explained');
    button('Cancel').click(); await pause();
    assert(!f.calls.some(call => call.url === '/donors/me/bookings' && call.method === 'post'), 'Cancel sends no mutation');
    button('Book').click(); await waitFor(() => confirmation(), 'new confirmation');
    button('Confirm book slot').click();
    await waitFor(() => text().includes('Book slot was saved.') && text().includes('Remaining: 0'), 'saved booking and capacity refresh');
    const mutation = f.calls.filter(call => call.url === '/donors/me/bookings' && call.method === 'post');
    assert(mutation.length === 1 && JSON.stringify(mutation[0].data) === JSON.stringify({ slotId: '40' }), 'One exact mutation');
    assert(Boolean(mutation[0].headers['x-csrf-token']), 'Fresh CSRF used');
    labels(); noOverflow();
  });
  await run('Donor booking list cancels own reservation and retains history', async () => {
    const f = await mount('/donor/bookings', { user: activeDonor(), bookings: [{ bookingId: '1', donorAccountId: '321', slotId: '40',
      bookingStatus: 'BOOKED', bookedAt: '2026-10-27T10:00:00+05:30', statusChangedAt: '2026-10-27T10:00:00+05:30',
      startsAt: '2026-11-01T10:00:00+05:30', endsAt: '2026-11-01T11:00:00+05:30', cancellationReason: null }] });
    await waitFor(() => button('Cancel booking'), 'own booking');
    button('Cancel booking').click(); await waitFor(() => confirmation(), 'cancellation confirmation');
    button('Confirm cancel booking').click();
    await waitFor(() => f.calls.some(call => call.url === '/donors/me/bookings/1/cancellation' && call.method === 'post')
      && text().includes('Status: CANCELLED_BY_DONOR'), 'preserved cancelled booking');
    const mutation = f.calls.filter(call => call.url.includes('/cancellation') && call.method === 'post');
    assert(mutation.length === 1 && mutation[0].data.reasonCode === 'DONOR_REQUESTED', 'Owner route and fixed reason');
    assert(!button('Cancel booking'), 'Cancelled row is no longer actionable');
    labels(); noOverflow();
  });
  await run('Admin slot page is Mint, creates with exact IST timestamps and lists updated slot', async () => {
    const f = await mount('/admin/donation-slots', { user: adminUser() });
    await waitFor(() => button('Review creation'), 'slot form');
    assert(container.querySelector('.mint-app-shell'), 'Admin theme remains Mint');
    await fill({ startsAt: '2026-11-02T10:00', endsAt: '2026-11-02T11:00', capacity: '2' });
    button('Review creation').click(); await waitFor(() => confirmation(), 'slot creation confirmation');
    button('Confirm create slot').click(); await waitFor(() => text().includes('Create slot was saved.'), 'slot saved');
    const mutation = f.calls.find(call => call.url === '/admin/donation-slots' && call.method === 'post');
    assert(mutation?.data.startsAt === '2026-11-02T10:00:00+05:30' && mutation?.data.capacity === 2, 'Explicit IST payload');
    labels(); noOverflow();
  });
  await run('Admin slot cancellation uses controlled reason and releases BOOKED fixture reservation', async () => {
    const f = await mount('/admin/donation-slots', { user: adminUser(), bookings: [{ bookingId: '1', donorAccountId: '321', slotId: '40', bookingStatus: 'BOOKED' }] });
    await waitFor(() => button('Cancel slot'), 'Admin slot');
    button('Cancel slot').click(); await waitFor(() => confirmation(), 'slot cancellation');
    assert(text().includes('Checked-in attendance must be resolved'), 'Staff consequence visible');
    button('Confirm cancel slot').click(); await waitFor(() => text().includes('Cancel slot was saved.'), 'slot cancellation saved');
    assert(f.bookings[0].bookingStatus === 'CANCELLED_BY_STAFF', 'Fixture booking released');
    const mutation = f.calls.find(call => call.url === '/admin/donation-slots/40' && call.method === 'patch');
    assert(mutation?.data.reason === 'STAFF_CANCELLED' && mutation.data.slotStatus === 'CANCELLED', 'Exact controlled action');
    labels(); noOverflow();
  });
  await run('Admin booking queue offers guarded check-in for an active donor appointment', async () => {
    const start = new Date(Date.now() - 60_000).toISOString(); const end = new Date(Date.now() + 60 * 60_000).toISOString();
    const f = await mount('/admin/bookings', { user: adminUser(), bookings: [{ bookingId: '1', donorAccountId: '321', donorName: 'Fixture Donor',
      donorAccountStatus: 'ACTIVE', hasDonation: false, latestDecision: null, slotId: '40', slotStatus: 'OPEN', bookingStatus: 'BOOKED', bookedAt: start,
      statusChangedAt: start, startsAt: start, endsAt: end }] });
    await waitFor(() => text().includes('Fixture Donor'), 'Admin booking fixture');
    assert(Boolean(button('Check in')), 'Eligible active Donor has check-in action');
    button('Check in').click(); await waitFor(() => confirmation(), 'check-in confirmation');
    assert(text().includes('BOOKED to CHECKED_IN') && text().includes('does not create a donation'), 'Confirmation states identity transition and boundary');
    button('Cancel').click(); await pause();
    assert(!f.calls.some(call => call.url === '/admin/bookings/1/status'), 'Cancel performs no mutation');
    button('Check in').click(); await waitFor(() => confirmation(), 'check-in confirmation'); button('Confirm check in').click();
    await waitFor(() => text().includes('Check in was saved.') && text().includes('Status: CHECKED_IN'), 'checked-in row refreshed');
    const mutation = f.calls.find(call => call.url === '/admin/bookings/1/status' && call.method === 'patch');
    assert(JSON.stringify(mutation.data) === JSON.stringify({ bookingStatus: 'CHECKED_IN', reason: 'STAFF_CHECKED_IN' }), 'Exact check-in contract');
    assert(Boolean(mutation.headers['x-csrf-token']), 'Fresh CSRF used');
    labels(); noOverflow();
  });
  await run('Admin individual cancellation confirms and sends the fixed pre-appointment transition', async () => {
    const start = new Date(Date.now() + 60 * 60_000).toISOString(); const end = new Date(Date.now() + 2 * 60 * 60_000).toISOString();
    const f = await mount('/admin/bookings', { user: adminUser(), bookings: [{ bookingId: '19', donorAccountId: '321', donorName: 'Fixture Donor',
      donorAccountStatus: 'ACTIVE', hasDonation: false, slotId: '40', slotStatus: 'CLOSED', bookingStatus: 'BOOKED', bookedAt: start,
      statusChangedAt: start, startsAt: start, endsAt: end, cancellationReason: null }] });
    await waitFor(() => button('Cancel booking'), 'individual staff cancellation');
    assert(!button('Mark no-show'), 'No-show is unavailable before slot end');
    button('Cancel booking').click(); await waitFor(() => confirmation(), 'individual cancellation confirmation');
    assert(text().includes('BOOKED to CANCELLED_BY_STAFF') && text().includes('Fixture Donor'), 'Confirmation freezes donor and transition');
    button('Cancel').click(); await pause();
    assert(!f.calls.some(call => call.url === '/admin/bookings/19/status'), 'Cancelling confirmation performs no mutation');
    button('Cancel booking').click(); await waitFor(() => confirmation(), 'confirm individual cancellation');
    button('Confirm cancel individual booking').click();
    await waitFor(() => text().includes('Cancel individual booking was saved.') && text().includes('Status: CANCELLED_BY_STAFF'), 'Cancelled booking refreshes');
    const mutation = f.calls.find(call => call.url === '/admin/bookings/19/status' && call.method === 'patch');
    assert(JSON.stringify(mutation.data) === JSON.stringify({ bookingStatus: 'CANCELLED_BY_STAFF', reason: 'STAFF_CANCELLED' }), 'Exact fixed individual cancellation payload');
    assert(Boolean(mutation.headers['x-csrf-token']), 'Fresh CSRF used');
    labels(); noOverflow();
  });
  await run('Admin no-show is available only after end, confirms, and recovers conflicts with GET', async () => {
    const start = new Date(Date.now() - 2 * 60 * 60_000).toISOString(); const end = new Date(Date.now() - 60 * 60_000).toISOString();
    const f = await mount('/admin/bookings', { user: adminUser(), bookingMode: 'conflict', bookings: [{ bookingId: '20', donorAccountId: '321', donorName: 'Fixture Donor',
      donorAccountStatus: 'ACTIVE', hasDonation: false, slotId: '40', slotStatus: 'OPEN', bookingStatus: 'BOOKED', bookedAt: start,
      statusChangedAt: start, startsAt: start, endsAt: end, cancellationReason: null }] });
    await waitFor(() => button('Mark no-show'), 'ended booking action');
    assert(!button('Cancel booking'), 'Individual cancellation is no longer available after slot start');
    button('Mark no-show').click(); await waitFor(() => confirmation(), 'no-show confirmation');
    assert(text().includes('NO_SHOW') && text().includes('Fixture Donor'), 'Confirmation identifies donor and no-show action');
    button('Confirm mark no-show').click();
    await waitFor(() => text().includes('This item changed. Reload the list'), 'Conflict message');
    assert(f.calls.filter(call => call.url === '/admin/bookings/20/status' && call.method === 'patch').length === 1, 'Conflict is never retried');
    assert(f.calls.filter(call => call.url === '/admin/bookings' && call.method === 'get').length >= 2, 'Conflict recovery reads the booking list');
    labels(); noOverflow();
  });
  await run('Admin no-show transport uncertainty is not retried and recovers by list read', async () => {
    const start = new Date(Date.now() - 2 * 60 * 60_000).toISOString(); const end = new Date(Date.now() - 60 * 60_000).toISOString();
    const f = await mount('/admin/bookings', { user: adminUser(), bookingMode: 'timeout', bookings: [{ bookingId: '21', donorAccountId: '321', donorName: 'Fixture Donor',
      donorAccountStatus: 'ACTIVE', hasDonation: false, slotId: '40', slotStatus: 'OPEN', bookingStatus: 'BOOKED', bookedAt: start,
      statusChangedAt: start, startsAt: start, endsAt: end, cancellationReason: null }] });
    await waitFor(() => button('Mark no-show'), 'ended booking action'); button('Mark no-show').click();
    await waitFor(() => confirmation(), 'no-show confirmation'); button('Confirm mark no-show').click();
    await waitFor(() => text().includes('outcome could not be confirmed'), 'uncertain outcome message');
    assert(f.calls.filter(call => call.url === '/admin/bookings/21/status' && call.method === 'patch').length === 1, 'Uncertain mutation is never retried');
    assert(f.calls.filter(call => call.url === '/admin/bookings' && call.method === 'get').length >= 2, 'Uncertain recovery uses GET only');
    noOverflow();
  });
  await run('Admin no-show malformed success is uncertain and only reloads the current list', async () => {
    const start = new Date(Date.now() - 2 * 60 * 60_000).toISOString(); const end = new Date(Date.now() - 60 * 60_000).toISOString();
    const f = await mount('/admin/bookings', { user: adminUser(), bookingMode: 'malformed', bookings: [{ bookingId: '22', donorAccountId: '321', donorName: 'Fixture Donor',
      donorAccountStatus: 'ACTIVE', hasDonation: false, slotId: '40', slotStatus: 'OPEN', bookingStatus: 'BOOKED', bookedAt: start,
      statusChangedAt: start, startsAt: start, endsAt: end, cancellationReason: null }] });
    await waitFor(() => button('Mark no-show'), 'ended booking action'); button('Mark no-show').click();
    await waitFor(() => confirmation(), 'no-show confirmation'); button('Confirm mark no-show').click();
    await waitFor(() => text().includes('outcome could not be confirmed') && text().includes('Status: NO_SHOW'), 'uncertain message with read recovery');
    assert(f.calls.filter(call => call.url === '/admin/bookings/22/status' && call.method === 'patch').length === 1, 'Malformed success is not retried');
    assert(f.calls.filter(call => call.url === '/admin/bookings' && call.method === 'get').length >= 2, 'Malformed success recovery uses GET');
    noOverflow();
  });
  await run('Admin day-of decision is accessible, visit-scoped, append-only, and uses exact fixed request', async () => {
    const start = new Date(Date.now() - 60_000).toISOString(); const end = new Date(Date.now() + 60 * 60_000).toISOString();
    const f = await mount('/admin/bookings', { user: adminUser(), bookings: [{ bookingId: '1', donorAccountId: '321', donorName: 'Fixture Donor',
      donorAccountStatus: 'ACTIVE', hasDonation: false, latestDecision: 'REVIEW_REQUIRED', latestDeferredUntil: null,
      slotId: '40', slotStatus: 'OPEN', bookingStatus: 'CHECKED_IN', bookedAt: start, statusChangedAt: start, startsAt: start, endsAt: end }] });
    await waitFor(() => button('Review decision'), 'day-of decision control');
    assert(text().includes('Latest staff decision: REVIEW REQUIRED'), 'Current decision context shown');
    assert(container.querySelector('[aria-label="Day-of eligibility decision for booking 1"]'), 'Decision control has accessible label');
    await fill({ 'decision-1': 'TEMPORARILY_DEFERRED' });
    assert(Boolean(container.querySelector('[name="deferredUntil-1"]')), 'Deferral requires a date');
    const deferredUntil = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    await fill({ 'deferredUntil-1': deferredUntil });
    button('Review decision').click(); await waitFor(() => confirmation(), 'decision confirmation');
    assert(text().includes('TEMPORARILY DEFERRED') && text().includes('Fixture Donor')
      && text().includes(`through ${deferredUntil}, inclusive in India Standard Time`), 'Confirmation identifies donor, decision, and captured inclusive IST date');
    button('Cancel').click(); await pause();
    assert(!f.calls.some(call => call.url.endsWith('/eligibility-decisions')), 'Cancel sends no decision');
    button('Review decision').click(); await waitFor(() => confirmation(), 'decision confirmation after cancel'); button('Confirm record eligibility decision').click();
    await waitFor(() => text().includes('Record eligibility decision was saved.') && text().includes('TEMPORARILY DEFERRED'), 'saved decision displayed after refresh');
    const mutation = f.calls.find(call => call.url === '/admin/donors/321/eligibility-decisions' && call.method === 'post');
    assert(mutation?.data.bookingId === '1' && mutation.data.decision === 'TEMPORARILY_DEFERRED'
      && mutation.data.deferredUntil === deferredUntil && mutation.data.reasonCode === undefined && mutation.data.safeNote === undefined,
    'Exact bounded request includes the captured date; no client reason or notes');
    const saved = f.calls.find(call => call.url.endsWith('/eligibility-decisions'));
    assert(saved, 'Decision mutation was dispatched with a valid complete response');
    labels(); noOverflow();
  });
  await run('Deferred decision response must match captured date and contain a valid decision ID', async () => {
    for (const [mode, expected] of [['wrong-date', 'mismatched date'], ['missing-date', 'missing date'], ['invalid-id', 'invalid ID']]) {
      const start = new Date(Date.now() - 60_000).toISOString(); const end = new Date(Date.now() + 60 * 60_000).toISOString();
      const f = await mount('/admin/bookings', { user: adminUser(), eligibilityDecisionMode: mode, bookings: [{ bookingId: '1', donorAccountId: '321',
        donorName: 'Fixture Donor', donorAccountStatus: 'ACTIVE', hasDonation: false, latestDecision: null, slotId: '40', slotStatus: 'OPEN',
        bookingStatus: 'CHECKED_IN', bookedAt: start, statusChangedAt: start, startsAt: start, endsAt: end }] });
      await waitFor(() => button('Review decision'), `${expected} fixture`);
      await fill({ 'decision-1': 'TEMPORARILY_DEFERRED' });
      const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
      await fill({ 'deferredUntil-1': date }); button('Review decision').click();
      await waitFor(() => text().includes(`through ${date}, inclusive in India Standard Time`), `${expected} confirmation`);
      button('Confirm record eligibility decision').click();
      await waitFor(() => text().includes('outcome could not be confirmed'), `${expected} uncertain outcome`);
      assert(!text().includes('Record eligibility decision was saved.'), `${expected} cannot display success`);
      assert(f.calls.filter(call => call.url.endsWith('/eligibility-decisions') && call.method === 'post').length === 1,
        `${expected} is not retried`);
      assert(f.calls.filter(call => call.url === '/admin/bookings' && call.method === 'get').length >= 2,
        `${expected} recovery uses a list read`);
      noOverflow();
    }
  });
  await run('Admin booking CSRF preflight becomes obsolete after booking query changes', async () => {
    const start = new Date(Date.now() - 60_000).toISOString(); const end = new Date(Date.now() + 60 * 60_000).toISOString();
    const f = await mount('/admin/bookings', { user: adminUser(), holdBookingCsrf: true, bookings: [{ bookingId: '1', donorAccountId: '321',
      donorName: 'Fixture Donor', donorAccountStatus: 'ACTIVE', slotId: '40', slotStatus: 'OPEN', bookingStatus: 'BOOKED',
      hasDonation: false, startsAt: start, endsAt: end, bookedAt: start, statusChangedAt: start }] });
    await waitFor(() => button('Check in'), 'eligible check-in'); button('Check in').click(); await waitFor(() => confirmation(), 'confirm check-in');
    button('Confirm check in').click(); await waitFor(() => f.releaseBookingCsrf, 'held CSRF');
    await fill({ bookingStatus: 'BOOKED' }); button('Search').click(); await waitFor(() => !confirmation(), 'query clears old confirmation');
    f.releaseBookingCsrf(); await pause(30);
    assert(!f.calls.some(call => call.url === '/admin/bookings/1/status'), 'Obsolete CSRF preflight does not dispatch PATCH');
    assert(!container.querySelector('.booking-notice,.booking-confirm'), 'Obsolete preflight cannot change current feedback');
  });
  await run('Admin in-flight check-in remains single-dispatch and old result cannot change a new query', async () => {
    const start = new Date(Date.now() - 60_000).toISOString(); const end = new Date(Date.now() + 60 * 60_000).toISOString();
    const f = await mount('/admin/bookings', { user: adminUser(), holdBookingMutation: true, bookings: [{ bookingId: '1', donorAccountId: '321',
      donorName: 'Fixture Donor', donorAccountStatus: 'ACTIVE', slotId: '40', slotStatus: 'OPEN', bookingStatus: 'BOOKED',
      hasDonation: false, startsAt: start, endsAt: end, bookedAt: start, statusChangedAt: start }] });
    await waitFor(() => button('Check in'), 'eligible check-in'); button('Check in').click(); await waitFor(() => confirmation(), 'confirmation');
    button('Confirm check in').click(); await waitFor(() => f.releaseBookingMutation, 'dispatched PATCH');
    await fill({ bookingStatus: 'CHECKED_IN' }); button('Search').click(); await waitFor(() => text().includes('No bookings match'), 'new query ready');
    assert(text().includes('An action is still in progress'), 'Duplicate guard remains across query change');
    f.releaseBookingMutation(); await waitFor(() => !text().includes('An action is still in progress'), 'mutation settled');
    assert(!container.querySelector('.booking-notice,.booking-confirm'), 'Obsolete success has no effect on current view');
    assert(f.calls.filter(call => call.url === '/admin/bookings/1/status' && call.method === 'patch').length === 1, 'Mutation not retried');
    labels(); noOverflow();
  });
  await run('Admin staff actions are hidden for inactive donors or visits with a Donation', async () => {
    const start = new Date(Date.now() - 60_000).toISOString(); const end = new Date(Date.now() + 60 * 60_000).toISOString();
    await mount('/admin/bookings', { user: adminUser(), bookings: [
      { bookingId: '1', donorAccountId: '321', donorName: 'Inactive fixture', donorAccountStatus: 'SUSPENDED', slotId: '40', slotStatus: 'OPEN', bookingStatus: 'BOOKED', hasDonation: false, startsAt: start, endsAt: end },
      { bookingId: '2', donorAccountId: '322', donorName: 'Donation fixture', donorAccountStatus: 'ACTIVE', slotId: '41', slotStatus: 'OPEN', bookingStatus: 'CHECKED_IN', hasDonation: true, startsAt: start, endsAt: end },
    ] });
    await waitFor(() => text().includes('Inactive fixture') && text().includes('Donation fixture'), 'ineligible rows');
    assert(!button('Check in') && !button('Review decision'), 'UI hides actions outside the bounded eligibility conditions');
    labels(); noOverflow();
  });
  await run('Conflict and uncertain booking outcomes use reads without blind mutation retries', async () => {
    for (const [mode, expected] of [['conflict', 'This item changed'], ['timeout', 'outcome could not be confirmed'], ['malformed', 'outcome could not be confirmed']]) {
      const f = await mount('/donor/slots', { user: activeDonor(), bookingMode: mode });
      await waitFor(() => button('Book'), 'slot to book'); button('Book').click();
      await waitFor(() => button('Confirm book slot'), 'confirmation'); button('Confirm book slot').click();
      await waitFor(() => text().includes(expected), `${mode} feedback`);
      assert(f.calls.filter(call => call.url === '/donors/me/bookings' && call.method === 'post').length === 1, `${mode} sends once`);
      assert(f.calls.filter(call => call.url === '/donation-slots' && call.method === 'get').length >= 2, `${mode} recovers with GET`);
    }
    noOverflow();
  });
  await run('Delayed CSRF after changed filters invalidates confirmation before PATCH', async () => {
    const f = await mount('/donor/slots', { user: activeDonor(), holdBookingCsrf: true });
    await waitFor(() => button('Book'), 'slot'); button('Book').click();
    await waitFor(() => button('Confirm book slot'), 'confirmation'); button('Confirm book slot').click();
    await waitFor(() => f.releaseBookingCsrf, 'held CSRF');
    button('Search').click(); await waitFor(() => !confirmation(), 'selection cleared');
    f.releaseBookingCsrf(); await pause(20);
    assert(!f.calls.some(call => call.url === '/donors/me/bookings' && call.method === 'post'), 'No stale PATCH');
  });

  for (const mode of ['success', 'conflict', 'timeout', 'validation']) {
    await run(`Obsolete ${mode} booking response cannot change a newer query or release the dispatch guard early`, async () => {
      const f = await mount('/donor/slots', { user: activeDonor(), holdBookingMutation: true, bookingMode: mode });
      await waitFor(() => button('Book'), 'bookable row'); button('Book').click();
      await waitFor(() => button('Confirm book slot'), 'confirmation'); button('Confirm book slot').click();
      await waitFor(() => f.releaseBookingMutation, 'held dispatched booking');
      await fill({ from: '2026-11-01' }); button('Search').click();
      await waitFor(() => button('Book') && !confirmation(), 'new query ready');
      const reads = f.calls.filter(call => call.url === '/donation-slots' && call.method === 'get').length;
      assert(button('Book').disabled, 'Guard survives query change until old mutation settles');
      button('Book').click();
      assert(f.calls.filter(call => call.url === '/donors/me/bookings' && call.method === 'post').length === 1, 'No duplicate dispatch');
      f.releaseBookingMutation();
      await waitFor(() => !button('Book').disabled, 'settled guard');
      assert(!container.querySelector('.booking-notice,.booking-confirm'), 'Old fulfillment/rejection has no UI effect');
      assert(f.calls.filter(call => call.url === '/donation-slots' && call.method === 'get').length === reads, 'Old result cannot reload current query');
      assert(text().includes('Remaining: 1'), 'New query snapshot is unchanged by old response');
      button('Book').click(); await waitFor(() => confirmation(), 'fresh selection');
      assert(text().includes('Confirm book slot'), 'Fresh selection remains available after old request settles');
      noOverflow();
    });
  }

  await run('Booked slot with timestamp seconds sends capacity-only PATCH', async () => {
    const f = await mount('/admin/donation-slots', { user: adminUser(), bookingSlots: [{ slotId: '40',
      startsAt: '2026-11-01T10:00:37+05:30', endsAt: '2026-11-01T11:00:53+05:30',
      capacity: 1, occupied: 1, remaining: 0, slotStatus: 'OPEN' }],
    bookings: [{ bookingId: '1', slotId: '40', donorAccountId: '321', bookingStatus: 'BOOKED' }] });
    await waitFor(() => button('Edit'), 'existing booked slot'); button('Edit').click();
    await waitFor(() => button('Review update'), 'capacity form');
    assert(container.querySelector('[name=startsAt]').value.endsWith(':37')
      && container.querySelector('[name=endsAt]').value.endsWith(':53'), 'Saved seconds retained in draft');
    await fill({ capacity: '2' }); button('Review update').click();
    await waitFor(() => button('Confirm update slot'), 'update confirmation'); button('Confirm update slot').click();
    await waitFor(() => text().includes('Update slot was saved.'), 'capacity update saved');
    const patch = f.calls.find(call => call.url === '/admin/donation-slots/40' && call.method === 'patch');
    assert(JSON.stringify(patch.data) === JSON.stringify({ capacity: 2 }), 'No schedule fields in capacity-only edit');
    assert(f.bookingSlots[0].startsAt.endsWith(':37+05:30') && f.bookingSlots[0].endsAt.endsWith(':53+05:30'), 'Schedule preserved');
    labels(); noOverflow();
  });

  for (const change of ['edit', 'discard']) {
    for (const csrfFailure of [false, true]) {
      await run(`Admin ${change} invalidates delayed ${csrfFailure ? 'rejected' : 'fulfilled'} CSRF preflight`, async () => {
        const f = await mount('/admin/donation-slots', { user: adminUser(), holdBookingCsrf: true, statusCsrfFailure: csrfFailure });
        await waitFor(() => button('Edit'), 'slot to edit'); button('Edit').click();
        await fill({ capacity: '2' }); button('Review update').click();
        await waitFor(() => button('Confirm update slot'), 'update confirmation'); button('Confirm update slot').click();
        await waitFor(() => f.releaseBookingCsrf, 'held CSRF');
        if (change === 'edit') await fill({ capacity: '3' }); else button('Discard edit').click();
        await waitFor(() => !confirmation(), 'obsolete confirmation cleared');
        f.releaseBookingCsrf(); await waitFor(() => !text().includes('An action is still in progress'), 'preflight settled');
        assert(!f.calls.some(call => call.url.startsWith('/admin/donation-slots/') && call.method === 'patch'), 'Obsolete preflight never dispatches');
        assert(!container.querySelector('.booking-notice,.booking-confirm'), 'Old preflight result cannot set feedback');
        assert(change === 'edit' ? container.querySelector('[name=capacity]').value === '3' : Boolean(button('Review creation')), 'Current draft preserved');
      });
    }
  }

  for (const mode of ['success', 'timeout']) {
    await run(`Admin draft change ignores delayed dispatched ${mode} result`, async () => {
      const f = await mount('/admin/donation-slots', { user: adminUser(), holdBookingMutation: true, bookingMode: mode });
      await waitFor(() => button('Edit'), 'slot edit'); button('Edit').click(); await fill({ capacity: '2' });
      button('Review update').click(); await waitFor(() => button('Confirm update slot'), 'confirmation'); button('Confirm update slot').click();
      await waitFor(() => f.releaseBookingMutation, 'held PATCH'); await fill({ capacity: '3' });
      const reads = f.calls.filter(call => call.url === '/donation-slots' && call.method === 'get').length;
      assert(button('Review update').disabled, 'Draft changes retain dispatch guard');
      f.releaseBookingMutation(); await waitFor(() => !button('Review update').disabled, 'PATCH settled');
      assert(!container.querySelector('.booking-notice,.booking-confirm'), 'Obsolete result cannot update notice/confirmation');
      assert(container.querySelector('[name=capacity]').value === '3', 'New draft unchanged');
      assert(f.calls.filter(call => call.url === '/donation-slots' && call.method === 'get').length === reads, 'No obsolete refresh');
    });
  }

  for (const mode of ['success', 'timeout']) {
    await run(`Old booking-management ${mode} result cannot affect fresh same-ID login`, async () => {
      const f = await mount('/admin/donation-slots', { user: adminUser(), holdBookingMutation: true, bookingMode: mode });
      await waitFor(() => button('Close'), 'slot action'); button('Close').click();
      await waitFor(() => button('Confirm close slot'), 'confirmation'); button('Confirm close slot').click();
      await waitFor(() => f.releaseBookingMutation, 'held PATCH');
      button('Sign out').click(); await waitFor(() => location.pathname === '/login' && container.querySelector('[name=email]'), 'signed out');
      f.loginRole = 'ADMIN'; f.loginAccountId = '31';
      await fill({ email: 'isolated-admin@example.test', password: 'Browser pass7!' }); await submit();
      await waitFor(() => location.pathname === '/admin/hospitals' && container.querySelector('a[href="/admin/donation-slots"]'), 'same-ID login');
      container.querySelector('a[href="/admin/donation-slots"]').click(); await waitFor(() => button('Close'), 'fresh slot workspace');
      button('Close').click(); await waitFor(() => confirmation(), 'fresh selection');
      const reads = f.calls.filter(call => call.url === '/donation-slots' && call.method === 'get').length;
      f.releaseBookingMutation(); await pause(30);
      assert(Boolean(confirmation()) && text().includes('Confirm close slot'), 'Old result leaves fresh confirmation intact');
      assert(!container.querySelector('.booking-notice'), 'Old result cannot set fresh notice');
      assert(f.calls.filter(call => call.url === '/donation-slots' && call.method === 'get').length === reads, 'Old result cannot reload fresh identity');
    });
  }
}
