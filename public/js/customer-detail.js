// ─── Extract customerId from URL: /extensions/customer/:customerId ───
var pathParts = window.location.pathname.split('/');
var CID = pathParts[pathParts.length - 1];
var BASE = '/api/v1/admin/customers/' + CID;

var CUSTOMER = null;

// ─── Pagination state ──────────────────────────────────────────
var logsPage = 0;
var LOGS_PER = 30;

// ═══════════════════════════════════════════════════════════════
// INIT — fetch customer data from API, then render everything
// ═══════════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', function () {
    if (!CID || isNaN(CID)) {
        showAlert('error', 'Không tìm thấy Customer ID trong URL');
        return;
    }
    fetchCustomerData();
    initButtons();
});

async function fetchCustomerData() {
    try {
        var res  = await fetch(BASE);
        var json = await res.json();
        if (!res.ok) throw new Error(json.message || 'Không thể tải dữ liệu');

        CUSTOMER = json.data;
        renderCustomerInfo();
        renderCredentials(CUSTOMER.credentials || []);
        loadWebhooks();
        loadLogs();
    } catch (e) {
        showAlert('error', e.message);
        setText('customerName', 'Lỗi tải dữ liệu');
        setText('customerMeta', e.message);
    }
}

// ═══════════════════════════════════════════════════════════════
// CUSTOMER INFO
// ═══════════════════════════════════════════════════════════════
function renderCustomerInfo() {
    setText('customerName',  CUSTOMER.customer_name);
    setText('customerMeta',  CUSTOMER.customer_code + ' · ' + (CUSTOMER.email || '—'));
    setText('infoCode',      CUSTOMER.customer_code);
    setText('infoEmail',     CUSTOMER.email || '—');
    setText('infoEnv',       CUSTOMER.environment);
    setText('infoRate',      CUSTOMER.rate_limit_per_hour + ' / ' + CUSTOMER.rate_limit_per_day);
    setText('infoWebhook',   CUSTOMER.webhook_enabled ? 'Enabled' : 'Disabled');
    setText('topbarName',    CUSTOMER.customer_name);

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
        setText('roleTag', 'Khách Hàng');
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
        setHtml('credentialsList', '<p style="color:var(--text2)">Chưa có credentials.</p>');
        return;
    }

    var rows = creds.map(function (c) {
        var refreshBtn = c.status === 'active'
            ? '<button class="btn btn-sm btn-danger btn-refresh-cred" data-cred-id="' + c.id + '" data-env="' + esc(c.environment) + '">🔄 Refresh</button>'
            : '';
        return '<div class="cred-row">' +
            '<span class="cred-label">Client ID</span>' +
            '<span class="cred-value">' + esc(c.client_id) + '</span>' +
            '<button class="btn-copy" data-copy="' + esc(c.client_id) + '">Copy</button>' +
            '<span class="badge badge-' + (c.status === 'active' ? 'success' : 'danger') + '">' + esc(c.status) + '</span>' +
            refreshBtn +
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
}

async function handleRefreshCredential(credentialId) {
    if (!confirm('Refresh sẽ xóa credential hiện tại và tạo mới.\nClient Secret mới chỉ hiển thị 1 lần.\n\nTiếp tục?')) return;

    try {
        var res  = await fetch(BASE + '/credentials/refresh', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ credentialId: parseInt(credentialId) })
        });
        var data = await res.json();
        if (!res.ok) throw new Error(data.message);

        // Show new secret
        document.getElementById('newSecretValue').textContent = data.data.client_secret;
        document.getElementById('secretRevealBox').style.display = 'block';
        showAlert('success', 'Credentials đã được refresh!');

        // Reload credentials list
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
            '<div class="icon">🪝</div>' +
            '<p>Chưa có webhook nào. Click "+ Thêm Webhook" để tạo.</p>' +
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
            '<td class="td-actions"><button class="btn btn-sm btn-danger btn-del-webhook" data-wh-id="' + w.id + '">🗑️ Xóa</button></td>' +
            '</tr>';
    }).join('');

    setHtml('webhooksTable',
        '<table><thead><tr>' +
        '<th>URL</th><th>Events</th><th>Status</th><th>Fail</th><th>Tạo lúc</th><th></th>' +
        '</tr></thead><tbody>' + rows + '</tbody></table>');

    // Attach delete buttons
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
        showAlert('error', 'Vui lòng điền đầy đủ URL, Secret và chọn ít nhất 1 event.');
        return;
    }

    try {
        var res  = await fetch(BASE + '/webhooks', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url: url, secret: secret, events: events })
        });
        var data = await res.json();
        if (!res.ok) throw new Error(data.message);

        showAlert('success', 'Webhook đã được đăng ký!');
        toggleWebhookForm(false);
        await loadWebhooks();
    } catch (e) {
        showAlert('error', e.message);
    }
}

