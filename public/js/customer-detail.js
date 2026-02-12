// ─── Extract customerId from URL: /extensions/customer/:customerId ───
var pathParts = window.location.pathname.split('/');
var CID = pathParts[pathParts.length - 1];
var BASE = '/api/v1/admin/customers/' + CID;

var CUSTOMER = null;

// ─── Pagination state ──────────────────────────────────────────
var logsPage = 0;
var LOGS_PER = 10;

// ═══════════════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', function () {
    if (!CID || isNaN(CID)) {
        showAlert('error', 'Customer ID not found in URL');
        return;
    }
    fetchCustomerData();
    initButtons();
});

async function fetchCustomerData() {
    try {
        var res  = await fetch(BASE);
        var json = await res.json();
        if (!res.ok) throw new Error(json.message || 'Failed to load data');

        CUSTOMER = json.data;
        renderCustomerInfo();
        renderCredentials(CUSTOMER.credentials || []);
        loadWebhooks();
        loadLogs();
    } catch (e) {
        showAlert('error', e.message);
        setText('customerName', 'Error loading data');
        setText('customerMeta', e.message);
    }
}

// ═══════════════════════════════════════════════════════════════
// CUSTOMER INFO
// ═══════════════════════════════════════════════════════════════
function renderCustomerInfo() {
    setText('customerName', CUSTOMER.customer_name);
    setText('customerMeta', CUSTOMER.customer_code + ' \u00b7 ' + (CUSTOMER.email || '\u2014'));
    setText('infoCode', CUSTOMER.customer_code);
    setText('infoEmail', CUSTOMER.email || '\u2014');
    setText('infoPhone', CUSTOMER.phone || '\u2014');
    setText('infoRate', CUSTOMER.rate_limit_per_hour + ' / ' + CUSTOMER.rate_limit_per_day);
    setText('topbarName', CUSTOMER.customer_name);

    // Webhook status
    var webhookEl = document.getElementById('infoWebhook');
    if (webhookEl) {
        var whEnabled = CUSTOMER.webhook_enabled;
        webhookEl.innerHTML = '<span class="badge badge-' + (whEnabled ? 'success' : 'danger') + '">' + (whEnabled ? 'Enabled' : 'Disabled') + '</span>';
    }

    // Bulk Order status
    var bulkEl = document.getElementById('infoBulkOrder');
    if (bulkEl) {
        var boEnabled = CUSTOMER.bulk_order_enabled;
        bulkEl.innerHTML = '<span class="badge badge-' + (boEnabled ? 'success' : 'danger') + '">' + (boEnabled ? 'Enabled' : 'Disabled') + '</span>';
    }

    // Portal password status
    var pwEl = document.getElementById('infoPortalPw');
    if (pwEl) {
        var hasPw = !!CUSTOMER.portal_password_hash;
        pwEl.innerHTML = '<span class="badge badge-' + (hasPw ? 'success' : 'warning') + '">' + (hasPw ? 'Set' : 'Not set') + '</span>';
    }

    // Environment badge
    var envEl = document.getElementById('infoEnv');
    if (envEl) {
        var envClass = CUSTOMER.environment === 'production' ? 'success' : 'warning';
        envEl.innerHTML = '<span class="badge badge-' + envClass + '">' + esc(CUSTOMER.environment) + '</span>';
    }

    // Status badge
    var statusEl = document.getElementById('infoStatus');
    if (statusEl) {
        statusEl.innerHTML = '<span class="badge badge-' + statusClass(CUSTOMER.status) + '">' + esc(CUSTOMER.status) + '</span>';
    }

    // Role badge (admin vs customer)
    if (CUSTOMER.portal_role === 'admin') {
        setText('roleTag', 'Admin');
        document.getElementById('roleTag').className = 'badge badge-info';
    } else {
        setText('roleTag', 'Customer');
        document.getElementById('roleTag').className = 'badge badge-warning';
    }
}

