// Test-only API fixtures; these render production components without live mutations.
export async function runAccountStatusScenarios(h) {
  const { mount, waitFor, assert, text, button, fill, submit, pause, noOverflow, labels, container, adminUser } = h;
  const actions = [
    { from: 'PENDING', to: 'ACTIVE', label: 'Approve', noun: 'approval', past: 'approved', progress: 'Approving', reason: 'REGISTRATION_REVIEWED', consequence: 'sign in again' },
    { from: 'ACTIVE', to: 'SUSPENDED', label: 'Suspend', noun: 'suspension', past: 'suspended', progress: 'Suspending', reason: 'ACCESS_RESTRICTED', consequence: 'prevents login' },
    { from: 'SUSPENDED', to: 'ACTIVE', label: 'Reactivate', noun: 'reactivation', past: 'reactivated', progress: 'Reactivating', reason: 'ACCESS_RESTORED', consequence: 'does not restore old sessions' },
  ];
  const accounts = () => actions.flatMap((action, index) => ['DONOR', 'HOSPITAL'].map((role, offset) => ({
    accountId: String(8000 + index * 2 + offset), email: `disposable-${index}-${role.toLowerCase()}@example.test`,
    role, accountStatus: action.from, createdAt: '2026-10-27 09:30:00',
  })));
  const rows = () => [...container.querySelectorAll('.mint-account-table tbody tr')];
  const patches = f => f.calls.filter(call => call.method === 'patch' && call.url.startsWith('/admin/accounts/'));
  const reads = f => f.calls.filter(call => call.url === '/admin/accounts');
  const run = (name, work) => h.run('Account status controls: ' + name, work);
  async function ready(action, options = {}) {
    const f = await mount('/admin/accounts', { user: adminUser(), loginRole: 'ADMIN', approvalAccounts: accounts(), ...options });
    await waitFor(() => rows().length || text().includes('No accounts found'), 'initial status queue');
    await fill({ accountStatus: action.from }); await submit();
    await waitFor(() => rows().length && button(action.label), 'status-filtered queue');
    return f;
  }
  async function choose(action, role = 'DONOR') {
    const target = rows().find(row => row.textContent.includes(role));
    target.querySelector('button').click();
    await waitFor(() => container.querySelector('#approval-confirm-heading'), 'status confirmation');
    return target;
  }
  async function relogin(f) {
    button('Sign out').click(); await waitFor(() => location.pathname === '/login' && container.querySelector('[name=email]'), 'status sign-out');
    assert(!container.querySelector('.mint-account-table,.mint-account-confirm'), 'Logout clears protected rows and selection');
    f.loginRole = 'ADMIN'; f.loginAccountId = '31';
    await fill({ email: 'isolated-admin@example.test', password: 'Browser pass7!' }); await submit();
    await waitFor(() => location.pathname === '/admin/hospitals' && container.querySelector('a[href="/admin/accounts"]'), 'unchanged Admin landing');
    container.querySelector('a[href="/admin/accounts"]').click();
    await waitFor(() => rows().length > 0, 'same-ID fresh workspace');
  }

  for (const action of actions) for (const role of ['DONOR', 'HOSPITAL']) {
    await run(`${role} ${action.label}: visibility, focus, cancellation, payload and confirmed success`, async () => {
      const f = await ready(action);
      assert(container.querySelector('h1').textContent === 'Account management' && container.querySelector('a[href="/admin/accounts"]').textContent === 'Account management', 'Accurate page and navigation labels');
      assert(rows().length === 2 && rows().every(row => row.querySelector('button').textContent === action.label), 'Only the exact source-state action for both roles');
      const original = await choose(action, role); const trigger = original.querySelector('button');
      const panel = container.querySelector('.mint-account-confirm');
      assert(panel.textContent.includes(role) && panel.textContent.includes(action.reason) && panel.textContent.includes(action.from) && panel.textContent.includes(action.to), 'Captured identity, role, controlled reason and transition');
      assert(panel.textContent.includes(action.consequence), 'Action-specific session consequence');
      assert(document.activeElement.id === 'approval-confirm-heading' && panel.getAttribute('aria-labelledby') === document.activeElement.id, 'Accessible named confirmation receives focus');
      labels(); noOverflow();
      panel.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await pause();
      assert(!container.querySelector('.mint-account-confirm') && document.activeElement === trigger, 'Escape restores action-trigger focus');
      await choose(action, role); button('Cancel').click(); await pause(); assert(patches(f).length === 0, 'Cancel never mutates');
      await choose(action, role); f.holdApproval = true;
      const confirm = button('Confirm ' + action.noun); confirm.click(); confirm.click();
      await waitFor(() => f.releaseApproval, 'held status PATCH');
      assert(patches(f).length === 1 && button(action.progress + '\u2026').disabled && button('Cancel').disabled, 'All actions share duplicate guard');
      assert(!text().includes('was ' + action.past + '.'), 'No optimistic success');
      const call = patches(f)[0];
      assert(JSON.stringify(call.data) === JSON.stringify({ accountStatus: action.to, reason: action.reason }), 'Exact fixed payload without actor or extra fields');
      assert(call.url.endsWith(original.querySelector('th').textContent) && !call.signal && /^[a-f0-9]{64}$/.test(call.headers['x-csrf-token']), 'Selected identity, fresh CSRF and no mutation abort signal');
      f.releaseApproval(); await waitFor(() => text().includes('was ' + action.past + '.') && rows().length === 1, 'confirmed status success and queue refresh');
      assert(!container.querySelector('.mint-account-confirm'), 'Confirmation closes after expected destination response'); noOverflow();
    });
  }
  await run('Admin/self targets have no controls and stale Approve never becomes Reactivate', async () => {
    const action = actions[0]; const f = await ready(action);
    await choose(action); f.approvalAccounts.find(row => row.accountId === '8000').accountStatus = 'SUSPENDED';
    assert(button('Confirm approval') && !button('Confirm reactivation'), 'Captured approval remains approval before dispatch');
    button('Confirm approval').click();
    await waitFor(() => text().includes('changed before approval.') && rows().length === 1, 'stale approval conflict');
    assert(patches(f).length === 1 && patches(f)[0].data.reason === 'REGISTRATION_REVIEWED' && !text().includes('was reactivated.'), 'Stale approval cannot restore a suspended target');
    const self = await ready(actions[1], { approvalAccounts: [...accounts(), { ...accounts()[2], accountId: '31' }] });
    const selfRow = rows().find(row => row.querySelector('th').textContent === '31');
    assert(selfRow && !selfRow.querySelector('button'), 'Self target has no action');
    assert(!self.calls.some(call => call.method === 'patch'), 'No self mutation');
    await mount('/admin/accounts', { user: adminUser(), approvalAccounts: [{ ...accounts()[0], role: 'ADMIN' }] });
    await waitFor(() => text().includes('Could not load accounts'), 'invalid Admin target projection');
    assert(!container.querySelector('.mint-account-table button'), 'Admin target never becomes an action');
  });

  for (const action of actions.slice(1)) {
    for (const mode of ['conflict', 'timeout', 'unknown', 'malformed', 'wrong-status']) {
      await run(`${action.label} ${mode} uses reads and never claims matching status proves causation`, async () => {
        const f = await ready(action, { approvalMode: mode }); await choose(action); button('Confirm ' + action.noun).click();
        await waitFor(() => text().includes(mode === 'conflict' ? 'changed before ' + action.noun : 'outcome could not be confirmed.'), 'status outcome classification');
        await waitFor(() => rows().length === 1, 'outcome read');
        assert(!text().includes('was ' + action.past + '.') && !text().includes('PRIVATE') && patches(f).length === 1, 'No false success, private errors or PATCH retry');
        if (mode !== 'conflict') assert(text().includes('matching status does not prove'), 'Matching state is not proof of this mutation');
        await fill({ accountStatus: action.to }); await submit(); await waitFor(() => rows().length >= 3, 'read matching destination');
        assert(patches(f).length === 1 && !text().includes('was ' + action.past + '.'), 'Reading matching state cannot manufacture success'); noOverflow();
      });
    }
    await run(`${action.label} saved followed by failed queue refresh retries GET only`, async () => {
      const f = await ready(action, { failRefreshAfterApproval: true }); await choose(action); button('Confirm ' + action.noun).click();
      await waitFor(() => text().includes('was saved, but the queue could not be refreshed.'), 'saved/refresh-failed status');
      assert(text().includes('was ' + action.past + '.') && patches(f).length === 1, 'Confirmed mutation remains separate from failed read');
      button('Try again').click(); await waitFor(() => rows().length === 1, 'GET-only recovery'); assert(patches(f).length === 1, 'Never repeat mutation on read retry');
    });
    await run(`${action.label} filter/page changes keep dispatched guard and ignore obsolete outcome`, async () => {
      const extra = Array.from({ length: 22 }, (_, index) => ({ ...accounts()[2], accountId: String(9000 + index) }));
      const f = await ready(action, { approvalAccounts: [...accounts(), ...extra.map(row => ({ ...row, accountStatus: action.from }))], holdApproval: true });
      await choose(action); button('Confirm ' + action.noun).click(); await waitFor(() => f.releaseApproval, 'in-flight status operation');
      button('Next').click(); await waitFor(() => text().includes('Page 2 of 2') && rows().length === 4, 'changed page');
      assert(rows().every(row => row.querySelector('button').disabled) && patches(f).length === 1, 'Guard spans pages');
      button('Clear filters').click(); await waitFor(() => rows().length === 2 && button('Approve'), 'changed status filter');
      assert(button('Approve').disabled && text().includes('still in progress'), 'Guard spans different actions');
      f.releaseApproval(); await waitFor(() => !button('Approve').disabled, 'settled old operation');
      assert(!text().includes('was ' + action.past + '.') && patches(f).length === 1, 'Late mutation cannot claim success in newer query'); noOverflow();
    });
    await run(`${action.label} delayed CSRF cannot outlive same-ID re-login`, async () => {
      const f = await ready(action, { holdApprovalCsrf: true }); await choose(action); button('Confirm ' + action.noun).click();
      await waitFor(() => f.releaseApprovalCsrf, 'held status CSRF'); await relogin(f); f.releaseApprovalCsrf(); await pause(25);
      assert(patches(f).length === 0 && !container.querySelector('.mint-account-confirm'), 'Old confirmation cannot dispatch into fresh same-ID session');
    });
    await run(`${action.label} older mutation 401 cannot clear fresh same-ID login`, async () => {
      const f = await ready(action, { holdApproval: true, oldApprovalUnauthorized: true }); await choose(action); button('Confirm ' + action.noun).click();
      await waitFor(() => f.releaseApproval, 'held old status mutation'); await relogin(f); f.releaseApproval(); await pause(25);
      assert(location.pathname === '/admin/accounts' && rows().length === 2 && !text().includes('was ' + action.past + '.'), 'Old 401 cannot invalidate or populate fresh identity');
    });
    await run(`${action.label} current protected 401 clears identity and confirmation`, async () => {
      const f = await ready(action, { oldApprovalUnauthorized: true }); await choose(action); button('Confirm ' + action.noun).click();
      await waitFor(() => location.pathname === '/login', 'status auth invalidation');
      assert(!container.querySelector('.mint-account-table,.mint-account-confirm'), 'Sensitive status state cleared');
      const count = reads(f).length; await pause(25); assert(reads(f).length === count && patches(f).length === 1, 'No auth retry loop');
    });
    await run(`${action.label} preflight 503 preserves identity and stale filters abort CSRF`, async () => {
      const f = await ready(action, { statusCsrfFailure: true }); await choose(action); button('Confirm ' + action.noun).click();
      await waitFor(() => text().includes('could not be submitted.'), 'preflight failure');
      assert(location.pathname === '/admin/accounts' && patches(f).length === 0, 'Transient 503 does not revoke or dispatch');
      f.holdApprovalCsrf = true; await choose(action); button('Confirm ' + action.noun).click(); await waitFor(() => f.releaseApprovalCsrf, 'delayed security token');
      await fill({ accountStatus: action.to }); await submit(); await waitFor(() => !container.querySelector('.mint-account-confirm'), 'obsolete source query');
      f.releaseApprovalCsrf(); await pause(25); assert(patches(f).length === 0 && !button('Confirm ' + action.noun), 'Changed source/filter never reinterprets confirmation');
    });
  }
}
