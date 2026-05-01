// public/js/oms-order-detail.js
// Drives the redesigned OMS order detail page focused on ITC label workflow.

const ID = parseInt(window.location.pathname.split('/').pop());
let currentRow = null;

// ─── Helpers ─────────────────────────────────────────────────────────────────
function badge(s) {
    if (!s) return '';
    return '<span class="badge badge-' + s + '">' + s + '</span>';
}

function toast(msg, ok) {
    if (ok === undefined) ok = true;
    const el = document.getElementById('alertToast');
    const txt = document.getElementById('alertText');
    el.classList.remove('success', 'error');
    el.classList.add(ok ? 'success' : 'error');
    txt.textContent = msg;
    el.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => el.classList.remove('show'), 3500);
}

async function fetchJson(url, opts) {
    opts = opts || {};
    const res = await fetch(url, {
        credentials: 'include',
        headers: Object.assign(
            { 'Accept': 'application/json', 'Content-Type': 'application/json' },
            opts.headers || {}
        ),
        ...opts,
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
        throw Object.assign(new Error(body.message || ('HTTP ' + res.status)), {
            status: res.status, body,
        });
    }
    return body;
}

function setVal(id, v) {
    const el = document.getElementById(id);
    if (!el) return;
    el.value = (v === null || v === undefined) ? '' : v;
}

function setText(id, v) {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = (v === null || v === undefined || v === '') ? '—' : v;
}

function setHtml(id, html) {
    const el = document.getElementById(id);
    if (el) el.innerHTML = html || '';
}

function v(id) {
    const el = document.getElementById(id);
    return !el || el.value === '' ? null : el.value;
}

function numOrNull(id) {
    const el = document.getElementById(id);
    if (!el || el.value === '' || el.value === null) return null;
    const n = Number(el.value);
    return Number.isFinite(n) ? n : null;
}

function fmtMoney(n, currency) {
    if (n === null || n === undefined || n === '') return '0';
    const num = Number(n);
    if (!Number.isFinite(num)) return '0';
    const formatted = num.toLocaleString('en-US', {
        minimumFractionDigits: 2, maximumFractionDigits: 2,
    });
    return currency ? `${formatted} ${currency}` : formatted;
}

function fmtNumber(n) {
    if (n === null || n === undefined || n === '') return '—';
    const num = Number(n);
    return Number.isFinite(num) ? num.toLocaleString('en-US') : String(n);
}

function fmtDate(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    const pad = n => String(n).padStart(2, '0');
    return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function escapeHtml(s) {
    if (s === null || s === undefined) return '';
    return String(s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ─── Load & Render ───────────────────────────────────────────────────────────
async function load() {
    try {
        const r = await fetchJson('/api/v1/admin/oms-orders/' + ID);
        currentRow = r.data;
        render(r.data);
    } catch (e) {
        if (e.status === 401) { location.href = '/login'; return; }
        toast('Failed to load: ' + e.message, false);
    }
}

function render(row) {
    // ─── Top bar / page title ──────────────────────────────────────────────
    setText('topbarOrderNum', row.order_number);
    setText('pageTitle', `View OMS Order — ${row.order_number || ''}`);
    setHtml('headStatusBadge', badge(row.internal_status || row.oms_status || 'new'));

    // ─── Sidebar header ────────────────────────────────────────────────────
    setText('sideOrderNumber', row.order_number);
    setHtml('sideStatusBadge', badge(row.internal_status || row.oms_status || 'new'));

    // ─── Receiver (read view) ──────────────────────────────────────────────
    setText('vReceiverName', row.receiver_name);
    setText('vReceiverCompany', row.receiver_company);
    setText('vReceiverPhone', row.receiver_phone);
    setText('vReceiverTaxNumber', row.receiver_tax_number);
    setText('vAddress1', row.receiver_address_line1);
    setText('vAddress2', row.receiver_address_line2);
    setText('vCity', row.receiver_city);
    setText('vState', row.receiver_state);
    setText('vPostalCode', row.receiver_postal_code);
    setText('vCountry', row.receiver_country);

    // ─── Receiver (edit view) ──────────────────────────────────────────────
    setVal('receiverName', row.receiver_name);
    setVal('receiverCompany', row.receiver_company);
    setVal('receiverPhone', row.receiver_phone);
    setVal('receiverTaxNumber', row.receiver_tax_number);
    setVal('receiverCountry', row.receiver_country);
    setVal('receiverState', row.receiver_state);
    setVal('receiverCity', row.receiver_city);
    setVal('receiverPostalCode', row.receiver_postal_code);
    setVal('receiverAddressLine1', row.receiver_address_line1);
    setVal('receiverAddressLine2', row.receiver_address_line2);

    // ─── Package (read) ────────────────────────────────────────────────────
    setText('vWeight', row.package_weight != null ? row.package_weight : '—');
    const dim = (row.package_length && row.package_width && row.package_height)
        ? `${row.package_length} × ${row.package_width} × ${row.package_height}`
        : '—';
    setText('vDimensions', dim);
    setText('vShippingPartner', row.route_shipping_partner);
    setText('vAddressIndex', row.address_index != null ? row.address_index : '—');

    // ─── Package (edit) — only partner + addressIndex; weight/dims are auto ──
    setVal('routeShippingPartner', row.route_shipping_partner);
    setVal('addressIndex', row.address_index);

    // ─── Items table ───────────────────────────────────────────────────────
    renderItemsRead(row.items || [], row.declared_currency || 'USD');
    renderItemsEdit(row.items || []);

    // ─── Pricing (read) ────────────────────────────────────────────────────
    const cur = row.declared_currency || 'USD';
    setText('vShippingPurchase', fmtMoney(row.shipping_fee_purchase, cur));
    setText('vShippingMarkup',
        row.shipping_markup_percent != null ? `${row.shipping_markup_percent}%` : '—');
    setText('vShippingSelling', fmtMoney(row.shipping_fee_selling, cur));
    setText('vGrossProfit', fmtMoney(row.gross_profit, cur));
    setText('vFulfillmentPurchase', fmtMoney(row.fulfillment_fee_purchase, cur));
    setText('vFulfillmentSelling', fmtMoney(row.fulfillment_fee_selling, cur));

    const profitEl = document.getElementById('vGrossProfit');
    if (profitEl) {
        profitEl.style.color = '';
        if (row.gross_profit != null) {
            profitEl.style.color = Number(row.gross_profit) >= 0
                ? 'var(--success)' : 'var(--danger)';
        }
    }

    // Pricing (edit)
    setVal('shippingFeeSelling', row.shipping_fee_selling);
    setVal('fulfillmentFeePurchase', row.fulfillment_fee_purchase);
    setVal('fulfillmentFeeSelling', row.fulfillment_fee_selling);

    // Totals
    setText('vTotalValue',    fmtMoney(row.total_value, cur));
    setText('vTotalDiscount', fmtMoney(row.total_discount, cur));
    setText('vPaidAmount',    fmtMoney(row.paid_amount, cur));
    setText('vRemaining',     fmtMoney(row.remaining_amount, cur));

    // ─── ITC Label ─────────────────────────────────────────────────────────
    const hasLabel = !!(row.tracking_number || row.carrier || row.itc_sid);
    document.getElementById('labelEmpty').classList.toggle('hidden', hasLabel);
    document.getElementById('labelDetails').classList.toggle('hidden', !hasLabel);
    setText('vCarrier', row.carrier);
    setText('vTrackingNumber', row.tracking_number);
    setText('vItcSid', row.itc_sid);
    setHtml('labelLinkWrap', row.label_url
        ? `<a class="btn btn-sm btn-primary" href="${escapeHtml(row.label_url)}" target="_blank" rel="noopener">📄 Open Label PDF</a>`
        : '');

    // ─── Sidebar — General ─────────────────────────────────────────────────
    setText('sOrCode', row.order_number);
    setText('sWarehouse', row.warehouse_code);

    // ─── Sidebar — Dates ───────────────────────────────────────────────────
    setText('sCreatedAt', fmtDate(row.oms_created_at || row.created_at));
    setText('sUpdatedAt', fmtDate(row.oms_updated_at || row.updated_at));
    setText('sSyncedAt', fmtDate(row.synced_at));

    // ─── ITC Preview ──────────────────────────────────────────────────────
    setVal('itcPreview', JSON.stringify(buildItcPayload(row), null, 2));

    // ─── Action buttons ────────────────────────────────────────────────────
    document.getElementById('btnBuyLabel').disabled =
        !['pending', 'selected'].includes(row.internal_status);
}

// Build a preview of the ITC request payload from current row
function buildItcPayload(row) {
    const items = (row.items || []).map(it => ({
        skuNumber: it.sku || it.skuNumber || '',
        productName: it.productName || '',
        itemDescription: it.itemDescription || '',
        quantity: Number(it.quantity || 0),
        itemWeight: Number(it.itemWeight || it.weight || 0),
        itemWidth: Number(it.itemWidth || it.width || 0),
        itemHeight: Number(it.itemHeight || it.height || 0),
        itemLength: Number(it.itemLength || it.length || 0),
        saleUrl: it.saleUrl || '',
    }));

    return {
        orderNumber: row.order_number || '',
        name: row.receiver_name || '',
        company: row.receiver_company || '',
        phone: row.receiver_phone || '',
        address1: row.receiver_address_line1 || '',
        address2: row.receiver_address_line2 || '',
        city: row.receiver_city || '',
        country: row.receiver_country || '',
        state: row.receiver_state || '',
        postalCode: row.receiver_postal_code || '',
        order_weight: Number(row.package_weight || 0),
        order_height: Number(row.package_height || 0),
        order_length: Number(row.package_length || 0),
        order_width: Number(row.package_width || 0),
        route_shipping_partner: row.route_shipping_partner || '',
        taxNumber: row.receiver_tax_number || '',
        addressIndex: row.address_index != null ? Number(row.address_index) : 0,
        items,
    };
}

// ─── Compute package weight / dims from items list ───────────────────────────
// Rules:
//   packageWeight = sum of (item.weight * item.quantity) for all items
//   packageLength = sum of (item.length * item.quantity) for all items
//   packageWidth  = sum of (item.width  * item.quantity) for all items
//   packageHeight = sum of (item.height * item.quantity) for all items
// Any field that sums to 0 (i.e. no values entered) is returned as null.
function computePackageTotalsFromItems(items) {
    let weight = 0;
    let length = 0;
    let width  = 0;
    let height = 0;

    for (const it of items) {
        const qty = Number(it.quantity) || 0;
        weight += (Number(it.weight) || 0) * qty;
        length += (Number(it.length) || 0) * qty;
        width  += (Number(it.width)  || 0) * qty;
        height += (Number(it.height) || 0) * qty;
    }

    // Round to 3 decimal places; return null when nothing was entered
    const round3 = n => Math.round(n * 1000) / 1000;
    return {
        packageWeight: weight > 0 ? round3(weight) : null,
        packageLength: length > 0 ? round3(length) : null,
        packageWidth:  width  > 0 ? round3(width)  : null,
        packageHeight: height > 0 ? round3(height) : null,
    };
}

// ─── Items: read view ────────────────────────────────────────────────────────
function renderItemsRead(items, currency) {
    const body = document.getElementById('itemsBody');
    const foot = document.getElementById('itemsFoot');

    if (!items.length) {
        body.innerHTML = '<tr><td colspan="6" class="text-muted text-center" style="padding:24px;">No items</td></tr>';
        foot.innerHTML = '';
        return;
    }

    let totalQty = 0;
    let totalSub = 0;

    body.innerHTML = items.map((it, i) => {
        const qty = Number(it.quantity || 0);
        const price = Number(it.unitPrice || 0);
        const discount = Number(it.discountValue || 0);
        const subtotal = qty * (price - discount);
        totalQty += qty;
        totalSub += subtotal;

        const sku = it.sku || it.skuNumber || '';
        const url = it.saleUrl ? `<br><a href="${escapeHtml(it.saleUrl)}" target="_blank" rel="noopener" style="font-size:11px;">🔗 Sale URL</a>` : '';
        const dimsBits = [];
        if (it.weight) dimsBits.push(`W:${it.weight}kg`);
        if (it.length || it.width || it.height) {
            dimsBits.push(`${it.length || 0}×${it.width || 0}×${it.height || 0}cm`);
        }
        const dimsLine = dimsBits.length ? `<div class="product-dims">${dimsBits.join(' · ')}</div>` : '';

        return `
            <tr>
                <td class="text-center">${i + 1}</td>
                <td>
                    <div class="product-name">${escapeHtml(it.productName || '—')} ${it.itemDescription ? `<span class="product-desc"> — ${escapeHtml(it.itemDescription)}</span>` : ''}</div>
                    <div class="product-meta">
                        ${sku ? `SKU: ${escapeHtml(sku)}` : ''}
                        ${url}
                    </div>
                    ${dimsLine}
                </td>
                <td class="text-right">${fmtNumber(qty)}</td>
                <td class="text-right">${fmtMoney(price)}</td>
                <td class="text-right">${fmtMoney(discount)}</td>
                <td class="text-right">${fmtMoney(subtotal)}</td>
            </tr>
        `;
    }).join('');

    foot.innerHTML = `
        <tr class="total-row">
            <td colspan="2" class="text-right">Total</td>
            <td class="text-right">${fmtNumber(totalQty)}</td>
            <td colspan="2"></td>
            <td class="text-right">${fmtMoney(totalSub, currency)}</td>
        </tr>
    `;
}

// ─── Items: edit view ────────────────────────────────────────────────────────
function renderItemsEdit(items) {
    const body = document.getElementById('itemsEditBody');
    if (!items.length) {
        body.innerHTML = '';
        addItemRow(); // start with one empty row
        return;
    }
    body.innerHTML = items.map(it => itemRowHtml(it)).join('');
    attachRemoveHandlers();
}

function itemRowHtml(it) {
    it = it || {};
    return `
        <tr>
            <td><input type="text" data-field="sku" value="${escapeHtml(it.sku || it.skuNumber || '')}" placeholder="SKU-001"></td>
            <td><input type="text" data-field="productName" value="${escapeHtml(it.productName || '')}" placeholder="Product Name"></td>
            <td><input type="text" data-field="itemDescription" value="${escapeHtml(it.itemDescription || '')}" placeholder="Item Description"></td>
            <td><input type="number" class="num" data-field="quantity" value="${it.quantity ?? ''}" min="0" step="1"></td>
            <td><input type="number" class="num" data-field="unitPrice" value="${it.unitPrice ?? ''}" min="0" step="0.01"></td>
            <td><input type="number" class="num" data-field="weight" value="${it.weight ?? ''}" min="0" step="0.001" placeholder="kg"></td>
            <td><input type="number" class="num" data-field="length" value="${it.length ?? ''}" min="0" step="0.1" placeholder="cm"></td>
            <td><input type="number" class="num" data-field="width" value="${it.width ?? ''}" min="0" step="0.1" placeholder="cm"></td>
            <td><input type="number" class="num" data-field="height" value="${it.height ?? ''}" min="0" step="0.1" placeholder="cm"></td>
            <td><input type="url" data-field="saleUrl" value="${escapeHtml(it.saleUrl || '')}" placeholder="https://..."></td>
            <td class="col-action"><button type="button" class="btn-remove" title="Remove">×</button></td>
        </tr>
    `;
}

function addItemRow() {
    const body = document.getElementById('itemsEditBody');
    const tmp = document.createElement('tbody');
    tmp.innerHTML = itemRowHtml({});
    body.appendChild(tmp.firstElementChild);
    attachRemoveHandlers();
}

function attachRemoveHandlers() {
    document.querySelectorAll('#itemsEditBody .btn-remove').forEach(btn => {
        btn.onclick = () => {
            const tr = btn.closest('tr');
            if (tr) tr.remove();
        };
    });
}

function collectItemsEdit() {
    const rows = document.querySelectorAll('#itemsEditBody tr');
    const items = [];
    rows.forEach(tr => {
        const get = (field) => {
            const el = tr.querySelector(`[data-field="${field}"]`);
            return el ? el.value : '';
        };
        const num = (field) => {
            const val = get(field);
            if (val === '' || val === null) return null;
            const n = Number(val);
            return Number.isFinite(n) ? n : null;
        };
        const sku = get('sku');
        const productName = get('productName');
        const itemDescription = get('itemDescription');
        // skip empty rows
        if (!sku) return;
        items.push({
            sku: sku,
            productName: productName,
            itemDescription: itemDescription,
            quantity: num('quantity'),
            unitPrice: num('unitPrice'),
            weight: num('weight'),
            length: num('length'),
            width: num('width'),
            height: num('height'),
            saleUrl: get('saleUrl'),
        });
    });
    return items;
}

// ─── Edit mode toggles ───────────────────────────────────────────────────────
function toggleEdit(panel, editing) {
    const map = {
        receiver: ['receiverView', 'receiverEdit'],
        package:  ['packageView',  'packageEdit'],
        items:    ['itemsView',    'itemsEdit'],
        pricing:  ['pricingView',  'pricingEdit'],
    };
    const [readId, editId] = map[panel];
    document.getElementById(readId).classList.toggle('hidden', editing);
    document.getElementById(editId).classList.toggle('hidden', !editing);
}

// ─── Save handlers ───────────────────────────────────────────────────────────
async function patch(body, successMsg) {
    try {
        const r = await fetchJson('/api/v1/admin/oms-orders/' + ID, {
            method: 'PATCH',
            body: JSON.stringify(body),
        });
        currentRow = r.data;
        render(r.data);
        toast(successMsg);
        return true;
    } catch (e) {
        toast(e.message, false);
        return false;
    }
}

async function saveReceiver() {
    const ok = await patch({
        receiverName: v('receiverName'),
        receiverCompany: v('receiverCompany'),
        receiverPhone: v('receiverPhone'),
        receiverTaxNumber: v('receiverTaxNumber'),
        receiverCountry: v('receiverCountry'),
        receiverState: v('receiverState'),
        receiverCity: v('receiverCity'),
        receiverPostalCode: v('receiverPostalCode'),
        receiverAddressLine1: v('receiverAddressLine1'),
        receiverAddressLine2: v('receiverAddressLine2'),
    }, 'Receiver saved');
    if (ok) toggleEdit('receiver', false);
}

// Package save — weight/dims are NOT editable here; only partner + address index.
async function savePackage() {
    const ok = await patch({
        routeShippingPartner: v('routeShippingPartner'),
        addressIndex: numOrNull('addressIndex'),
    }, 'Package saved');
    if (ok) toggleEdit('package', false);
}

// Items save — after persisting items, recompute package weight/dims from the
// collected rows and send a second PATCH to update the package fields.
async function saveItems() {
    const items = collectItemsEdit();

    // Step 1: save items
    const itemsOk = await patch({ items }, 'Items saved');
    if (!itemsOk) return;

    // Step 2: compute package totals from the saved items
    const packageTotals = computePackageTotalsFromItems(items);

    // Only send the second patch when at least one dimension was computed
    const hasAnyTotal = Object.values(packageTotals).some(val => val !== null);
    if (!hasAnyTotal) {
        toggleEdit('items', false);
        return;
    }

    try {
        const r = await fetchJson('/api/v1/admin/oms-orders/' + ID, {
            method: 'PATCH',
            body: JSON.stringify(packageTotals),
        });
        currentRow = r.data;
        render(r.data);
        toast('Items saved · package dimensions updated');
    } catch (e) {
        // Items were already saved successfully; just warn about the dims patch
        toast('Items saved, but failed to update package dimensions: ' + e.message, false);
    }

    toggleEdit('items', false);
}

async function savePricing() {
    try {
        const body = {
            shippingFeeSelling: numOrNull('shippingFeeSelling'),
            fulfillmentFeePurchase: numOrNull('fulfillmentFeePurchase'),
            fulfillmentFeeSelling: numOrNull('fulfillmentFeeSelling'),
        };
        const r = await fetchJson('/api/v1/admin/oms-orders/' + ID + '/pricing', {
            method: 'PATCH',
            body: JSON.stringify(body),
        });
        currentRow = r.data;
        render(r.data);
        toggleEdit('pricing', false);
        toast('Pricing saved (gross profit recomputed)');
    } catch (e) {
        toast(e.message, false);
    }
}

async function buyLabel() {
    if (!confirm('Buy ITC label for this order? This calls ITC and is not reversible.')) return;
    try {
        const r = await fetchJson('/api/v1/admin/oms-orders/' + ID + '/buy-label', {
            method: 'POST', body: JSON.stringify({}),
        });
        currentRow = r.data;
        render(r.data);
        toast('Label purchased successfully');
    } catch (e) {
        toast(e.message, false);
    }
}

async function setStatus() {
    const status = document.getElementById('newStatus').value;
    if (!status) return;
    try {
        const r = await fetchJson('/api/v1/admin/oms-orders/' + ID + '/internal-status', {
            method: 'PATCH', body: JSON.stringify({ status }),
        });
        currentRow = r.data;
        render(r.data);
        document.getElementById('newStatus').value = '';
        toast('Status set to ' + status);
    } catch (e) {
        toast(e.message, false);
    }
}

function copyOrderNum() {
    if (!currentRow || !currentRow.order_number) return;
    navigator.clipboard.writeText(currentRow.order_number)
        .then(() => toast('Copied order number'))
        .catch(() => toast('Copy failed', false));
}

function togglePreview() {
    const body = document.getElementById('itcPreviewBody');
    body.classList.toggle('hidden');
}

// ─── Init ────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    // Receiver
    document.getElementById('btnEditReceiver').addEventListener('click', () => toggleEdit('receiver', true));
    document.getElementById('btnCancelReceiver').addEventListener('click', () => {
        toggleEdit('receiver', false);
        if (currentRow) render(currentRow);
    });
    document.getElementById('btnSaveReceiver').addEventListener('click', saveReceiver);

    // Package
    document.getElementById('btnEditPackage').addEventListener('click', () => toggleEdit('package', true));
    document.getElementById('btnCancelPackage').addEventListener('click', () => {
        toggleEdit('package', false);
        if (currentRow) render(currentRow);
    });
    document.getElementById('btnSavePackage').addEventListener('click', savePackage);

    // Items
    document.getElementById('btnEditItems').addEventListener('click', () => toggleEdit('items', true));
    document.getElementById('btnCancelItems').addEventListener('click', () => {
        toggleEdit('items', false);
        if (currentRow) render(currentRow);
    });
    document.getElementById('btnSaveItems').addEventListener('click', saveItems);
    document.getElementById('btnAddItem').addEventListener('click', addItemRow);

    // Pricing
    document.getElementById('btnEditPricing').addEventListener('click', () => toggleEdit('pricing', true));
    document.getElementById('btnCancelPricing').addEventListener('click', () => {
        toggleEdit('pricing', false);
        if (currentRow) render(currentRow);
    });
    document.getElementById('btnSavePricing').addEventListener('click', savePricing);

    // Top-level actions
    document.getElementById('btnBuyLabel').addEventListener('click', buyLabel);
    document.getElementById('btnSetStatus').addEventListener('click', setStatus);
    document.getElementById('btnCopyOrderNum').addEventListener('click', copyOrderNum);
    document.getElementById('btnTogglePreview').addEventListener('click', togglePreview);

    load();
});