// ═══════════════════════════════════════════════════════════════
// CREDENTIALS
// ═══════════════════════════════════════════════════════════════
async function reloadCredentials() {
    try {
        var res  = await fetch(BASE);
        var data = await res.json();
        if (!res.ok) throw new Error(data.message);

        var creds = data.data.credentials || [];
        renderCredentials(creds);
    } catch (e) {
        setHtml('credentialsList', '<p style="color:var(--danger)">' + esc(e.message) + '</p>');
    }
}

function renderCredentials(creds) {
    if (creds.length === 0) {
        setHtml('credentialsList',
            '<div class="empty-state">' +
            '<p class="empty-title">No credentials</p>' +
            '<p>This customer has no active credentials.</p>' +
            '<button class="btn btn-primary btn-sm" id="btnGenerateCred" style="margin-top:16px">Generate Credentials</button>' +
            '</div>');

        var genBtn = document.getElementById('btnGenerateCred');
        if (genBtn) genBtn.addEventListener('click', handleGenerateCredential);
        return;
    }

    var rows = creds.map(function (c) {
        return '<div class="cred-item">' +
            '<div class="cred-item-header">' +
                '<span style="font-size:13px;font-weight:600;color:var(--text-secondary)">CLIENT ID</span>' +
                '<span class="badge badge-success">' + esc(c.status) + '</span>' +
            '</div>' +
            '<div class="cred-client-id">' +
                '<code>' + esc(c.client_id) + '</code>' +
                '<button class="btn btn-sm btn-copy" data-copy="' + esc(c.client_id) + '">Copy</button>' +
            '</div>' +
            '<div class="cred-actions" style="margin-top:12px">' +
                '<button class="btn btn-sm btn-refresh-cred" data-cred-id="' + c.id + '" data-env="' + esc(c.environment) + '">Refresh</button>' +
                '<button class="btn btn-sm btn-danger btn-revoke-cred" data-cred-id="' + c.id + '">Revoke</button>' +
            '</div>' +
            '</div>';
    }).join('');

    setHtml('credentialsList', rows);

    // Attach copy buttons
    var copyBtns = document.querySelectorAll('.btn-copy');
    for (var i = 0; i < copyBtns.length; i++) {
        (function (btn) {
            btn.addEventListener('click', function () { copyToClipboard(btn.dataset.copy, btn); });
        })(copyBtns[i]);
    }

    // Attach refresh buttons
    var refreshBtns = document.querySelectorAll('.btn-refresh-cred');
    for (var j = 0; j < refreshBtns.length; j++) {
        (function (btn) {
            btn.addEventListener('click', function () { handleRefreshCredential(btn.dataset.credId); });
        })(refreshBtns[j]);
    }

    // Attach revoke buttons
    var revokeBtns = document.querySelectorAll('.btn-revoke-cred');
    for (var k = 0; k < revokeBtns.length; k++) {
        (function (btn) {
            btn.addEventListener('click', function () { handleRevokeCredential(btn.dataset.credId); });
        })(revokeBtns[k]);
    }
}

async function handleGenerateCredential() {
    if (!confirm('Generate new credentials for this customer?\nThe Client Secret will only be shown ONCE.')) return;

    try {
        var res = await fetch(BASE + '/credentials', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ environment: CUSTOMER.environment || 'production' })
        });
        var data = await res.json();
        if (!res.ok) throw new Error(data.message);

        document.getElementById('newSecretValue').textContent = data.data.client_secret;
        document.getElementById('secretRevealBox').style.display = 'block';
        showAlert('success', 'Credentials generated successfully!');

        await reloadCredentials();
    } catch (e) {
        showAlert('error', e.message);
    }
}

async function handleRefreshCredential(credentialId) {
    if (!confirm('This will revoke the current credential and generate a new one.\nThe new Client Secret will only be shown ONCE.\n\nContinue?')) return;

    try {
        var res = await fetch(BASE + '/credentials/refresh', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ credentialId: parseInt(credentialId) })
        });
        var data = await res.json();
        if (!res.ok) throw new Error(data.message);

        document.getElementById('newSecretValue').textContent = data.data.client_secret;
        document.getElementById('secretRevealBox').style.display = 'block';
        showAlert('success', 'Credentials refreshed successfully!');

        await reloadCredentials();
    } catch (e) {
        showAlert('error', e.message);
    }
}

