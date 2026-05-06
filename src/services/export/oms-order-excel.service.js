// src/services/export/oms-order-excel.service.js
//
// Tạo file Excel (.xlsx) cho OMS Orders export với 2 mode:
//   - 'selling' : cột phí selling only, dùng gửi khách hàng
//   - 'full'    : thêm cost + profit, dùng nội bộ (kế toán)
//
// Cấu trúc: 1 sheet = 1 ngày (tên DD.MM) + sheet "Tổng hợp" ở cuối.
// Mỗi order chiếm nhiều dòng (1 dòng / item); phí + receiver chỉ điền dòng đầu.
// Dùng exceljs.

const ExcelJS = require('exceljs');

// ─── Mapping trạng thái ────────────────────────────────────────────────────
const STATUS_LABEL = {
    pending:          'Chờ xử lý',
    selected:         'Đã chọn',
    label_purchasing: 'Đang tạo label',
    label_purchased:  'Đã tạo label',
    oms_updated:      'Đã tạo label',
    shipped:          'Đã bàn giao vận chuyển',
    delivered:        'Đã giao hàng',
    cancelled:        'Đã huỷ',
    failed:           'Thất bại',
    error:            'Lỗi',
};

// ─── Màu sắc ──────────────────────────────────────────────────────────────
const COLOR = {
    HEADER_BG:  '1E5BC6',
    HEADER_FG:  'FFFFFFFF',
    ROW_ALT:    'FFF5F5F5',
    ROW_WHITE:  'FFFFFFFF',
    TOTAL_BG:   'FFFEF9C3',
    PROFIT_POS: 'FFDCFCE7',
    PROFIT_NEG: 'FFFEE2E2',
    PROFIT_POS_FG: '16A34A',
    PROFIT_NEG_FG: 'DC2626',
    SUMMARY_HDR:  '2563EB',
};

const NUM_FMT = '"$"#,##0.00';

// ─── Column widths ────────────────────────────────────────────────────────
// Selling mode: A-R
const WIDTHS_SELLING = [5, 12, 20, 20, 18, 22, 30, 8, 14, 14, 14, 14, 14, 28, 12, 22, 15, 45];
// Full mode: A-W (A-M same, N-R cost cols, S-W = tracking..address)
const WIDTHS_FULL    = [5, 12, 20, 20, 18, 22, 30, 8, 14, 14, 14, 14, 14, 14, 14, 14, 14, 14, 28, 12, 22, 15, 45];

// ─── Helper: date → "DD.MM" ───────────────────────────────────────────────
function toSheetName(d) {
    const day   = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    return `${day}.${month}`;
}

