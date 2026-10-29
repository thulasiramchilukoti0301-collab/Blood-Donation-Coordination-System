export async function runDonorDashboardScenarios({ mount, waitFor, assert, text, button, fill, submit,
  noOverflow, labels, container, activeDonor, getFixture, run }) {
  await run('Donor dashboard shows owner activity, empty state and refreshes a partial read', async () => {
    const current = await mount('/donor', { user: activeDonor(), activityFailure: true });
    await waitFor(() => text().includes('Some dashboard information is unavailable'), 'partial dashboard');
    assert(text().includes('Isolated Browser Donor') && text().includes('Eligibility preview'), 'Independent profile and eligibility reads remain visible');
    current.activityFailure = false;
    button('Refresh dashboard').click();
    await waitFor(() => text().includes('No bookings or donations recorded yet.'), 'empty activity after refresh');
    assert(current.calls.filter(call => call.url === '/donors/me/reports/activity').length === 2, 'Read-only refresh reloads activity');
    assert(container.querySelector('a[href="/donor/bookings"]') && container.querySelector('a[href="/donor/donations"]'), 'Activity links remain available');
    labels(); noOverflow();
  });
  await run('PENDING Donor cannot open operational dashboard', async () => {
    const current = await mount('/donor', { user: { ...activeDonor(), accountStatus: 'PENDING' } });
    await waitFor(() => text().includes('This account cannot open this page'), 'access denied');
    assert(!current.calls.some(call => call.url === '/donors/me/reports/activity'), 'No activity request for a PENDING account');
    noOverflow();
  });
  await run('Password settings keeps invalid proof safe and signs out after a confirmed change', async () => {
    const current = await mount('/account/settings', { user: { ...activeDonor(), accountStatus: 'PENDING' }, passwordMode: 'wrong' });
    await waitFor(() => text().includes('Change password'), 'settings');
    await fill({ currentPassword: 'previous7!', newPassword: 'replacement8!', repeatPassword: 'replacement8!' });
    await submit(); await waitFor(() => text().includes('Current password is incorrect.'), 'wrong proof');
    assert(current.user?.accountStatus === 'PENDING', 'Wrong proof leaves account signed in');
    current.passwordMode = 'success'; await submit();
    await waitFor(() => location.pathname === '/login', 'fresh-login redirect');
    const sent = current.calls.filter(call => call.url === '/auth/password' && call.method === 'post');
    assert(sent.length === 2 && sent.every(call => call.headers['x-csrf-token']?.length === 64), 'Both bounded requests carry CSRF');
    assert(current.user === null && !text().includes('replacement8!'), 'Confirmed change clears identity without rendering password');
    labels(); noOverflow();
  });
}
