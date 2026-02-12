/**
 * dashboard.js — Main dashboard logic with clean RBAC
 * No inline JS. All handlers attached via addEventListener.
 */
var API = '/api/v1';
var currentUser = null;

// ════════════════════════════════════════════
// INIT
// ════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', function () {
    fetchCurrentUser().then(function () {
        initNavigation();
        initQuickAccessCards();
        initEventListeners();

        if (currentUser) {
            if (currentUser.role === 'admin') {
                loadCustomers();
            } else if (currentUser.role === 'customer') {
                loadClientData();
            }
        }

        updateClock();
        setInterval(updateClock, 60000);
    });
});

// ════════════════════════════════════════════
// AUTH & ROLE
// ════════════════════════════════════════════
function fetchCurrentUser() {
    return fetch(API + '/me')
        .then(function (r) {
            if (!r.ok) { window.location.href = '/login'; return; }
            return r.json();
        })
        .then(function (data) {
            if (data && data.success && data.data) {
                currentUser = data.data;
                renderUserUI();
                applyRBAC();
            } else {
                window.location.href = '/login';
            }
        })
        .catch(function () {
            showAlert('Cannot load user info', 'error');
        });
}

function renderUserUI() {
    if (!currentUser) return;
    var nameEl = document.getElementById('userName');
    var roleEl = document.getElementById('userRole');
    var avatarEl = document.getElementById('userAvatar');
    var subtitleEl = document.getElementById('sidebarSubtitle');

    if (currentUser.role === 'admin') {
        nameEl.textContent = currentUser.fullName || currentUser.username;
        roleEl.textContent = 'Administrator';
        avatarEl.textContent = (currentUser.username || 'A')[0].toUpperCase();
        subtitleEl.textContent = 'Admin Dashboard';
    } else {
        nameEl.textContent = currentUser.customerName || currentUser.customerCode;
        roleEl.textContent = 'Customer';
        avatarEl.textContent = (currentUser.customerCode || 'C')[0].toUpperCase();
        subtitleEl.textContent = 'Customer Portal';
    }
}

function applyRBAC() {
    if (!currentUser) return;
    var role = currentUser.role;

    // Show elements for this role
    var els = document.querySelectorAll('[data-role="' + role + '"]');
    for (var i = 0; i < els.length; i++) {
        els[i].classList.add('role-visible');
    }

    // Show shared sections (no data-role)
    // They're always visible by CSS

    // Set initial active section
    if (role === 'admin') {
        navigateToSection('admin-overview');
    } else {
        navigateToSection('client-overview');
    }
}

// ════════════════════════════════════════════
// NAVIGATION
// ════════════════════════════════════════════
function initNavigation() {
    var links = document.querySelectorAll('.nav-link[data-section]');
    for (var i = 0; i < links.length; i++) {
        links[i].addEventListener('click', handleNavClick);
    }
}

function handleNavClick(e) {
    var section = this.getAttribute('data-section');
    if (section) {
        navigateToSection(section);
        setActiveNav(this);
    }
}

function navigateToSection(sectionId) {
    // Hide all sections
    var sections = document.querySelectorAll('.content-section');
    for (var i = 0; i < sections.length; i++) {
        sections[i].classList.remove('active');
    }

    // Show target
    var target = document.getElementById(sectionId);
    if (target) {
        target.classList.add('active');
        updatePageTitle(sectionId);

        // Lazy-load data
        if (sectionId === 'admin-customers') loadCustomers();
        if (sectionId === 'client-credentials') loadCredentials();
        if (sectionId === 'client-webhooks') loadWebhooks();
    }

    // Update nav highlight
    var navLink = document.querySelector('.nav-link[data-section="' + sectionId + '"]');
    if (navLink) setActiveNav(navLink);

    window.scrollTo({ top: 0, behavior: 'smooth' });
}

function setActiveNav(activeLink) {
    var all = document.querySelectorAll('.nav-link');
    for (var i = 0; i < all.length; i++) {
        all[i].classList.remove('active');
    }
    activeLink.classList.add('active');
}

var pageTitles = {
    'admin-overview':        { t: 'Dashboard Overview',   s: 'System overview and quick actions' },
    'admin-customers':       { t: 'API Customers',        s: 'Manage API customers' },
    'admin-create-customer': { t: 'Create Customer',      s: 'Create new API customer' },
    'admin-tools':           { t: 'Internal Tools',       s: 'Admin-only tools and extensions' },
    'client-overview':       { t: 'Account Overview',     s: 'Your account information' },
    'client-credentials':    { t: 'API Credentials',      s: 'Your Client ID and Secret Key' },
    'client-webhooks':       { t: 'Webhooks',             s: 'Manage webhook registrations' },
    'api-docs':              { t: 'API Documentation',    s: 'THG-FULFILL Open API reference' },
    'public-extensions':     { t: 'Public Extensions',    s: 'Chrome extensions for ECount' }
};