async function handleRevokeCredential(credentialId) {
    if (!confirm('This will permanently revoke this credential.\nThe customer will no longer be able to use it.\n\nContinue?')) return;

    try {
        var res = await fetch(BASE + '/credentials/' + credentialId + '/revoke', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        });
        var data = await res.json();
        if (!res.ok) throw new Error(data.message);

        showAlert('success', 'Credential revoked.');
        await reloadCredentials();
    } catch (e) {
        showAlert('error', e.message);
    }
}

// ═══════════════════════════════════════════════════════════════
// WEBHOOKS
// ═══════════════════════════════════════════════════════════════
async function loadWebhooks() {
    try {
        var res  = await fetch(BASE + '/webhooks');
        var data = await res.json();
        if (!res.ok) throw new Error(data.message);
        renderWebhooks(data.data);
    } catch (e) {
        setHtml('webhooksTable', '<p style="color:var(--danger)">' + esc(e.message) + '</p>');
    }
}

function renderWebhooks(webhooks) {
    if (webhooks.length === 0) {
        setHtml('webhooksTable',
            '<div class="empty-state">' +
            '<p class="empty-title">No webhooks</p>' +
            '<p>Click "+ Add Webhook" to register one.</p>' +
            '</div>');
        return;
    }

    // Store webhooks data for test popup
    _webhooksData = webhooks;

    var rows = webhooks.map(function (w) {
        var eventBadges = w.events.map(function (ev) {
            return '<span class="badge badge-info" style="margin-right:4px">' + esc(ev) + '</span>';
        }).join('');

        return '<tr>' +
            '<td class="td-url">' + esc(w.url) + '</td>' +
            '<td>' + eventBadges + '</td>' +
            '<td><span class="badge badge-' + (w.status === 'active' ? 'success' : 'danger') + '">' + esc(w.status) + '</span></td>' +
            '<td>' + w.fail_count + '</td>' +
            '<td>' + fmtDate(w.created_at) + '</td>' +
            '<td style="white-space:nowrap;">' +
                '<div style="display:inline-flex;align-items:center;gap:6px;">' +
                '<button class="btn btn-sm btn-test-webhook" data-wh-id="' + w.id + '" style="background:#6366f1;color:#fff;border-color:#6366f1;">Test</button>' +
                '<button class="btn btn-sm btn-danger btn-del-webhook" data-wh-id="' + w.id + '">Delete</button>' +
                '</div>' +
            '</td>' +
            '</tr>';
    }).join('');

    setHtml('webhooksTable',
        '<table class="data-table"><thead><tr>' +
        '<th>URL</th><th>Events</th><th>Status</th><th>Fails</th><th>Created</th><th>Actions</th>' +
        '</tr></thead><tbody>' + rows + '</tbody></table>');

    var delBtns = document.querySelectorAll('.btn-del-webhook');
    for (var i = 0; i < delBtns.length; i++) {
        (function (btn) {
            btn.addEventListener('click', function () { handleDeleteWebhook(btn.dataset.whId); });
        })(delBtns[i]);
    }
    var testBtns = document.querySelectorAll('.btn-test-webhook');
    for (var j = 0; j < testBtns.length; j++) {
        (function (btn) {
            btn.addEventListener('click', function () { showTestEventPicker(btn); });
        })(testBtns[j]);
    }
}

// Store webhooks for event lookup
var _webhooksData = [];

