/**
 * js/sections/oms-orders.js
 * Admin — OMS Orders section (list, filters, pagination, bulk actions).
 * Exposes: window.OmsOrders
 * Depends on: dashboard.core.js
 *
 * Changes vs previous version:
 *  - Status filter: select → tab bar (All + mỗi status + số lượng đếm từ API)
 *  - Search input: tìm theo order_number, oms_order_id, oms_order_number
 *  - Search debounce 400ms, reset page về 0 khi search/đổi tab
 */

(function (global) {
    'use strict';

    var OMS_PAGE_SIZE   = 100;
    var omsPage         = 0;
    var omsLastRows     = [];
    var _searchTimer    = null;  // debounce handle

    // Định nghĩa các tab status — thứ tự hiển thị
    var STATUS_TABS = [
        { value: '',                 label: 'All' },
        { value: 'pending',          label: 'Pending' },
        { value: 'selected',         label: 'Selected' },
        { value: 'label_purchasing', label: 'Purchasing' },
        { value: 'label_purchased',  label: 'Purchased' },
        { value: 'oms_updated',      label: 'OMS Updated' },
        { value: 'shipped',          label: 'Shipped' },
        { value: 'delivered',        label: 'Delivered' },
        { value: 'cancelled',        label: 'Cancelled' },
        { value: 'failed',           label: 'Failed' },
        { value: 'error',            label: 'Error' }
    ];

    // ════════════════════════════════════════
    // HTML TEMPLATE
    // ════════════════════════════════════════
    var OMS_HTML = [
        '<div class="content-card">',
        '  <div class="card-header">',
        '    <div>',
        '      <h2 class="card-title">OMS Orders</h2>',
        '      <p class="card-subtitle">Outbound request management — pull from customer OMS, buy ITC labels, push tracking back</p>',
        '    </div>',
        '  </div>',

        '  <!-- Filter bar -->',
        '  <div class="card-header oms-filter-bar">',
        '    <div class="filter-group">',
        '      <span class="filter-label">Customer</span>',
        '      <select class="form-select" id="filterCustomer">',
        '        <option value="">All</option>',
        '      </select>',
        '    </div>',
        '    <div class="filter-group oms-search-group">',
        '      <span class="filter-label">Search</span>',
        '      <div class="oms-search-wrap">',
        '        <input type="text" class="form-input" id="omsSearch"',
        '               placeholder="Order #, OMS ID, OMS order number…"',
        '               autocomplete="off" spellcheck="false">',
        '        <button class="oms-search-clear" id="omsSearchClear" title="Clear search" style="display:none;">&#x2715;</button>',
        '      </div>',
        '    </div>',
        '    <button class="btn btn-sm" id="refreshBtn">&#x21BB; Refresh</button>',
        '  </div>',

        '  <!-- Status tabs -->',
        '  <div class="oms-status-tabs" id="omsStatusTabs">',
        '    <!-- tabs rendered by JS -->',
        '  </div>',

        '  <!-- Bulk action bar -->',
        '  <div id="bulkBar" class="bulk-bar">',
        '    <span class="bulk-bar-count"><span id="selCount">0</span> orders selected</span>',
        '    <span class="bulk-bar-sep"></span>',
        '    <button class="btn btn-success btn-sm" id="bulkCreateLabelBtn" title="Tạo label cho các đơn đã chọn (chỉ áp dụng đơn đủ điều kiện)">&#x1F3F7; Tạo label</button>',
        '    <button class="btn btn-primary btn-sm" id="bulkDownloadLabelBtn" title="Tải label dạng PDF gộp (chỉ đơn có tracking + label)">&#x2B07; Tải xuống label</button>',
        '  </div>',

        '  <!-- Orders table -->',
        '  <div class="table-container">',
        '    <table class="data-table">',
        '      <thead>',
        '        <tr>',
        '          <th><input type="checkbox" id="selectAll" title="Select all"></th>',
        '          <th>Order #</th>',
        '          <th style="min-width:150px;">Customer</th>',
        '          <th style="min-width:200px;">OMS Order</th>',
        '          <th style="min-width:150px;">Status</th>',
        '          <th>Tracking</th>',
        '          <th style="min-width:150px;">Receiver</th>',
        '          <th style="min-width:150px;">Cost / Sell / Profit</th>',
        '          <th>Created</th>',
        '          <th>Actions</th>',
        '        </tr>',
        '      </thead>',
        '      <tbody id="orderRows"></tbody>',
        '    </table>',
        '  </div>',

        '  <!-- Empty state -->',
        '  <div id="emptyState" class="empty-state" style="display:none;">',
        '    <div class="empty-icon">&#x1F69A;</div>',
        '    <div class="empty-title">No OMS orders found</div>',
        '    <p>No orders match the current filters.</p>',
        '  </div>',

        '  <!-- Pagination -->',
        '  <div class="pagination">',
        '    <span class="pagination-info" id="paginationInfo">—</span>',
        '    <div class="pagination-controls" id="omsPagination"></div>',
        '  </div>',
        '</div>'
    ].join('\n');

    // ════════════════════════════════════════
    // INIT
    // ════════════════════════════════════════
    function init() {
        var mount = document.getElementById('section-admin-oms-orders-mount');
        if (!mount) return;
        mount.innerHTML = OMS_HTML;

        _renderStatusTabs('');
        _bindEventListeners();
        _loadCustomersDropdown();
    }

    // ── Render tab bar ────────────────────────────────────────────────────────
    function _renderStatusTabs(activeValue, counts) {
        counts = counts || {};
        var container = document.getElementById('omsStatusTabs');
        if (!container) return;

        container.innerHTML = STATUS_TABS.map(function (tab) {
            var isActive = tab.value === activeValue;
            var cnt      = counts[tab.value];
            var badge    = (cnt !== undefined && cnt !== null)
                ? '<span class="oms-tab-badge">' + cnt + '</span>'
                : '';
            return '<button class="oms-tab-btn' + (isActive ? ' active' : '') + '"' +
                   ' data-status="' + tab.value + '">' +
                   esc(tab.label) + badge +
                   '</button>';
        }).join('');

        // bind click
        container.querySelectorAll('.oms-tab-btn').forEach(function (btn) {
            btn.addEventListener('click', function () {
                var status = this.getAttribute('data-status');
                _setActiveTab(status);
                omsPage = 0;
                setUrlParams({ status: status || null }, { replace: true });
                loadOmsOrders();
            });
        });
    }

    function _setActiveTab(value) {
        var container = document.getElementById('omsStatusTabs');
        if (!container) return;
        container.querySelectorAll('.oms-tab-btn').forEach(function (btn) {
            btn.classList.toggle('active', btn.getAttribute('data-status') === value);
        });
    }

    function _getActiveTabValue() {
        var container = document.getElementById('omsStatusTabs');
        if (!container) return '';
        var active = container.querySelector('.oms-tab-btn.active');
        return active ? active.getAttribute('data-status') : '';
    }

    // ── Bind events ───────────────────────────────────────────────────────────
    function _bindEventListeners() {
        addChange('filterCustomer', function () {
            omsPage = 0;
            setUrlParams({ page: null }, { replace: true });
            loadOmsOrders();
        });

        addClick('refreshBtn', function () { loadOmsOrders(); });

        // Search — debounce 400ms
        var searchEl = document.getElementById('omsSearch');
        var clearBtn = document.getElementById('omsSearchClear');

        if (searchEl) {
            searchEl.addEventListener('input', function () {
                var hasVal = searchEl.value.trim().length > 0;
                if (clearBtn) clearBtn.style.display = hasVal ? 'flex' : 'none';
                clearTimeout(_searchTimer);
                _searchTimer = setTimeout(function () {
                    omsPage = 0;
                    setUrlParams({ page: null, q: searchEl.value.trim() || null }, { replace: true });
                    loadOmsOrders();
                }, 400);
            });
        }

        if (clearBtn) {
            clearBtn.addEventListener('click', function () {
                if (searchEl) { searchEl.value = ''; }
                clearBtn.style.display = 'none';
                clearTimeout(_searchTimer);
                omsPage = 0;
                setUrlParams({ page: null, q: null }, { replace: true });
                loadOmsOrders();
            });
        }

        addClick('bulkCreateLabelBtn',   bulkCreateLabels);
        addClick('bulkDownloadLabelBtn', bulkDownloadLabels);

        var selectAll = document.getElementById('selectAll');
        if (selectAll) {
            selectAll.addEventListener('change', function (e) {
                document.querySelectorAll('.rowSel').forEach(function (cb) {
                    cb.checked = e.target.checked;
                });
                updateSelCount();
            });
        }
    }

    function _loadCustomersDropdown() {
        fetch(API + '/admin/customers?limit=200')
            .then(function (r) { return r.json(); })
            .then(function (r) {
                var sel = document.getElementById('filterCustomer');
                if (!sel) return;
                var customers = (r.data && r.data.customers) || [];
                customers.forEach(function (c) {
                    var opt = document.createElement('option');
                    opt.value = c.id;
                    opt.textContent = c.customer_code + ' — ' + c.customer_name;
                    sel.appendChild(opt);
                });
            })
            .catch(function (e) { console.warn('OMS customer dropdown failed', e); });
    }

    // ════════════════════════════════════════
    // URL HELPERS
    // ════════════════════════════════════════
    function readOmsPageFromUrl() {
        var p = parseHash().params.get('page');
        var n = parseInt(p, 10);
        if (!Number.isFinite(n) || n < 1) return 0;
        return n - 1; // URL is 1-indexed; omsPage is 0-indexed
    }

    function _readStatusFromUrl() {
        return parseHash().params.get('status') || '';
    }

    function _readSearchFromUrl() {
        return parseHash().params.get('q') || '';
    }

    // ════════════════════════════════════════
    // LOAD ORDERS
    // ════════════════════════════════════════
    function loadOmsOrders() {
        var customer = val('filterCustomer');
        var status   = _getActiveTabValue();
        var search   = (document.getElementById('omsSearch') || {}).value;
        search = (search || '').trim();

        var params = new URLSearchParams({ limit: OMS_PAGE_SIZE, offset: omsPage * OMS_PAGE_SIZE });
        if (customer) params.set('customer_id', customer);
        if (status)   params.set('internal_status', status);
        if (search)   params.set('q', search);

        var paginationInfo = document.getElementById('paginationInfo');
        if (paginationInfo) paginationInfo.textContent = 'Loading...';

        fetch(API + '/admin/oms-orders?' + params.toString(), { credentials: 'include' })
            .then(function (r) {
                if (r.status === 401) { location.href = '/login'; return null; }
                return r.json();
            })
            .then(function (r) {
                if (!r) return;
                var data = r.data || {};
                omsLastRows = data.orders || [];
                renderOmsRows(omsLastRows);

                // Cập nhật badge đếm trên tab bar
                if (data.statusCounts) {
                    _updateTabBadges(data.statusCounts, status);
                }

                var total      = Number.isFinite(data.total) ? data.total : omsLastRows.length;
                var totalPages = Math.max(1, Math.ceil(total / OMS_PAGE_SIZE));

                // Clamp omsPage nếu filter thu hẹp
                if (omsPage >= totalPages) {
                    omsPage = totalPages - 1;
                    setUrlParams({ page: omsPage > 0 ? omsPage + 1 : null }, { replace: true });
                }

                var startIdx = total === 0 ? 0 : omsPage * OMS_PAGE_SIZE + 1;
                var endIdx   = omsPage * OMS_PAGE_SIZE + omsLastRows.length;
                if (paginationInfo) {
                    paginationInfo.textContent = total === 0
                        ? '0 orders'
                        : startIdx + '–' + endIdx + ' / ' + total + ' orders';
                }

                renderOmsPagination(omsPage, totalPages);

                var emptyState = document.getElementById('emptyState');
                if (emptyState) emptyState.style.display = omsLastRows.length ? 'none' : 'block';
            })
            .catch(function (e) { showAlert('Failed to load orders: ' + e.message, 'error'); });
    }

    // Cập nhật badge số lượng trên mỗi tab (chỉ khi không đang filter theo status cụ thể,
    // hoặc server trả về statusCounts)
    function _updateTabBadges(counts, activeStatus) {
        var container = document.getElementById('omsStatusTabs');
        if (!container) return;
        container.querySelectorAll('.oms-tab-btn').forEach(function (btn) {
            var tabStatus = btn.getAttribute('data-status');
            var cnt;
            if (tabStatus === '') {
                // Tab "All" — hiện tổng
                cnt = counts.__total__;
            } else {
                cnt = counts[tabStatus];
            }
            // Cập nhật badge (giữ label text)
            var labelText = STATUS_TABS.filter(function (t) { return t.value === tabStatus; })
                                       .map(function (t) { return t.label; })[0] || tabStatus;
            var badge = (cnt !== undefined && cnt !== null && cnt > 0)
                ? '<span class="oms-tab-badge">' + cnt + '</span>'
                : '';
            btn.innerHTML = esc(labelText) + badge;
        });
    }

    // ════════════════════════════════════════
    // RENDER
    // ════════════════════════════════════════
    function renderOmsRows(rows) {
        var tbody = document.getElementById('orderRows');
        if (!tbody) return;

        var selectAll = document.getElementById('selectAll');
        if (selectAll) selectAll.checked = false;

        if (!rows.length) {
            tbody.innerHTML = '';
            updateSelCount();
            return;
        }

        tbody.innerHTML = rows.map(function (r) {
            var totalCost = sumMoney([
                r.shipping_fee_purchase,
                r.fulfillment_fee_purchase,
                r.packaging_material_fee_cost,
            ]);
            var totalSelling = sumMoney([
                r.shipping_fee_selling,
                r.fulfillment_fee_selling,
                r.packaging_material_fee_selling,
                r.additional_fee,
            ]);
            var profitVal;
            var gp = r.gross_profit;
            if (gp !== null && gp !== undefined) {
                var gpCls = Number(gp) >= 0 ? 'money-profit' : 'money-loss';
                profitVal = '<span class="' + gpCls + '">' + fmtMoney(gp) + '</span>';
            } else {
                profitVal = '<span style="color:var(--text-secondary)">—</span>';
            }

            var statusCell = omsBadge(r.internal_status);
            if (r.error_message) {
                statusCell += '<div style="margin-top:4px;font-size:11px;color:var(--danger,#dc2626);white-space:normal;word-break:break-word;max-width:260px;" title="' + esc(r.error_message) + '">⚠ ' + esc(r.error_message) + '</div>';
            }

            var hasLabel = !!(r.tracking_number && r.label_url);
            return '<tr>' +
                '<td><input type="checkbox" class="rowSel"' +
                    ' data-id="' + r.id + '"' +
                    ' data-status="' + esc(r.internal_status || '') + '"' +
                    ' data-has-label="' + (hasLabel ? '1' : '0') + '"' +
                    ' data-label-url="' + esc(r.label_url || '') + '"' +
                    ' data-order-number="' + esc(r.order_number || '') + '"' +
                    ' data-tracking="' + esc(r.tracking_number || '') + '"></td>' +
                '<td><a class="order-link" href="/extensions/oms-orders/' + r.id + '">' + esc(r.order_number) + '</a></td>' +
                '<td>' +
                    '<div style="font-size:11px;font-weight:600;margin-top:2px;"><span class="cust-badge">#' + esc(r.customer_id) + '</span>' + esc(r.customer_code || '—') + '</div>' +
                    '<div style="font-size:11px;color:var(--text-secondary);">' + esc(r.customer_name || '') + '</div>' +
                '</td>' +
                '<td>' +
                    '<div class="mono-sm">' + esc(r.oms_order_id || '—') + '</div>' +
                    (r.oms_order_number ? '<div style="font-size:11px;color:var(--text-secondary);">' + esc(r.oms_order_number) + '</div>' : '') +
                    (r.oms_shipping_service_name ? '<div style="font-size:11px;color:var(--text-muted);margin-top:2px;">🚚 ' + esc(r.oms_shipping_service_name) + '</div>' : '') +
                '</td>' +
                '<td>' + statusCell + '</td>' +
                '<td class="mono-sm">' + (esc(r.tracking_number) || '<span style="color:var(--text-secondary)">—</span>') + '</td>' +
                '<td>' +
                    '<div class="receiver-name">' + esc(r.receiver_name || '—') + '</div>' +
                    '<div class="receiver-location">' + esc(r.receiver_country || '') + ' ' + esc(r.receiver_city || '') + '</div>' +
                '</td>' +
                '<td>' +
                    '<div class="money-cell">' +
                        '<div>Cost: <strong>' + (totalCost !== null ? fmtMoney(totalCost) : '—') + '</strong></div>' +
                        '<div>Sell: <strong>' + (totalSelling !== null ? fmtMoney(totalSelling) : '—') + '</strong></div>' +
                        '<div>Profit: ' + profitVal + '</div>' +
                    '</div>' +
                '</td>' +
                '<td class="date-sm">' + fmtDatetime(r.created_at) + '</td>' +
                '<td><a href="/extensions/oms-orders/' + r.id + '" class="btn btn-sm btn-primary">View</a></td>' +
            '</tr>';
        }).join('');

        document.querySelectorAll('.rowSel').forEach(function (cb) {
            cb.addEventListener('change', updateSelCount);
        });
        updateSelCount();
    }

    function omsBadge(status) {
        var map = {
            pending:          'badge-warning',
            selected:         'badge-info',
            label_purchasing: 'badge-info',
            label_purchased:  'badge-info',
            oms_updated:      'badge-success',
            shipped:          'badge-success',
            delivered:        'badge-success',
            cancelled:        'badge-danger',
            failed:           'badge-danger',
            error:            'badge-danger'
        };
        var cls = map[status] || 'badge-info';
        return '<span class="badge ' + cls + '">' + esc((status || '').replace(/_/g, ' ')) + '</span>';
    }

    // ════════════════════════════════════════
    // PAGINATION
    // ════════════════════════════════════════
    function renderOmsPagination(current, totalPages) {
        var container = document.getElementById('omsPagination');
        if (!container) return;
        container.innerHTML = '';

        var pages = computePageList(current, totalPages);

        container.appendChild(makePageBtn('← Prev', current - 1, current === 0));

        pages.forEach(function (p) {
            if (p === '...') {
                var dots = document.createElement('span');
                dots.className   = 'page-ellipsis';
                dots.textContent = '...';
                container.appendChild(dots);
            } else {
                container.appendChild(makePageBtn(String(p), p - 1, false, p - 1 === current));
            }
        });

        container.appendChild(makePageBtn('Next →', current + 1, current >= totalPages - 1));
    }

    function makePageBtn(label, targetPage, disabled, active) {
        var btn = document.createElement('button');
        btn.type      = 'button';
        btn.className = 'page-btn' + (active ? ' active' : '');
        btn.textContent = label;
        if (disabled) btn.disabled = true;
        if (!disabled && !active) {
            btn.addEventListener('click', function () { goToOmsPage(targetPage); });
        }
        return btn;
    }

    function computePageList(current, totalPages) {
        var cur1    = current + 1;
        var window_ = 1;
        var pages   = new Set();
        pages.add(1);
        pages.add(totalPages);
        for (var i = cur1 - window_; i <= cur1 + window_; i++) {
            if (i >= 1 && i <= totalPages) pages.add(i);
        }
        var sorted = Array.from(pages).sort(function (a, b) { return a - b; });
        var out = [];
        for (var j = 0; j < sorted.length; j++) {
            if (j > 0 && sorted[j] - sorted[j - 1] > 1) out.push('...');
            out.push(sorted[j]);
        }
        return out;
    }

    function goToOmsPage(page) {
        if (page === omsPage) return;
        omsPage = page;
        setUrlParams({ page: page > 0 ? page + 1 : null });
        loadOmsOrders();
    }

    // ════════════════════════════════════════
    // SELECTION HELPERS
    // ════════════════════════════════════════
    function updateSelCount() {
        var ids = getSelectedIds();
        setText('selCount', ids.length);
        var bulkBar = document.getElementById('bulkBar');
        if (bulkBar) bulkBar.classList.toggle('show', ids.length > 0);
    }

    function getSelectedRows() {
        return Array.from(document.querySelectorAll('.rowSel:checked')).map(function (cb) {
            return {
                id:          parseInt(cb.dataset.id),
                status:      cb.dataset.status || '',
                hasLabel:    cb.dataset.hasLabel === '1',
                labelUrl:    cb.dataset.labelUrl || '',
                orderNumber: cb.dataset.orderNumber || '',
                tracking:    cb.dataset.tracking || ''
            };
        });
    }

    function getSelectedIds() {
        return getSelectedRows().map(function (r) { return r.id; });
    }

    // ════════════════════════════════════════
    // BULK ACTIONS
    // ════════════════════════════════════════
    function bulkCreateLabels() {
        var rows = getSelectedRows();
        if (!rows.length) return;

        var CLAIMABLE = { pending: 1, selected: 1, error: 1, failed: 1 };
        var eligible  = rows.filter(function (r) { return CLAIMABLE[r.status]; });
        var skipped   = rows.length - eligible.length;

        if (!eligible.length) {
            showAlert('Không có đơn nào đủ điều kiện tạo label (cần pending/selected/error/failed).', 'error');
            return;
        }

        // Load seller profiles rồi mở modal xác nhận
        fetch(API + '/admin/system-configs/seller-profiles', { credentials: 'include' })
            .then(function (r) { return r.json(); })
            .then(function (data) {
                var profiles = (data && data.success && data.data) ? data.data : [];
                var select = document.getElementById('bulkBuySellerSelect');
                select.innerHTML = '<option value="">-- Dùng default --</option>';
                profiles.forEach(function (p) {
                    var opt = document.createElement('option');
                    opt.value = p.id;
                    opt.textContent = p.profileName + (p.isDefault ? ' (default)' : '');
                    if (p.isDefault) opt.selected = true;
                    select.appendChild(opt);
                });
                var msg = 'Đẩy ' + eligible.length + ' đơn vào queue mua label?';
                if (skipped > 0) msg += ' (' + skipped + ' đơn không đủ điều kiện sẽ bỏ qua)';
                document.getElementById('bulkBuyLabelMsg').textContent = msg;
                document.getElementById('bulkBuyLabelModal').style.display = 'flex';
            })
            .catch(function () {
                // Nếu lỗi load profiles thì vẫn mở modal với dropdown trống
                var msg = 'Đẩy ' + eligible.length + ' đơn vào queue mua label?';
                document.getElementById('bulkBuyLabelMsg').textContent = msg;
                document.getElementById('bulkBuyLabelModal').style.display = 'flex';
            });

        document.getElementById('bulkBuyLabelCancel').onclick = function () {
            document.getElementById('bulkBuyLabelModal').style.display = 'none';
        };

        document.getElementById('bulkBuyLabelConfirm').onclick = function () {
            var sellerProfileId = document.getElementById('bulkBuySellerSelect').value || null;
            document.getElementById('bulkBuyLabelModal').style.display = 'none';
            _doBulkBuyLabels(eligible, skipped, sellerProfileId);
        };
    }

    function _doBulkBuyLabels(eligible, skipped, sellerProfileId) {
        var btn = document.getElementById('bulkCreateLabelBtn');
        if (btn) { btn.disabled = true; btn.textContent = 'Queueing...'; }

        var payload = { ids: eligible.map(function (r) { return r.id; }) };
        if (sellerProfileId) payload.sellerProfileId = sellerProfileId;

        fetch(API + '/admin/oms-orders/buy-labels-bulk', {
            method:      'POST',
            credentials: 'include',
            headers:     { 'Content-Type': 'application/json' },
            body:        JSON.stringify(payload)
        })
        .then(function (r) { return r.json(); })
        .then(function (r) {
            var data         = r.data || {};
            var queuedCount  = data.queuedCount  || 0;
            var skippedCount = data.skippedCount || 0;
            var failed       = data.failedToQueue || 0;
            var errors       = data.errors  || [];
            var skippedSrv   = data.skipped || [];
            var failDetails  = errors.map(function (x) { return '#' + x.id + ': ' + x.error; }).join('\n');
            var skipDetails  = skippedSrv.map(function (x) { return '#' + x.id + ': ' + x.reason; }).join('\n');

            var line = 'Đã queue ' + queuedCount + '/' + eligible.length + ' đơn';
            if (skipped > 0)        line += ' • ' + skipped + ' đơn loại do trạng thái không hợp lệ';
            if (skippedCount > 0)   line += ' • ' + skippedCount + ' đơn đang in-flight (server skip)';
            if (failed > 0)         line += ' • ' + failed + ' lỗi enqueue';
            line += '. Worker đang xử lý nền — refresh để xem trạng thái.';

            showAlert(line, failed > 0 ? 'error' : 'success');
            if (failDetails) alert('Lỗi enqueue:\n' + failDetails);
            else if (skipDetails && skippedCount === eligible.length) alert('Tất cả đơn đã được queue trước đó:\n' + skipDetails);
            loadOmsOrders();
        })
        .catch(function (e) { showAlert('Bulk queue failed: ' + e.message, 'error'); })
        .finally(function () {
            if (btn) { btn.disabled = false; btn.textContent = '🏷 Tạo label'; }
            updateSelCount();
        });
    }

    function bulkDownloadLabels() {
        var rows = getSelectedRows();
        if (!rows.length) return;

        var eligible = rows.filter(function (r) { return r.hasLabel && r.labelUrl; });
        var skipped  = rows.length - eligible.length;

        if (!eligible.length) {
            showAlert('Không có đơn nào có tracking + label để tải.', 'error'); return;
        }

        var msg = 'Tải xuống ' + eligible.length + ' label (gộp thành 1 file PDF)?';
        if (skipped > 0) msg += '\n(' + skipped + ' đơn chưa có label sẽ bị bỏ qua)';
        if (!confirm(msg)) return;

        var btn = document.getElementById('bulkDownloadLabelBtn');
        var originalText = btn ? btn.textContent : '';
        if (btn) { btn.disabled = true; btn.textContent = 'Loading PDF lib...'; }

        loadPdfLib()
            .then(function () {
                if (btn) btn.textContent = 'Đang tải labels (0/' + eligible.length + ')...';
                return mergeLabelsToPdf(eligible, function (done, total) {
                    if (btn) btn.textContent = 'Đang tải labels (' + done + '/' + total + ')...';
                });
            })
            .then(function (result) {
                triggerPdfDownload(result.bytes, 'oms-labels-' + Date.now() + '.pdf');
                var line = 'Đã gộp ' + result.merged + '/' + eligible.length + ' label';
                if (result.failed.length) line += ' • Lỗi ' + result.failed.length + ' đơn';
                showAlert(line, result.failed.length ? 'error' : 'success');
                if (result.failed.length) {
                    alert('Các đơn không tải được:\n' +
                        result.failed.map(function (f) { return '#' + f.id + ' (' + f.orderNumber + '): ' + f.error; }).join('\n'));
                }
            })
            .catch(function (e) { showAlert('Bulk download failed: ' + e.message, 'error'); })
            .finally(function () {
                if (btn) { btn.disabled = false; btn.textContent = originalText || '⬇ Tải xuống label'; }
            });
    }

    // ─── PDF helpers ──────────────────────────────────────────────────────
    var _pdfLibPromise = null;

    function loadPdfLib() {
        if (window.PDFLib) return Promise.resolve(window.PDFLib);
        if (_pdfLibPromise) return _pdfLibPromise;
        _pdfLibPromise = new Promise(function (resolve, reject) {
            var script = document.createElement('script');
            script.src   = 'https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.min.js';
            script.async = true;
            script.onload  = function () {
                if (window.PDFLib) resolve(window.PDFLib);
                else reject(new Error('pdf-lib loaded but PDFLib not defined'));
            };
            script.onerror = function () { reject(new Error('Cannot load pdf-lib from CDN')); };
            document.head.appendChild(script);
        });
        return _pdfLibPromise;
    }

    function mergeLabelsToPdf(rows, onProgress) {
        var PDFDocument = window.PDFLib.PDFDocument;
        var failed = [];
        var done   = 0;

        return PDFDocument.create().then(function (mergedPdf) {
            var chain = Promise.resolve();
            rows.forEach(function (r) {
                chain = chain.then(function () {
                    return fetch(r.labelUrl, { credentials: 'include' })
                        .then(function (resp) {
                            if (!resp.ok) throw new Error('HTTP ' + resp.status);
                            return resp.arrayBuffer();
                        })
                        .then(function (buf) {
                            return PDFDocument.load(buf, { ignoreEncryption: true });
                        })
                        .then(function (srcPdf) {
                            var pageIndices = srcPdf.getPageIndices();
                            return mergedPdf.copyPages(srcPdf, pageIndices).then(function (pages) {
                                pages.forEach(function (p) { mergedPdf.addPage(p); });
                            });
                        })
                        .catch(function (err) {
                            failed.push({ id: r.id, orderNumber: r.orderNumber, error: err.message });
                        })
                        .then(function () {
                            done++;
                            if (typeof onProgress === 'function') onProgress(done, rows.length);
                        });
                });
            });

            return chain.then(function () {
                if (mergedPdf.getPageCount() === 0) {
                    throw new Error('Không có label nào tải được — file PDF rỗng');
                }
                return mergedPdf.save().then(function (bytes) {
                    return { bytes: bytes, merged: rows.length - failed.length, failed: failed };
                });
            });
        });
    }

    function triggerPdfDownload(bytes, filename) {
        var blob = new Blob([bytes], { type: 'application/pdf' });
        var url  = URL.createObjectURL(blob);
        var a    = document.createElement('a');
        a.href     = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        setTimeout(function () {
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        }, 0);
    }

    // ════════════════════════════════════════
    // PUBLIC API
    // ════════════════════════════════════════
    global.OmsOrders = {
        init:               init,
        loadOmsOrders:      loadOmsOrders,
        readOmsPageFromUrl: readOmsPageFromUrl,
        get omsPage()       { return omsPage; },
        set omsPage(v)      { omsPage = v; }
    };

})(window);