// ─── Helper: format date DD/MM/YYYY ──────────────────────────────────────
function fmtDate(val) {
    if (!val) return '';
    const d = val instanceof Date ? val : new Date(val);
    if (isNaN(d.getTime())) return '';
    return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`;
}

// ─── Helper: full address string ─────────────────────────────────────────
function buildAddress(r) {
    return [r.receiver_address_line1, r.receiver_address_line2,
            r.receiver_city, r.receiver_state,
            r.receiver_postal_code, r.receiver_country]
        .filter(Boolean).join(', ');
}

// ─── Helper: safe number ─────────────────────────────────────────────────
function num(v) {
    const n = Number(v);
    return isNaN(n) ? null : n;
}

// ─── Apply header style to a row ─────────────────────────────────────────
function styleHeader(row) {
    row.eachCell({ includeEmpty: true }, (cell) => {
        cell.font      = { name: 'Arial', size: 10, bold: true, color: { argb: COLOR.HEADER_FG } };
        cell.fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR.HEADER_BG } };
        cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: false };
        cell.border    = {
            bottom: { style: 'thin', color: { argb: 'FFCCCCCC' } },
        };
    });
    row.height = 22;
}

// ─── Apply data row style ─────────────────────────────────────────────────
function styleDataRow(row, isAlt) {
    const bg = isAlt ? COLOR.ROW_ALT : COLOR.ROW_WHITE;
    row.eachCell({ includeEmpty: true }, (cell) => {
        cell.font = { name: 'Arial', size: 10 };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bg } };
        cell.alignment = { vertical: 'top', wrapText: false };
    });
}

// ─── Apply number format to a cell ────────────────────────────────────────
function applyNumFmt(cell, value) {
    if (value == null) { cell.value = null; return; }
    cell.value     = value;
    cell.numFmt    = NUM_FMT;
    cell.alignment = { horizontal: 'right', vertical: 'top' };
}

// ─── Main ─────────────────────────────────────────────────────────────────

/**
 * @param {object[]} orders        — formatted order objects (already include cost fields)
 * @param {string}   mode          — 'selling' | 'full'
 * @param {string}   baseUrl       — process.env.BASE_URL
 * @returns {Promise<Buffer>}
 */
async function generateExcel(orders, mode, baseUrl) {
    const isFull = mode === 'full';
    const wb     = new ExcelJS.Workbook();
    wb.creator  = 'THG-FULFILL';
    wb.created  = new Date();

    // ── Group orders by day ───────────────────────────────────────────────
    // Key = "DD.MM.YYYY" (sort); value = array of orders
    const byDay = new Map();
    for (const o of orders) {
        const src = o.oms_created_at || o.created_at;
        const d   = src ? new Date(src) : new Date();
        const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
        if (!byDay.has(key)) byDay.set(key, []);
        byDay.get(key).push(o);
    }
    const sortedDays = Array.from(byDay.keys()).sort();

    // Summary data accumulated
    const summaryRows = [];

    for (const dayKey of sortedDays) {
        const dayOrders  = byDay.get(dayKey);
        const dateObj    = new Date(dayKey + 'T00:00:00');
        const sheetName  = toSheetName(dateObj);
        const ws         = wb.addWorksheet(sheetName);

        _setColumnWidths(ws, isFull ? WIDTHS_FULL : WIDTHS_SELLING);

        // ── Header ───────────────────────────────────────────────────────
        const headers = _buildHeaders(isFull);
        const headerRow = ws.addRow(headers);
        styleHeader(headerRow);
        ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: headers.length } };
        ws.views = [{ state: 'frozen', ySplit: 1 }];

        // ── Data rows ────────────────────────────────────────────────────
        let stt        = 0;
        let orderIndex = 0;
        let dayStats   = { orders: 0, items: 0, fulfillSell: 0, packSell: 0, shipSell: 0, addFee: 0, totalSell: 0, totalCost: 0, profit: 0 };

        for (const o of dayOrders) {
            stt++;
            orderIndex++;
            const isAlt  = stt % 2 === 0;
            const items  = Array.isArray(o.items) ? o.items : [];
            const rowsN  = Math.max(items.length, 1);

            // Selling fees
            const fulfillSell = num(o.fulfillment_fee_selling);
            const packSell    = num(o.packaging_material_fee_selling);
            const shipSell    = num(o.shipping_fee_selling);
            const addFee      = num(o.additional_fee);
            const totalSell   = _sumNullable([fulfillSell, packSell, shipSell, addFee]);

            // Cost fees (full mode only)
            const shipCost    = num(o.shipping_fee_purchase);
            const fulfillCost = num(o.fulfillment_fee_purchase);
            const packCost    = num(o.packaging_material_fee_cost);
            const totalCost   = isFull ? _sumNullable([shipCost, fulfillCost, packCost]) : null;
            const profit      = isFull && totalSell != null && totalCost != null
                ? totalSell - totalCost : null;

            const labelUrl    = o.label_access_key
                ? `${baseUrl}/api/labels/${o.label_access_key}` : null;
            const fullAddr    = buildAddress(o);

            // Accumulate summary
            dayStats.orders++;
            dayStats.items      += rowsN;
            dayStats.fulfillSell += fulfillSell || 0;
            dayStats.packSell    += packSell    || 0;
            dayStats.shipSell    += shipSell    || 0;
            dayStats.addFee      += addFee      || 0;
            dayStats.totalSell   += totalSell   || 0;
            if (isFull) {
                dayStats.totalCost += totalCost || 0;
                dayStats.profit    += profit    || 0;
            }

            for (let i = 0; i < rowsN; i++) {
                const item   = items[i] || {};
                const isFirst = i === 0;

                const rowData = isFirst
                    ? _buildFirstRow(stt, o, item, fulfillSell, packSell, shipSell, addFee,
                                     totalSell, shipCost, fulfillCost, packCost, totalCost, profit,
                                     labelUrl, fullAddr, isFull)
                    : _buildContinueRow(item, isFull);

                const dataRow = ws.addRow(rowData);
                styleDataRow(dataRow, isAlt);

                // Number format for fee columns
                _applyFeeFormatting(ws, dataRow, isFirst, isFull, profit, labelUrl);
            }
        }

        summaryRows.push({ date: fmtDate(new Date(dayKey + 'T00:00:00')), ...dayStats });
    }

    // ── Sheet "Tổng hợp" ─────────────────────────────────────────────────
    _buildSummarySheet(wb, summaryRows, isFull);

    const buffer = await wb.xlsx.writeBuffer();
    return Buffer.from(buffer);
}

// ─── Build header array ──────────────────────────────────────────────────
function _buildHeaders(isFull) {
    const base = [
        '#', 'Ngày tạo', 'Mã OR', 'Mã OR đối tác', 'Trạng thái',
        'SKU', 'Tên sản phẩm', 'Số lượng',
        'Phí xử lý ($)', 'Phí bao bì ($)', 'Phí ship ($)', 'Additional ($)',
        'Tổng ($)',
    ];
    if (!isFull) {
        return [...base, 'Tracking', 'Label', 'Tên người mua', 'SĐT', 'Địa chỉ'];
    }
    return [
        ...base,
        'Phí ship COST ($)', 'Phí xử lý COST ($)', 'Phí bao bì COST ($)',
        'Tổng COST ($)', 'Profit ($)',
        'Tracking', 'Label', 'Tên người mua', 'SĐT', 'Địa chỉ',
    ];
}

// ─── Column indexes (1-based) ─────────────────────────────────────────────
const COL = {
    NUM: 1, DATE: 2, OR: 3, PARTNER_OR: 4, STATUS: 5,
    SKU: 6, PRODUCT: 7, QTY: 8,
    FULFILL_SELL: 9, PACK_SELL: 10, SHIP_SELL: 11, ADD_FEE: 12,
    TOTAL_SELL: 13,
    // selling mode
    TRACKING_S: 14, LABEL_S: 15, BUYER_S: 16, PHONE_S: 17, ADDR_S: 18,
    // full mode (cost cols after TOTAL_SELL)
    SHIP_COST: 14, FULFILL_COST: 15, PACK_COST: 16, TOTAL_COST: 17, PROFIT: 18,
    TRACKING_F: 19, LABEL_F: 20, BUYER_F: 21, PHONE_F: 22, ADDR_F: 23,
};

// ─── Build first-row data array ───────────────────────────────────────────
function _buildFirstRow(stt, o, item, fulfillSell, packSell, shipSell, addFee,
                         totalSell, shipCost, fulfillCost, packCost, totalCost, profit,
                         labelUrl, fullAddr, isFull) {
    const base = [
        stt,
        fmtDate(o.oms_created_at || o.created_at),
        o.oms_order_number || '',
        o.customer_order_number || '',
        STATUS_LABEL[o.internal_status] || o.internal_status || '',
        item.sku || '',
        item.productName || '',
        num(item.quantity),
        fulfillSell, packSell, shipSell, addFee,
        totalSell,
    ];
    if (!isFull) {
        return [...base, o.tracking_number || '', labelUrl || '', o.receiver_name || '', o.receiver_phone || '', fullAddr];
    }
    return [
        ...base,
        shipCost, fulfillCost, packCost, totalCost, profit,
        o.tracking_number || '', labelUrl || '', o.receiver_name || '', o.receiver_phone || '', fullAddr,
    ];
}

// ─── Build continuation row (item i>0) ───────────────────────────────────
function _buildContinueRow(item, isFull) {
    const len = isFull ? 23 : 18;
    const row = new Array(len).fill(null);
    row[COL.SKU     - 1] = item.sku         || '';
    row[COL.PRODUCT - 1] = item.productName || '';
    row[COL.QTY     - 1] = num(item.quantity);
    return row;
}

// ─── Apply number formatting / hyperlinks to fee cells ────────────────────
function _applyFeeFormatting(ws, dataRow, isFirst, isFull, profit, labelUrl) {
    // Fee columns (I-M = 9-13)
    const feeCols = [COL.FULFILL_SELL, COL.PACK_SELL, COL.SHIP_SELL, COL.ADD_FEE, COL.TOTAL_SELL];
    feeCols.forEach(c => {
        const cell = dataRow.getCell(c);
        if (cell.value != null) {
            cell.numFmt    = NUM_FMT;
            cell.alignment = { horizontal: 'right', vertical: 'top' };
        }
    });

    // Highlight Tổng selling
    const totalSellCell = dataRow.getCell(COL.TOTAL_SELL);
    if (totalSellCell.value != null) {
        totalSellCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR.TOTAL_BG } };
        totalSellCell.font = { name: 'Arial', size: 10, bold: true };
    }

    if (isFull) {
        [COL.SHIP_COST, COL.FULFILL_COST, COL.PACK_COST, COL.TOTAL_COST].forEach(c => {
            const cell = dataRow.getCell(c);
            if (cell.value != null) {
                cell.numFmt    = NUM_FMT;
                cell.alignment = { horizontal: 'right', vertical: 'top' };
            }
        });

        const profitCell = dataRow.getCell(COL.PROFIT);
        if (profitCell.value != null) {
            profitCell.numFmt    = NUM_FMT;
            profitCell.alignment = { horizontal: 'right', vertical: 'top' };
            const pNum = Number(profitCell.value);
            if (pNum > 0) {
                profitCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR.PROFIT_POS } };
                profitCell.font = { name: 'Arial', size: 10, color: { argb: COLOR.PROFIT_POS_FG } };
            } else if (pNum < 0) {
                profitCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR.PROFIT_NEG } };
                profitCell.font = { name: 'Arial', size: 10, color: { argb: COLOR.PROFIT_NEG_FG } };
            }
        }
    }

    // Label URL — gắn thẳng URL text (hyperlink object không tương thích tốt)
    if (isFirst && labelUrl) {
        const labelCol  = isFull ? COL.LABEL_F : COL.LABEL_S;
        const labelCell = dataRow.getCell(labelCol);
        labelCell.value = labelUrl;
        labelCell.font  = { name: 'Arial', size: 10 };
    }
}

// ─── Set column widths ────────────────────────────────────────────────────
function _setColumnWidths(ws, widths) {
    widths.forEach((w, i) => {
        ws.getColumn(i + 1).width = w;
    });
}

// ─── Summary sheet ────────────────────────────────────────────────────────
function _buildSummarySheet(wb, rows, isFull) {
    const ws = wb.addWorksheet('Tổng hợp');
    _setColumnWidths(ws, isFull ? [14, 10, 10, 16, 16, 16, 16, 16, 16, 16] : [14, 10, 10, 16, 16, 16, 16, 16]);

    const headers = ['Ngày', 'Số đơn', 'Số items', 'Tổng Phí xử lý ($)', 'Tổng Phí bao bì ($)', 'Tổng Phí ship ($)', 'Tổng Additional ($)', 'Tổng Selling ($)'];
    if (isFull) { headers.push('Tổng COST ($)', 'Profit ($)'); }

    const hRow = ws.addRow(headers);
    styleHeader(hRow);
    ws.views = [{ state: 'frozen', ySplit: 1 }];

    let grandTotal = { orders: 0, items: 0, fulfillSell: 0, packSell: 0, shipSell: 0, addFee: 0, totalSell: 0, totalCost: 0, profit: 0 };

    rows.forEach((r, idx) => {
        const rowData = [r.date, r.orders, r.items, r.fulfillSell, r.packSell, r.shipSell, r.addFee, r.totalSell];
        if (isFull) rowData.push(r.totalCost, r.profit);
        const dRow = ws.addRow(rowData);
        styleDataRow(dRow, idx % 2 !== 0);
        _applySummaryNumFmt(dRow, isFull);

        grandTotal.orders     += r.orders;
        grandTotal.items      += r.items;
        grandTotal.fulfillSell+= r.fulfillSell;
        grandTotal.packSell   += r.packSell;
        grandTotal.shipSell   += r.shipSell;
        grandTotal.addFee     += r.addFee;
        grandTotal.totalSell  += r.totalSell;
        if (isFull) {
            grandTotal.totalCost += r.totalCost;
            grandTotal.profit    += r.profit;
        }
    });

    // Grand total row
    const totData = ['Grand Total', grandTotal.orders, grandTotal.items,
        grandTotal.fulfillSell, grandTotal.packSell, grandTotal.shipSell,
        grandTotal.addFee, grandTotal.totalSell];
    if (isFull) totData.push(grandTotal.totalCost, grandTotal.profit);
    const totRow = ws.addRow(totData);
    totRow.eachCell({ includeEmpty: true }, cell => {
        cell.font = { name: 'Arial', size: 10, bold: true };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE0E7FF' } };
    });
    _applySummaryNumFmt(totRow, isFull);
}

function _applySummaryNumFmt(row, isFull) {
    const numCols = isFull ? [4, 5, 6, 7, 8, 9, 10] : [4, 5, 6, 7, 8];
    numCols.forEach(c => {
        const cell = row.getCell(c);
        if (cell.value != null) {
            cell.numFmt    = NUM_FMT;
            cell.alignment = { horizontal: 'right' };
        }
    });

    if (isFull) {
        const profitCell = row.getCell(10);
        if (profitCell.value != null) {
            const p = Number(profitCell.value);
            profitCell.font = { name: 'Arial', size: 10,
                color: { argb: p > 0 ? COLOR.PROFIT_POS_FG : p < 0 ? COLOR.PROFIT_NEG_FG : '000000' },
                bold: row.getCell(1).value === 'Grand Total',
            };
        }
    }
}

// ─── Helper: sum array of nullable numbers ────────────────────────────────
function _sumNullable(arr) {
    const valid = arr.filter(v => v != null);
    if (!valid.length) return null;
    return valid.reduce((a, b) => a + b, 0);
}

module.exports = { generateExcel };