async function handleDeleteWebhook(webhookId) {
    if (!confirm('Bạn có chắc muốn xóa webhook này?')) return;
    try {
        var res  = await fetch(BASE + '/webhooks/' + webhookId, { method: 'DELETE' });
        var data = await res.json();
        if (!res.ok) throw new Error(data.message);

        showAlert('success', 'Webhook đã xóa.');
        await loadWebhooks();
    } catch (e) {
        showAlert('error', e.message);
    }
}

function toggleWebhookForm(show) {
    document.getElementById('webhookFormWrap').style.display = show ? 'block' : 'none';
    document.getElementById('btnToggleWebhookForm').textContent = show ? '− Đóng' : '+ Thêm Webhook';
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
            '<div class="icon">📋</div>' +
            '<p>Chưa có log nào.</p>' +
            '</div>');
        updatePagination(total);
        return;
    }

    var rows = logs.map(function (l) {
        var statusCls = l.status === 'success' ? 'log-success' : l.status === 'failed' ? 'log-failed' : 'log-pending';
        return '<tr>' +
            '<td>' + fmtDatetime(l.created_at) + '</td>' +
            '<td>' + esc(l.event) + '</td>' +
            '<td class="td-url">' + esc(l.webhook_url || '—') + '</td>' +
            '<td>' + (l.order_id || '—') + '</td>' +
            '<td class="' + statusCls + '">' + esc(l.status) + '</td>' +
            '<td>' + (l.http_status || '—') + '</td>' +
            '<td>' + l.attempts + '</td>' +
            '<td style="max-width:180px;font-size:12px;color:var(--text2);word-break:break-all">' + esc(l.error_message || '—') + '</td>' +
            '</tr>';
    }).join('');

    setHtml('logsTable',
        '<table><thead><tr>' +
        '<th>Thời gian</th><th>Event</th><th>Webhook URL</th><th>Order</th>' +
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
    info.textContent = 'Trang ' + (logsPage + 1) + ' / ' + (totalPages || 1) + '  (' + total + ' records)';
}

// ═══════════════════════════════════════════════════════════════
// EVENT LISTENERS
// ═══════════════════════════════════════════════════════════════
function initButtons() {
    // Toggle webhook form
    document.getElementById('btnToggleWebhookForm').addEventListener('click', function () {
        var wrap   = document.getElementById('webhookFormWrap');
        var isOpen = wrap.style.display === 'block';
        toggleWebhookForm(!isOpen);
    });

    // Save webhook
    document.getElementById('btnSaveWebhook').addEventListener('click', handleSaveWebhook);

    // Cancel webhook form
    document.getElementById('btnCancelWebhook').addEventListener('click', function () { toggleWebhookForm(false); });

    // Copy new secret (after refresh)
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
// HELPERS
// ═══════════════════════════════════════════════════════════════
function setText(id, val)  { var el = document.getElementById(id); if (el) el.textContent = val; }
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
        // fallback
        var ta = document.createElement('textarea');
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
    }
    if (btn) {
        var orig = btn.textContent;
        btn.textContent = '✓';
        setTimeout(function () { btn.textContent = orig; }, 1200);
    }
    showAlert('success', 'Đã sao chép!');
}

// ─── Alert toast ──────────────────────────────────────────────
var alertTimer;
function showAlert(type, msg) {
    var toast = document.getElementById('alertToast');
    var icon  = document.getElementById('alertIcon');
    var text  = document.getElementById('alertText');

    icon.textContent = type === 'success' ? '✅' : '❌';
    text.textContent = msg;
    toast.className  = 'alert ' + type + ' show';

    clearTimeout(alertTimer);
    alertTimer = setTimeout(function () { toast.classList.remove('show'); }, 4000);
}