function showTestEventPicker(btn) {
    var webhookId = btn.dataset.whId;

    // Find this webhook's subscribed events
    var webhook = null;
    for (var i = 0; i < _webhooksData.length; i++) {
        if (String(_webhooksData[i].id) === String(webhookId)) {
            webhook = _webhooksData[i];
            break;
        }
    }
    if (!webhook) return;

    var events = webhook.events || [];

    // Build event buttons
    var eventBtns = events.map(function (ev) {
        return '<button class="btn btn-sm btn-pick-event" data-event="' + esc(ev) + '" ' +
            'style="background:var(--primary);color:#fff;border-color:var(--primary);">' + esc(ev) + '</button>';
    }).join('');

    var html =
        '<div style="margin-bottom:12px;color:var(--text-secondary);font-size:14px;">' +
            'Chọn event để gửi test webhook tới:<br>' +
            '<code style="font-size:12px;color:var(--primary);">' + esc(webhook.url) + '</code>' +
        '</div>' +
        '<div style="display:flex;flex-wrap:wrap;gap:8px;">' + eventBtns + '</div>';

    document.getElementById('testEventPickerContent').innerHTML = html;
    document.getElementById('testEventPickerModal').dataset.whId = webhookId;
    document.getElementById('testEventPickerModal').classList.add('show');

    // Attach event pick handlers
    var pickBtns = document.querySelectorAll('.btn-pick-event');
    for (var j = 0; j < pickBtns.length; j++) {
        (function (pb) {
            pb.addEventListener('click', function () {
                document.getElementById('testEventPickerModal').classList.remove('show');
                handleTestWebhook(webhookId, pb.dataset.event);
            });
        })(pickBtns[j]);
    }
}

async function handleSaveWebhook() {
    var url    = document.getElementById('whUrl').value.trim();
    var secret = document.getElementById('whSecret').value.trim();
    var checkboxes = document.querySelectorAll('.event-cb:checked');
    var events = [];
    for (var i = 0; i < checkboxes.length; i++) {
        events.push(checkboxes[i].value);
    }

    if (!url || !secret || events.length === 0) {
        showAlert('error', 'Please fill in URL, Secret, and select at least 1 event.');
        return;
    }

    try {
        var res = await fetch(BASE + '/webhooks', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url: url, secret: secret, events: events })
        });
        var data = await res.json();
        if (!res.ok) throw new Error(data.message);

        showAlert('success', 'Webhook registered!');
        toggleWebhookForm(false);
        await loadWebhooks();
    } catch (e) {
        showAlert('error', e.message);
    }
}

async function handleDeleteWebhook(webhookId) {
    if (!confirm('Delete this webhook?')) return;
    try {
        var res = await fetch(BASE + '/webhooks/' + webhookId, { method: 'DELETE' });
        var data = await res.json();
        if (!res.ok) throw new Error(data.message);

        showAlert('success', 'Webhook deleted.');
        await loadWebhooks();
    } catch (e) {
        showAlert('error', e.message);
    }
}

async function handleTestWebhook(webhookId, event) {
    // Disable the Test button for this webhook while sending
    var testBtn = document.querySelector('.btn-test-webhook[data-wh-id="' + webhookId + '"]');
    if (testBtn) { testBtn.disabled = true; testBtn.textContent = 'Sending...'; }

    try {
        var res = await fetch(BASE + '/webhooks/' + webhookId + '/test', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ event: event })
        });
        var data = await res.json();
        if (!res.ok) throw new Error(data.message);

        if (data.data && data.data.success) {
            showAlert('success', 'Test [' + event + '] sent! HTTP ' + data.data.httpStatus);
        } else {
            showAlert('error', 'Test [' + event + '] failed: ' + (data.data && data.data.error ? data.data.error : 'Unknown error'));
        }
        // Refresh delivery logs
        loadLogs(0);
    } catch (e) {
        showAlert('error', e.message);
    } finally {
        if (testBtn) { testBtn.disabled = false; testBtn.textContent = 'Test'; }
    }
}

function toggleWebhookForm(show) {
    document.getElementById('webhookFormWrap').style.display = show ? 'block' : 'none';
    document.getElementById('btnToggleWebhookForm').textContent = show ? 'Cancel' : '+ Add Webhook';
}

