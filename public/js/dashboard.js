// Dashboard JavaScript - No Inline Handlers
const API_BASE_URL = '/api/v1';

// ============================================
// INITIALIZATION
// ============================================
document.addEventListener('DOMContentLoaded', () => {
    initNavigation();
    initQuickAccessCards();
    initEventListeners();
    loadCustomers();
    updateLastUpdateTime();
    
    // Update time every minute
    setInterval(updateLastUpdateTime, 60000);
});

// ============================================
// NAVIGATION
// ============================================
function initNavigation() {
    const navLinks = document.querySelectorAll('.nav-link');
    
    navLinks.forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            
            const sectionId = link.getAttribute('data-section');
            if (sectionId) {
                navigateToSection(sectionId);
                
                // Update active state
                navLinks.forEach(l => l.classList.remove('active'));
                link.classList.add('active');
            }
        });
    });
}

function navigateToSection(sectionId) {
    // Hide all sections
    document.querySelectorAll('.content-section').forEach(section => {
        section.classList.remove('active');
    });
    
    // Show target section
    const targetSection = document.getElementById(sectionId);
    if (targetSection) {
        targetSection.classList.add('active');
        updatePageTitle(sectionId);
        
        // Load data if needed
        if (sectionId === 'api-customers') {
            loadCustomers();
        }
        
        // Scroll to top
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }
}

function updatePageTitle(sectionId) {
    const titles = {
        'overview': { 
            title: 'Dashboard Overview', 
            subtitle: 'Quản lý và theo dõi hệ thống' 
        },
        'bulk-update': { 
            title: 'Bulk Update Orders', 
            subtitle: 'Cập nhật đơn hàng hàng loạt' 
        },
        'ecount-extension': { 
            title: 'ECount Extension', 
            subtitle: 'Extension Chrome tự động hóa' 
        },
        'label-extension': { 
            title: 'Label Extension', 
            subtitle: 'Extension tải label công khai' 
        },
        'api-create': { 
            title: 'Create API Customer', 
            subtitle: 'Tạo khách hàng mới' 
        },
        'api-customers': { 
            title: 'API Customers', 
            subtitle: 'Quản lý khách hàng API' 
        }
    };
    
    const pageInfo = titles[sectionId] || { title: 'Dashboard', subtitle: '' };
    
    const titleEl = document.getElementById('pageTitle');
    const subtitleEl = document.getElementById('pageSubtitle');
    
    if (titleEl) titleEl.textContent = pageInfo.title;
    if (subtitleEl) subtitleEl.textContent = pageInfo.subtitle;
}

// ============================================
// QUICK ACCESS CARDS
// ============================================
function initQuickAccessCards() {
    const cards = document.querySelectorAll('.quick-access-card');
    
    cards.forEach(card => {
        card.addEventListener('click', () => {
            const navigateTo = card.getAttribute('data-navigate');
            const url = card.getAttribute('data-url');
            
            if (navigateTo) {
                navigateToSection(navigateTo);
                
                // Update nav active state
                document.querySelectorAll('.nav-link').forEach(link => {
                    if (link.getAttribute('data-section') === navigateTo) {
                        link.classList.add('active');
                    } else {
                        link.classList.remove('active');
                    }
                });
            } else if (url) {
                window.location.href = url;
            }
        });
    });
}

// ============================================
// EVENT LISTENERS
// ============================================
function initEventListeners() {
    // Reload customers button
    const reloadBtn = document.getElementById('reloadCustomersBtn');
    if (reloadBtn) {
        reloadBtn.addEventListener('click', () => {
            loadCustomers();
        });
    }
    
    // Create customer form
    const createForm = document.getElementById('createCustomerForm');
    if (createForm) {
        createForm.addEventListener('submit', handleCreateCustomer);
    }
}

// ============================================
// UTILITY FUNCTIONS
// ============================================
function updateLastUpdateTime() {
    const now = new Date();
    const timeStr = now.toLocaleTimeString('vi-VN', { 
        hour: '2-digit', 
        minute: '2-digit' 
    });
    
    const element = document.getElementById('lastUpdate');
    if (element) {
        element.textContent = timeStr;
    }
}

function showAlert(message, type = 'success') {
    const alertContainer = document.getElementById('alertContainer');
    if (!alertContainer) return;
    
    const alertDiv = document.createElement('div');
    alertDiv.className = `alert alert-${type} show`;
    alertDiv.textContent = message;
    alertContainer.appendChild(alertDiv);

    setTimeout(() => {
        alertDiv.classList.remove('show');
        setTimeout(() => alertDiv.remove(), 300);
    }, 5000);
}

