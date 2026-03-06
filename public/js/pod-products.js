/**
 * POD Products Dashboard
 * Manages CRUD operations, filtering, pagination, and Excel import
 * for POD product inventory.
 *
 * All event handlers bound via addEventListener (no inline onclick).
 * API response shape: { success: true, data: { products: [...], pagination: {...} }, message: "..." }
 */

const API_BASE = '/api/v1/admin/pod-products';

// ─── State ───
let products = [];
let currentOffset = 0;
const PAGE_LIMIT = 50;
let totalProducts = 0;
let editingProductId = null;
let importFile = null;
let searchDebounce = null;

// ─── DOM Refs ───
const dom = {
    // Filters
    filterWarehouse: document.getElementById('filterWarehouse'),
    filterSearch: document.getElementById('filterSearch'),
    filterProductGroup: document.getElementById('filterProductGroup'),
    filterStatus: document.getElementById('filterStatus'),

    // Stats
    statTotal: document.getElementById('statTotal'),
    statActive: document.getElementById('statActive'),
    statInactive: document.getElementById('statInactive'),
    statWarehouses: document.getElementById('statWarehouses'),

    // Table
    tableBody: document.getElementById('tableBody'),
    tableLoading: document.getElementById('tableLoading'),
    paginationInfo: document.getElementById('paginationInfo'),
    btnPrev: document.getElementById('btnPrev'),
    btnNext: document.getElementById('btnNext'),

    // Action bar buttons
    btnOpenImport: document.getElementById('btnOpenImport'),
    btnOpenAdd: document.getElementById('btnOpenAdd'),

    // Product Modal
    productModal: document.getElementById('productModal'),
    modalTitle: document.getElementById('modalTitle'),
    productForm: document.getElementById('productForm'),
    productId: document.getElementById('productId'),
    btnSaveProduct: document.getElementById('btnSaveProduct'),
    btnCloseProductModal: document.getElementById('btnCloseProductModal'),
    btnCancelProduct: document.getElementById('btnCancelProduct'),

    // Product form fields
    formWarehouse: document.getElementById('formWarehouse'),
    formItemName: document.getElementById('formItemName'),
    formWarehouseSku: document.getElementById('formWarehouseSku'),
    formProductGroup: document.getElementById('formProductGroup'),
    formSkuKey: document.getElementById('formSkuKey'),
    formSize: document.getElementById('formSize'),
    formColor: document.getElementById('formColor'),
    formWeight: document.getElementById('formWeight'),
    formLength: document.getElementById('formLength'),
    formWidth: document.getElementById('formWidth'),
    formHeight: document.getElementById('formHeight'),
    formGrossPrice: document.getElementById('formGrossPrice'),
    formThgSkuSbsl: document.getElementById('formThgSkuSbsl'),
    formThgSkuSbtt: document.getElementById('formThgSkuSbtt'),
    formThgPriceSbsl: document.getElementById('formThgPriceSbsl'),
    formThgPriceSbtt: document.getElementById('formThgPriceSbtt'),
    formImportTax: document.getElementById('formImportTax'),
    formCustomsFee: document.getElementById('formCustomsFee'),
    formStatus: document.getElementById('formStatus'),

    // Import Modal
    importModal: document.getElementById('importModal'),
    importWarehouse: document.getElementById('importWarehouse'),
    importUploadArea: document.getElementById('importUploadArea'),
    importFileInput: document.getElementById('importFileInput'),
    importFileInfo: document.getElementById('importFileInfo'),
    importFileName: document.getElementById('importFileName'),
    importFileSize: document.getElementById('importFileSize'),
    importResults: document.getElementById('importResults'),
    importResultTitle: document.getElementById('importResultTitle'),
    importResultMessage: document.getElementById('importResultMessage'),
    importResultStats: document.getElementById('importResultStats'),
    btnImport: document.getElementById('btnImport'),
    btnCloseImportModal: document.getElementById('btnCloseImportModal'),
    btnCancelImport: document.getElementById('btnCancelImport'),
    btnRemoveImportFile: document.getElementById('btnRemoveImportFile'),

    // Toast
    toast: document.getElementById('toast'),
};


// ──────────────────────────────────────────
// API Functions
// ──────────────────────────────────────────