function updatePageTitle(sectionId) {
    var info = pageTitles[sectionId] || { t: 'Dashboard', s: '' };
    var titleEl = document.getElementById('pageTitle');
    var subEl = document.getElementById('pageSubtitle');
    if (titleEl) titleEl.textContent = info.t;
    if (subEl) subEl.textContent = info.s;
}

// ════════════════════════════════════════════
// QUICK ACCESS CARDS
// ════════════════════════════════════════════
function initQuickAccessCards() {
    var cards = document.querySelectorAll('.stat-card.clickable[data-navigate]');
    for (var i = 0; i < cards.length; i++) {
        cards[i].addEventListener('click', function () {
            var nav = this.getAttribute('data-navigate');
            if (nav) navigateToSection(nav);
        });
    }
}

// ════════════════════════════════════════════
// EVENT LISTENERS
// ════════════════════════════════════════════
function initEventListeners() {
    // Admin: reload customers
    addClick('btnReloadCustomers', function () { loadCustomers(); });
    addClick('btnGoCreateCustomer', function () { navigateToSection('admin-create-customer'); });

    // Admin: create customer form
    var form = document.getElementById('createCustomerForm');
    if (form) form.addEventListener('submit', handleCreateCustomer);
    addClick('btnCopyPortalPw', function () {
        var pw = document.getElementById('resultPortalPassword');
        if (pw && pw.textContent) {
            if (navigator.clipboard) {
                navigator.clipboard.writeText(pw.textContent).then(function () {
                    showAlert('Portal password copied!', 'success');
                });
            } else {
                var ta = document.createElement('textarea');
                ta.value = pw.textContent;
                document.body.appendChild(ta);
                ta.select();
                document.execCommand('copy');
                document.body.removeChild(ta);
                showAlert('Portal password copied!', 'success');
            }
        }
    });

    // Client: credentials
    addClick('btnCopyClientId', function () { copyField('credClientId'); });
    addClick('btnCopyNewSecret', function () { copyField('newSecretValue'); });
    addClick('btnCopySecret', function () { copyField('credClientSecret'); });
    addClick('btnShowSecret', function () {
        showAlert('Secret key is not stored. It is only shown when newly generated.', 'info');
    });
    addClick('btnResetSecret', handleResetSecret);

    // Client: change password
    addClick('btnChangePassword', handleChangePassword);

    // Client: webhooks
    addClick('btnAddWebhook', function () {
        document.getElementById('webhookModal').classList.add('show');
    });
    addClick('btnCancelWebhook', function () {
        document.getElementById('webhookModal').classList.remove('show');
    });

    var whForm = document.getElementById('webhookForm');
    if (whForm) whForm.addEventListener('submit', handleAddWebhook);

    // Modal overlay click-to-close
    var overlay = document.getElementById('webhookModal');
    if (overlay) {
        overlay.addEventListener('click', function (e) {
            if (e.target === overlay) overlay.classList.remove('show');
        });
    }

    // Test event picker modal
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

function addClick(id, fn) {
    var el = document.getElementById(id);
    if (el) el.addEventListener('click', fn);
}

// ════════════════════════════════════════════
// ADMIN: CUSTOMER MANAGEMENT
// ════════════════════════════════════════════
function loadCustomers() {
    var loading = document.getElementById('loadingCustomers');
    var tbody = document.getElementById('customersTableBody');
    if (!tbody) return;

    if (loading) loading.classList.add('show');
    tbody.innerHTML = '';

    fetch(API + '/admin/customers')
        .then(function (r) { return r.json(); })
        .then(function (result) {
            if (result.success) {
                var customers = result.data.customers;
                updateStats(customers);
                if (customers.length === 0) {
                    tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;padding:40px;color:var(--text-secondary);">No customers yet</td></tr>';
                } else {
                    renderCustomerRows(customers, tbody);
                }
            } else {
                showAlert(result.message || 'Failed to load customers', 'error');
            }
        })
        .catch(function () { showAlert('Server connection error', 'error'); })
        .finally(function () { if (loading) loading.classList.remove('show'); });
}

function renderCustomerRows(customers, tbody) {
    for (var i = 0; i < customers.length; i++) {
        var c = customers[i];
        var tr = document.createElement('tr');
        tr.innerHTML =
            '<td>' + c.id + '</td>' +
            '<td><strong>' + esc(c.customer_code) + '</strong></td>' +
            '<td>' + esc(c.customer_name) + '</td>' +
            '<td><span class="badge badge-' + (c.environment === 'production' ? 'success' : 'warning') + '">' + c.environment + '</span></td>' +
            '<td><span class="badge badge-' + statusBadge(c.status) + '">' + c.status + '</span></td>' +
            '<td>' + formatTelegramTags(c.telegram_responsibles) + '</td>' +
            '<td>' + formatTelegramGroups(c.telegram_group_ids) + '</td>' +
            '<td>' + fmtDate(c.created_at) + '</td>' +
            '<td><button class="btn btn-sm view-btn" data-id="' + c.id + '" data-code="' + esc(c.customer_code) + '">View</button></td>';
        tbody.appendChild(tr);
    }

    // Attach view buttons
    var btns = tbody.querySelectorAll('.view-btn');
    for (var j = 0; j < btns.length; j++) {
        btns[j].addEventListener('click', function () {
            var id = this.getAttribute('data-id');
            if (id) window.location.href = '/extensions/customer/' + id;
        });
    }
}

function updateStats(customers) {
    var total = customers.length;
    var active = 0;
    for (var i = 0; i < customers.length; i++) {
        if (customers[i].status === 'active') active++;
    }
    setText('navCustomerCount', total);
    setText('statsCustomerCount', total);
    setText('statsActiveCount', active + ' Active');
}

function handleCreateCustomer(e) {
    e.preventDefault();

    var data = {
        customer_code: val('formCustomerCode'),
        customer_name: val('formCustomerName'),
        email: val('formEmail') || undefined,
        phone: val('formPhone') || undefined,
        environment: val('formEnvironment'),
        rate_limit_per_hour: parseInt(val('formRateLimitHourly')),
        rate_limit_per_day: parseInt(val('formRateLimitDaily')),
        webhook_enabled: document.getElementById('formWebhookEnabled').checked,
        bulk_order_enabled: document.getElementById('formBulkOrderEnabled').checked
    };

    fetch(API + '/admin/customers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
    })
    .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, data: d }; }); })
    .then(function (res) {
        if (res.ok) {
            showAlert('Customer created successfully!', 'success');
            displayCreateSuccess(res.data.data);
            document.getElementById('createCustomerForm').reset();
            document.getElementById('formWebhookEnabled').checked = true;
            document.getElementById('formBulkOrderEnabled').checked = true;
        } else {
            showAlert(res.data.message || 'Error creating customer', 'error');
        }
    })
    .catch(function () { showAlert('Server connection error', 'error'); });
}