// ═══════════════════════════════════════════════════════════════
// WEBHOOK DELIVERY LOGS
// ═══════════════════════════════════════════════════════════════
async function loadLogs(page) {
    if (page === undefined) page = 0;
    logsPage = page;
    var eventFilter  = document.getElementById('filterEvent').value;
    var statusFilter = document.getElementById('filterStatus').value;

    var url = BASE + '/webhook-logs?limit=' + LOGS_PER + '&offset=' + (page * LOGS_PER);
    if (eventFilter)  url += '&event=' + eventFilter;
    if (statusFilter) url += '&status=' + statusFilter;

    try {
        var res  = await fetch(url);
        var data = await res.json();
        if (!res.ok) throw new Error(data.message);

        renderLogs(data.data.logs, data.data.total);
    } catch (e) {
        setHtml('logsTable', '<p style="color:var(--danger)">' + esc(e.message) + '</p>');
    }
}

// Store logs data for detail view
var _currentLogs = [];

function renderLogs(logs, total) {
    _currentLogs = logs;

    if (logs.length === 0) {
        setHtml('logsTable',
            '<div class="empty-state">' +
            '<p class="empty-title">No logs</p>' +
            '<p>No webhook delivery logs found.</p>' +
            '</div>');
        updatePagination(total);
        return;
    }

    var rows = logs.map(function (l, idx) {
        var statusCls = l.status === 'success' ? 'log-success' : l.status === 'failed' ? 'log-failed' : 'log-pending';

        // Detect test delivery: payload contains _test: true
        var isTest = false;
        try {
            var p = typeof l.payload === 'string' ? JSON.parse(l.payload) : l.payload;
            if (p && p._test) isTest = true;
        } catch (e) {}

        var testTag = isTest ? ' <span style="background:#f59e0b;color:#fff;padding:2px 6px;border-radius:4px;font-size:10px;font-weight:700;vertical-align:middle;">TEST</span>' : '';

        return '<tr' + (isTest ? ' style="background:#fffbeb;"' : '') + '>' +
            '<td>' + fmtDatetime(l.created_at) + '</td>' +
            '<td><span class="badge badge-info" style="font-size:11px;">' + esc(l.event) + '</span>' + testTag + '</td>' +
            '<td class="td-url">' + esc(l.webhook_url || '\u2014') + '</td>' +
            '<td>' + (l.order_id || '\u2014') + '</td>' +
            '<td class="' + statusCls + '">' + esc(l.status) + '</td>' +
            '<td>' + (l.http_status || '\u2014') + '</td>' +
            '<td>' + l.attempts + '</td>' +
            '<td style="white-space:nowrap;">' +
                '<button class="btn btn-sm btn-view-log" data-log-idx="' + idx + '" style="font-size:12px;padding:4px 10px;">Detail</button>' +
            '</td>' +
            '</tr>';
    }).join('');

    setHtml('logsTable',
        '<table class="data-table"><thead><tr>' +
        '<th>Time</th><th>Event</th><th>Webhook URL</th><th>Order</th>' +
        '<th>Status</th><th>HTTP</th><th>Attempts</th><th></th>' +
        '</tr></thead><tbody>' + rows + '</tbody></table>');

    // Attach detail buttons
    var detailBtns = document.querySelectorAll('.btn-view-log');
    for (var i = 0; i < detailBtns.length; i++) {
        (function (btn) {
            btn.addEventListener('click', function () {
                var idx = parseInt(btn.dataset.logIdx);
                showLogDetail(_currentLogs[idx]);
            });
        })(detailBtns[i]);
    }

    updatePagination(total);
}

function formatJson(val) {
    if (!val) return '—';
    try {
        var obj = typeof val === 'string' ? JSON.parse(val) : val;
        return JSON.stringify(obj, null, 2);
    } catch (e) {
        return String(val);
    }
}