async function loadProducts() {
    showTableLoading(true);

    var params = new URLSearchParams();
    if (dom.filterWarehouse.value) params.set('podWarehouse', dom.filterWarehouse.value);
    if (dom.filterSearch.value.trim()) params.set('search', dom.filterSearch.value.trim());
    if (dom.filterProductGroup.value) params.set('productGroup', dom.filterProductGroup.value);
    if (dom.filterStatus.value) params.set('status', dom.filterStatus.value);
    params.set('limit', PAGE_LIMIT);
    params.set('offset', currentOffset);

    try {
        var res = await fetch(API_BASE + '?' + params.toString(), {
            credentials: 'include',
        });

        if (!res.ok) {
            var err = await res.json().catch(function () { return {}; });
            throw new Error(err.message || 'HTTP ' + res.status);
        }

        var data = await res.json();

        // Fix: API returns { success, data: { products: [...], pagination: {...} }, message }
        products = data.data?.products || [];
        totalProducts = data.data?.pagination?.total ?? products.length;

        // Update stat card with total from pagination
        dom.statTotal.textContent = formatNumber(totalProducts);

        renderTable(products);
        updatePagination(totalProducts, PAGE_LIMIT, currentOffset);
    } catch (err) {
        showToast('error', 'Failed to load products: ' + err.message);
        renderEmptyTable();
    } finally {
        showTableLoading(false);
    }
}

async function loadProductGroups() {
    var params = new URLSearchParams();
    if (dom.filterWarehouse.value) params.set('podWarehouse', dom.filterWarehouse.value);

    try {
        var res = await fetch(API_BASE + '/product-groups?' + params.toString(), {
            credentials: 'include',
        });

        if (!res.ok) return;

        var data = await res.json();

        // Fix: API returns { success, data: { groups: [...] } }
        var groups = data.data?.groups || data.data || [];

        // If data.data is not an array and not an object with groups, fallback
        if (!Array.isArray(groups)) {
            groups = [];
        }

        // Preserve current selection
        var current = dom.filterProductGroup.value;
        dom.filterProductGroup.innerHTML = '<option value="">All Groups</option>';

        groups.forEach(function (group) {
            var name = typeof group === 'string' ? group : group.name || group.productGroup;
            if (!name) return;
            var opt = document.createElement('option');
            opt.value = name;
            opt.textContent = name;
            dom.filterProductGroup.appendChild(opt);
        });

        // Restore selection if still valid
        if (current) {
            dom.filterProductGroup.value = current;
        }
    } catch (err) {
        // Silently fail - groups are optional
    }
}

function updateStats(stats) {
    dom.statTotal.textContent = formatNumber(stats.total || 0);
    dom.statActive.textContent = formatNumber(stats.active || 0);
    dom.statInactive.textContent = formatNumber(stats.inactive || 0);
    dom.statWarehouses.textContent = formatNumber(stats.warehouses || 0);
}


// ──────────────────────────────────────────
// Render Functions
// ──────────────────────────────────────────

function renderTable(items) {
    if (!items || items.length === 0) {
        renderEmptyTable();
        return;
    }

    var html = '';
    items.forEach(function (p, i) {
        var rowNum = currentOffset + i + 1;
        var pid = p.id || p._id;
        html += '<tr>';
        html += '<td>' + rowNum + '</td>';
        html += '<td>' + getWarehouseBadge(p.podWarehouse || p.pod_warehouse || '') + '</td>';
        html += '<td>' + escapeHtml(p.itemName || p.item_name || '-') + '</td>';
        html += '<td><code style="font-size:12px">' + escapeHtml(p.warehouseSku || p.warehouse_sku || '-') + '</code></td>';
        html += '<td>' + escapeHtml(p.size || '-') + '</td>';
        html += '<td>' + escapeHtml(p.productColor || p.product_color || '-') + '</td>';
        html += '<td><code style="font-size:12px">' + escapeHtml(p.thgSkuSbsl || p.thg_sku_sbsl || '-') + '</code></td>';
        html += '<td><code style="font-size:12px">' + escapeHtml(p.thgSkuSbtt || p.thg_sku_sbtt || '-') + '</code></td>';
        html += '<td>' + escapeHtml(p.productGroup || p.product_group || '-') + '</td>';
        html += '<td>' + formatPrice(p.grossPrice || p.gross_price) + '</td>';
        html += '<td>' + getStatusBadge(p.status) + '</td>';
        html += '<td class="action-btns">';
        html += '  <button class="btn btn-secondary btn-sm btn-icon" data-action="edit" data-id="' + escapeHtml(pid) + '" title="Edit">&#9998;</button>';
        html += '  <button class="btn btn-danger btn-sm btn-icon" data-action="delete" data-id="' + escapeHtml(pid) + '" title="Delete">&#10005;</button>';
        html += '</td>';
        html += '</tr>';
    });

    dom.tableBody.innerHTML = html;
}