function displayCreateSuccess(data) {
    setText('resultCustomerCode', data.customer_code);
    setText('resultPortalPassword', data.portal_password || '');
    var link = document.getElementById('resultViewLink');
    if (link) link.href = '/extensions/customer/' + data.customer_id;
    document.getElementById('createSuccessResult').classList.remove('hidden');
}

// ════════════════════════════════════════════
// CLIENT: LOAD ALL DATA
// ════════════════════════════════════════════
function loadClientData() {
    if (!currentUser || currentUser.role !== 'customer') return;

    // Account info (read-only)
    setText('infoCustomerCode', currentUser.customerCode || '-');
    setText('infoCustomerName', currentUser.customerName || '-');
    setText('infoEmail', currentUser.email || '-');
    setText('infoPhone', currentUser.phone || '-');
    setText('infoEnvironment', currentUser.environment || '-');
    setText('infoStatus', currentUser.status || '-');

    // Sandbox customers cannot reset secret key — only admin can
    if (currentUser.environment === 'sandbox') {
        var resetBtn = document.getElementById('btnResetSecret');
        if (resetBtn) {
            resetBtn.disabled = true;
            resetBtn.textContent = 'Reset disabled (Sandbox)';
            resetBtn.title = 'Sandbox customers cannot reset secret keys. Contact admin.';
        }
    }

    // Webhook feature disabled — hide content, show notice
    if (!currentUser.webhookEnabled) {
        var whNotice = document.getElementById('webhookDisabledNotice');
        var whContainer = document.getElementById('webhooksContainer');
        var whAddBtn = document.getElementById('btnAddWebhook');
        if (whNotice) whNotice.classList.remove('hidden');
        if (whContainer) whContainer.classList.add('hidden');
        if (whAddBtn) whAddBtn.classList.add('hidden');
    }

    // Bulk Order / API Credentials feature disabled — hide content, show notice
    if (!currentUser.bulkOrderEnabled) {
        var credNotice = document.getElementById('credentialsDisabledNotice');
        var credContent = document.getElementById('credentialsContent');
        if (credNotice) credNotice.classList.remove('hidden');
        if (credContent) credContent.classList.add('hidden');
    }

    if (currentUser.bulkOrderEnabled) loadCredentials();
    if (currentUser.webhookEnabled) loadWebhooks();
}

