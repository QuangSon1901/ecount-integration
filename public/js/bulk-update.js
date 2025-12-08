let processedData = [];
let currentFilter = 'all';

// Upload area handling
const uploadArea = document.getElementById('uploadArea');
const fileInput = document.getElementById('fileInput');

uploadArea.addEventListener('click', () => fileInput.click());

uploadArea.addEventListener('dragover', (e) => {
    e.preventDefault();
    uploadArea.classList.add('dragover');
});

uploadArea.addEventListener('dragleave', () => {
    uploadArea.classList.remove('dragover');
});

uploadArea.addEventListener('drop', (e) => {
    e.preventDefault();
    uploadArea.classList.remove('dragover');
    const file = e.dataTransfer.files[0];
    if (file) handleFileUpload(file);
});

fileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) handleFileUpload(file);
});

// Filter tabs
document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
        document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        currentFilter = tab.dataset.filter;
        renderTable();
    });
});

// Update all button
document.getElementById('btnUpdateAll').addEventListener('click', updateAllOrders);

async function handleFileUpload(file) {
    if (!file.name.match(/\.(xlsx|xls)$/)) {
        showAlert('error', 'Vui lòng chọn file Excel (.xlsx hoặc .xls)');
        return;
    }

    const formData = new FormData();
    formData.append('file', file);

    showLoading(true);
    hideAlert();

    try {
        const response = await fetch('/api/orders/bulk-check', {
            method: 'POST',
            body: formData
        });

        const result = await response.json();

        if (!result.success) {
            throw new Error(result.message);
        }

        processedData = result.data.results;
        updateStats(result.data.summary);
        renderTable();
        document.getElementById('resultsSection').classList.add('show');
        
        // Enable update button if có đơn tìm thấy
        document.getElementById('btnUpdateAll').disabled = result.data.summary.found === 0;

        showAlert('success', `Đã xử lý ${result.data.summary.total} dòng dữ liệu`);

    } catch (error) {
        showAlert('error', 'Lỗi: ' + error.message);
    } finally {
        showLoading(false);
        fileInput.value = '';
    }
}

function updateStats(summary) {
    document.getElementById('totalCount').textContent = summary.total;
    document.getElementById('foundCount').textContent = summary.found;
    document.getElementById('notFoundCount').textContent = summary.not_found;
    document.getElementById('duplicatesCount').textContent = summary.duplicates;
}

function renderTable() {
    const tbody = document.getElementById('tableBody');
    tbody.innerHTML = '';

    const filtered = processedData.filter(item => {
        if (currentFilter === 'all') return true;
        if (currentFilter === 'found') return item.status === 'found';
        if (currentFilter === 'not-found') return item.status === 'not_found';
        if (currentFilter === 'duplicates') return item.status === 'duplicate';
        return true;
    });

    filtered.forEach((item, index) => {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${index + 1}</td>
            <td><code style="font-size: 12px">${escapeHtml(item.original_code)}</code></td>
            <td><strong>${item.tracking_number || '-'}</strong></td>
            <td><code style="font-size: 12px">${item.waybill_number || '-'}</code></td>
            <td><strong>${item.erp_order_code || '-'}</strong></td>
            <td>${item.carrier || '-'}</td>
            <td>${getStatusBadge(item.status)}</td>
            <td style="font-size: 13px; color: #6b7280">${item.note || '-'}</td>
        `;
        tbody.appendChild(row);
    });

    if (filtered.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="8" style="text-align: center; padding: 40px; color: #9ca3af">
                    Không có dữ liệu
                </td>
            </tr>
        `;
    }
}

function getStatusBadge(status) {
    const badges = {
        'found': '<span class="badge badge-success">Tìm thấy</span>',
        'not_found': '<span class="badge badge-error">Không tìm thấy</span>',
        'duplicate': '<span class="badge badge-warning">Trùng lặp</span>'
    };
    return badges[status] || '<span class="badge">Unknown</span>';
}

async function updateAllOrders() {
    const foundOrders = processedData.filter(item => item.status === 'found');
    
    if (foundOrders.length === 0) {
        showAlert('warning', 'Không có đơn hàng nào để cập nhật');
        return;
    }

    const estimatedTime = Math.ceil(foundOrders.length * 5 / 60); // Tính thời gian ước tính (phút)
    
    if (!confirm(`Bạn có chắc chắn muốn cập nhật ${foundOrders.length} đơn hàng?\n\nThời gian ước tính: ~${estimatedTime} phút (${foundOrders.length * 5} giây)`)) {
        return;
    }

    const erpOrderCodes = foundOrders.map(item => item.erp_order_code);

    showLoading(true);
    document.getElementById('btnUpdateAll').disabled = true;

    try {
        const response = await fetch('/api/orders/bulk-update-status', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                erp_order_codes: erpOrderCodes,
                status: 'THG Received'
            })
        });

        const result = await response.json();

        if (!result.success) {
            throw new Error(result.message);
        }

        let message = `✅ Đã tạo ${result.data.success} jobs thành công`;
        
        if (result.data.failed > 0) {
            message += `\n⚠️ ${result.data.failed} đơn thất bại`;
        }
        
        message += `\n\n⏱️ Các jobs sẽ được xử lý tự động với delay 5 giây/đơn`;
        message += `\n📊 Thời gian hoàn thành dự kiến: ~${estimatedTime} phút`;

        showAlert('success', message);

        // Log chi tiết
        console.log('Bulk update result:', result.data);

    } catch (error) {
        showAlert('error', 'Lỗi: ' + error.message);
        document.getElementById('btnUpdateAll').disabled = false;
    } finally {
        showLoading(false);
    }
}

function showLoading(show) {
    document.getElementById('loading').classList.toggle('show', show);
}

function showAlert(type, message) {
    const alert = document.getElementById('alert');
    alert.className = `alert alert-${type} show`;
    alert.textContent = message;
}

function hideAlert() {
    document.getElementById('alert').classList.remove('show');
}

function escapeHtml(text) {
    const map = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
    };
    return text.replace(/[&<>"']/g, m => map[m]);
}