function renderEmptyTable() {
    dom.tableBody.innerHTML =
        '<tr><td colspan="12" class="table-empty">' +
        '<div class="empty-icon">&#128230;</div>' +
        '<p>No products found</p>' +
        '</td></tr>';
}

function getWarehouseBadge(warehouse) {
    var wh = (warehouse || '').toUpperCase();
    var cls = '';
    switch (wh) {
        case 'ONOS': cls = 'badge-wh-onos'; break;
        case 'S2BDIY': cls = 'badge-wh-s2bdiy'; break;
        case 'PRINTPOSS': cls = 'badge-wh-printposs'; break;
        default: cls = '';
    }
    return '<span class="badge ' + cls + '">' + escapeHtml(warehouse) + '</span>';
}

function getStatusBadge(status) {
    if (status === 'active') {
        return '<span class="badge badge-active">Active</span>';
    }
    if (status === 'inactive') {
        return '<span class="badge badge-inactive">Inactive</span>';
    }
    return '<span class="badge">' + escapeHtml(status || '-') + '</span>';
}


// ──────────────────────────────────────────
// Pagination
// ──────────────────────────────────────────

function updatePagination(total, limit, offset) {
    var start = total > 0 ? offset + 1 : 0;
    var end = Math.min(offset + limit, total);

    dom.paginationInfo.textContent = 'Showing ' + start + '-' + end + ' of ' + total;
    dom.btnPrev.disabled = offset <= 0;
    dom.btnNext.disabled = offset + limit >= total;
}

function changePage(direction) {
    if (direction === -1 && currentOffset >= PAGE_LIMIT) {
        currentOffset -= PAGE_LIMIT;
    } else if (direction === 1) {
        currentOffset += PAGE_LIMIT;
    }
    loadProducts();
}


// ──────────────────────────────────────────
// Product Modal (Add / Edit)
// ──────────────────────────────────────────

function openAddModal() {
    editingProductId = null;
    dom.modalTitle.textContent = 'Add Product';
    dom.btnSaveProduct.textContent = 'Save Product';
    dom.productForm.reset();
    dom.productId.value = '';
    dom.formStatus.value = 'active';
    dom.productModal.classList.add('show');
}

async function openEditModal(id) {
    editingProductId = id;
    dom.modalTitle.textContent = 'Edit Product';
    dom.btnSaveProduct.textContent = 'Update Product';

    try {
        var res = await fetch(API_BASE + '/' + id, {
            credentials: 'include',
        });

        if (!res.ok) {
            var err = await res.json().catch(function () { return {}; });
            throw new Error(err.message || 'Failed to load product');
        }

        var data = await res.json();
        var p = data.data || data.product || data;

        dom.productId.value = p.id || p._id || '';
        dom.formWarehouse.value = p.podWarehouse || p.pod_warehouse || '';
        dom.formItemName.value = p.itemName || p.item_name || '';
        dom.formWarehouseSku.value = p.warehouseSku || p.warehouse_sku || '';
        dom.formProductGroup.value = p.productGroup || p.product_group || '';
        dom.formSkuKey.value = p.skuKey || p.sku_key || '';
        dom.formSize.value = p.size || '';
        dom.formColor.value = p.productColor || p.product_color || '';
        dom.formWeight.value = p.weight || '';
        dom.formLength.value = p.length || '';
        dom.formWidth.value = p.width || '';
        dom.formHeight.value = p.height || '';
        dom.formGrossPrice.value = p.grossPrice || p.gross_price || '';
        dom.formThgSkuSbsl.value = p.thgSkuSbsl || p.thg_sku_sbsl || '';
        dom.formThgSkuSbtt.value = p.thgSkuSbtt || p.thg_sku_sbtt || '';
        dom.formThgPriceSbsl.value = p.thgPriceSbsl || p.thg_price_sbsl || '';
        dom.formThgPriceSbtt.value = p.thgPriceSbtt || p.thg_price_sbtt || '';
        dom.formImportTax.value = p.usImportTaxUnit || p.us_import_tax_unit || '';
        dom.formCustomsFee.value = p.customsFeeOrder || p.customs_fee_order || '';
        dom.formStatus.value = p.status || 'active';

        dom.productModal.classList.add('show');
    } catch (err) {
        showToast('error', err.message);
    }
}

