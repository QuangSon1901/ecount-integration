/**
 * js/sections/customers.js
 * Admin — Customer management (list + create).
 * Exposes: window.Customers
 * Depends on: dashboard.core.js (API, currentUser, showAlert, esc, etc.)
 */

(function (global) {
    'use strict';

    // ─── Race-condition guard: token increments on each fetch,
    //     so stale responses from parallel calls are silently ignored.
    var _fetchToken = 0;

    // ════════════════════════════════════════
    // HTML TEMPLATES
    // ════════════════════════════════════════
    var CUSTOMER_LIST_HTML = [
        '<div class="content-card">',
        '  <div class="card-header">',
        '    <div>',
        '      <h2 class="card-title">API Customers</h2>',
        '      <p class="card-subtitle">All registered API customers</p>',
        '    </div>',
        '    <div class="card-actions">',
        '      <button class="btn" id="btnReloadCustomers">Reload</button>',
        '      <button class="btn btn-primary" id="btnGoCreateCustomer">+ Create</button>',
        '    </div>',
        '  </div>',
        '  <div id="loadingCustomers" class="loading">Loading...</div>',
        '  <div class="table-container">',
        '    <table class="data-table">',
        '      <thead>',
        '        <tr>',
        '          <th>ID</th><th>Code</th><th>Name</th><th>Environment</th>',
        '          <th>Status</th><th>TG Phụ trách</th><th>TG Groups</th>',
        '          <th>Lark Groups</th><th>Created</th><th>Actions</th>',
        '        </tr>',
        '      </thead>',
        '      <tbody id="customersTableBody"></tbody>',
        '    </table>',
        '  </div>',
        '</div>'
    ].join('\n');

    var CREATE_CUSTOMER_HTML = [
        '<div class="content-card">',
        '  <div class="card-header">',
        '    <div>',
        '      <h2 class="card-title">Create API Customer</h2>',
        '      <p class="card-subtitle">Create a new customer with portal access</p>',
        '    </div>',
        '  </div>',
        '  <form id="createCustomerForm">',
        '    <div class="form-grid">',
        '      <div class="form-group">',
        '        <label class="form-label required">Customer Code</label>',
        '        <input type="text" class="form-input" id="formCustomerCode" required placeholder="CUS0001">',
        '      </div>',
        '      <div class="form-group">',
        '        <label class="form-label required">Customer Name</label>',
        '        <input type="text" class="form-input" id="formCustomerName" required placeholder="Company ABC">',
        '      </div>',
        '      <div class="form-group">',
        '        <label class="form-label">Email</label>',
        '        <input type="email" class="form-input" id="formEmail" placeholder="contact@example.com">',
        '      </div>',
        '      <div class="form-group">',
        '        <label class="form-label">Phone</label>',
        '        <input type="tel" class="form-input" id="formPhone" placeholder="+84 xxx xxx xxx">',
        '      </div>',
        '      <div class="form-group">',
        '        <label class="form-label required">Environment</label>',
        '        <select class="form-select" id="formEnvironment">',
        '          <option value="production">Production</option>',
        '          <option value="sandbox">Sandbox</option>',
        '        </select>',
        '      </div>',
        '      <div class="form-group">',
        '        <label class="form-label">Rate Limit (Hourly)</label>',
        '        <input type="number" class="form-input" id="formRateLimitHourly" value="6000">',
        '      </div>',
        '      <div class="form-group">',
        '        <label class="form-label">Rate Limit (Daily)</label>',
        '        <input type="number" class="form-input" id="formRateLimitDaily" value="10000">',
        '      </div>',
        '    </div>',
        '    <div style="margin-bottom:24px;">',
        '      <label class="form-label" style="margin-bottom:12px;">Features</label>',
        '      <div style="display:flex;gap:24px;flex-wrap:wrap;">',
        '        <label style="display:flex;align-items:center;gap:8px;font-size:14px;cursor:pointer;">',
        '          <input type="checkbox" id="formWebhookEnabled" style="accent-color:var(--primary);width:16px;height:16px;">',
        '          Webhook Enabled',
        '        </label>',
        '        <label style="display:flex;align-items:center;gap:8px;font-size:14px;cursor:pointer;">',
        '          <input type="checkbox" id="formBulkOrderEnabled" style="accent-color:var(--primary);width:16px;height:16px;">',
        '          Bulk Order Enabled',
        '        </label>',
        '      </div>',
        '    </div>',
        '    <div style="border-top:1px solid var(--border);margin-bottom:24px;padding-top:20px;">',
        '      <label class="form-label" style="margin-bottom:4px;font-weight:600;">OMS Integration</label>',
        '      <p style="font-size:12px;color:var(--text-secondary);margin-bottom:16px;">OAuth2 client credentials cho hệ thống OMS của khách hàng. Có thể bỏ trống và cấu hình sau ở trang chi tiết.</p>',
        '      <div class="form-grid">',
        '        <div class="form-group">',
        '          <label class="form-label">OMS Realm</label>',
        '          <input type="text" class="form-input" id="formOmsRealm" placeholder="vd: customer-realm">',
        '        </div>',
        '        <div class="form-group">',
        '          <label class="form-label">OMS Client ID</label>',
        '          <input type="text" class="form-input" id="formOmsClientId" placeholder="OAuth client_id">',
        '        </div>',
        '        <div class="form-group">',
        '          <label class="form-label">OMS Client Secret</label>',
        '          <input type="password" class="form-input" id="formOmsClientSecret" placeholder="OAuth client_secret" autocomplete="new-password">',
        '        </div>',
        '        <div class="form-group">',
        '          <label class="form-label">OMS URL Auth</label>',
        '          <input type="url" class="form-input" id="formOmsUrlAuth" placeholder="https://oms.example.com/oauth/token">',
        '        </div>',
        '        <div class="form-group">',
        '          <label class="form-label">OMS URL API</label>',
        '          <input type="url" class="form-input" id="formOmsUrlApi" placeholder="https://oms.example.com/api">',
        '        </div>',
        '        <div class="form-group">',
        '          <label class="form-label">Shipping Markup (%)</label>',
        '          <input type="number" class="form-input" id="formShippingMarkupPercent" min="0" max="100" step="0.01" value="0" placeholder="0.00">',
        '        </div>',
        '      </div>',
        '    </div>',
        '    <button type="submit" class="btn btn-primary">+ Create Customer</button>',
        '  </form>',
        '  <div id="createSuccessResult" class="hidden" style="margin-top:20px;padding:20px;background:var(--success-light);border:1px solid #a7f3d0;border-radius:8px;">',
        '    <div style="font-size:14px;font-weight:600;color:#065f46;margin-bottom:12px;">Customer created successfully!</div>',
        '    <div style="display:flex;flex-direction:column;gap:8px;font-size:13px;color:#065f46;">',
        '      <div>Customer Code: <strong id="resultCustomerCode"></strong></div>',
        '      <div style="background:white;border:1px solid #a7f3d0;border-radius:6px;padding:12px;margin-top:4px;">',
        '        <div style="font-size:12px;font-weight:600;color:#92400e;margin-bottom:6px;">Portal Password (copy now — shown only once)</div>',
        '        <div style="display:flex;align-items:center;gap:8px;">',
        '          <code id="resultPortalPassword" style="font-family:\'Courier New\',monospace;font-size:15px;font-weight:700;letter-spacing:1px;flex:1;word-break:break-all;"></code>',
        '          <button class="btn btn-sm" id="btnCopyPortalPw" type="button">Copy</button>',
        '        </div>',
        '      </div>',
        '      <p style="font-size:12px;color:var(--text-secondary);margin-top:4px;">API Credentials can be generated from the customer detail page.</p>',
        '    </div>',
        '    <a id="resultViewLink" href="#" class="btn btn-sm btn-primary" style="margin-top:12px;">View Customer</a>',
        '  </div>',
        '</div>'
    ].join('\n');

    // ════════════════════════════════════════
    // INIT
    // ════════════════════════════════════════
    function init() {
        _mountCustomerList();
        _mountCreateCustomer();
    }

    function _mountCustomerList() {
        var mount = document.getElementById('section-admin-customers-mount');
        if (!mount) return;
        mount.innerHTML = CUSTOMER_LIST_HTML;
        addClick('btnReloadCustomers', function () { loadCustomers(); });
        addClick('btnGoCreateCustomer', function () { navigateToSection('admin-create-customer'); });
    }

    function _mountCreateCustomer() {
        var mount = document.getElementById('section-admin-create-customer-mount');
        if (!mount) return;
        mount.innerHTML = CREATE_CUSTOMER_HTML;

        var form = document.getElementById('createCustomerForm');
        if (form) form.addEventListener('submit', handleCreateCustomer);

        addClick('btnCopyPortalPw', function () {
            var pw = document.getElementById('resultPortalPassword');
            if (pw && pw.textContent) copyText(pw.textContent, 'Portal password copied!');
        });
    }

    // ════════════════════════════════════════
    // LOAD CUSTOMERS
    // ════════════════════════════════════════
    function loadCustomers() {
        var loading = document.getElementById('loadingCustomers');
        var tbody   = document.getElementById('customersTableBody');
        if (!tbody) return;

        if (loading) loading.classList.add('show');
        var token = ++_fetchToken;

        fetch(API + '/admin/customers')
            .then(function (r) { return r.json(); })
            .then(function (result) {
                if (token !== _fetchToken) return;
                if (result.success) {
                    var customers = result.data.customers;
                    updateStats(customers);
                    tbody.innerHTML = '';
                    if (customers.length === 0) {
                        tbody.innerHTML = '<tr><td colspan="10" style="text-align:center;padding:40px;color:var(--text-secondary);">No customers yet</td></tr>';
                    } else {
                        renderCustomerRows(customers, tbody);
                    }
                } else {
                    showAlert(result.message || 'Failed to load customers', 'error');
                }
            })
            .catch(function () {
                if (token !== _fetchToken) return;
                showAlert('Server connection error', 'error');
            })
            .finally(function () {
                if (token !== _fetchToken) return;
                if (loading) loading.classList.remove('show');
            });
    }

    function renderCustomerRows(customers, tbody) {
        for (var i = 0; i < customers.length; i++) {
            var c  = customers[i];
            var tr = document.createElement('tr');
            tr.innerHTML =
                '<td>' + c.id + '</td>' +
                '<td><strong>' + esc(c.customer_code) + '</strong></td>' +
                '<td>' + esc(c.customer_name) + '</td>' +
                '<td><span class="badge badge-' + (c.environment === 'production' ? 'success' : 'warning') + '">' + c.environment + '</span></td>' +
                '<td><span class="badge badge-' + statusBadge(c.status) + '">' + c.status + '</span></td>' +
                '<td>' + formatTelegramTags(c.telegram_responsibles) + '</td>' +
                '<td>' + formatTelegramGroups(c.telegram_group_ids) + '</td>' +
                '<td>' + formatLarkGroups(c.lark_group_ids) + '</td>' +
                '<td>' + fmtDate(c.created_at) + '</td>' +
                '<td><button class="btn btn-sm view-btn" data-id="' + c.id + '">View</button></td>';
            tbody.appendChild(tr);
        }

        var btns = tbody.querySelectorAll('.view-btn');
        for (var j = 0; j < btns.length; j++) {
            btns[j].addEventListener('click', function () {
                var id = this.getAttribute('data-id');
                if (id) window.location.href = '/extensions/customer/' + id;
            });
        }
    }

    function updateStats(customers) {
        var total  = customers.length;
        var active = 0;
        for (var i = 0; i < customers.length; i++) {
            if (customers[i].status === 'active') active++;
        }
        setText('navCustomerCount',   total);
        setText('statsCustomerCount', total);
        setText('statsActiveCount',   active + ' Active');
    }

    // ════════════════════════════════════════
    // CREATE CUSTOMER
    // ════════════════════════════════════════
    function handleCreateCustomer(e) {
        e.preventDefault();

        var omsRealm        = val('formOmsRealm').trim();
        var omsClientId     = val('formOmsClientId').trim();
        var omsClientSecret = val('formOmsClientSecret');
        var omsUrlAuth      = val('formOmsUrlAuth').trim();
        var omsUrlApi       = val('formOmsUrlApi').trim();
        var markupRaw       = val('formShippingMarkupPercent').trim();

        var urlRe = /^https?:\/\/\S+$/i;
        if (omsUrlAuth && !urlRe.test(omsUrlAuth)) {
            showAlert('OMS URL Auth must be a valid http/https URL', 'error'); return;
        }
        if (omsUrlApi && !urlRe.test(omsUrlApi)) {
            showAlert('OMS URL API must be a valid http/https URL', 'error'); return;
        }

        var markupVal;
        if (markupRaw !== '') {
            markupVal = Number(markupRaw);
            if (!isFinite(markupVal) || markupVal < 0 || markupVal > 100) {
                showAlert('Shipping markup must be a number between 0 and 100', 'error'); return;
            }
        }

        var data = {
            customer_code:       val('formCustomerCode'),
            customer_name:       val('formCustomerName'),
            email:               val('formEmail')   || undefined,
            phone:               val('formPhone')   || undefined,
            environment:         val('formEnvironment'),
            rate_limit_per_hour: parseInt(val('formRateLimitHourly')),
            rate_limit_per_day:  parseInt(val('formRateLimitDaily')),
            webhook_enabled:     document.getElementById('formWebhookEnabled').checked,
            bulk_order_enabled:  document.getElementById('formBulkOrderEnabled').checked,
            oms_realm:           omsRealm        || undefined,
            oms_client_id:       omsClientId     || undefined,
            oms_client_secret:   omsClientSecret || undefined,
            oms_url_auth:        omsUrlAuth      || undefined,
            oms_url_api:         omsUrlApi       || undefined
        };
        if (markupVal !== undefined) data.shipping_markup_percent = markupVal;

        fetch(API + '/admin/customers', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify(data)
        })
        .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, data: d }; }); })
        .then(function (res) {
            if (res.ok) {
                showAlert('Customer created successfully!', 'success');
                displayCreateSuccess(res.data.data);
                document.getElementById('createCustomerForm').reset();
            } else {
                showAlert(res.data.message || 'Error creating customer', 'error');
            }
        })
        .catch(function () { showAlert('Server connection error', 'error'); });
    }

    function displayCreateSuccess(data) {
        setText('resultCustomerCode',   data.customer_code);
        setText('resultPortalPassword', data.portal_password || '');
        var link = document.getElementById('resultViewLink');
        if (link) link.href = '/extensions/customer/' + data.customer_id;
        document.getElementById('createSuccessResult').classList.remove('hidden');
    }

    // ════════════════════════════════════════
    // PUBLIC API
    // ════════════════════════════════════════
    global.Customers = {
        init:          init,
        loadCustomers: loadCustomers
    };

})(window);