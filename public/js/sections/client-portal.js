/**
 * js/sections/client-portal.js
 * Customer portal — account overview, API credentials, webhooks, change password.
 * Exposes: window.ClientPortal
 * Depends on: dashboard.core.js
 */

(function (global) {
    'use strict';

    var _portalWebhooks = [];

    // ════════════════════════════════════════
    // HTML TEMPLATES
    // ════════════════════════════════════════
    var CLIENT_OVERVIEW_HTML = [
        '<div class="content-card">',
        '  <div class="card-header">',
        '    <div>',
        '      <h2 class="card-title">Account Information</h2>',
        '      <p class="card-subtitle">Your account details (read-only)</p>',
        '    </div>',
        '  </div>',
        '  <div class="info-box" id="clientInfoBox">',
        '    <div class="info-row"><span class="info-label">Customer Code</span><span class="info-value" id="infoCustomerCode">-</span></div>',
        '    <div class="info-row"><span class="info-label">Customer Name</span><span class="info-value" id="infoCustomerName">-</span></div>',
        '    <div class="info-row"><span class="info-label">Email</span><span class="info-value" id="infoEmail">-</span></div>',
        '    <div class="info-row"><span class="info-label">Phone</span><span class="info-value" id="infoPhone">-</span></div>',
        '    <div class="info-row"><span class="info-label">Environment</span><span class="info-value" id="infoEnvironment">-</span></div>',
        '    <div class="info-row"><span class="info-label">Status</span><span class="info-value" id="infoStatus">-</span></div>',
        '  </div>',
        '</div>',

        '<div class="content-card">',
        '  <div class="card-header">',
        '    <div>',
        '      <h2 class="card-title">Change Password</h2>',
        '      <p class="card-subtitle">Update your portal login password</p>',
        '    </div>',
        '  </div>',
        '  <div style="max-width:400px;">',
        '    <div class="form-group">',
        '      <label class="form-label">Current Password</label>',
        '      <input type="password" class="form-input" id="changePwCurrent" placeholder="Enter current password">',
        '    </div>',
        '    <div class="form-group">',
        '      <label class="form-label">New Password</label>',
        '      <input type="password" class="form-input" id="changePwNew" placeholder="Min 6 characters">',
        '    </div>',
        '    <div class="form-group">',
        '      <label class="form-label">Confirm New Password</label>',
        '      <input type="password" class="form-input" id="changePwConfirm" placeholder="Re-enter new password">',
        '    </div>',
        '    <button class="btn btn-primary" id="btnChangePassword">Change Password</button>',
        '  </div>',
        '</div>'
    ].join('\n');

    var CLIENT_CREDENTIALS_HTML = [
        '<div class="content-card">',
        '  <div class="card-header">',
        '    <div>',
        '      <h2 class="card-title">API Credentials</h2>',
        '      <p class="card-subtitle">Your Client ID and Secret Key</p>',
        '    </div>',
        '  </div>',

        '  <div id="credentialsDisabledNotice" class="hidden" style="padding:32px 20px;text-align:center;">',
        '    <div style="font-size:16px;font-weight:600;color:var(--text-primary);margin-bottom:8px;">Feature Not Activated</div>',
        '    <p style="font-size:14px;color:var(--text-secondary);">API access has not been enabled for your account. Please contact the administrator to activate this feature.</p>',
        '  </div>',

        '  <div id="credentialsContent" style="padding:4px 0;">',
        '    <div style="background:var(--warning-light);border:1px solid #fbbf24;padding:16px;border-radius:8px;margin-bottom:20px;">',
        '      <div style="display:flex;align-items:start;gap:12px;">',
        '        <div style="font-size:20px;">&#x26A0;</div>',
        '        <div style="font-size:13px;color:#92400e;">',
        '          <strong>Note:</strong> Secret key is shown only once when generated. Please store it securely.',
        '        </div>',
        '      </div>',
        '    </div>',

        '    <div class="form-group">',
        '      <label class="form-label" style="font-weight:600;">Client ID</label>',
        '      <div class="copy-group">',
        '        <input type="text" class="form-input mono" id="credClientId" readonly>',
        '        <button class="btn" id="btnCopyClientId">Copy</button>',
        '      </div>',
        '    </div>',

        '    <div class="form-group">',
        '      <label class="form-label" style="font-weight:600;">Secret Key</label>',
        '      <div class="copy-group">',
        '        <input type="password" class="form-input mono" id="credClientSecret" readonly value="********">',
        '        <button class="btn hidden" id="btnCopySecret">Copy</button>',
        '        <button class="btn" id="btnShowSecret">Show</button>',
        '      </div>',
        '      <p id="credSecretMessage" style="margin-top:8px;font-size:13px;color:var(--text-secondary);font-style:italic;"></p>',
        '    </div>',

        '    <button class="btn btn-danger" id="btnResetSecret" style="margin-top:16px;">Reset Secret Key</button>',

        '    <div id="newSecretBox" class="hidden" style="margin-top:16px;padding:16px;background:#f0fdf4;border:1px solid #10b981;border-radius:8px;">',
        '      <div style="font-size:14px;font-weight:600;margin-bottom:8px;color:#065f46;">New Secret Key (Save now!)</div>',
        '      <div class="copy-group">',
        '        <input type="text" class="form-input mono" id="newSecretValue" readonly>',
        '        <button class="btn" id="btnCopyNewSecret">Copy</button>',
        '      </div>',
        '    </div>',
        '  </div>',
        '</div>'
    ].join('\n');

    var CLIENT_WEBHOOKS_HTML = [
        '<div class="content-card">',
        '  <div class="card-header">',
        '    <div>',
        '      <h2 class="card-title">Webhooks</h2>',
        '      <p class="card-subtitle">Register URLs to receive automatic notifications</p>',
        '    </div>',
        '    <button class="btn btn-primary" id="btnAddWebhook">+ Add Webhook</button>',
        '  </div>',

        '  <div id="webhookDisabledNotice" class="hidden" style="padding:32px 20px;text-align:center;">',
        '    <div style="font-size:16px;font-weight:600;color:var(--text-primary);margin-bottom:8px;">Feature Not Activated</div>',
        '    <p style="font-size:14px;color:var(--text-secondary);">Webhook feature has not been enabled for your account. Please contact the administrator to activate this feature.</p>',
        '  </div>',

        '  <div id="webhooksContainer">',
        '    <div class="loading show">Loading...</div>',
        '  </div>',
        '</div>'
    ].join('\n');

    // ════════════════════════════════════════
    // INIT
    // ════════════════════════════════════════
    function init() {
        _mountClientOverview();
        _mountClientCredentials();
        _mountClientWebhooks();
    }

    function _mountClientOverview() {
        var mount = document.getElementById('section-client-overview-mount');
        if (!mount) return;
        mount.innerHTML = CLIENT_OVERVIEW_HTML;
        addClick('btnChangePassword', handleChangePassword);
    }

    function _mountClientCredentials() {
        var mount = document.getElementById('section-client-credentials-mount');
        if (!mount) return;
        mount.innerHTML = CLIENT_CREDENTIALS_HTML;

        addClick('btnCopyClientId',  function () { copyField('credClientId'); });
        addClick('btnCopyNewSecret', function () { copyField('newSecretValue'); });
        addClick('btnCopySecret',    function () { copyField('credClientSecret'); });
        addClick('btnShowSecret',    function () {
            toast('Secret key is not stored. It is only shown when newly generated.', false);
        });
        addClick('btnResetSecret', handleResetSecret);
    }

    function _mountClientWebhooks() {
        var mount = document.getElementById('section-client-webhooks-mount');
        if (!mount) return;
        mount.innerHTML = CLIENT_WEBHOOKS_HTML;

        addClick('btnAddWebhook', function () {
            document.getElementById('webhookModal').classList.add('show');
        });
        addClick('btnCancelWebhook', function () {
            document.getElementById('webhookModal').classList.remove('show');
        });

        var whForm = document.getElementById('webhookForm');
        if (whForm) whForm.addEventListener('submit', handleAddWebhook);

        var overlay = document.getElementById('webhookModal');
        if (overlay) {
            overlay.addEventListener('click', function (e) {
                if (e.target === overlay) overlay.classList.remove('show');
            });
        }

        addClick('btnCancelTestPicker', function () {
            document.getElementById('testEventPickerModal').classList.remove('show');
        });
        var testPickerOverlay = document.getElementById('testEventPickerModal');
        if (testPickerOverlay) {
            testPickerOverlay.addEventListener('click', function (e) {
                if (e.target === testPickerOverlay) testPickerOverlay.classList.remove('show');
            });
        }
    }

    // ════════════════════════════════════════
    // LOAD CLIENT DATA
    // ════════════════════════════════════════
    function loadClientData() {
        if (!currentUser || currentUser.role !== 'customer') return;

        setText('infoCustomerCode', currentUser.customerCode  || '-');
        setText('infoCustomerName', currentUser.customerName  || '-');
        setText('infoEmail',        currentUser.email         || '-');
        setText('infoPhone',        currentUser.phone         || '-');
        setText('infoEnvironment',  currentUser.environment   || '-');
        setText('infoStatus',       currentUser.status        || '-');

        if (currentUser.environment === 'sandbox') {
            var resetBtn = document.getElementById('btnResetSecret');
            if (resetBtn) {
                resetBtn.disabled    = true;
                resetBtn.textContent = 'Reset disabled (Sandbox)';
                resetBtn.title       = 'Sandbox customers cannot reset secret keys. Contact admin.';
            }
        }

        if (!currentUser.webhookEnabled) {
            var whNotice    = document.getElementById('webhookDisabledNotice');
            var whContainer = document.getElementById('webhooksContainer');
            var whAddBtn    = document.getElementById('btnAddWebhook');
            if (whNotice)    whNotice.classList.remove('hidden');
            if (whContainer) whContainer.classList.add('hidden');
            if (whAddBtn)    whAddBtn.classList.add('hidden');
        }

        if (!currentUser.bulkOrderEnabled) {
            var credNotice  = document.getElementById('credentialsDisabledNotice');
            var credContent = document.getElementById('credentialsContent');
            if (credNotice)  credNotice.classList.remove('hidden');
            if (credContent) credContent.classList.add('hidden');
        }

        if (currentUser.bulkOrderEnabled) loadCredentials();
        if (currentUser.webhookEnabled)   loadWebhooks();
    }

    // ════════════════════════════════════════
    // CREDENTIALS
    // ════════════════════════════════════════
    function loadCredentials() {
        if (!currentUser || currentUser.role !== 'customer') return;

        fetch(API + '/admin/customers/' + currentUser.id + '/credentials')
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (data.success && data.data) {
                    document.getElementById('credClientId').value = data.data.client_id || '';

                    if (data.data.client_secret && currentUser.environment === 'sandbox') {
                        var secretInput = document.getElementById('credClientSecret');
                        secretInput.type  = 'text';
                        secretInput.value = data.data.client_secret;

                        var btnCopySecret = document.getElementById('btnCopySecret');
                        if (btnCopySecret) btnCopySecret.classList.remove('hidden');

                        var btnShow = document.getElementById('btnShowSecret');
                        if (btnShow) btnShow.classList.add('hidden');

                        setText('credSecretMessage', 'Sandbox environment: Secret key is visible for testing purposes.');
                    } else {
                        setText('credSecretMessage', 'Secret key is hidden for security. Only shown when newly generated.');
                    }
                }
            })
            .catch(function () { toast('Failed to load credentials', false); });
    }

    function handleResetSecret() {
        if (!currentUser) return;

        if (currentUser.environment === 'sandbox') {
            toast('Sandbox customers cannot reset secret keys. Please contact admin.', false);
            return;
        }

        if (!confirm('The old secret key will be invalidated immediately. Are you sure?')) return;

        var btn = document.getElementById('btnResetSecret');
        btn.disabled    = true;
        btn.textContent = 'Processing...';

        fetch(API + '/admin/customers/' + currentUser.id + '/credentials')
            .then(function (r) { return r.json(); })
            .then(function (credData) {
                if (!credData.success || !credData.data) throw new Error('No credentials found');
                return fetch(API + '/admin/customers/' + currentUser.id);
            })
            .then(function (r) { return r.json(); })
            .then(function (custData) {
                if (!custData.success) throw new Error('Cannot load customer data');
                var creds = custData.data.credentials;
                var activeCred = null;
                for (var i = 0; i < creds.length; i++) {
                    if (creds[i].status === 'active') { activeCred = creds[i]; break; }
                }
                if (!activeCred) throw new Error('No active credential found');
                return fetch(API + '/admin/customers/' + currentUser.id + '/credentials/refresh', {
                    method:  'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body:    JSON.stringify({ credentialId: activeCred.id })
                });
            })
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (data.success && data.data) {
                    document.getElementById('newSecretValue').value = data.data.client_secret;
                    document.getElementById('newSecretBox').classList.remove('hidden');
                    document.getElementById('credClientId').value  = data.data.client_id;
                    toast('Secret key has been reset! Save it now.', true);
                } else {
                    throw new Error(data.message || 'Failed to reset');
                }
            })
            .catch(function (err) { toast('Error: ' + err.message, false); })
            .finally(function () {
                btn.disabled    = false;
                btn.textContent = 'Reset Secret Key';
            });
    }

    // ════════════════════════════════════════
    // CHANGE PASSWORD
    // ════════════════════════════════════════
    function handleChangePassword() {
        if (!currentUser) return;

        var current = val('changePwCurrent');
        var newPw   = val('changePwNew');
        var confirm = val('changePwConfirm');

        if (!current)                   { toast('Please enter your current password', false); return; }
        if (!newPw || newPw.length < 6) { toast('New password must be at least 6 characters', false); return; }
        if (newPw !== confirm)          { toast('New password and confirmation do not match', false); return; }

        var btn = document.getElementById('btnChangePassword');
        btn.disabled    = true;
        btn.textContent = 'Changing...';

        fetch(API + '/admin/customers/' + currentUser.id + '/change-password', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ current_password: current, new_password: newPw })
        })
        .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, data: d }; }); })
        .then(function (res) {
            if (res.ok) {
                toast('Password changed successfully!', true);
                document.getElementById('changePwCurrent').value = '';
                document.getElementById('changePwNew').value     = '';
                document.getElementById('changePwConfirm').value = '';
            } else {
                toast(res.data.message || 'Failed to change password', false);
            }
        })
        .catch(function () { toast('Server connection error', false); })
        .finally(function () {
            btn.disabled    = false;
            btn.textContent = 'Change Password';
        });
    }

    // ════════════════════════════════════════
    // WEBHOOKS
    // ════════════════════════════════════════
    function loadWebhooks() {
        if (!currentUser || currentUser.role !== 'customer') return;
        var container = document.getElementById('webhooksContainer');
        if (!container) return;
        container.innerHTML = '<div class="loading show">Loading...</div>';

        fetch(API + '/admin/customers/' + currentUser.id + '/webhooks')
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (data.success) renderWebhooks(data.data || []);
            })
            .catch(function () {
                container.innerHTML = '<div style="padding:20px;text-align:center;color:#ef4444;">Failed to load webhooks</div>';
                toast('Failed to load webhooks', false);
            });
    }

    function renderWebhooks(webhooks) {
        var container = document.getElementById('webhooksContainer');
        _portalWebhooks = webhooks;

        if (webhooks.length === 0) {
            container.innerHTML = '<div style="padding:40px;text-align:center;color:var(--text-secondary);">No webhooks registered yet</div>';
            return;
        }

        var html = '<div class="table-container"><table class="data-table"><thead><tr>' +
            '<th>URL</th><th>Events</th><th>Status</th><th>Fails</th><th>Actions</th>' +
            '</tr></thead><tbody>';

        for (var i = 0; i < webhooks.length; i++) {
            var wh    = webhooks[i];
            var evArr = Array.isArray(wh.events) ? wh.events : (typeof wh.events === 'string' ? wh.events.split(',') : []);
            var badge = wh.status === 'active'
                ? '<span class="badge badge-success">Active</span>'
                : '<span class="badge badge-danger">Inactive</span>';

            html += '<tr>' +
                '<td class="mono" style="font-size:13px;max-width:300px;overflow:hidden;text-overflow:ellipsis;">' + esc(wh.url) + '</td>' +
                '<td style="font-size:12px;">' + esc(evArr.join(', ')) + '</td>' +
                '<td>' + badge + '</td>' +
                '<td style="text-align:center;">' + (wh.fail_count || 0) + '</td>' +
                '<td style="white-space:nowrap;">' +
                    '<button class="btn btn-sm test-wh-btn" style="background:#6366f1;color:#fff;margin-right:6px;border-color:#6366f1;" data-wh-id="' + wh.id + '">Test</button>' +
                    '<button class="btn btn-danger btn-sm del-wh-btn" data-wh-id="' + wh.id + '">Delete</button>' +
                '</td>' +
            '</tr>';
        }

        html += '</tbody></table></div>';
        container.innerHTML = html;

        var testBtns = container.querySelectorAll('.test-wh-btn');
        for (var t = 0; t < testBtns.length; t++) {
            (function (btn) {
                btn.addEventListener('click', function () { showTestEventPicker(btn); });
            })(testBtns[t]);
        }

        var delBtns = container.querySelectorAll('.del-wh-btn');
        for (var j = 0; j < delBtns.length; j++) {
            delBtns[j].addEventListener('click', function () {
                var whId = parseInt(this.getAttribute('data-wh-id'), 10);
                if (whId) deleteWebhook(whId);
            });
        }
    }

    function showTestEventPicker(btn) {
        var webhookId = btn.getAttribute('data-wh-id');
        var webhook   = null;
        for (var i = 0; i < _portalWebhooks.length; i++) {
            if (String(_portalWebhooks[i].id) === String(webhookId)) { webhook = _portalWebhooks[i]; break; }
        }
        if (!webhook) return;

        var evArr = Array.isArray(webhook.events) ? webhook.events : (typeof webhook.events === 'string' ? webhook.events.split(',') : []);
        var eventBtns = '';
        for (var e = 0; e < evArr.length; e++) {
            var ev = evArr[e].trim();
            if (ev) eventBtns += '<button class="btn btn-sm pick-ev-btn" data-event="' + esc(ev) + '" style="background:#2563eb;color:#fff;border-color:#2563eb;">' + esc(ev) + '</button> ';
        }

        var contentEl = document.getElementById('testEventPickerContent');
        contentEl.innerHTML =
            '<div style="margin-bottom:12px;color:var(--text-secondary);font-size:14px;">' +
                'Chọn event để gửi test webhook tới:<br>' +
                '<code style="font-size:12px;color:var(--primary);">' + esc(webhook.url) + '</code>' +
            '</div>' +
            '<div style="display:flex;flex-wrap:wrap;gap:8px;">' + eventBtns + '</div>';

        var modal = document.getElementById('testEventPickerModal');
        modal.dataset.whId = webhookId;
        modal.classList.add('show');

        var pickBtns = contentEl.querySelectorAll('.pick-ev-btn');
        for (var p = 0; p < pickBtns.length; p++) {
            (function (pb) {
                pb.addEventListener('click', function () {
                    modal.classList.remove('show');
                    testWebhook(webhookId, pb.getAttribute('data-event'));
                });
            })(pickBtns[p]);
        }
    }

    function handleAddWebhook(e) {
        e.preventDefault();
        if (!currentUser) return;

        var url        = val('webhookUrl');
        var secret     = val('webhookSecret');
        var checkboxes = document.querySelectorAll('input[name="webhookEvents"]:checked');
        var events     = [];
        for (var i = 0; i < checkboxes.length; i++) events.push(checkboxes[i].value);

        if (events.length === 0) { toast('Please select at least one event', false); return; }

        fetch(API + '/admin/customers/' + currentUser.id + '/webhooks', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ url: url, secret: secret, events: events })
        })
        .then(function (r) { return r.json(); })
        .then(function (data) {
            if (data.success) {
                toast('Webhook added successfully', true);
                document.getElementById('webhookModal').classList.remove('show');
                document.getElementById('webhookForm').reset();
                loadWebhooks();
            } else {
                toast(data.message || 'Failed to add webhook', false);
            }
        })
        .catch(function () { toast('Server error', false); });
    }

    function testWebhook(webhookId, event) {
        if (!currentUser) return;

        var testBtn = document.querySelector('.test-wh-btn[data-wh-id="' + webhookId + '"]');
        if (testBtn) { testBtn.disabled = true; testBtn.textContent = 'Sending...'; }

        fetch(API + '/admin/customers/' + currentUser.id + '/webhooks/' + webhookId + '/test', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ event: event })
        })
        .then(function (r) { return r.json(); })
        .then(function (data) {
            if (!data.success) throw new Error(data.message || 'Request failed');
            if (data.data && data.data.success) {
                toast('Test [' + event + '] sent! HTTP ' + data.data.httpStatus, true);
            } else {
                toast('Test [' + event + '] failed: ' + (data.data && data.data.error ? data.data.error : 'Unknown error'), false);
            }
        })
        .catch(function (e) { toast(e.message || 'Server error', false); })
        .finally(function () {
            if (testBtn) { testBtn.disabled = false; testBtn.textContent = 'Test'; }
        });
    }

    function deleteWebhook(whId) {
        if (!confirm('Delete this webhook?')) return;
        if (!currentUser) return;

        fetch(API + '/admin/customers/' + currentUser.id + '/webhooks/' + whId, { method: 'DELETE' })
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (data.success) {
                    toast('Webhook deleted', true);
                    loadWebhooks();
                } else {
                    toast(data.message || 'Failed to delete', false);
                }
            })
            .catch(function () { toast('Server error', false); });
    }

    // ════════════════════════════════════════
    // PUBLIC API
    // ════════════════════════════════════════
    global.ClientPortal = {
        init:            init,
        loadClientData:  loadClientData,
        loadCredentials: loadCredentials,
        loadWebhooks:    loadWebhooks
    };

})(window);