function closeProductModal() {
    dom.productModal.classList.remove('show');
    editingProductId = null;
}

async function saveProduct() {
    // Validate required fields
    if (!dom.formWarehouse.value) {
        showToast('warning', 'Please select a warehouse');
        dom.formWarehouse.focus();
        return;
    }
    if (!dom.formItemName.value.trim()) {
        showToast('warning', 'Please enter item name');
        dom.formItemName.focus();
        return;
    }
    if (!dom.formWarehouseSku.value.trim()) {
        showToast('warning', 'Please enter warehouse SKU');
        dom.formWarehouseSku.focus();
        return;
    }

    var body = {
        podWarehouse: dom.formWarehouse.value,
        itemName: dom.formItemName.value.trim(),
        warehouseSku: dom.formWarehouseSku.value.trim(),
        productGroup: dom.formProductGroup.value.trim() || undefined,
        skuKey: dom.formSkuKey.value.trim() || undefined,
        size: dom.formSize.value.trim() || undefined,
        productColor: dom.formColor.value.trim() || undefined,
        weight: parseFloat(dom.formWeight.value) || undefined,
        length: parseFloat(dom.formLength.value) || undefined,
        width: parseFloat(dom.formWidth.value) || undefined,
        height: parseFloat(dom.formHeight.value) || undefined,
        grossPrice: parseFloat(dom.formGrossPrice.value) || undefined,
        thgSkuSbsl: dom.formThgSkuSbsl.value.trim() || undefined,
        thgSkuSbtt: dom.formThgSkuSbtt.value.trim() || undefined,
        thgPriceSbsl: parseFloat(dom.formThgPriceSbsl.value) || undefined,
        thgPriceSbtt: parseFloat(dom.formThgPriceSbtt.value) || undefined,
        usImportTaxUnit: parseFloat(dom.formImportTax.value) || undefined,
        customsFeeOrder: parseFloat(dom.formCustomsFee.value) || undefined,
        status: dom.formStatus.value,
    };

    // Remove undefined values
    Object.keys(body).forEach(function (key) {
        if (body[key] === undefined) delete body[key];
    });

    var isEdit = !!editingProductId;
    var url = isEdit ? API_BASE + '/' + editingProductId : API_BASE;
    var method = isEdit ? 'PATCH' : 'POST';

    dom.btnSaveProduct.disabled = true;
    dom.btnSaveProduct.innerHTML = '<span class="spinner-inline"></span> Saving...';

    try {
        var res = await fetch(url, {
            method: method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            credentials: 'include',
        });

        if (!res.ok) {
            var err = await res.json().catch(function () { return {}; });
            throw new Error(err.message || 'Failed to save product');
        }

        showToast('success', isEdit ? 'Product updated successfully' : 'Product created successfully');
        closeProductModal();
        loadProducts();
        loadProductGroups();
    } catch (err) {
        showToast('error', err.message);
    } finally {
        dom.btnSaveProduct.disabled = false;
        dom.btnSaveProduct.textContent = isEdit ? 'Update Product' : 'Save Product';
    }
}


// ──────────────────────────────────────────
// Delete Product
// ──────────────────────────────────────────