function formatDate(dateString) {
    const date = new Date(dateString);
    return date.toLocaleDateString('vi-VN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    });
}

function getStatusBadgeClass(status) {
    const classes = {
        'active': 'success',
        'suspended': 'warning',
        'inactive': 'danger'
    };
    return classes[status] || 'info';
}

// ============================================
// API CUSTOMER MANAGEMENT
// ============================================
async function handleCreateCustomer(e) {
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

            // Display credentials
            displayCredentials(result.data);

            // Reset form
            document.getElementById('createCustomerForm').reset();

            // Reload customers and navigate after delay
            setTimeout(() => {
                loadCustomers();
                navigateToSection('api-customers');
            }, 2000);
        } else {
            showAlert(result.message || 'Có lỗi xảy ra', 'error');
        }
    } catch (error) {
        showAlert('Không thể kết nối đến server', 'error');
        console.error('Create customer error:', error);
    }
}

function displayCredentials(data) {
    document.getElementById('resultCustomerId').textContent = data.customer_id;
    document.getElementById('resultCustomerCode').textContent = data.customer_code;
    document.getElementById('resultClientId').textContent = data.credentials.client_id;
    document.getElementById('resultClientSecret').textContent = data.credentials.client_secret;
    document.getElementById('resultEnvironment').textContent = data.credentials.environment;

    const credentialsBox = document.getElementById('credentialsResult');
    if (credentialsBox) {
        credentialsBox.classList.remove('hidden');
    }
}

async function loadCustomers() {
    const loadingEl = document.getElementById('loadingCustomers');
    const tableBody = document.getElementById('customersTableBody');

    if (!tableBody) return;

    // Show loading
    if (loadingEl) loadingEl.classList.add('show');
    tableBody.innerHTML = '';

    try {
        const response = await fetch(`${API_BASE_URL}/admin/customers`);
        const result = await response.json();

        if (response.ok) {
            const customers = result.data.customers;
            
            // Update stats
            updateCustomerStats(customers);

            // Render table
            if (customers.length === 0) {
                tableBody.innerHTML = `
                    <tr>
                        <td colspan="9" style="text-align: center; padding: 40px; color: var(--text-secondary);">
                            <div class="empty-icon">👥</div>
                            <div class="empty-title">Chưa có khách hàng nào</div>
                            <div class="empty-text">Tạo khách hàng đầu tiên để bắt đầu</div>
                        </td>
                    </tr>
                `;
            } else {
                renderCustomersTable(customers, tableBody);
            }
        } else {
            showAlert(result.message || 'Không thể tải danh sách khách hàng', 'error');
        }
    } catch (error) {
        showAlert('Không thể kết nối đến server', 'error');
        console.error('Load customers error:', error);
    } finally {
        if (loadingEl) loadingEl.classList.remove('show');
    }
}

function renderCustomersTable(customers, tableBody) {
    customers.forEach(customer => {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${customer.id}</td>
            <td><strong>${escapeHtml(customer.customer_code)}</strong></td>
            <td>${escapeHtml(customer.customer_name)}</td>
            <td>${customer.email ? escapeHtml(customer.email) : '-'}</td>
            <td><span class="badge badge-${customer.environment === 'production' ? 'success' : 'warning'}">${customer.environment}</span></td>
            <td><span class="badge badge-${getStatusBadgeClass(customer.status)}">${customer.status}</span></td>
            <td>${customer.rate_limit_per_hour} / ${customer.rate_limit_per_day}</td>
            <td>${formatDate(customer.created_at)}</td>
            <td>
                <button class="btn btn-sm view-customer-btn" data-customer-id="${customer.id}">
                    <span>👁️</span> View
                </button>
            </td>
        `;
        tableBody.appendChild(row);
    });
    
    // Attach event listeners to view buttons
    attachViewCustomerButtons();
}

function attachViewCustomerButtons() {
    const buttons = document.querySelectorAll('.view-customer-btn');
    buttons.forEach(btn => {
        btn.addEventListener('click', (e) => {
            const customerId = e.currentTarget.getAttribute('data-customer-id');
            viewCustomerDetails(customerId);
        });
    });
}

function viewCustomerDetails(customerId) {
    // TODO: Implement customer details modal or page
    showAlert(`Xem chi tiết customer ID: ${customerId} (Coming soon)`, 'info');
}

function updateCustomerStats(customers) {
    const totalCount = customers.length;
    const activeCount = customers.filter(c => c.status === 'active').length;
    
    const customerCountEl = document.getElementById('customerCount');
    const statsCustomerCountEl = document.getElementById('statsCustomerCount');
    const statsActiveCountEl = document.getElementById('statsActiveCount');
    
    if (customerCountEl) customerCountEl.textContent = totalCount;
    if (statsCustomerCountEl) statsCustomerCountEl.textContent = totalCount;
    if (statsActiveCountEl) statsActiveCountEl.textContent = `${activeCount} Active`;
}

// ============================================
// SECURITY HELPERS
// ============================================
function escapeHtml(text) {
    if (!text) return '';
    
    const map = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
    };
    
    return String(text).replace(/[&<>"']/g, m => map[m]);
}

// ============================================
// EXPORT FOR DEBUGGING (Optional)
// ============================================
if (typeof window !== 'undefined') {
    window.DashboardApp = {
        navigateToSection,
        loadCustomers,
        viewCustomerDetails
    };
}