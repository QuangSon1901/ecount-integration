/**
 * js/sections/oms-packaging.js
 * Admin — OMS Packaging Materials + SKU Mappings.
 * Exposes: window.OmsPackaging
 * Depends on: dashboard.core.js (API, esc, val, setText, addClick, addChange,
 *             showAlert, fmtDatetime).
 *
 * Hai sub-view trong cùng section:
 *   - Materials: CRUD vật liệu đóng gói (poly mailer, hộp carton...)
 *   - SKU Mappings: map SKU → material, theo customer hoặc default (NULL)
 */

(function (global) {
    'use strict';

    var _activeView    = 'materials';   // 'materials' | 'mappings'
    var _customers     = [];            // cache cho dropdowns
    var _materials     = [];            // cache cho mapping form
    var _editingMatId  = null;          // id material đang edit (null = create)

    // ════════════════════════════════════════
    // HTML TEMPLATE
    // ════════════════════════════════════════
    var HTML = [
        '<div class="content-card">',
        '  <div class="card-header">',
        '    <div>',
        '      <h2 class="card-title">OMS Packaging</h2>',
        '      <p class="card-subtitle">Vật liệu đóng gói &amp; mapping SKU — dùng để tự động tính packaging fee selling cho đơn OMS</p>',
        '    </div>',
        '    <div class="card-actions">',
        '      <button class="btn btn-primary" id="btnPkgAdd">+ Thêm</button>',
        '    </div>',
        '  </div>',

        '  <!-- Sub-view tabs -->',
        '  <div class="oms-status-tabs" id="pkgTabs" style="margin-top:8px;">',
        '    <button class="oms-tab-btn active" data-view="materials">Materials</button>',
        '    <button class="oms-tab-btn" data-view="mappings">SKU Mappings</button>',
        '  </div>',

        '  <!-- Materials view -->',
        '  <div id="pkgMaterialsView">',
        '    <div class="card-header oms-filter-bar" style="margin-top:20px;">',
        '      <div class="filter-group oms-search-group">',
        '        <span class="filter-label">Search</span>',
        '        <div class="oms-search-wrap">',
        '          <input type="text" class="form-input" id="pkgMatSearch" placeholder="Tên hoặc mô tả…" autocomplete="off">',
        '        </div>',
        '      </div>',
        '      <label style="display:flex;align-items:center;gap:6px;font-size:13px;color:var(--text-secondary);">',
        '        <input type="checkbox" id="pkgMatActiveOnly"> Chỉ hiện active',
        '      </label>',
        '      <button class="btn btn-sm" id="pkgMatRefresh">↻ Refresh</button>',
        '    </div>',

        '    <div class="table-container">',
        '      <table class="data-table">',
        '        <thead><tr>',
        '          <th>#</th>',
        '          <th>Name</th>',
        '          <th>Description</th>',
        '          <th>Cost</th>',
        '          <th>Sell</th>',
        '          <th>Active</th>',
        '          <th>Updated</th>',
        '          <th>Actions</th>',
        '        </tr></thead>',
        '        <tbody id="pkgMatRows"><tr><td colspan="8" style="text-align:center;color:var(--text-secondary);padding:24px;">Loading…</td></tr></tbody>',
        '      </table>',
        '    </div>',
        '  </div>',

        '  <!-- Mappings view -->',
        '  <div id="pkgMappingsView" style="display:none;">',
        '    <div class="card-header oms-filter-bar" style="margin-top:20px;">',
        '      <div class="filter-group">',
        '        <span class="filter-label">Customer</span>',
        '        <select class="form-select" id="pkgMapCustomer">',
        '          <option value="">All</option>',
        '          <option value="null">— Default (NULL)</option>',
        '        </select>',
        '      </div>',
        '      <div class="filter-group oms-search-group">',
        '        <span class="filter-label">SKU</span>',
        '        <div class="oms-search-wrap">',
        '          <input type="text" class="form-input" id="pkgMapSku" placeholder="Tìm SKU…" autocomplete="off">',
        '        </div>',
        '      </div>',
        '      <button class="btn btn-sm" id="pkgMapRefresh">↻ Refresh</button>',
        '    </div>',

        '    <div class="table-container">',
        '      <table class="data-table">',
        '        <thead><tr>',
        '          <th>#</th>',
        '          <th>SKU</th>',
        '          <th>Customer</th>',
        '          <th>Material</th>',
        '          <th>Sell Price</th>',
        '          <th>Updated</th>',
        '          <th>Actions</th>',
        '        </tr></thead>',
        '        <tbody id="pkgMapRows"><tr><td colspan="7" style="text-align:center;color:var(--text-secondary);padding:24px;">Loading…</td></tr></tbody>',
        '      </table>',
        '    </div>',
        '  </div>',
        '</div>',

        // ─── Material modal ─────────────────────────────────────────
        '<div class="modal-overlay" id="pkgMatModal">',
        '  <div class="modal">',
        '    <h3 id="pkgMatModalTitle">Thêm vật liệu</h3>',
        '    <form id="pkgMatForm">',
        '      <div class="form-group">',
        '        <label class="form-label required">Name</label>',
        '        <input type="text" class="form-input" id="pkgMatName" required maxlength="255" placeholder="Poly Mailer 10x13">',
        '      </div>',
        '      <div class="form-group">',
        '        <label class="form-label">Description</label>',
        '        <textarea class="form-input" id="pkgMatDescription" rows="2" placeholder="Mô tả ngắn (tùy chọn)"></textarea>',
        '      </div>',
        '      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">',
        '        <div class="form-group">',
        '          <label class="form-label">Cost Price</label>',
        '          <input type="number" step="0.0001" min="0" class="form-input" id="pkgMatCost" placeholder="(tùy chọn)">',
        '        </div>',
        '        <div class="form-group">',
        '          <label class="form-label required">Sell Price</label>',
        '          <input type="number" step="0.0001" min="0" class="form-input" id="pkgMatSell" required>',
        '        </div>',
        '      </div>',
        '      <div class="form-group">',
        '        <label style="display:flex;align-items:center;gap:8px;cursor:pointer;">',
        '          <input type="checkbox" id="pkgMatActive" checked> <span>Active</span>',
        '        </label>',
        '      </div>',
        '      <div class="modal-actions">',
        '        <button type="button" class="btn" id="pkgMatCancel">Cancel</button>',
        '        <button type="submit" class="btn btn-primary" id="pkgMatSave">Save</button>',
        '      </div>',
        '    </form>',
        '  </div>',
        '</div>',

        // ─── Mapping modal ─────────────────────────────────────────
        '<div class="modal-overlay" id="pkgMapModal">',
        '  <div class="modal">',
        '    <h3>Thêm mapping SKU → Material</h3>',
        '    <form id="pkgMapForm">',
        '      <div class="form-group">',
        '        <label class="form-label required">SKU</label>',
        '        <input type="text" class="form-input" id="pkgMapNewSku" required maxlength="255" placeholder="SKU-001">',
        '      </div>',
        '      <div class="form-group">',
        '        <label class="form-label required">Customer</label>',
        '        <select class="form-select" id="pkgMapNewCustomer" required>',
        '          <option value="null">— Default (áp dụng cho mọi customer)</option>',
        '        </select>',
        '        <p style="margin-top:4px;font-size:12px;color:var(--text-secondary);">Customer-specific sẽ thắng default khi tính fee.</p>',
        '      </div>',
        '      <div class="form-group">',
        '        <label class="form-label required">Material</label>',
        '        <select class="form-select" id="pkgMapNewMaterial" required>',
        '          <option value="">— Chọn —</option>',
        '        </select>',
        '      </div>',
        '      <div class="modal-actions">',
        '        <button type="button" class="btn" id="pkgMapCancel">Cancel</button>',
        '        <button type="submit" class="btn btn-primary" id="pkgMapSave">Save</button>',
        '      </div>',
        '    </form>',
        '  </div>',
        '</div>'
    ].join('\n');

    // ════════════════════════════════════════
    // INIT
    // ════════════════════════════════════════
    function init() {
        var mount = document.getElementById('section-admin-oms-packaging-mount');
        if (!mount) return;
        mount.innerHTML = HTML;
        _bindEvents();
        _loadCustomersDropdown();
    }

    function _bindEvents() {
        // Tab switch
        var tabs = document.querySelectorAll('#pkgTabs .oms-tab-btn');
        tabs.forEach(function (btn) {
            btn.addEventListener('click', function () {
                _setActiveView(this.getAttribute('data-view'));
            });
        });

        addClick('btnPkgAdd', _onAddClick);

        // Materials
        addClick('pkgMatRefresh', loadMaterials);
        addChange('pkgMatActiveOnly', loadMaterials);
        var matSearch = document.getElementById('pkgMatSearch');
        if (matSearch) {
            var t = null;
            matSearch.addEventListener('input', function () {
                clearTimeout(t);
                t = setTimeout(loadMaterials, 350);
            });
        }
        addClick('pkgMatCancel', function () { _closeModal('pkgMatModal'); });
        var matForm = document.getElementById('pkgMatForm');
        if (matForm) matForm.addEventListener('submit', function (e) {
            e.preventDefault();
            _submitMaterial();
        });

        // Mappings
        addClick('pkgMapRefresh', loadMappings);
        addChange('pkgMapCustomer', loadMappings);
        var mapSku = document.getElementById('pkgMapSku');
        if (mapSku) {
            var t2 = null;
            mapSku.addEventListener('input', function () {
                clearTimeout(t2);
                t2 = setTimeout(loadMappings, 350);
            });
        }
        addClick('pkgMapCancel', function () { _closeModal('pkgMapModal'); });
        var mapForm = document.getElementById('pkgMapForm');
        if (mapForm) mapForm.addEventListener('submit', function (e) {
            e.preventDefault();
            _submitMapping();
        });
    }

    function _setActiveView(view) {
        if (view !== 'materials' && view !== 'mappings') return;
        _activeView = view;

        document.querySelectorAll('#pkgTabs .oms-tab-btn').forEach(function (btn) {
            btn.classList.toggle('active', btn.getAttribute('data-view') === view);
        });
        var matView = document.getElementById('pkgMaterialsView');
        var mapView = document.getElementById('pkgMappingsView');
        if (matView) matView.style.display = view === 'materials' ? '' : 'none';
        if (mapView) mapView.style.display = view === 'mappings' ? '' : 'none';

        var btn = document.getElementById('btnPkgAdd');
        if (btn) btn.textContent = view === 'materials' ? '+ Thêm vật liệu' : '+ Thêm mapping';

        if (view === 'materials') loadMaterials();
        else                       loadMappings();
    }

    function _onAddClick() {
        if (_activeView === 'materials') _openMaterialModal(null);
        else                             _openMappingModal();
    }

    // ════════════════════════════════════════
    // CUSTOMERS DROPDOWN
    // ════════════════════════════════════════
    function _loadCustomersDropdown() {
        fetch(API + '/admin/customers?limit=200', { credentials: 'include' })
            .then(function (r) { return r.json(); })
            .then(function (r) {
                _customers = (r.data && r.data.customers) || [];
                _populateCustomerSelects();
            })
            .catch(function (e) { console.warn('packaging customers dropdown failed', e); });
    }

    function _populateCustomerSelects() {
        var filter = document.getElementById('pkgMapCustomer');
        var modal  = document.getElementById('pkgMapNewCustomer');
        [filter, modal].forEach(function (sel) {
            if (!sel) return;
            // Giữ option đầu (All / default), xóa phần còn lại
            while (sel.options.length > (sel === filter ? 2 : 1)) sel.remove(sel.options.length - 1);
            _customers.forEach(function (c) {
                var opt = document.createElement('option');
                opt.value = c.id;
                opt.textContent = c.customer_code + ' — ' + c.customer_name;
                sel.appendChild(opt);
            });
        });
    }

    // ════════════════════════════════════════
    // MATERIALS — LOAD + RENDER
    // ════════════════════════════════════════
    function loadMaterials() {
        var search = (val('pkgMatSearch') || '').trim();
        var activeOnly = !!(document.getElementById('pkgMatActiveOnly') || {}).checked;

        var params = new URLSearchParams();
        if (activeOnly) params.set('active_only', '1');
        if (search)     params.set('q', search);

        var tbody = document.getElementById('pkgMatRows');
        if (tbody) tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;color:var(--text-secondary);padding:24px;">Loading…</td></tr>';

        fetch(API + '/admin/oms-packaging-materials?' + params.toString(), { credentials: 'include' })
            .then(function (r) {
                if (r.status === 401) { location.href = '/login'; return null; }
                return r.json();
            })
            .then(function (r) {
                if (!r) return;
                _materials = (r.data && r.data.materials) || [];
                _renderMaterials(_materials);
                _populateMaterialDropdown();
            })
            .catch(function (e) { showAlert('Failed to load materials: ' + e.message, 'error'); });
    }

    function _renderMaterials(rows) {
        var tbody = document.getElementById('pkgMatRows');
        if (!tbody) return;
        if (!rows.length) {
            tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;color:var(--text-secondary);padding:24px;">Chưa có vật liệu nào.</td></tr>';
            return;
        }
        tbody.innerHTML = rows.map(function (m) {
            return '<tr>' +
                '<td class="mono-sm">' + esc(m.id) + '</td>' +
                '<td><strong>' + esc(m.name || '—') + '</strong></td>' +
                '<td style="max-width:280px;color:var(--text-secondary);font-size:12px;">' + esc(m.description || '') + '</td>' +
                '<td class="mono-sm">' + (m.cost_price != null ? esc(m.cost_price) : '—') + '</td>' +
                '<td class="mono-sm"><strong>' + (m.sell_price != null ? esc(m.sell_price) : '—') + '</strong></td>' +
                '<td>' + (m.is_active
                    ? '<span class="badge badge-success">Active</span>'
                    : '<span class="badge badge-danger">Inactive</span>') + '</td>' +
                '<td class="date-sm">' + fmtDatetime(m.updated_at) + '</td>' +
                '<td>' +
                    '<button class="btn btn-sm" data-pkg-mat-edit="' + esc(m.id) + '">Edit</button> ' +
                    '<button class="btn btn-sm btn-danger" data-pkg-mat-del="' + esc(m.id) + '">Delete</button>' +
                '</td>' +
            '</tr>';
        }).join('');

        tbody.querySelectorAll('[data-pkg-mat-edit]').forEach(function (b) {
            b.addEventListener('click', function () {
                var id = parseInt(this.getAttribute('data-pkg-mat-edit'), 10);
                var mat = _materials.filter(function (x) { return x.id === id; })[0];
                if (mat) _openMaterialModal(mat);
            });
        });
        tbody.querySelectorAll('[data-pkg-mat-del]').forEach(function (b) {
            b.addEventListener('click', function () {
                var id = parseInt(this.getAttribute('data-pkg-mat-del'), 10);
                _deleteMaterial(id);
            });
        });
    }

    function _populateMaterialDropdown() {
        var sel = document.getElementById('pkgMapNewMaterial');
        if (!sel) return;
        // Giữ option đầu "— Chọn —"
        while (sel.options.length > 1) sel.remove(sel.options.length - 1);
        _materials.filter(function (m) { return m.is_active; }).forEach(function (m) {
            var opt = document.createElement('option');
            opt.value = m.id;
            opt.textContent = m.name + ' ($' + m.sell_price + ')';
            sel.appendChild(opt);
        });
    }

    // ════════════════════════════════════════
    // MATERIALS — MODAL
    // ════════════════════════════════════════
    function _openMaterialModal(material) {
        _editingMatId = material ? material.id : null;
        setText('pkgMatModalTitle', material ? 'Sửa vật liệu' : 'Thêm vật liệu');
        var nameEl   = document.getElementById('pkgMatName');
        var descEl   = document.getElementById('pkgMatDescription');
        var costEl   = document.getElementById('pkgMatCost');
        var sellEl   = document.getElementById('pkgMatSell');
        var activeEl = document.getElementById('pkgMatActive');
        if (nameEl)   nameEl.value   = material ? (material.name || '') : '';
        if (descEl)   descEl.value   = material ? (material.description || '') : '';
        if (costEl)   costEl.value   = material && material.cost_price != null ? material.cost_price : '';
        if (sellEl)   sellEl.value   = material && material.sell_price != null ? material.sell_price : '';
        if (activeEl) activeEl.checked = material ? !!material.is_active : true;
        _openModal('pkgMatModal');
    }

    function _submitMaterial() {
        var name = (val('pkgMatName') || '').trim();
        var desc = (val('pkgMatDescription') || '').trim();
        var cost = val('pkgMatCost');
        var sell = val('pkgMatSell');
        var active = !!(document.getElementById('pkgMatActive') || {}).checked;

        if (!name) { showAlert('Name là bắt buộc', 'error'); return; }
        if (sell === '' || sell === null) { showAlert('Sell Price là bắt buộc', 'error'); return; }

        var payload = {
            name: name,
            description: desc || null,
            cost_price: (cost === '' || cost === null) ? null : Number(cost),
            sell_price: Number(sell),
            is_active: active
        };

        var url    = API + '/admin/oms-packaging-materials' + (_editingMatId ? '/' + _editingMatId : '');
        var method = _editingMatId ? 'PUT' : 'POST';

        var btn = document.getElementById('pkgMatSave');
        if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }

        fetch(url, {
            method: method,
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        })
        .then(function (r) { return r.json().then(function (b) { return { ok: r.ok, body: b }; }); })
        .then(function (res) {
            if (!res.ok) throw new Error((res.body && res.body.message) || 'Request failed');
            showAlert(_editingMatId ? 'Cập nhật vật liệu' : 'Đã thêm vật liệu', 'success');
            _closeModal('pkgMatModal');
            loadMaterials();
        })
        .catch(function (e) { showAlert(e.message || 'Save failed', 'error'); })
        .finally(function () {
            if (btn) { btn.disabled = false; btn.textContent = 'Save'; }
        });
    }

    function _deleteMaterial(id) {
        if (!confirm('Xóa vật liệu #' + id + '? Các SKU mapping liên quan cũng sẽ bị xóa (CASCADE).')) return;
        fetch(API + '/admin/oms-packaging-materials/' + id, {
            method: 'DELETE', credentials: 'include'
        })
        .then(function (r) { return r.json().then(function (b) { return { ok: r.ok, body: b }; }); })
        .then(function (res) {
            if (!res.ok) throw new Error((res.body && res.body.message) || 'Delete failed');
            showAlert('Đã xóa vật liệu', 'success');
            loadMaterials();
            if (_activeView === 'mappings') loadMappings();
        })
        .catch(function (e) { showAlert(e.message || 'Delete failed', 'error'); });
    }

    // ════════════════════════════════════════
    // MAPPINGS — LOAD + RENDER
    // ════════════════════════════════════════
    function loadMappings() {
        var customer = val('pkgMapCustomer');
        var sku      = (val('pkgMapSku') || '').trim();

        var params = new URLSearchParams({ limit: 500, offset: 0 });
        if (customer) params.set('customer_id', customer);
        if (sku)      params.set('sku', sku);

        var tbody = document.getElementById('pkgMapRows');
        if (tbody) tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--text-secondary);padding:24px;">Loading…</td></tr>';

        fetch(API + '/admin/oms-sku-packaging-mappings?' + params.toString(), { credentials: 'include' })
            .then(function (r) {
                if (r.status === 401) { location.href = '/login'; return null; }
                return r.json();
            })
            .then(function (r) {
                if (!r) return;
                var rows = (r.data && r.data.mappings) || [];
                _renderMappings(rows);
            })
            .catch(function (e) { showAlert('Failed to load mappings: ' + e.message, 'error'); });
    }

    function _renderMappings(rows) {
        var tbody = document.getElementById('pkgMapRows');
        if (!tbody) return;
        if (!rows.length) {
            tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--text-secondary);padding:24px;">Chưa có mapping nào.</td></tr>';
            return;
        }
        tbody.innerHTML = rows.map(function (m) {
            var customerLabel = m.customer_id == null
                ? '<span class="badge badge-info">Default</span>'
                : '<span class="cust-badge">#' + esc(m.customer_id) + '</span>' + esc(m.customer_code || '—');
            return '<tr>' +
                '<td class="mono-sm">' + esc(m.id) + '</td>' +
                '<td><strong>' + esc(m.sku) + '</strong></td>' +
                '<td>' + customerLabel +
                    (m.customer_name ? '<div style="font-size:11px;color:var(--text-secondary);">' + esc(m.customer_name) + '</div>' : '') + '</td>' +
                '<td>' + esc(m.material_name || ('#' + m.material_id)) + '</td>' +
                '<td class="mono-sm">' + (m.material_sell_price != null ? esc(m.material_sell_price) : '—') + '</td>' +
                '<td class="date-sm">' + fmtDatetime(m.updated_at) + '</td>' +
                '<td><button class="btn btn-sm btn-danger" data-pkg-map-del="' + esc(m.id) + '">Delete</button></td>' +
            '</tr>';
        }).join('');

        tbody.querySelectorAll('[data-pkg-map-del]').forEach(function (b) {
            b.addEventListener('click', function () {
                var id = parseInt(this.getAttribute('data-pkg-map-del'), 10);
                _deleteMapping(id);
            });
        });
    }

    // ════════════════════════════════════════
    // MAPPINGS — MODAL
    // ════════════════════════════════════════
    function _openMappingModal() {
        // Reset form
        var skuEl = document.getElementById('pkgMapNewSku');
        var custEl = document.getElementById('pkgMapNewCustomer');
        var matEl  = document.getElementById('pkgMapNewMaterial');
        if (skuEl)  skuEl.value  = '';
        if (custEl) custEl.value = 'null';
        if (matEl)  matEl.value  = '';

        // Đảm bảo materials cache có sẵn — nếu chưa load, fetch trước
        if (!_materials.length) {
            loadMaterials();
        } else {
            _populateMaterialDropdown();
        }
        _openModal('pkgMapModal');
    }

    function _submitMapping() {
        var sku      = (val('pkgMapNewSku') || '').trim();
        var customer = val('pkgMapNewCustomer');
        var material = val('pkgMapNewMaterial');

        if (!sku)      { showAlert('SKU là bắt buộc', 'error'); return; }
        if (!material) { showAlert('Material là bắt buộc', 'error'); return; }

        var payload = {
            sku: sku,
            material_id: parseInt(material, 10),
            customer_id: (customer === 'null' || customer === '' || customer == null) ? null : parseInt(customer, 10)
        };

        var btn = document.getElementById('pkgMapSave');
        if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }

        fetch(API + '/admin/oms-sku-packaging-mappings', {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        })
        .then(function (r) { return r.json().then(function (b) { return { ok: r.ok, body: b }; }); })
        .then(function (res) {
            if (!res.ok) throw new Error((res.body && res.body.message) || 'Save failed');
            showAlert('Đã thêm mapping', 'success');
            _closeModal('pkgMapModal');
            loadMappings();
        })
        .catch(function (e) { showAlert(e.message || 'Save failed', 'error'); })
        .finally(function () {
            if (btn) { btn.disabled = false; btn.textContent = 'Save'; }
        });
    }

    function _deleteMapping(id) {
        if (!confirm('Xóa mapping #' + id + '?')) return;
        fetch(API + '/admin/oms-sku-packaging-mappings/' + id, {
            method: 'DELETE', credentials: 'include'
        })
        .then(function (r) { return r.json().then(function (b) { return { ok: r.ok, body: b }; }); })
        .then(function (res) {
            if (!res.ok) throw new Error((res.body && res.body.message) || 'Delete failed');
            showAlert('Đã xóa mapping', 'success');
            loadMappings();
        })
        .catch(function (e) { showAlert(e.message || 'Delete failed', 'error'); });
    }

    // ════════════════════════════════════════
    // MODAL HELPERS
    // ════════════════════════════════════════
    function _openModal(id)  { var el = document.getElementById(id); if (el) el.classList.add('show'); }
    function _closeModal(id) { var el = document.getElementById(id); if (el) el.classList.remove('show'); }

    // ════════════════════════════════════════
    // PUBLIC API
    // ════════════════════════════════════════
    global.OmsPackaging = {
        init:          init,
        loadMaterials: loadMaterials,
        loadMappings:  loadMappings,
        getActiveView: function () { return _activeView; }
    };

})(window);
