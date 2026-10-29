export async function runAdminDonorScenarios({ mount, waitFor, assert, text, button, fill, submit, pause,
  noOverflow, labels, container, adminUser, getFixture, run }) {
  await run('Donor Management list filters, stable pages, Mint navigation and accessible narrow layout', async () => {
    await mount('/admin/donors', { user: adminUser(), adminDonors: Array.from({ length: 23 }, (_, index) => donor(index)) });
    await waitFor(() => container.querySelectorAll('.mint-admin-table tbody tr').length === 20, 'first Donor page');
    assert(text().includes('Donor management') && container.querySelector('a[href="/admin/donors"][aria-current="page"]'), 'Screen 16 and navigation are identified');
    assert(!text().includes('password_hash') && !text().includes('SECRET_'), 'List contains only projected identity/status/group values');
    labels(); noOverflow();
    button('Next').click(); await waitFor(() => container.querySelectorAll('.mint-admin-table tbody tr').length === 3, 'second Donor page');
    assert(button('Next').disabled, 'Pagination stops at the actual final page');
    await fill({ search: 'Fixture Donor 03', accountStatus: 'SUSPENDED', bloodGroupId: '2', groupMatch: 'REPORTED' }); await submit();
    await waitFor(() => text().includes('Fixture Donor 03'), 'filtered Donor');
    const request = getFixture().calls.filter(call => call.url === '/admin/donors' && call.method === 'get').at(-1);
    assert(request.params.page === 1 && request.params.accountStatus === 'SUSPENDED' && request.params.bloodGroupId === '2'
      && request.params.groupMatch === 'REPORTED', 'Filters are explicit and reset the page');
    noOverflow();
  });
  await run('Donor detail keeps self-reported and confirmed groups separate and account status read-only', async () => {
    await mount('/admin/donors/41', { user: adminUser(), adminDonors: [donor(0, '41')] });
    await waitFor(() => text().includes('Donor details'), 'Donor detail');
    assert(text().includes('Reported blood group') && text().includes('O+') && text().includes('Staff-confirmed blood group') && text().includes('A+'), 'Both distinct group values appear');
    assert(text().includes('Account status') && !text().includes('Suspend donor'), 'Status is read-only here');
    assert(text().includes('Bookings recorded') && text().includes('Donations recorded'), 'Only high-level operational context is shown');
    assert(!text().includes('PRIVATE_MEDICAL_SENTINEL') && !text().includes('PRIVATE_STAFF_NOTE_SENTINEL')
      && !text().includes('PRIVATE_COLLECTION_SENTINEL'), 'Private medical/operational sentinels are excluded from rendered detail');
    labels(); noOverflow();
  });
  await run('Donor edit confirmation is keyboard accessible; cancellation sends no mutation', async () => {
    await mount('/admin/donors/41', { user: adminUser(), adminDonors: [donor(0, '41')] }); await waitFor(() => text().includes('Donor details'), 'detail');
    button('Edit profile').click(); await waitFor(() => input('fullName'), 'edit form');
    await fill({ fullName: 'Cancelled Draft' }); button('Review changes').click();
    await waitFor(() => text().includes('Confirm Donor correction'), 'confirmation dialog');
    assert(container.querySelector('#donor-confirm-title') === document.activeElement, 'Focus moves to confirmation heading');
    const patches = getFixture().calls.filter(call => call.url === '/admin/donors/41' && call.method === 'patch').length;
    container.querySelector('.mint-donor-confirmation').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await waitFor(() => !text().includes('Confirm Donor correction'), 'Escape cancels confirmation');
    assert(getFixture().calls.filter(call => call.url === '/admin/donors/41' && call.method === 'patch').length === patches, 'Escape does not mutate');
    button('Review changes').click(); await waitFor(() => text().includes('Confirm Donor correction'), 'reopened confirmation');
    container.querySelector('.mint-donor-confirmation form button[type="button"]').click();
    await waitFor(() => !text().includes('Confirm Donor correction'), 'Cancel button dismisses confirmation');
    assert(getFixture().calls.filter(call => call.url === '/admin/donors/41' && call.method === 'patch').length === patches, 'Cancel does not mutate');
    assert(document.activeElement.textContent.includes('Donor details') || document.activeElement.tagName === 'H1', 'Focus returns to the page heading when edit trigger is obsolete');
    noOverflow();
  });
  await run('Donor profile correction sends a fixed reason, exact changed field and validates the response', async () => {
    await mount('/admin/donors/41', { user: adminUser(), adminDonors: [donor(0, '41')] }); await waitFor(() => text().includes('Donor details'), 'detail');
    button('Edit profile').click(); await waitFor(() => input('fullName'), 'edit form'); await fill({ area: 'New area' });
    button('Review changes').click(); await waitFor(() => text().includes('STAFF_PROFILE_CORRECTION'), 'audit reason');
    button('Confirm and save').click(); await waitFor(() => text().includes('changes were saved'), 'saved response');
    const patch = getFixture().calls.find(call => call.url === '/admin/donors/41' && call.method === 'patch');
    assert(JSON.stringify(patch.data) === JSON.stringify({ area: 'New area', originalValues: { area: 'Fixture area' }, reasonCode: 'STAFF_PROFILE_CORRECTION' }), 'Changed field, reviewed original and fixed reason are sent');
    assert(patch.headers['x-csrf-token'] && patch.headers['x-csrf-token'].length === 64, 'Fresh CSRF token accompanies PATCH');
    assert(text().includes('O+') && text().includes('A+'), 'Profile keeps reported/confirmed group distinction after update');
    labels(); noOverflow();
  });
  await run('Staff-confirmed group remains separate and uses its own fixed audit reason', async () => {
    await mount('/admin/donors/41', { user: adminUser(), adminDonors: [donor(0, '41')] }); await waitFor(() => text().includes('Donor details'), 'detail');
    button('Edit profile').click(); await waitFor(() => input('confirmedBloodGroupId'), 'confirmed-group edit');
    await fill({ confirmedBloodGroupId: '5' }); button('Review changes').click();
    await waitFor(() => text().includes('STAFF_GROUP_CONFIRMATION'), 'group confirmation reason');
    assert(text().includes('Staff-confirmed blood group: B-'), 'Confirmation freezes the explicit staff-selected group');
    button('Confirm and save').click(); await waitFor(() => text().includes('changes were saved'), 'group save');
    const patch = getFixture().calls.find(call => call.url === '/admin/donors/41' && call.method === 'patch');
    assert(JSON.stringify(patch.data) === JSON.stringify({ confirmedBloodGroupId: '5', originalValues: { confirmedBloodGroupId: '4' }, reasonCode: 'STAFF_GROUP_CONFIRMATION' }), 'Confirmed group, reviewed original and fixed reason are sent');
    assert(text().includes('Reported blood group') && text().includes('O+') && text().includes('Staff-confirmed blood group') && text().includes('B-'), 'Self-report remains unchanged and separate');
  });
  await run('Malformed successful Donor PATCH response triggers GET-only uncertainty recovery', async () => {
    await mount('/admin/donors/41', { user: adminUser(), adminDonors: [donor(0, '41')], adminDonorMode: 'malformed' });
    await waitFor(() => text().includes('Donor details'), 'detail'); button('Edit profile').click(); await waitFor(() => input('fullName'), 'form');
    await fill({ phone: '555-0101' }); button('Review changes').click(); await waitFor(() => text().includes('Confirm Donor correction'), 'confirmation');
    button('Confirm and save').click(); await waitFor(() => text().includes('outcome could not be confirmed'), 'uncertainty warning');
    assert(getFixture().calls.filter(call => call.url === '/admin/donors/41' && call.method === 'patch').length === 1, 'No automatic mutation retry');
    assert(getFixture().calls.filter(call => call.url === '/admin/donors/41' && call.method === 'get').length >= 2, 'Recovery uses read-only GET');
    assert(!text().includes('changes were saved'), 'Malformed response never produces saved-success feedback'); noOverflow();
  });
  await run('A stale Donor draft conflicts without overwriting the newer field or claiming success', async () => {
    const current = await mount('/admin/donors/41', { user: adminUser(), adminDonors: [donor(0, '41')] });
    await waitFor(() => text().includes('Donor details'), 'detail'); button('Edit profile').click();
    await waitFor(() => input('phone'), 'form'); await fill({ phone: '555-0999' }); button('Review changes').click();
    await waitFor(() => text().includes('Confirm Donor correction'), 'confirmation');
    current.adminDonors[0].phone = '555-0888';
    button('Confirm and save').click(); await waitFor(() => text().includes('Current details were reloaded'), 'GET-only conflict recovery');
    const patches = current.calls.filter(call => call.url === '/admin/donors/41' && call.method === 'patch');
    assert(patches.length === 1 && patches[0].data.originalValues.phone === '555-0001', 'Frozen reviewed phone was sent once');
    assert(current.adminDonors[0].phone === '555-0888' && !text().includes('changes were saved'), 'Newer value survives without false success');
    assert(current.calls.filter(call => call.url === '/admin/donors/41' && call.method === 'get').length >= 2, 'Recovery reads without retrying PATCH');
  });
  await run('Delayed CSRF preflight becomes obsolete after leaving the Donor detail and never dispatches PATCH', async () => {
    await mount('/admin/donors/41', { user: adminUser(), adminDonors: [donor(0, '41')], holdAdminDonorCsrf: true });
    await waitFor(() => button('Edit profile'), 'detail'); button('Edit profile').click(); await waitFor(() => input('area'), 'edit');
    await fill({ area: 'Preflight draft' }); button('Review changes').click(); await waitFor(() => text().includes('Confirm Donor correction'), 'confirmation');
    button('Confirm and save').click(); await waitFor(() => typeof getFixture().releaseAdminDonorCsrf === 'function', 'delayed CSRF read');
    const current = getFixture();
    try {
      container.querySelector('a[href="/admin/donors"]').click();
      await pause(250);
      const listCalls = current.calls.filter(call => call.url === '/admin/donors' && call.method === 'get');
      assert(listCalls.length > 0, `Donor list GET dispatched after navigation; visible=${text()}`);
      assert(container.querySelectorAll('.mint-admin-table tbody tr').length === 1, `Donor list response rendered; visible=${text()}`);
      current.releaseAdminDonorCsrf(); await pause(50);
      assert(!current.calls.some(call => call.url === '/admin/donors/41' && call.method === 'patch'), 'Obsolete preflight does not dispatch a mutation');
    } finally { current.releaseAdminDonorCsrf?.(); }
  });
  await run('Dispatched update stays locked across navigation; stale completion is ignored and reopened detail rereads', async () => {
    const current = await mount('/admin/donors/41', { user: adminUser(), adminDonors: [donor(0, '41')], holdAdminDonorPatch: true });
    await waitFor(() => button('Edit profile'), 'detail'); button('Edit profile').click(); await waitFor(() => input('area'), 'edit');
    await fill({ area: 'Settled area' }); button('Review changes').click(); await waitFor(() => text().includes('Confirm Donor correction'), 'confirmation'); button('Confirm and save').click();
    await waitFor(() => typeof current.releaseAdminDonorPatch === 'function', 'dispatched PATCH');
    container.querySelector('a[href="/admin/donors"]').click(); await waitFor(() => container.querySelectorAll('.mint-admin-table tbody tr').length === 1, 'Donor list');
    const detailGets = current.calls.filter(call => call.url === '/admin/donors/41' && call.method === 'get').length;
    container.querySelector('a[href="/admin/donors/41"]').click(); await waitFor(() => text().includes('Loading Donor details'), 'reopened detail waits'); await pause(50);
    assert(current.calls.filter(call => call.url === '/admin/donors/41' && call.method === 'get').length === detailGets, 'Detail does not read a possibly stale state while mutation is pending');
    current.releaseAdminDonorPatch(); await waitFor(() => text().includes('Settled area'), 'fresh detail after mutation settles');
    assert(current.calls.filter(call => call.url === '/admin/donors/41' && call.method === 'patch').length === 1, 'No duplicate mutation after navigation');
    assert(!text().includes('changes were saved'), 'Unmounted completion cannot show a stale success notice'); noOverflow();
  });
}

function donor(index, id = String(400 + index)) {
  const statuses = ['ACTIVE', 'PENDING', 'SUSPENDED'];
  return { donorId: id, email: `donor${id}@example.test`, accountStatus: statuses[index % 3],
    fullName: `Fixture Donor ${String(index + 1).padStart(2, '0')}`, dateOfBirth: '1990-04-12',
    phone: `555-${String(index + 1).padStart(4, '0')}`, address: 'Fixture address', area: index % 2 ? null : 'Fixture area',
    reportedBloodGroup: { bloodGroupId: '2', code: 'O+', displayName: 'O positive' },
    confirmedBloodGroup: { bloodGroupId: '4', code: 'A+', displayName: 'A positive' },
    createdAt: '2026-10-28T04:30:00.000Z', updatedAt: '2026-10-28T05:00:00.000Z',
    context: { bookingCount: 2, donationCount: 1, latestBooking: { bookingStatus: 'COMPLETED', appointmentAt: '2026-10-27T10:00:00+05:30' },
      latestDonation: { outcome: 'COLLECTED', releaseStatus: 'APPROVED', collectedAt: '2026-10-27T11:00:00+05:30' } } };
}
function input(name) { return document.querySelector(`[name="${name}"]`); }