async function deleteProduct(id) {
    if (!confirm('Are you sure you want to delete this product? This action cannot be undone.')) {
        return;
    }

    try {
        var res = await fetch(API_BASE + '/' + id, {
            method: 'DELETE',
            credentials: 'include',
        });

        if (!res.ok) {
            var err = await res.json().catch(function () { return {}; });
            throw new Error(err.message || 'Failed to delete product');
        }

        showToast('success', 'Product deleted successfully');
        loadProducts();
    } catch (err) {
        showToast('error', err.message);
    }
}


// ──────────────────────────────────────────
// Import Modal
// ──────────────────────────────────────────

function openImportModal() {
    importFile = null;
    dom.importWarehouse.value = '';
    dom.importFileInfo.classList.remove('show');
    dom.importResults.classList.remove('show', 'success', 'error');
    dom.btnImport.disabled = true;
    dom.importFileInput.value = '';
    dom.importModal.classList.add('show');
}

function closeImportModal() {
    dom.importModal.classList.remove('show');
    importFile = null;
}

function removeImportFile() {
    importFile = null;
    dom.importFileInfo.classList.remove('show');
    dom.importFileInput.value = '';
    dom.btnImport.disabled = true;
}

function handleImportFileSelect(file) {
    if (!file) return;

    if (!file.name.match(/\.(xlsx|xls)$/i)) {
        showToast('error', 'Please select an Excel file (.xlsx or .xls)');
        return;
    }

    importFile = file;
    dom.importFileName.textContent = file.name;
    dom.importFileSize.textContent = formatFileSize(file.size);
    dom.importFileInfo.classList.add('show');
    dom.importResults.classList.remove('show', 'success', 'error');
    dom.btnImport.disabled = false;
}

async function handleImportFile() {
    if (!dom.importWarehouse.value) {
        showToast('warning', 'Please select a warehouse before importing');
        dom.importWarehouse.focus();
        return;
    }

    if (!importFile) {
        showToast('warning', 'Please select an Excel file to import');
        return;
    }

    var formData = new FormData();
    formData.append('file', importFile);
    formData.append('podWarehouse', dom.importWarehouse.value);

    dom.btnImport.disabled = true;
    dom.btnImport.innerHTML = '<span class="spinner-inline"></span> Importing...';

    try {
        var res = await fetch(API_BASE + '/import', {
            method: 'POST',
            body: formData,
            credentials: 'include',
        });

        var data = await res.json();

        if (!res.ok) {
            throw new Error(data.message || 'Import failed');
        }

        // Show import results — API returns { data: { summary: {...}, errors: [...] } }
        var result = data.data?.summary || data.data || data;
        dom.importResultTitle.textContent = 'Import Complete';
        dom.importResultMessage.textContent = data.message || 'Products imported successfully.';

        var statsHtml = '';
        if (result.created !== undefined) {
            statsHtml += '<span class="result-stat" style="color:#065f46">Created: ' + result.created + '</span>';
        }
        if (result.updated !== undefined) {
            statsHtml += '<span class="result-stat" style="color:#1e40af">Updated: ' + result.updated + '</span>';
        }
        if (result.skipped !== undefined) {
            statsHtml += '<span class="result-stat" style="color:#92400e">Skipped: ' + result.skipped + '</span>';
        }
        if (result.failed !== undefined) {
            statsHtml += '<span class="result-stat" style="color:#991b1b">Failed: ' + result.failed + '</span>';
        }
        if (result.total !== undefined) {
            statsHtml += '<span class="result-stat" style="color:#0f172a">Total: ' + result.total + '</span>';
        }
        dom.importResultStats.innerHTML = statsHtml;

        dom.importResults.classList.remove('error');
        dom.importResults.classList.add('show', 'success');

        showToast('success', 'Products imported successfully');

        // Reload data
        loadProducts();
        loadProductGroups();
    } catch (err) {
        dom.importResultTitle.textContent = 'Import Failed';
        dom.importResultMessage.textContent = err.message;
        dom.importResultStats.innerHTML = '';
        dom.importResults.classList.remove('success');
        dom.importResults.classList.add('show', 'error');

        showToast('error', 'Import failed: ' + err.message);
    } finally {
        dom.btnImport.disabled = false;
        dom.btnImport.innerHTML = 'Import Products';
    }
}


// ──────────────────────────────────────────
// Event Listeners (all bound via addEventListener)
// ──────────────────────────────────────────

