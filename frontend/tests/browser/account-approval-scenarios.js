// Test-only Axios fixtures drive the real mounted application and browser DOM.
export async function runAccountApprovalScenarios(h) {
  const { mount, waitFor, assert, text, button, fill, submit, pause, noOverflow, labels, container, adminUser, hospitalUser } = h;
  const rows = () => container.querySelectorAll('.mint-account-table tbody tr');
  const patchCalls = f => f.calls.filter(call => call.method === 'patch' && call.url.startsWith('/admin/accounts/'));
  const queueCalls = f => f.calls.filter(call => call.url === '/admin/accounts');
  const run = async (name, work) => {
    // Let the existing harness own reporting without weakening its assertions.
    await h.run('Account approvals: ' + name, work);
  };
  async function ready(options = {}) {
    const f = await mount('/admin/accounts', { user: adminUser(), loginRole: 'ADMIN', ...options });
    await waitFor(() => rows().length > 0 || text().includes('No accounts found') || text().includes('Could not load accounts'), 'account queue');
    return f;
  }
  async function choose() {
    button('Approve').click();
    await waitFor(() => container.querySelector('#approval-confirm-heading'), 'confirmation panel');
  }
  async function relogin(f, id = '31') {
    button('Sign out').click();
    await waitFor(() => location.pathname === '/login' && container.querySelector('[name=email]'), 'sign-out redirect');
    assert(!container.querySelector('.mint-account-table,#approval-confirm-heading'), 'Protected queue and selection cleared');
    f.loginRole = 'ADMIN'; f.loginAccountId = id;
    await fill({ email: 'isolated-admin@example.test', password: 'Browser pass7!' }); await submit();
    await waitFor(() => location.pathname === '/admin/hospitals' && container.querySelector('a[href="/admin/accounts"]'), 'unchanged Admin landing');
    container.querySelector('a[href="/admin/accounts"]').click();
    await waitFor(() => rows().length > 0, 'fresh approvals workspace');
  }

  await run('ACTIVE Admin queue, safe projection, exact Mint layout and route-based navigation', async () => {
    const f = await ready();
    assert(rows().length === 20 && text().includes('1–20 of 21 accounts'), 'Fixed server page and total');
    assert(JSON.stringify(queueCalls(f)[0].params) === JSON.stringify({ accountStatus: 'PENDING', page: 1 }), 'PENDING default with omitted role');
    assert(container.querySelector('a[href="/admin/accounts"][aria-current="page"]') && !container.querySelector('a[href="/admin/hospitals"][aria-current]'), 'Mint does not determine active navigation');
    assert(text().includes('9007199254740993') && !text().includes('SECRET_'), 'BIGINT remains exact and secrets are projected away');
    assert(container.querySelector('time').dateTime === '2026-10-26T09:30:00+05:30', 'MySQL local time has explicit IST offset');
    assert(getComputedStyle(container.querySelector('.mint-app-shell')).backgroundColor === 'rgb(241, 250, 246)', 'Exact Mint background');
    assert(container.querySelector('.mint-app-shell').getBoundingClientRect().height >= innerHeight, 'Full viewport background');
    assert(getComputedStyle(container.querySelector('h1')).fontFamily.includes('Sora') && getComputedStyle(container.querySelector('input')).fontFamily.includes('Nunito Sans'), 'Existing Mint typography');
    labels(); noOverflow();
    container.querySelector('a[href="/admin/hospitals"]').click();
    await waitFor(() => location.pathname === '/admin/hospitals' && container.querySelector('h1')?.textContent === 'Hospital Management' && container.querySelector('.mint-admin-table'), 'Hospital navigation preserved');
    assert(container.querySelector('a[href="/admin/hospitals"][aria-current="page"]') && !container.querySelector('a[href="/admin/accounts"][aria-current]'), 'Active navigation follows route both ways');
  });
  await run('signed-out, wrong-role and inactive Admin guards prevent queue reads', async () => {
    const signedOut = await mount('/admin/accounts'); await waitFor(() => location.pathname === '/login', 'signed-out guard');
    assert(queueCalls(signedOut).length === 0, 'Signed-out access makes no queue request');
    for (const user of [hospitalUser(), hospitalUser('ACTIVE'), { accountId: '321', role: 'DONOR', accountStatus: 'ACTIVE' }, adminUser('PENDING'), adminUser('SUSPENDED')]) {
      const f = await mount('/admin/accounts', { user });
      await waitFor(() => location.pathname === '/unauthorized', 'role/status guard');
      assert(queueCalls(f).length === 0 && !container.querySelector('.mint-account-table'), 'No protected requests or data');
    }
  });
  await run('authentication restoration shows progress and safe retry before queue access', async () => {
    const f = await mount('/admin/accounts', { user: adminUser(), holdIdentity: true });
    await waitFor(() => f.releaseIdentity && text().includes('Restoring your account'), 'restore progress');
    assert(queueCalls(f).length === 0, 'No queue while identity is restoring');
    f.releaseIdentity(); await waitFor(() => rows().length === 20, 'restored identity');
    const broken = await mount('/admin/accounts', { user: adminUser(), identityFailures: 1 });
    await waitFor(() => text().includes('Could not check your account'), 'restore failure');
    assert(queueCalls(broken).length === 0, 'No queue after failed restoration');
    button('Try again').click(); await waitFor(() => rows().length === 20, 'restore retry');
  });
  await run('search/role/status filters reset pagination, validate before requesting and clear to PENDING', async () => {
    const f = await ready(); button('Next').click(); await waitFor(() => text().includes('21–21 of 21'), 'page two');
    await fill({ search: ' applicant1 ', role: 'HOSPITAL', accountStatus: 'PENDING' }); await submit();
    await waitFor(() => text().includes('1–6 of 6 accounts'), 'filtered queue');
    assert(JSON.stringify(queueCalls(f).at(-1).params) === JSON.stringify({ role: 'HOSPITAL', accountStatus: 'PENDING', search: 'applicant1', page: 1 }), 'Exact filter query and reset page');
    const before = queueCalls(f).length;
    await fill({ search: ' '.repeat(255) }); await submit();
    await waitFor(() => text().includes('Use no more than 254'), 'raw search validation');
    assert(queueCalls(f).length === before && document.activeElement.name === 'search', 'No invalid request, validation focus');
    await fill({ search: 'nobody@example.test' }); await submit(); await waitFor(() => text().includes('No accounts found'), 'empty queue');
    assert(!container.querySelector('.mint-account-table'), 'No invented empty rows');
    button('Clear filters').click(); await waitFor(() => rows().length === 20, 'clear defaults');
    assert(container.querySelector('[name=role]').value === '' && container.querySelector('[name=accountStatus]').value === 'PENDING', 'Clear restores both roles/PENDING');
    await fill({ accountStatus: 'ACTIVE' }); await submit(); await waitFor(() => button('Suspend'), 'ACTIVE queue');
    assert(!button('Approve') && queueCalls(f).at(-1).params.accountStatus === 'ACTIVE', 'ACTIVE has no approval');
    await fill({ accountStatus: 'SUSPENDED' }); await submit(); await waitFor(() => text().includes('SUSPENDED') && button('Reactivate'), 'SUSPENDED queue');
    assert(!button('Approve'), 'SUSPENDED has no approval'); noOverflow();
  });
  await run('queue failure is safe and retried only as GET', async () => {
    const f = await ready({ queueFailures: 1 });
    assert(text().includes('temporarily unavailable') && !text().includes('PRIVATE'), 'Safe loading failure');
    button('Try again').click(); await waitFor(() => rows().length === 20, 'GET retry');
    assert(queueCalls(f).length === 2 && patchCalls(f).length === 0, 'Only GET retried');
  });
  await run('confirmation exposes identity/reason, keyboard Escape cancels and restores focus', async () => {
    const f = await ready(); const original = button('Approve'); await choose();
    const panel = container.querySelector('.mint-account-confirm');
    assert(document.activeElement.id === 'approval-confirm-heading' && panel.getAttribute('role') === 'region', 'Named panel receives focus');
    assert(panel.textContent.includes('9007199254740993') && panel.textContent.includes('DONOR') && panel.textContent.includes('Registration reviewed') && panel.textContent.includes('sign in again'), 'Selected identity and consequences');
    assert(getComputedStyle(button('Confirm approval')).backgroundColor === 'rgb(30, 138, 113)' && button('Confirm approval').type === 'submit', 'Strong teal native submit button');
    noOverflow();
    panel.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await pause();
    assert(!container.querySelector('.mint-account-confirm') && document.activeElement === original, 'Escape cancels and restores triggering focus');
    await choose(); button('Cancel').click(); await pause();
    assert(patchCalls(f).length === 0, 'Cancel before submission never mutates');
  });
  await run('exact fresh-CSRF approval, no optimistic success and duplicate prevention', async () => {
    const f = await ready({ holdApproval: true }); await choose();
    const confirm = button('Confirm approval'); confirm.click(); confirm.click();
    await waitFor(() => f.releaseApproval, 'held PATCH');
    assert(patchCalls(f).length === 1 && button('Approving…').disabled && !text().includes('was approved.'), 'Single in-flight mutation without optimistic success');
    const call = patchCalls(f)[0];
    assert(JSON.stringify(call.data) === JSON.stringify({ accountStatus: 'ACTIVE', reason: 'REGISTRATION_REVIEWED' }), 'Exact body, no actor or role fields');
    assert(/^[a-f0-9]{64}$/.test(call.headers['x-csrf-token']) && f.calls.at(-2).url === '/auth/csrf', 'Fresh CSRF before PATCH');
    assert(!call.signal, 'Mutation is not aborted as if cancellation undid it');
    f.releaseApproval(); await waitFor(() => text().includes('was approved.') && text().includes('1–20 of 20 accounts'), 'confirmed success and real reload');
    assert(!container.querySelector('.mint-account-confirm'), 'Confirmation closes after valid success');
  });
  await run('last row approval returns an out-of-range pending page to the real last page', async () => {
    const f = await ready(); button('Next').click(); await waitFor(() => text().includes('21–21 of 21'), 'last pending page');
    await choose(); button('Confirm approval').click();
    await waitFor(() => text().includes('1–20 of 20 accounts'), 'corrected first page');
    assert(queueCalls(f).at(-1).params.page === 1 && button('Next').disabled, 'No empty-page or request loop');
  });
  await run('filter changes do not release the guard of a dispatched approval', async () => {
    const f = await ready({ holdApproval: true }); await choose(); button('Confirm approval').click();
    await waitFor(() => f.releaseApproval, 'dispatched approval');
    button('Clear filters').click(); await waitFor(() => rows().length === 20 && !container.querySelector('.mint-account-confirm'), 'new query with obsolete confirmation');
    assert([...container.querySelectorAll('.mint-account-table button')].every(element => element.disabled), 'All approval triggers remain guarded until PATCH settles');
    assert(patchCalls(f).length === 1, 'No duplicate dispatch through refreshed rows');
    f.releaseApproval(); await waitFor(() => button('Approve') && !button('Approve').disabled, 'settled submission guard');
    assert(!text().includes('was approved.'), 'Obsolete confirmation does not claim success in new scope');
    button('Search').click(); await waitFor(() => text().includes('1–20 of 20 accounts'), 'explicit GET of completed state');
  });
  await run('saved approval and failed refresh remain distinct, with GET-only retry', async () => {
    const f = await ready({ failRefreshAfterApproval: true }); await choose(); button('Confirm approval').click();
    await waitFor(() => text().includes('Approval was saved, but the queue could not be refreshed.'), 'saved/refresh-failed distinction');
    assert(text().includes('was approved.') && patchCalls(f).length === 1, 'Saved success retained');
    button('Try again').click(); await waitFor(() => rows().length === 20, 'post-save GET retry');
    assert(patchCalls(f).length === 1, 'Retry never replays approval');
  });
  for (const mode of ['conflict', 'timeout', 'unknown', 'malformed']) {
    await run(mode + ' refreshes without claiming approval or automatically retrying PATCH', async () => {
      const f = await ready({ approvalMode: mode }); await choose(); button('Confirm approval').click();
      await waitFor(() => text().includes(mode === 'conflict' ? 'This account changed before approval.' : 'outcome could not be confirmed.'), 'controlled outcome message');
      await waitFor(() => rows().length === 20 && !text().includes('1–20 of 21 accounts'), 'outcome queue check');
      assert(!text().includes('was approved.') && !text().includes('PRIVATE') && patchCalls(f).length === 1, 'No invented success or mutation retry');
    });
  }
  await run('obsolete reads are aborted and cannot overwrite a newer applied filter', async () => {
    const f = await mount('/admin/accounts', { user: adminUser(), holdQueue: true });
    await waitFor(() => f.releaseQueue, 'old queue read'); const old = queueCalls(f)[0];
    await fill({ search: 'applicant5@' }); await submit(); await waitFor(() => rows().length === 1, 'newer query');
    f.releaseQueue(); await pause(30);
    assert(old.signal.aborted && rows().length === 1 && text().includes('applicant5@example.test'), 'Old list cannot populate new scope');
  });
  await run('applied filter invalidates a confirmation while fresh CSRF is pending', async () => {
    const f = await ready({ holdApprovalCsrf: true }); await choose(); button('Confirm approval').click();
    await waitFor(() => f.releaseApprovalCsrf, 'held CSRF');
    await fill({ role: 'HOSPITAL' }); await submit(); await waitFor(() => rows().length === 10, 'new role scope');
    f.releaseApprovalCsrf(); await pause(30);
    assert(patchCalls(f).length === 0 && !container.querySelector('.mint-account-confirm'), 'Stale CSRF cannot dispatch old selection');
  });
  await run('same-Account logout/re-login invalidates delayed CSRF confirmation', async () => {
    const f = await ready({ holdApprovalCsrf: true }); await choose(); button('Confirm approval').click();
    await waitFor(() => f.releaseApprovalCsrf, 'held old CSRF'); await relogin(f);
    f.releaseApprovalCsrf(); await pause(30);
    assert(patchCalls(f).length === 0 && !container.querySelector('.mint-account-confirm') && !text().includes('was approved.'), 'Same ID gets a new auth lifecycle');
  });
  await run('same-Account logout/re-login cannot reuse an obsolete queued read', async () => {
    const f = await mount('/admin/accounts', { user: adminUser(), loginRole: 'ADMIN', holdQueue: true });
    await waitFor(() => f.releaseQueue, 'held old queue');
    const old = queueCalls(f)[0];
    f.approvalAccounts = [{ ...f.approvalAccounts[1], email: 'fresh-lifecycle@example.test' }];
    await relogin(f);
    f.releaseQueue(); await pause(30);
    assert(old.signal.aborted && rows().length === 1 && text().includes('fresh-lifecycle@example.test') && !text().includes('long-email-'), 'Old protected read cannot populate fresh same-ID login');
  });
  await run('old dispatched mutation 401 cannot clear a newer different Admin login', async () => {
    const f = await ready({ holdApproval: true, oldApprovalUnauthorized: true }); await choose(); button('Confirm approval').click();
    await waitFor(() => f.releaseApproval, 'held old mutation'); await relogin(f, '32');
    f.releaseApproval(); await pause(30);
    assert(location.pathname === '/admin/accounts' && rows().length === 20 && !text().includes('was approved.'), 'Old identity response neither invalidates nor populates new login');
  });
  await run('session invalidation clears queue and selection with no request loop', async () => {
    const f = await ready(); await choose(); f.expireAccounts = true;
    button('Clear filters').click(); await waitFor(() => location.pathname === '/login', 'invalidated session redirect');
    assert(!container.querySelector('.mint-account-table,.mint-account-confirm'), 'No sensitive queue/selection remains');
    const count = queueCalls(f).length; await pause(30); assert(queueCalls(f).length === count, 'No invalidation request loop');
  });
}
