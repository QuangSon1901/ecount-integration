/**
 * js/sections/system-config.js
 * Admin — System Config section: quản lý seller profiles cho ITC label.
 * Exposes: window.SystemConfig
 * Depends on: dashboard.core.js
 */

(function (global) {
    'use strict';

    var API = '/api/v1/admin/system-configs';
    var _profiles = [];
    var _editingId = null; // id của profile đang được edit, null nếu tạo mới

    // ════════════════════════════════════════
    // HTML TEMPLATE
    // ════════════════════════════════════════
    var HTML = [
        '<div class="content-card">',
        '  <div class="card-header">',
        '    <div>',
        '      <h2 class="card-title">Seller Profiles</h2>',
        '      <p class="card-subtitle">Thông tin seller gửi kèm khi mua ITC label. Profile mặc định sẽ được dùng tự động.</p>',
        '    </div>',
        '    <button class="btn btn-primary" id="scBtnAddProfile">+ Add Profile</button>',
        '  </div>',

        '  <div id="scProfileList" style="margin-top:16px;"></div>',
        '</div>',

        '<!-- Modal tạo/edit profile -->',
        '<div class="modal-overlay" id="scModal" style="display:none;">',
        '  <div class="modal" style="max-width:540px;">',
        '    <h3 id="scModalTitle">Add Seller Profile</h3>',
        '    <form id="scProfileForm" autocomplete="off">',
        '      <div class="form-group">',
        '        <label class="form-label required">Profile Name</label>',
        '        <input type="text" class="form-input" id="scFieldProfileName" placeholder="Ví dụ: US Main Warehouse" required>',
        '      </div>',
        '      <div class="form-group">',
        '        <label class="form-label required">Seller Name</label>',
        '        <input type="text" class="form-input" id="scFieldName" placeholder="Tên seller" required>',
        '      </div>',
        '      <div class="form-group">',
        '        <label class="form-label required">Address Line 1</label>',
        '        <input type="text" class="form-input" id="scFieldAddress1" placeholder="Địa chỉ dòng 1" required>',
        '      </div>',
        '      <div class="form-group">',
        '        <label class="form-label">Address Line 2</label>',
        '        <input type="text" class="form-input" id="scFieldAddress2" placeholder="Địa chỉ dòng 2 (tuỳ chọn)">',
        '      </div>',
        '      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">',
        '        <div class="form-group">',
        '          <label class="form-label required">City</label>',
        '          <input type="text" class="form-input" id="scFieldCity" placeholder="Thành phố" required>',
        '        </div>',
        '        <div class="form-group">',
        '          <label class="form-label">State</label>',
        '          <input type="text" class="form-input" id="scFieldState" placeholder="Bang/tỉnh">',
        '        </div>',
        '        <div class="form-group">',
        '          <label class="form-label">Postal Code</label>',
        '          <input type="text" class="form-input" id="scFieldPostalCode" placeholder="Mã bưu chính">',
        '        </div>',
        '        <div class="form-group">',
        '          <label class="form-label required">Country</label>',
        '          <input type="text" class="form-input" id="scFieldCountry" placeholder="Mã quốc gia (VD: US)" maxlength="2" required>',
        '        </div>',
        '      </div>',
        '      <div class="form-group">',
        '        <label class="form-label">Phone</label>',
        '        <input type="text" class="form-input" id="scFieldPhone" placeholder="Số điện thoại">',
        '      </div>',
        '      <div class="form-group" id="scDefaultCheckWrap">',
        '        <label style="display:flex;align-items:center;gap:8px;font-size:14px;cursor:pointer;">',
        '          <input type="checkbox" id="scFieldIsDefault"> Đặt làm default',
        '        </label>',
        '      </div>',
        '      <div class="modal-actions">',
        '        <button type="button" class="btn" id="scBtnCancelModal">Huỷ</button>',
        '        <button type="submit" class="btn btn-primary" id="scBtnSubmitModal">Lưu</button>',
        '      </div>',
        '    </form>',
        '  </div>',
        '</div>',
    ].join('\n');

    // ════════════════════════════════════════
    // RENDER
    // ════════════════════════════════════════
    function renderProfileList() {
        var container = document.getElementById('scProfileList');
        if (!container) return;

        if (_profiles.length === 0) {
            container.innerHTML = '<p style="color:var(--text-secondary);font-size:14px;">Chưa có seller profile nào. Nhấn "+ Add Profile" để tạo mới.</p>';
            return;
        }

        var rows = _profiles.map(function (p) {
            var defaultBadge = p.isDefault
                ? '<span style="background:var(--success);color:#fff;font-size:11px;padding:2px 8px;border-radius:4px;margin-left:8px;">Default</span>'
                : '';
            return [
                '<div class="content-card" style="margin-bottom:12px;padding:16px 20px;">',
                '  <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;">',
                '    <div>',
                '      <div style="font-weight:600;font-size:15px;">' + esc(p.profileName) + defaultBadge + '</div>',
                '      <div style="font-size:13px;color:var(--text-secondary);margin-top:4px;">',
                '        ' + esc(p.name) + ' &bull; ' + esc(p.address1) + (p.address2 ? ', ' + esc(p.address2) : '') +
                ', ' + esc(p.city) + (p.state ? ' ' + esc(p.state) : '') + ' ' + esc(p.postalCode) +
                ', ' + esc(p.country) + (p.phone ? ' &bull; ' + esc(p.phone) : ''),
                '      </div>',
                '    </div>',
                '    <div style="display:flex;gap:8px;flex-shrink:0;">',
                (!p.isDefault ? '<button class="btn btn-sm" data-action="set-default" data-id="' + esc(p.id) + '">Set Default</button>' : ''),
                '<button class="btn btn-sm" data-action="edit" data-id="' + esc(p.id) + '">Edit</button>',
                '<button class="btn btn-sm" style="background:var(--danger-light);color:var(--danger);" data-action="delete" data-id="' + esc(p.id) + '">Delete</button>',
                '    </div>',
                '  </div>',
                '</div>',
            ].join('');
        });

        container.innerHTML = rows.join('');

        // Gắn event cho các nút
        container.querySelectorAll('[data-action]').forEach(function (btn) {
            btn.addEventListener('click', function () {
                var action = btn.getAttribute('data-action');
                var id = btn.getAttribute('data-id');
                if (action === 'set-default') setDefault(id);
                else if (action === 'edit')    openEditModal(id);
                else if (action === 'delete')  deleteProfile(id);
            });
        });
    }

    // ════════════════════════════════════════
    // MODAL
    // ════════════════════════════════════════
    function openAddModal() {
        _editingId = null;
        document.getElementById('scModalTitle').textContent = 'Add Seller Profile';
        document.getElementById('scProfileForm').reset();
        document.getElementById('scModal').style.display = 'flex';
    }

    function openEditModal(id) {
        var p = _profiles.find(function (x) { return x.id === id; });
        if (!p) return;
        _editingId = id;
        document.getElementById('scModalTitle').textContent = 'Edit Seller Profile';
        document.getElementById('scFieldProfileName').value = p.profileName || '';
        document.getElementById('scFieldName').value        = p.name || '';
        document.getElementById('scFieldAddress1').value    = p.address1 || '';
        document.getElementById('scFieldAddress2').value    = p.address2 || '';
        document.getElementById('scFieldCity').value        = p.city || '';
        document.getElementById('scFieldState').value       = p.state || '';
        document.getElementById('scFieldPostalCode').value  = p.postalCode || '';
        document.getElementById('scFieldCountry').value     = p.country || '';
        document.getElementById('scFieldPhone').value       = p.phone || '';
        // Ẩn checkbox isDefault khi edit (dùng "Set Default" button)
        document.getElementById('scDefaultCheckWrap').style.display = 'none';
        document.getElementById('scModal').style.display = 'flex';
    }

    function closeModal() {
        document.getElementById('scModal').style.display = 'none';
        document.getElementById('scDefaultCheckWrap').style.display = '';
        _editingId = null;
    }

    // ════════════════════════════════════════
    // API CALLS
    // ════════════════════════════════════════
    function loadProfiles() {
        fetch(API + '/seller-profiles', { credentials: 'include' })
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (data && data.success) {
                    _profiles = data.data || [];
                    renderProfileList();
                }
            })
            .catch(function (err) {
                showAlert('Không thể tải seller profiles: ' + err.message, 'error');
            });
    }

    function submitProfile(e) {
        e.preventDefault();
        var payload = {
            profileName: document.getElementById('scFieldProfileName').value.trim(),
            name:        document.getElementById('scFieldName').value.trim(),
            address1:    document.getElementById('scFieldAddress1').value.trim(),
            address2:    document.getElementById('scFieldAddress2').value.trim(),
            city:        document.getElementById('scFieldCity').value.trim(),
            state:       document.getElementById('scFieldState').value.trim(),
            postalCode:  document.getElementById('scFieldPostalCode').value.trim(),
            country:     document.getElementById('scFieldCountry').value.trim().toUpperCase(),
            phone:       document.getElementById('scFieldPhone').value.trim(),
        };

        var submitBtn = document.getElementById('scBtnSubmitModal');
        submitBtn.disabled = true;

        var url, method;
        if (_editingId) {
            url    = API + '/seller-profiles/' + encodeURIComponent(_editingId);
            method = 'PUT';
        } else {
            payload.isDefault = document.getElementById('scFieldIsDefault').checked;
            url    = API + '/seller-profiles';
            method = 'POST';
        }

        fetch(url, {
            method: method,
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        })
            .then(function (r) { return r.json(); })
            .then(function (data) {
                submitBtn.disabled = false;
                if (data && data.success) {
                    showAlert(_editingId ? 'Đã cập nhật seller profile.' : 'Đã tạo seller profile.', 'success');
                    closeModal();
                    loadProfiles();
                } else {
                    showAlert((data && data.message) || 'Lỗi lưu seller profile', 'error');
                }
            })
            .catch(function (err) {
                submitBtn.disabled = false;
                showAlert('Lỗi: ' + err.message, 'error');
            });
    }

    function setDefault(id) {
        fetch(API + '/seller-profiles/' + encodeURIComponent(id) + '/default', {
            method: 'PATCH',
            credentials: 'include',
        })
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (data && data.success) {
                    showAlert('Đã đặt default seller profile.', 'success');
                    loadProfiles();
                } else {
                    showAlert((data && data.message) || 'Lỗi', 'error');
                }
            })
            .catch(function (err) { showAlert('Lỗi: ' + err.message, 'error'); });
    }

    function deleteProfile(id) {
        if (!confirm('Xoá seller profile này?')) return;
        fetch(API + '/seller-profiles/' + encodeURIComponent(id), {
            method: 'DELETE',
            credentials: 'include',
        })
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (data && data.success) {
                    showAlert('Đã xoá seller profile.', 'success');
                    loadProfiles();
                } else {
                    showAlert((data && data.message) || 'Lỗi', 'error');
                }
            })
            .catch(function (err) { showAlert('Lỗi: ' + err.message, 'error'); });
    }

    // ════════════════════════════════════════
    // HELPERS
    // ════════════════════════════════════════
    function esc(str) {
        if (!str) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function showAlert(msg, type) {
        if (global.showAlert) { global.showAlert(msg, type); return; }
        // fallback
        var el = document.getElementById('alertContainer');
        if (!el) return;
        var div = document.createElement('div');
        div.className = 'alert alert-' + (type || 'info');
        div.textContent = msg;
        el.appendChild(div);
        setTimeout(function () { div.remove(); }, 4000);
    }

    // ════════════════════════════════════════
    // PUBLIC API
    // ════════════════════════════════════════
    var SystemConfig = {
        init: function () {
            var mount = document.getElementById('section-admin-system-config-mount');
            if (!mount) return;
            mount.innerHTML = HTML;

            document.getElementById('scBtnAddProfile').addEventListener('click', openAddModal);
            document.getElementById('scBtnCancelModal').addEventListener('click', closeModal);
            document.getElementById('scProfileForm').addEventListener('submit', submitProfile);

            // Đóng modal khi click ngoài
            document.getElementById('scModal').addEventListener('click', function (e) {
                if (e.target === this) closeModal();
            });
        },

        // Gọi khi section được navigate vào (lazy load)
        onActivate: function () {
            loadProfiles();
        },

        // Trả về danh sách profiles hiện tại (để OmsOrders dùng khi mua label)
        getProfiles: function () { return _profiles; },
        loadProfiles: loadProfiles,
    };

    global.SystemConfig = SystemConfig;
}(window));