// Action bar buttons
dom.btnOpenImport.addEventListener('click', openImportModal);
dom.btnOpenAdd.addEventListener('click', openAddModal);

// Pagination buttons
dom.btnPrev.addEventListener('click', function () { changePage(-1); });
dom.btnNext.addEventListener('click', function () { changePage(1); });

// Product modal buttons
dom.btnCloseProductModal.addEventListener('click', closeProductModal);
dom.btnCancelProduct.addEventListener('click', closeProductModal);
dom.btnSaveProduct.addEventListener('click', saveProduct);

// Prevent form default submission
dom.productForm.addEventListener('submit', function (e) {
    e.preventDefault();
    saveProduct();
});

// Import modal buttons
dom.btnCloseImportModal.addEventListener('click', closeImportModal);
dom.btnCancelImport.addEventListener('click', closeImportModal);
dom.btnImport.addEventListener('click', handleImportFile);
dom.btnRemoveImportFile.addEventListener('click', removeImportFile);

// Table body: delegated click handler for edit/delete buttons
dom.tableBody.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-action]');
    if (!btn) return;

    var action = btn.getAttribute('data-action');
    var id = btn.getAttribute('data-id');

    if (action === 'edit' && id) {
        openEditModal(id);
    } else if (action === 'delete' && id) {
        deleteProduct(id);
    }
});

// Filter changes → reload products
dom.filterWarehouse.addEventListener('change', function () {
    currentOffset = 0;
    loadProducts();
    loadProductGroups();
});

dom.filterProductGroup.addEventListener('change', function () {
    currentOffset = 0;
    loadProducts();
});

dom.filterStatus.addEventListener('change', function () {
    currentOffset = 0;
    loadProducts();
});

// Search with debounce
dom.filterSearch.addEventListener('input', function () {
    clearTimeout(searchDebounce);
    searchDebounce = setTimeout(function () {
        currentOffset = 0;
        loadProducts();
    }, 400);
});

// Import file drag & drop
dom.importUploadArea.addEventListener('click', function () {
    dom.importFileInput.click();
});

dom.importUploadArea.addEventListener('dragover', function (e) {
    e.preventDefault();
    dom.importUploadArea.classList.add('dragover');
});

dom.importUploadArea.addEventListener('dragleave', function () {
    dom.importUploadArea.classList.remove('dragover');
});

dom.importUploadArea.addEventListener('drop', function (e) {
    e.preventDefault();
    dom.importUploadArea.classList.remove('dragover');
    var file = e.dataTransfer.files[0];
    if (file) handleImportFileSelect(file);
});

dom.importFileInput.addEventListener('change', function (e) {
    var file = e.target.files[0];
    if (file) handleImportFileSelect(file);
});

// Close modals on overlay click
dom.productModal.addEventListener('click', function (e) {
    if (e.target === dom.productModal) closeProductModal();
});

dom.importModal.addEventListener('click', function (e) {
    if (e.target === dom.importModal) closeImportModal();
});

// Close modals on Escape key
document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
        if (dom.productModal.classList.contains('show')) closeProductModal();
        if (dom.importModal.classList.contains('show')) closeImportModal();
    }
});


// ──────────────────────────────────────────
// Utility Functions
// ──────────────────────────────────────────

function showTableLoading(show) {
    dom.tableLoading.classList.toggle('show', show);
}

var toastTimer = null;

function showToast(type, message) {
    clearTimeout(toastTimer);
    dom.toast.className = 'toast toast-' + type + ' show';
    dom.toast.textContent = message;
    toastTimer = setTimeout(function () {
        dom.toast.classList.remove('show');
    }, 4000);
}

function escapeHtml(text) {
    if (!text) return '';
    var map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
    return String(text).replace(/[&<>"']/g, function (m) { return map[m]; });
}

function formatNumber(num) {
    return Number(num || 0).toLocaleString();
}

function formatPrice(price) {
    if (price === null || price === undefined || price === '') return '-';
    return Number(price).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

function formatFileSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / 1048576).toFixed(1) + ' MB';
}


// ──────────────────────────────────────────
// Initialize
// ──────────────────────────────────────────

(function init() {
    loadProducts();
    loadProductGroups();
})();