// ════════════════════════════════════════════
// CLIENT: CREDENTIALS
// ════════════════════════════════════════════
function loadCredentials() {
    if (!currentUser || currentUser.role !== 'customer') return;

    fetch(API + '/admin/customers/' + currentUser.id + '/credentials')
        .then(function (r) { return r.json(); })
        .then(function (data) {
            if (data.success && data.data) {
                document.getElementById('credClientId').value = data.data.client_id || '';

                // Sandbox: show actual secret key (stored in plaintext)
                if (data.data.client_secret && currentUser.environment === 'sandbox') {
                    var secretInput = document.getElementById('credClientSecret');
                    secretInput.type = 'text';
                    secretInput.value = data.data.client_secret;

                    // Enable copy for sandbox secret
                    var btnCopySecret = document.getElementById('btnCopySecret');
                    if (btnCopySecret) btnCopySecret.classList.remove('hidden');

                    // Hide "Show" button — not needed for sandbox
                    var btnShow = document.getElementById('btnShowSecret');
                    if (btnShow) btnShow.classList.add('hidden');

                    document.getElementById('credSecretMessage').textContent =
                        'Sandbox environment: Secret key is visible for testing purposes.';
                } else {
                    document.getElementById('credSecretMessage').textContent =
                        'Secret key is hidden for security. Only shown when newly generated.';
                }
            }
        })
        .catch(function () { showAlert('Failed to load credentials', 'error'); });
}

function handleResetSecret() {
    if (!currentUser) return;

    // Sandbox customers cannot reset secret key
    if (currentUser.environment === 'sandbox') {
        showAlert('Sandbox customers cannot reset secret keys. Please contact admin.', 'error');
        return;
    }

    if (!confirm('The old secret key will be invalidated immediately. Are you sure?')) return;

    var btn = document.getElementById('btnResetSecret');
    btn.disabled = true;
    btn.textContent = 'Processing...';

    // First get credential info to find the credential ID
    fetch(API + '/admin/customers/' + currentUser.id + '/credentials')
        .then(function (r) { return r.json(); })
        .then(function (credData) {
            if (!credData.success || !credData.data) {
                throw new Error('No credentials found');
            }
            // We need the credential ID — fetch the full customer to get it
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
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ credentialId: activeCred.id })
            });
        })
        .then(function (r) { return r.json(); })
        .then(function (data) {
            if (data.success && data.data) {
                document.getElementById('newSecretValue').value = data.data.client_secret;
                document.getElementById('newSecretBox').classList.remove('hidden');
                document.getElementById('credClientId').value = data.data.client_id;
                showAlert('Secret key has been reset! Save it now.', 'success');
            } else {
                throw new Error(data.message || 'Failed to reset');
            }
        })
        .catch(function (err) { showAlert('Error: ' + err.message, 'error'); })
        .finally(function () {
            btn.disabled = false;
            btn.textContent = 'Reset Secret Key';
        });
}

// ════════════════════════════════════════════
// CLIENT: CHANGE PASSWORD
// ════════════════════════════════════════════
function handleChangePassword() {
    if (!currentUser) return;

    var current = val('changePwCurrent');
    var newPw = val('changePwNew');
    var confirm = val('changePwConfirm');

    if (!current) {
        showAlert('Please enter your current password', 'error');
        return;
    }
    if (!newPw || newPw.length < 6) {
        showAlert('New password must be at least 6 characters', 'error');
        return;
    }
    if (newPw !== confirm) {
        showAlert('New password and confirmation do not match', 'error');
        return;
    }

    var btn = document.getElementById('btnChangePassword');
    btn.disabled = true;
    btn.textContent = 'Changing...';

    fetch(API + '/admin/customers/' + currentUser.id + '/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ current_password: current, new_password: newPw })
    })
    .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, data: d }; }); })
    .then(function (res) {
        if (res.ok) {
            showAlert('Password changed successfully!', 'success');
            document.getElementById('changePwCurrent').value = '';
            document.getElementById('changePwNew').value = '';
            document.getElementById('changePwConfirm').value = '';
        } else {
            showAlert(res.data.message || 'Failed to change password', 'error');
        }
    })
    .catch(function () { showAlert('Server connection error', 'error'); })
    .finally(function () {
        btn.disabled = false;
        btn.textContent = 'Change Password';
    });
}

