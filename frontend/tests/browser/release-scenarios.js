const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const donation = () => ({ donationId: '8', bookingId: '3', donorAccountId: '321', outcome: 'COLLECTED',
  releaseStatus: 'PENDING', collectedAt: `${today()}T09:20:00+05:30`, createdAt: `${today()}T09:30:00+05:30` });

export async function runReleaseScenarios({ mount, waitFor, assert, text, button, fill, pause, noOverflow, labels,
  container, adminUser, activeDonor, run }) {
  await run('release approval confirmation, cancellation, exact POST and read-only inventory', async () => {
    const current = await mount('/admin/donations/testing', { user: adminUser(), donations: [donation()] });
    await waitFor(() => button('Review release'), 'pending donation');
    assert(container.querySelector('.mint-app-shell'), 'Mint release theme');
    button('Review release').click(); await waitFor(() => button('Review decision'), 'release draft');
    await fill({ confirmedBloodGroupId: '3' }); button('Review decision').click();
    await waitFor(() => button('Confirm decision'), 'approval confirmation');
    assert(text().includes('Donation 8') && text().includes('A-') && text().includes('creates exactly one BloodUnit'), 'Frozen approval context');
    button('Cancel').click(); await pause();
    assert(!current.calls.some(call => call.url?.endsWith('/testing-decision') && call.method === 'post'), 'Cancel sends no POST');
    button('Review decision').click(); await waitFor(() => button('Confirm decision'), 'reopened approval');
    button('Confirm decision').click(); await waitFor(() => text().includes('release decision saved'), 'approval success');
    const posts = current.calls.filter(call => call.url?.endsWith('/testing-decision') && call.method === 'post');
    assert(posts.length === 1 && posts[0].url === '/admin/donations/8/testing-decision', 'One exact release path');
    assert(posts[0].data.decision === 'APPROVED' && posts[0].data.confirmedBloodGroupId === '3'
      && Object.keys(posts[0].data).length === 2, 'Only approved body fields');
    assert(current.units.length === 1, 'One fixture unit');
    labels(); noOverflow();
    await mount('/admin/inventory', { user: adminUser(), units: current.units });
    await waitFor(() => text().includes('Unit 17'), 'inventory list');
    assert(!text().includes('Fixture Donor'), 'No Donor name in inventory');
    await fill({ availableOnly: 'true' });
    assert(container.querySelector('[name="unitStatus"]').value === 'AVAILABLE', 'Available-only uses AVAILABLE status');
    await fill({ unitStatus: 'EXPIRED' });
    assert(container.querySelector('[name="availableOnly"]').value === '', 'Other statuses clear available-only');
    labels(); noOverflow();
    await mount('/admin/inventory/17', { user: adminUser(), units: current.units });
    await waitFor(() => text().includes('Source Donation 8'), 'unit detail');
    assert(text().includes('Allocation history: unavailable'), 'No invented allocations');
    noOverflow();
  });

  await run('release rejection requires a bounded reason and creates no unit', async () => {
    const current = await mount('/admin/donations/testing', { user: adminUser(), donations: [donation()] });
    await waitFor(() => button('Review release'), 'pending rejection'); button('Review release').click();
    await waitFor(() => container.querySelector('[name="releaseDecision"]'), 'rejection draft');
    await fill({ releaseDecision: 'REJECTED', reasonCode: 'PROCESSING_ISSUE' });
    button('Review decision').click(); await waitFor(() => button('Confirm decision'), 'rejection confirmation');
    assert(text().includes('Processing issue') && text().includes('creates no BloodUnit'), 'Bounded rejection consequence');
    button('Confirm decision').click(); await waitFor(() => text().includes('release decision saved'), 'rejection success');
    const post = current.calls.find(call => call.url?.endsWith('/testing-decision') && call.method === 'post');
    assert(post.data.decision === 'REJECTED' && post.data.reasonCode === 'PROCESSING_ISSUE'
      && Object.keys(post.data).length === 2 && current.units.length === 0, 'Exact rejection and no unit');
    noOverflow();
  });

  await run('malformed release response is uncertain and recovers by GET without repeat POST', async () => {
    const current = await mount('/admin/donations/testing', { user: adminUser(), donations: [donation()], releaseMode: 'malformed' });
    await waitFor(() => button('Review release'), 'pending malformed'); button('Review release').click();
    await waitFor(() => container.querySelector('[name="confirmedBloodGroupId"]'), 'malformed draft');
    await fill({ confirmedBloodGroupId: '3' }); button('Review decision').click();
    await waitFor(() => button('Confirm decision'), 'malformed confirmation'); button('Confirm decision').click();
    await waitFor(() => text().includes('outcome could not be confirmed'), 'uncertain release');
    assert(current.calls.filter(call => call.url?.endsWith('/testing-decision') && call.method === 'post').length === 1, 'No blind retry');
    assert(current.calls.filter(call => call.url === '/admin/donations' && call.method === 'get').length >= 2, 'GET recovery');
    noOverflow();
  });

  await run('release conflict and dispatched timeout use GET recovery with no blind POST retry', async () => {
    for (const mode of ['conflict', 'timeout']) {
      const current = await mount('/admin/donations/testing', { user: adminUser(), donations: [donation()], releaseMode: mode });
      await waitFor(() => button('Review release'), 'pending release'); button('Review release').click();
      await waitFor(() => container.querySelector('[name="confirmedBloodGroupId"]'), 'release draft');
      await fill({ confirmedBloodGroupId: '3' }); button('Review decision').click();
      await waitFor(() => button('Confirm decision'), 'release confirmation'); button('Confirm decision').click();
      await waitFor(() => text().includes(mode === 'conflict' ? 'This item changed' : 'outcome could not be confirmed'), `${mode} recovery`);
      assert(current.calls.filter(call => call.url?.endsWith('/testing-decision') && call.method === 'post').length === 1, 'One POST only');
      assert(current.calls.filter(call => call.url === '/admin/donations' && call.method === 'get').length >= 2, 'GET recovery');
      noOverflow();
    }
  });

  await run('leaving release review during delayed CSRF prevents mutation dispatch', async () => {
    const current = await mount('/admin/donations/testing', { user: adminUser(), donations: [donation()], holdBookingCsrf: true });
    await waitFor(() => button('Review release'), 'pending delayed CSRF'); button('Review release').click();
    await waitFor(() => container.querySelector('[name="confirmedBloodGroupId"]'), 'delayed draft');
    await fill({ confirmedBloodGroupId: '3' }); button('Review decision').click();
    await waitFor(() => button('Confirm decision'), 'delayed confirmation'); button('Confirm decision').click();
    await waitFor(() => current.releaseBookingCsrf, 'held CSRF');
    await mount('/admin/inventory', { user: adminUser() }); current.releaseBookingCsrf(); await pause();
    assert(current.calls.filter(call => call.url?.endsWith('/testing-decision') && call.method === 'post').length === 0, 'No obsolete POST');
    noOverflow();
  });

  await run('inventory discard confirmation and expiry reconciliation use exact mutations with read recovery', async () => {
    const current = await mount('/admin/inventory', { user: adminUser(), units: [
      { bloodUnitId: '71', donationId: '8', bloodGroupCode: 'A-', unitStatus: 'AVAILABLE', expiryDate: '2099-01-01' },
      { bloodUnitId: '72', donationId: '9', bloodGroupCode: 'O+', unitStatus: 'AVAILABLE', expiryDate: '2000-01-01' },
    ] });
    await waitFor(() => button('Discard unallocated unit'), 'discardable unit');
    assert(text().includes('Persisted status') && text().includes('Effective availability'), 'Persisted and effective states distinguished');
    button('Discard unallocated unit').click(); await waitFor(() => button('Confirm'), 'discard confirmation');
    assert(text().includes('Unit 71') && text().includes('2099-01-01'), 'Confirmation captures unit and expiry');
    button('Cancel').click(); await pause();
    assert(!current.calls.some(call => call.url?.endsWith('/discard') && call.method === 'post'), 'Cancel sends no discard');
    button('Discard unallocated unit').click(); await waitFor(() => button('Confirm'), 'reopened discard'); button('Confirm').click();
    await waitFor(() => text().includes('discard saved'), 'discard success');
    const discard = current.calls.find(call => call.url?.endsWith('/discard') && call.method === 'post');
    assert(discard.url === '/admin/inventory/71/discard' && discard.data.reasonCode === 'OTHER_NON_SENSITIVE', 'Exact bounded discard request');
    assert(current.calls.filter(call => call.url === '/inventory' && call.method === 'get').length >= 2, 'Discard refreshes by GET');
    button('Run expiry reconciliation').click(); await waitFor(() => text().includes('entire run is refused'), 'expiry confirmation');
    button('Confirm').click(); await waitFor(() => text().includes('due available unit(s) expired'), 'expiry success');
    const expiry = current.calls.find(call => call.url === '/admin/inventory/expiry/run' && call.method === 'post');
    assert(expiry && Object.keys(expiry.data).length === 0, 'Expiry request has no client eligibility fields');
    labels(); noOverflow();
  });

  await run('inventory uncertain mutation does not retry and recovers through reads', async () => {
    const current = await mount('/admin/inventory', { user: adminUser(), inventoryMode: 'timeout', units: [
      { bloodUnitId: '73', donationId: '10', bloodGroupCode: 'B+', unitStatus: 'AVAILABLE', expiryDate: '2099-01-01' },
    ] });
    await waitFor(() => button('Run expiry reconciliation'), 'expiry button'); button('Run expiry reconciliation').click();
    await waitFor(() => button('Confirm'), 'expiry dialog'); button('Confirm').click();
    await waitFor(() => text().includes('outcome could not be confirmed'), 'uncertain expiry');
    assert(current.calls.filter(call => call.url === '/admin/inventory/expiry/run' && call.method === 'post').length === 1, 'No mutation retry');
    assert(current.calls.filter(call => call.url === '/inventory' && call.method === 'get').length >= 2, 'Recovery uses inventory GET');
    noOverflow();
  });

  await run('Admin-only release and inventory routes redirect signed-out or wrong-role users', async () => {
    for (const route of ['/admin/donations/testing', '/admin/inventory', '/admin/inventory/17']) {
      await mount(route); await waitFor(() => location.pathname === '/login', 'signed-out route');
      await mount(route, { user: activeDonor() }); await waitFor(() => location.pathname === '/unauthorized', 'Donor route denied');
    }
    noOverflow();
  });
}
