const API_BASE_URL = '/api/v1';

// Show alert message
function showAlert(message, type = 'success') {
    const alertContainer = document.getElementById('alertContainer');
    const alertDiv = document.createElement('div');
    alertDiv.className = `alert alert-${type}`;
    alertDiv.textContent = message;
    alertContainer.appendChild(alertDiv);

    setTimeout(() => {
        alertDiv.remove();
    }, 5000);
}

// Create Customer
document.getElementById('createCustomerForm').addEventListener('submit', async (e) => {
    e.preventDefault();

    const data = {
        customer_code: document.getElementById('customerCode').value,
        customer_name: document.getElementById('customerName').value,
        email: document.getElementById('email').value || undefined,
        phone: document.getElementById('phone').value || undefined,
        environment: document.getElementById('environment').value,
        rate_limit_per_hour: parseInt(document.getElementById('rateLimitHourly').value),
        rate_limit_per_day: parseInt(document.getElementById('rateLimitDaily').value)
    };

    try {
        const response = await fetch(`${API_BASE_URL}/admin/customers`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(data)
        });

        const result = await response.json();

        if (response.ok) {
            showAlert('Khách hàng đã được tạo thành công!', 'success');

            // Show credentials
            document.getElementById('resultCustomerId').textContent = result.data.customer_id;
            document.getElementById('resultCustomerCode').textContent = result.data.customer_code;
            document.getElementById('resultClientId').textContent = result.data.credentials.client_id;
            document.getElementById('resultClientSecret').textContent = result.data.credentials.client_secret;
            document.getElementById('resultEnvironment').textContent = result.data.credentials.environment;

            document.getElementById('credentialsResult').classList.remove('hidden');

            // Reset form
            document.getElementById('createCustomerForm').reset();

            // Reload customers list
            setTimeout(loadCustomers, 2000);
        } else {
            showAlert(result.message || 'Có lỗi xảy ra', 'error');
        }
    } catch (error) {
        showAlert('Không thể kết nối đến server', 'error');
        console.error(error);
    }
});

// Load Customers
async function loadCustomers() {
    const loadingEl = document.getElementById('loadingCustomers');
    const tableBody = document.getElementById('customersTableBody');

    loadingEl.classList.remove('hidden');
    tableBody.innerHTML = '';

    try {
        const response = await fetch(`${API_BASE_URL}/admin/customers`, {
            headers: {}
        });

        const result = await response.json();

        if (response.ok) {
            const customers = result.data.customers;

            if (customers.length === 0) {
                tableBody.innerHTML = '<tr><td colspan="8" style="text-align: center;">Chưa có khách hàng nào</td></tr>';
            } else {
                customers.forEach(customer => {
                    const row = document.createElement('tr');
                    const tgTags = formatTgTags(customer.telegram_responsibles);
                    const tgGroups = formatTgGroups(customer.telegram_group_ids);
                    row.innerHTML = `
                                <td>${customer.id}</td>
                                <td><strong>${customer.customer_code}</strong></td>
                                <td>${customer.customer_name}</td>
                                <td>${customer.environment}</td>
                                <td><span class="status-badge status-${customer.status}">${customer.status}</span></td>
                                <td>${tgTags}</td>
                                <td>${tgGroups}</td>
                                <td>${new Date(customer.created_at).toLocaleDateString('vi-VN')}</td>
                            `;
                    tableBody.appendChild(row);
                });
            }
        } else {
            showAlert(result.message || 'Không thể tải danh sách khách hàng', 'error');
        }
    } catch (error) {
        showAlert('Không thể kết nối đến server', 'error');
        console.error(error);
    } finally {
        loadingEl.classList.add('hidden');
    }
}

function escHtml(text) {
    if (!text) return '';
    const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
    return String(text).replace(/[&<>"']/g, m => map[m]);
}

function formatTgTags(str) {
    if (!str) return '<span style="color:#94a3b8;font-size:12px;">—</span>';
    return str.split(',').map(t => t.trim()).filter(Boolean)
        .map(tag => `<span style="display:inline-block;background:#e0f2fe;color:#0369a1;padding:1px 6px;border-radius:4px;font-size:11px;margin:1px 2px;">${escHtml(tag)}</span>`)
        .join('');
}

function formatTgGroups(str) {
    if (!str) return '<span style="color:#94a3b8;font-size:12px;">—</span>';
    const groups = str.split(',').map(g => g.trim()).filter(Boolean);
    return `<span style="color:#64748b;font-size:11px;">${groups.length} group${groups.length > 1 ? 's' : ''}</span>`;
}

// Load customers on page load
loadCustomers();