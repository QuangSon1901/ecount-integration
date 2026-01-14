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
                    row.innerHTML = `
                                <td>${customer.id}</td>
                                <td><strong>${customer.customer_code}</strong></td>
                                <td>${customer.customer_name}</td>
                                <td>${customer.email || '-'}</td>
                                <td>${customer.environment}</td>
                                <td><span class="status-badge status-${customer.status}">${customer.status}</span></td>
                                <td>${customer.rate_limit_per_hour} / ${customer.rate_limit_per_day}</td>
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

// Load customers on page load
loadCustomers();