// ════════════════════════════════════════════
// CLIENT: WEBHOOKS
// ════════════════════════════════════════════
function loadWebhooks() {
    if (!currentUser || currentUser.role !== 'customer') return;
    var container = document.getElementById('webhooksContainer');
    container.innerHTML = '<div class="loading show">Loading...</div>';

    fetch(API + '/admin/customers/' + currentUser.id + '/webhooks')
        .then(function (r) { return r.json(); })
        .then(function (data) {
            if (data.success) {
                renderWebhooks(data.data || []);
            }
        })
        .catch(function () {
            container.innerHTML = '<div style="padding:20px;text-align:center;color:#ef4444;">Failed to load webhooks</div>';
        });
}

function renderWebhooks(webhooks) {
    var container = document.getElementById('webhooksContainer');

    if (webhooks.length === 0) {
        container.innerHTML = '<div style="padding:40px;text-align:center;color:#64748b;">No webhooks registered yet</div>';
        return;
    }

    var html = '<div class="table-container"><table class="data-table"><thead><tr>' +
        '<th>URL</th><th>Events</th><th>Status</th><th>Fails</th><th>Actions</th>' +
        '</tr></thead><tbody>';

    // Store webhooks data for event picker
    _portalWebhooks = webhooks;

    for (var i = 0; i < webhooks.length; i++) {
        var wh = webhooks[i];
        var evArr = Array.isArray(wh.events) ? wh.events : (typeof wh.events === 'string' ? wh.events.split(',') : []);
        var eventsStr = evArr.join(', ');
        var badge = wh.status === 'active'
            ? '<span class="badge badge-success">Active</span>'
            : '<span class="badge badge-danger">Inactive</span>';

        html += '<tr>' +
            '<td class="mono" style="font-size:13px;max-width:300px;overflow:hidden;text-overflow:ellipsis;">' + esc(wh.url) + '</td>' +
            '<td style="font-size:12px;">' + esc(eventsStr) + '</td>' +
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

    // Attach test handlers — open event picker
    var testBtns = container.querySelectorAll('.test-wh-btn');
    for (var t = 0; t < testBtns.length; t++) {
        (function (btn) {
            btn.addEventListener('click', function () {
                showTestEventPicker(btn);
            });
        })(testBtns[t]);
    }

    // Attach delete handlers
    var btns = container.querySelectorAll('.del-wh-btn');
    for (var j = 0; j < btns.length; j++) {
        btns[j].addEventListener('click', function () {
            var whId = parseInt(this.getAttribute('data-wh-id'), 10);
            if (whId) deleteWebhook(whId);
        });
    }
}

var _portalWebhooks = [];

function showTestEventPicker(btn) {
    var webhookId = btn.getAttribute('data-wh-id');
    var webhook = null;
    for (var i = 0; i < _portalWebhooks.length; i++) {
        if (String(_portalWebhooks[i].id) === String(webhookId)) {
            webhook = _portalWebhooks[i];
            break;
        }
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
        '<div style="margin-bottom:12px;color:#64748b;font-size:14px;">' +
            'Chọn event để gửi test webhook tới:<br>' +
            '<code style="font-size:12px;color:#2563eb;">' + esc(webhook.url) + '</code>' +
        '</div>' +
        '<div style="display:flex;flex-wrap:wrap;gap:8px;">' + eventBtns + '</div>';

    var modal = document.getElementById('testEventPickerModal');
    modal.dataset.whId = webhookId;
    modal.classList.add('show');

    // Attach pick handlers
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

    var url = val('webhookUrl');
    var secret = val('webhookSecret');

    // Gather checked events
    var checkboxes = document.querySelectorAll('input[name="webhookEvents"]:checked');
    var events = [];
    for (var i = 0; i < checkboxes.length; i++) {
        events.push(checkboxes[i].value);
    }

    if (events.length === 0) {
        showAlert('Please select at least one event', 'error');
        return;
    }

    fetch(API + '/admin/customers/' + currentUser.id + '/webhooks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: url, secret: secret, events: events })
    })
    .then(function (r) { return r.json(); })
    .then(function (data) {
        if (data.success) {
            showAlert('Webhook added successfully', 'success');
            document.getElementById('webhookModal').classList.remove('show');
            document.getElementById('webhookForm').reset();
            loadWebhooks();
        } else {
            showAlert(data.message || 'Failed to add webhook', 'error');
        }
    })
    .catch(function () { showAlert('Server error', 'error'); });
}

function testWebhook(webhookId, event) {
    if (!currentUser) return;

    // Disable button while sending
    var testBtn = document.querySelector('.test-wh-btn[data-wh-id="' + webhookId + '"]');
    if (testBtn) { testBtn.disabled = true; testBtn.textContent = 'Sending...'; }

    fetch(API + '/admin/customers/' + currentUser.id + '/webhooks/' + webhookId + '/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event: event })
    })
    .then(function (r) { return r.json(); })
    .then(function (data) {
        if (!data.success) throw new Error(data.message || 'Request failed');
        if (data.data && data.data.success) {
            showAlert('Test [' + event + '] sent! HTTP ' + data.data.httpStatus, 'success');
        } else {
            showAlert('Test [' + event + '] failed: ' + (data.data && data.data.error ? data.data.error : 'Unknown error'), 'error');
        }
    })
    .catch(function (e) { showAlert(e.message || 'Server error', 'error'); })
    .finally(function () {
        if (testBtn) { testBtn.disabled = false; testBtn.textContent = 'Test'; }
    });
}

