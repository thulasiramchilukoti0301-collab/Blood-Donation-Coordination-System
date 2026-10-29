const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const booking = decision => ({ bookingId: '3', donorAccountId: '321', donorName: 'Fixture Donor',
  donorAccountStatus: 'ACTIVE', slotId: '40', bookingStatus: 'CHECKED_IN', slotStatus: 'OPEN',
  startsAt: `${today()}T09:00:00+05:30`, endsAt: `${today()}T10:00:00+05:30`,
  statusChangedAt: `${today()}T09:01:00+05:30`, latestDecision: decision,
  latestDecisionAt: `${today()}T09:05:00+05:30`, hasDonation: false });
const donation = () => ({ donationId: '8', bookingId: '3', donorAccountId: '321', donorName: 'Fixture Donor',
  slotId: '40', bookingStatus: 'COMPLETED', outcome: 'COLLECTED', releaseStatus: 'PENDING',
  collectedAt: `${today()}T09:20:00+05:30`, createdAt: `${today()}T09:30:00+05:30`, startsAt: `${today()}T09:00:00+05:30` });

export async function runDonationScenarios({ mount, waitFor, assert, text, button, fill, pause, noOverflow, labels,
  container, adminUser, activeDonor, run }) {
  await run('Admin outcome confirmation, cancellation and collected save stay separate from release approval', async () => {
    const current = await mount('/admin/donations/process', { user: adminUser(), bookings: [booking('ACCEPTED')] });
    await waitFor(() => button('Record outcome'), 'checked-in visit');
    assert(container.querySelector('.mint-app-shell'), 'Mint theme');
    assert(container.querySelector('a[href="/admin/donations/process"][aria-current="page"]'), 'Active Admin navigation');
    button('Record outcome').click(); await waitFor(() => container.querySelector('.donation-form'), 'outcome form');
    await fill({ collectedAt: `${today()}T09:20:12`, collectionReference: 'REF-BROWSER' });
    button('Review outcome').click(); await waitFor(() => button('Confirm outcome'), 'outcome confirmation');
    assert(text().includes('REF-BROWSER') && text().includes('COMPLETED') && text().includes('does not create an inventory unit'), 'Complete confirmation');
    button('Cancel').click(); await pause();
    assert(!current.calls.some(call => call.url === '/admin/donations' && call.method === 'post'), 'Cancel has no mutation');
    button('Review outcome').click(); await waitFor(() => button('Confirm outcome'), 'reopened confirmation');
    button('Confirm outcome').click(); await waitFor(() => text().includes('Donation outcome saved'), 'collected save');
    const post = current.calls.find(call => call.url === '/admin/donations' && call.method === 'post');
    assert(post && post.data.bookingId === '3' && post.data.outcome === 'COLLECTED'
      && post.data.collectedAt === `${today()}T09:20:12+05:30` && post.data.collectionReference === 'REF-BROWSER', 'Exact captured POST');
    assert(current.donations.length === 1 && current.bookings[0].bookingStatus === 'COMPLETED', 'Resolved booking and one donation');
    assert(!button('Record outcome'), 'Completed visit cannot be selected again');
    labels(); noOverflow();
  });

  await run('Incomplete and deferred outcomes omit collection fields and use final same-visit decisions', async () => {
    for (const [decision, outcome] of [['ACCEPTED', 'INCOMPLETE'], ['TEMPORARILY_DEFERRED', 'DEFERRED']]) {
      const current = await mount('/admin/donations/process', { user: adminUser(), bookings: [booking(decision)] });
      await waitFor(() => button('Record outcome'), 'checked-in visit');
      button('Record outcome').click(); await waitFor(() => container.querySelector('[name="recordOutcome"]'), 'outcome choice');
      if (outcome === 'INCOMPLETE') await fill({ recordOutcome: 'INCOMPLETE' });
      assert(!container.querySelector('[name="collectedAt"]'), 'No collection time for non-collected outcome');
      button('Review outcome').click(); await waitFor(() => button('Confirm outcome'), 'confirmation');
      button('Confirm outcome').click(); await waitFor(() => text().includes('Donation outcome saved'), 'outcome saved');
      const post = current.calls.find(call => call.url === '/admin/donations' && call.method === 'post');
      assert(post && post.data.outcome === outcome && Object.keys(post.data).length === 2, 'Only booking and outcome sent');
      assert(current.donations[0].releaseStatus === 'NOT_REQUIRED', 'No testing release needed');
    }
  });

  await run('Malformed success is uncertain and recovers by GET, without another POST', async () => {
    const current = await mount('/admin/donations/process', { user: adminUser(), bookings: [booking('TEMPORARILY_DEFERRED')], donationMode: 'malformed' });
    await waitFor(() => button('Record outcome'), 'checked-in visit');
    button('Record outcome').click(); await waitFor(() => button('Review outcome'), 'record form');
    button('Review outcome').click(); await waitFor(() => button('Confirm outcome'), 'confirmation');
    button('Confirm outcome').click(); await waitFor(() => text().includes('outcome could not be confirmed'), 'uncertain feedback');
    assert(current.calls.filter(call => call.url === '/admin/donations' && call.method === 'post').length === 1, 'No blind retry');
    await waitFor(() => text().includes('Donation 0'), 'GET history recovery');
    noOverflow();
  });

  await run('Conflict and transport uncertainty both recover by read without automatic mutation retry', async () => {
    for (const [mode, expected] of [['conflict', 'This item changed'], ['timeout', 'outcome could not be confirmed']]) {
      const current = await mount('/admin/donations/process', { user: adminUser(), bookings: [booking('TEMPORARILY_DEFERRED')], donationMode: mode });
      await waitFor(() => button('Record outcome'), 'checked-in visit');
      button('Record outcome').click(); await waitFor(() => button('Review outcome'), 'form');
      button('Review outcome').click(); await waitFor(() => button('Confirm outcome'), 'confirmation');
      button('Confirm outcome').click(); await waitFor(() => text().includes(expected), 'failure feedback');
      assert(current.calls.filter(call => call.url === '/admin/donations' && call.method === 'post').length === 1, 'No mutation retry');
      assert(current.calls.filter(call => call.url === '/admin/bookings' && call.method === 'get').length >= 2, 'GET recovery');
    }
  });

  await run('A dispatched old result cannot show success after its draft changes', async () => {
    const current = await mount('/admin/donations/process', { user: adminUser(), bookings: [booking('ACCEPTED')], holdDonationMutation: true });
    await waitFor(() => button('Record outcome'), 'checked-in visit');
    button('Record outcome').click(); await waitFor(() => button('Review outcome'), 'form');
    await fill({ collectedAt: `${today()}T09:20:00`, collectionReference: 'REF-1' });
    button('Review outcome').click(); await waitFor(() => button('Confirm outcome'), 'confirmation');
    button('Confirm outcome').click(); await waitFor(() => current.releaseDonationMutation, 'dispatched mutation');
    await fill({ collectionReference: 'REF-2' }); current.releaseDonationMutation(); await pause(30);
    assert(!text().includes('Donation outcome saved'), 'Old result cannot update current draft');
    assert(current.calls.filter(call => call.url === '/admin/donations' && call.method === 'post').length === 1, 'Only one dispatch');
  });

  await run('Confirmed save followed by history refresh failure gives separate saved feedback', async () => {
    await mount('/admin/donations/process', { user: adminUser(), bookings: [booking('TEMPORARILY_DEFERRED')], failDonationRefresh: true });
    await waitFor(() => button('Record outcome'), 'checked-in visit');
    button('Record outcome').click(); await waitFor(() => button('Review outcome'), 'form');
    button('Review outcome').click(); await waitFor(() => button('Confirm outcome'), 'confirmation');
    button('Confirm outcome').click();
    await waitFor(() => text().includes('The outcome was saved, but donation history could not be refreshed.'), 'saved refresh failure');
  });

  await run('Delayed CSRF invalidated by draft change never dispatches a Donation POST', async () => {
    const current = await mount('/admin/donations/process', { user: adminUser(), bookings: [booking('ACCEPTED')], holdBookingCsrf: true });
    await waitFor(() => button('Record outcome'), 'checked-in visit');
    button('Record outcome').click(); await waitFor(() => container.querySelector('[name="collectedAt"]'), 'form');
    await fill({ collectedAt: `${today()}T09:20:00`, collectionReference: 'REF-1' });
    button('Review outcome').click(); await waitFor(() => button('Confirm outcome'), 'confirmation');
    button('Confirm outcome').click(); await waitFor(() => current.releaseBookingCsrf, 'pending CSRF');
    await fill({ collectionReference: 'REF-2' }); current.releaseBookingCsrf(); await pause(30);
    assert(current.calls.filter(call => call.url === '/admin/donations' && call.method === 'post').length === 0, 'Old draft cannot dispatch');
  });

  await run('Donor history is read-only, owner-scoped, filterable and Rose styled', async () => {
    const other = { ...donation(), donationId: '9', donorAccountId: '999', donorName: 'Other' };
    const current = await mount('/donor/donations', { user: activeDonor(), donations: [donation(), other], nextEligibleDate: today() });
    await waitFor(() => text().includes('Donation 8'), 'own history');
    assert(container.querySelector('.rose-app-shell'), 'Rose theme');
    assert(!text().includes('Donation 9') && !text().includes('Other'), 'Other owner is hidden');
    assert(!button('Record outcome') && text().includes('not approved stock'), 'No staff mutation or implied approval');
    await fill({ from: today(), to: today() });
    container.querySelector('.donation-filters').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await waitFor(() => current.calls.some(call => call.url === '/donors/me/donations' && call.params?.from === today()), 'own filtered GET');
    assert(!current.calls.some(call => call.url === '/admin/donations'), 'No Admin history request');
    labels(); noOverflow();
  });
}