function showLogDetail(log) {
    if (!log) return;

    var statusCls = log.status === 'success' ? 'log-success' : log.status === 'failed' ? 'log-failed' : 'log-pending';

    // Detect test delivery
    var isTest = false;
    try {
        var p = typeof log.payload === 'string' ? JSON.parse(log.payload) : log.payload;
        if (p && p._test) isTest = true;
    } catch (e) {}

    var testTag = isTest ? ' <span style="background:#f59e0b;color:#fff;padding:3px 8px;border-radius:4px;font-size:11px;font-weight:700;">TEST</span>' : '';

    var html =
        (isTest ? '<div style="background:#fffbeb;border:1px solid #f59e0b;border-radius:8px;padding:10px 14px;margin-bottom:16px;font-size:13px;color:#92400e;font-weight:600;">This is a test delivery — sample data, does not affect fail count.</div>' : '') +
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:20px;">' +
            '<div class="info-box" style="padding:12px 16px;">' +
                '<div class="info-row"><span class="info-label">Time</span><span class="info-value">' + fmtDatetime(log.created_at) + '</span></div>' +
                '<div class="info-row"><span class="info-label">Event</span><span class="info-value"><span class="badge badge-info">' + esc(log.event) + '</span>' + testTag + '</span></div>' +
                '<div class="info-row"><span class="info-label">Status</span><span class="info-value ' + statusCls + '">' + esc(log.status) + '</span></div>' +
                '<div class="info-row"><span class="info-label">HTTP Status</span><span class="info-value">' + (log.http_status || '—') + '</span></div>' +
            '</div>' +
            '<div class="info-box" style="padding:12px 16px;">' +
                '<div class="info-row"><span class="info-label">Webhook URL</span><span class="info-value td-url" style="font-size:12px;">' + esc(log.webhook_url || '—') + '</span></div>' +
                '<div class="info-row"><span class="info-label">Order ID</span><span class="info-value">' + (log.order_id || '—') + '</span></div>' +
                '<div class="info-row"><span class="info-label">Attempts</span><span class="info-value">' + log.attempts + '</span></div>' +
                '<div class="info-row"><span class="info-label">Delivered At</span><span class="info-value">' + (log.delivered_at ? fmtDatetime(log.delivered_at) : '—') + '</span></div>' +
            '</div>' +
        '</div>';

    // Error message
    if (log.error_message) {
        html += '<div style="margin-bottom:16px;">' +
            '<label style="display:block;font-size:13px;font-weight:600;color:var(--danger);margin-bottom:6px;">Error Message</label>' +
            '<div style="background:var(--danger-light);border:1px solid var(--danger);border-radius:8px;padding:12px;font-size:13px;word-break:break-all;">' + esc(log.error_message) + '</div>' +
            '</div>';
    }

    // Payload
    html += '<div style="margin-bottom:16px;">' +
        '<label style="display:block;font-size:13px;font-weight:600;color:var(--text-secondary);margin-bottom:6px;">Request Payload</label>' +
        '<pre style="background:var(--bg-secondary);border:1px solid var(--border);border-radius:8px;padding:14px;font-size:12px;font-family:\'Courier New\',monospace;overflow-x:auto;max-height:300px;overflow-y:auto;white-space:pre-wrap;word-break:break-all;margin:0;">' + esc(formatJson(log.payload)) + '</pre>' +
        '</div>';

    // Response body
    html += '<div style="margin-bottom:0;">' +
        '<label style="display:block;font-size:13px;font-weight:600;color:var(--text-secondary);margin-bottom:6px;">Response Body</label>' +
        '<pre style="background:var(--bg-secondary);border:1px solid var(--border);border-radius:8px;padding:14px;font-size:12px;font-family:\'Courier New\',monospace;overflow-x:auto;max-height:300px;overflow-y:auto;white-space:pre-wrap;word-break:break-all;margin:0;">' + esc(formatJson(log.response_body)) + '</pre>' +
        '</div>';

    // Show in modal
    document.getElementById('logDetailContent').innerHTML = html;
    document.getElementById('logDetailModal').classList.add('show');
}

function updatePagination(total) {
    var totalPages = Math.ceil(total / LOGS_PER);
    var prev = document.getElementById('btnPrevPage');
    var next = document.getElementById('btnNextPage');
    var info = document.getElementById('pageInfo');

    prev.disabled = logsPage <= 0;
    next.disabled = logsPage >= totalPages - 1;
    info.textContent = 'Page ' + (logsPage + 1) + ' / ' + (totalPages || 1) + '  (' + total + ' records)';
}