function deleteWebhook(whId) {
    if (!confirm('Delete this webhook?')) return;
    if (!currentUser) return;

    fetch(API + '/admin/customers/' + currentUser.id + '/webhooks/' + whId, {
        method: 'DELETE'
    })
    .then(function (r) { return r.json(); })
    .then(function (data) {
        if (data.success) {
            showAlert('Webhook deleted', 'success');
            loadWebhooks();
        } else {
            showAlert(data.message || 'Failed to delete', 'error');
        }
    })
    .catch(function () { showAlert('Server error', 'error'); });
}

// ════════════════════════════════════════════
// UTILITIES
// ════════════════════════════════════════════
function showAlert(msg, type) {
    var container = document.getElementById('alertContainer');
    if (!container) return;
    var div = document.createElement('div');
    div.className = 'alert alert-' + (type || 'success') + ' show';
    div.textContent = msg;
    container.appendChild(div);
    setTimeout(function () {
        div.classList.remove('show');
        setTimeout(function () { div.remove(); }, 300);
    }, 5000);
}

function esc(text) {
    if (!text) return '';
    var map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
    return String(text).replace(/[&<>"']/g, function (m) { return map[m]; });
}

function fmtDate(str) {
    var d = new Date(str);
    return d.toLocaleDateString('vi-VN', { year: 'numeric', month: '2-digit', day: '2-digit' });
}

function statusBadge(s) {
    return s === 'active' ? 'success' : s === 'suspended' ? 'warning' : 'danger';
}

function formatTelegramTags(str) {
    if (!str) return '<span style="color:var(--text-secondary);font-size:12px;">—</span>';
    var tags = str.split(',').map(function (t) { return t.trim(); }).filter(Boolean);
    return tags.map(function (tag) {
        return '<span style="display:inline-block;background:#e0f2fe;color:#0369a1;padding:1px 6px;border-radius:4px;font-size:11px;margin:1px 2px;">' + esc(tag) + '</span>';
    }).join('');
}

function formatTelegramGroups(str) {
    if (!str) return '<span style="color:var(--text-secondary);font-size:12px;">—</span>';
    var groups = str.split(',').map(function (g) { return g.trim(); }).filter(Boolean);
    return '<span style="color:var(--text-secondary);font-size:11px;">' + groups.length + ' group' + (groups.length > 1 ? 's' : '') + '</span>';
}

function setText(id, v) {
    var el = document.getElementById(id);
    if (el) el.textContent = v;
}

function val(id) {
    var el = document.getElementById(id);
    return el ? el.value : '';
}

function copyField(id) {
    var input = document.getElementById(id);
    if (!input || !input.value) return;
    if (navigator.clipboard) {
        navigator.clipboard.writeText(input.value).then(function () {
            showAlert('Copied to clipboard!', 'success');
        });
    } else {
        input.select();
        document.execCommand('copy');
        showAlert('Copied to clipboard!', 'success');
    }
}

function updateClock() {
    var el = document.getElementById('lastUpdate');
    if (el) {
        el.textContent = new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
    }
}
