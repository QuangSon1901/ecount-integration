// ─── Extract customerId from URL: /extensions/customer/:customerId ───
var pathParts = window.location.pathname.split('/');
var CID = pathParts[pathParts.length - 1];
var BASE = '/api/v1/admin/customers/' + CID;

var CUSTOMER = null;

// ─── Pagination state ──────────────────────────────────────────
var logsPage = 0;
var LOGS_PER = 30;

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
    setText('infoWebhook', CUSTOMER.webhook_enabled ? 'Enabled' : 'Disabled');
    setText('topbarName', CUSTOMER.customer_name);

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
            '<td><button class="btn btn-sm btn-danger btn-del-webhook" data-wh-id="' + w.id + '">Delete</button></td>' +
            '</tr>';
    }).join('');

    setHtml('webhooksTable',
        '<table class="data-table"><thead><tr>' +
        '<th>URL</th><th>Events</th><th>Status</th><th>Fails</th><th>Created</th><th></th>' +
        '</tr></thead><tbody>' + rows + '</tbody></table>');

    var delBtns = document.querySelectorAll('.btn-del-webhook');
    for (var i = 0; i < delBtns.length; i++) {
        (function (btn) {
            btn.addEventListener('click', function () { handleDeleteWebhook(btn.dataset.whId); });
        })(delBtns[i]);
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

function renderLogs(logs, total) {
    if (logs.length === 0) {
        setHtml('logsTable',
            '<div class="empty-state">' +
            '<p class="empty-title">No logs</p>' +
            '<p>No webhook delivery logs found.</p>' +
            '</div>');
        updatePagination(total);
        return;
    }

    var rows = logs.map(function (l) {
        var statusCls = l.status === 'success' ? 'log-success' : l.status === 'failed' ? 'log-failed' : 'log-pending';
        return '<tr>' +
            '<td>' + fmtDatetime(l.created_at) + '</td>' +
            '<td>' + esc(l.event) + '</td>' +
            '<td class="td-url">' + esc(l.webhook_url || '\u2014') + '</td>' +
            '<td>' + (l.order_id || '\u2014') + '</td>' +
            '<td class="' + statusCls + '">' + esc(l.status) + '</td>' +
            '<td>' + (l.http_status || '\u2014') + '</td>' +
            '<td>' + l.attempts + '</td>' +
            '<td style="max-width:180px;font-size:12px;color:var(--text-secondary);word-break:break-all">' + esc(l.error_message || '\u2014') + '</td>' +
            '</tr>';
    }).join('');

    setHtml('logsTable',
        '<table class="data-table"><thead><tr>' +
        '<th>Time</th><th>Event</th><th>Webhook URL</th><th>Order</th>' +
        '<th>Status</th><th>HTTP</th><th>Attempts</th><th>Error</th>' +
        '</tr></thead><tbody>' + rows + '</tbody></table>');

    updatePagination(total);
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