// ═══════════════════════════════════════════════════════════════
// EVENT LISTENERS
// ═══════════════════════════════════════════════════════════════
function initButtons() {
    // Edit customer
    document.getElementById('btnEditCustomer').addEventListener('click', openEditModal);
    document.getElementById('btnCloseEditModal').addEventListener('click', closeEditModal);
    document.getElementById('btnCancelEdit').addEventListener('click', closeEditModal);
    document.getElementById('btnSaveEdit').addEventListener('click', handleSaveEdit);

    // Close modal on overlay click
    document.getElementById('editModal').addEventListener('click', function (e) {
        if (e.target === this) closeEditModal();
    });

    // Reset portal password
    document.getElementById('btnResetPortalPw').addEventListener('click', handleResetPortalPassword);
    document.getElementById('btnCopyResetPw').addEventListener('click', function () {
        var pw = document.getElementById('resetPwValue').textContent;
        if (pw) copyToClipboard(pw, this);
    });

    // Toggle webhook form
    document.getElementById('btnToggleWebhookForm').addEventListener('click', function () {
        var wrap = document.getElementById('webhookFormWrap');
        var isOpen = wrap.style.display === 'block';
        toggleWebhookForm(!isOpen);
    });

    // Save webhook
    document.getElementById('btnSaveWebhook').addEventListener('click', handleSaveWebhook);

    // Cancel webhook form
    document.getElementById('btnCancelWebhook').addEventListener('click', function () { toggleWebhookForm(false); });

    // Copy new secret
    document.getElementById('btnCopyNewSecret').addEventListener('click', function () {
        copyToClipboard(document.getElementById('newSecretValue').textContent);
    });

    // Test event picker modal
    document.getElementById('btnCloseTestPicker').addEventListener('click', function () {
        document.getElementById('testEventPickerModal').classList.remove('show');
    });
    document.getElementById('testEventPickerModal').addEventListener('click', function (e) {
        if (e.target === this) this.classList.remove('show');
    });

    // Log detail modal
    document.getElementById('btnCloseLogDetail').addEventListener('click', function () {
        document.getElementById('logDetailModal').classList.remove('show');
    });
    document.getElementById('logDetailModal').addEventListener('click', function (e) {
        if (e.target === this) this.classList.remove('show');
    });

    // Log filters
    document.getElementById('filterEvent').addEventListener('change', function () { loadLogs(0); });
    document.getElementById('filterStatus').addEventListener('change', function () { loadLogs(0); });
    document.getElementById('btnRefreshLogs').addEventListener('click', function () { loadLogs(0); });

    // Pagination
    document.getElementById('btnPrevPage').addEventListener('click', function () { loadLogs(logsPage - 1); });
    document.getElementById('btnNextPage').addEventListener('click', function () { loadLogs(logsPage + 1); });
}

// ═══════════════════════════════════════════════════════════════
// EDIT CUSTOMER
// ═══════════════════════════════════════════════════════════════
function openEditModal() {
    if (!CUSTOMER) return;

    document.getElementById('editName').value = CUSTOMER.customer_name || '';
    document.getElementById('editEmail').value = CUSTOMER.email || '';
    document.getElementById('editPhone').value = CUSTOMER.phone || '';
    document.getElementById('editStatus').value = CUSTOMER.status || 'active';
    document.getElementById('editWebhookEnabled').value = CUSTOMER.webhook_enabled ? 'true' : 'false';
    document.getElementById('editBulkOrderEnabled').value = CUSTOMER.bulk_order_enabled ? 'true' : 'false';
    document.getElementById('editRateHour').value = CUSTOMER.rate_limit_per_hour || 6000;
    document.getElementById('editRateDay').value = CUSTOMER.rate_limit_per_day || 10000;

    document.getElementById('editModal').classList.add('show');
}

function closeEditModal() {
    document.getElementById('editModal').classList.remove('show');
}

async function handleSaveEdit() {
    var payload = {
        customerName:     document.getElementById('editName').value.trim(),
        email:            document.getElementById('editEmail').value.trim() || null,
        phone:            document.getElementById('editPhone').value.trim() || null,
        status:           document.getElementById('editStatus').value,
        webhookEnabled:   document.getElementById('editWebhookEnabled').value === 'true',
        bulkOrderEnabled: document.getElementById('editBulkOrderEnabled').value === 'true',
        rateLimitPerHour: parseInt(document.getElementById('editRateHour').value) || 6000,
        rateLimitPerDay:  parseInt(document.getElementById('editRateDay').value) || 10000
    };

    if (!payload.customerName) {
        showAlert('error', 'Customer name is required.');
        return;
    }

    var btnSave = document.getElementById('btnSaveEdit');
    btnSave.disabled = true;
    btnSave.textContent = 'Saving...';

    try {
        var res = await fetch(BASE, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        var data = await res.json();
        if (!res.ok) throw new Error(data.message || 'Update failed');

        showAlert('success', 'Customer updated successfully!');
        closeEditModal();
        await fetchCustomerData();
    } catch (e) {
        showAlert('error', e.message);
    } finally {
        btnSave.disabled = false;
        btnSave.textContent = 'Save Changes';
    }
}

// ═══════════════════════════════════════════════════════════════
// RESET PORTAL PASSWORD
// ═══════════════════════════════════════════════════════════════
async function handleResetPortalPassword() {
    if (!confirm('Generate a new random password for this customer? The old password will be invalidated immediately.')) return;

    var btn = document.getElementById('btnResetPortalPw');
    btn.disabled = true;
    btn.textContent = 'Resetting...';

    try {
        var res = await fetch(BASE + '/portal-password', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({})
        });
        var data = await res.json();
        if (!res.ok) throw new Error(data.message || 'Failed to reset password');

        // Show the generated password
        var resultBox = document.getElementById('resetPwResult');
        var pwValue = document.getElementById('resetPwValue');
        if (resultBox && pwValue && data.data && data.data.portal_password) {
            pwValue.textContent = data.data.portal_password;
            resultBox.style.display = 'block';
        }

        showAlert('success', 'Portal password has been reset! Copy the new password now.');
        await fetchCustomerData();
    } catch (e) {
        showAlert('error', e.message);
    } finally {
        btn.disabled = false;
        btn.textContent = 'Reset Password';
    }
}

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════
function setText(id, val) { var el = document.getElementById(id); if (el) el.textContent = val; }
function setHtml(id, html) { var el = document.getElementById(id); if (el) el.innerHTML = html; }

function esc(text) {
    if (text == null) return '';
    var map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
    return String(text).replace(/[&<>"']/g, function (m) { return map[m]; });
}

function statusClass(s) {
    return { active: 'success', suspended: 'warning', inactive: 'danger' }[s] || 'info';
}

function fmtDate(d) {
    return new Date(d).toLocaleDateString('vi-VN', { year: 'numeric', month: '2-digit', day: '2-digit' });
}

function fmtDatetime(d) {
    return new Date(d).toLocaleString('vi-VN', {
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit'
    });
}

async function copyToClipboard(text, btn) {
    try {
        await navigator.clipboard.writeText(text);
    } catch (_) {
        var ta = document.createElement('textarea');
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
    }
    if (btn) {
        var orig = btn.textContent;
        btn.textContent = 'Copied!';
        setTimeout(function () { btn.textContent = orig; }, 1200);
    }
    showAlert('success', 'Copied to clipboard!');
}

// ─── Alert toast ──────────────────────────────────────────────
var alertTimer;
function showAlert(type, msg) {
    var toast = document.getElementById('alertToast');
    var text  = document.getElementById('alertText');

    text.textContent = msg;
    toast.className = 'alert-toast ' + type + ' show';

    clearTimeout(alertTimer);
    alertTimer = setTimeout(function () { toast.classList.remove('show'); }, 4000);
}
