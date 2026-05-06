/**
 * js/sections/warehouse-billing.js  — v3
 * Admin — Warehouse Billing section (phiếu phí kho US).
 * Exposes: window.WarehouseBilling
 * Depends on: dashboard.core.js (showAlert, toast, esc, val, addClick, API)
 *
 * Layout create: 2-col (left = meta + chip picker + totals + save / right = section blocks)
 * Features:
 *  - Toggle section chip; "Bỏ chọn" button on block header
 *  - Add extra rows: Inspection Fee (canAdd) & Phí Khác (canAdd)
 *  - Delete individual row
 *  - Smart dirty-flag: switching to List/Summary after save auto-reloads
 */

(function (global) {
    'use strict';

    var WB_API = '/api/v1/admin/oms-warehouse-billing';

    // ── SVG icons ────────────────────────────────────────────────────────────
    var IC = {
        plus:    '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>',
        list:    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>',
        chart:   '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/><line x1="2" y1="20" x2="22" y2="20"/></svg>',
        save:    '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>',
        trash:   '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2"/></svg>',
        close:   '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
        refresh: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 11-2.12-9.36L23 10"/></svg>',
        chevL:   '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="15 18 9 12 15 6"/></svg>',
        chevR:   '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="9 18 15 12 9 6"/></svg>',
        eye:     '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>',
        x:       '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
        wh:      '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>',
        reset:   '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M3 12a9 9 0 109-9 9.75 9.75 0 00-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>',
    };

    // ── Section definitions ──────────────────────────────────────────────────
    var SECTIONS = [
        { id:1, label:'Inbound Receiving',  emoji:'📦', canAdd:false, items:[
            {id:'inb_01',name:'Inbound Receiving',unit:'/shipment',sp:0,cost:0,free:true},
        ]},
        { id:2, label:'Inspection Fee',     emoji:'🔍', canAdd:true,  items:[
            {id:'ins_01',name:'Small parcels (<20 items/carton)',     unit:'/carton',         sp:0,    cost:0,    free:true},
            {id:'ins_02',name:'Single product type, quick check',      unit:'/carton',         sp:2.5,  cost:2.0,  free:false},
            {id:'ins_03',name:'Mixed carton, multiple product types',  unit:'/carton',         sp:6.25, cost:5.0,  free:false},
            {id:'ins_04',name:'Large items packed by CBM',             unit:'/CBM',            sp:38,   cost:30,   free:false},
            {id:'ins_05',name:'Periodic inventory check (on request)', unit:'/hr or /1500pcs', sp:30,   cost:20,   free:false},
            {id:'ins_06',name:'Other cases',                           unit:'',                sp:null, cost:null, free:false},
        ]},
        { id:3, label:'Storage Fee',        emoji:'🗄️', canAdd:false, items:[
            {id:'sto_01',name:'Storage Fee',unit:'/pc/month or /CBM',sp:null,cost:null,free:false},
        ]},
        { id:6, label:'Return Handling',    emoji:'↩️', canAdd:false, items:[
            {id:'ret_01',name:'Return Handling',unit:'/shipment',sp:0,cost:0,free:true},
        ]},
        { id:8, label:'Return Export Fee',  emoji:'📤', canAdd:false, items:[
            {id:'rex_01',name:'Return Export Fee',unit:'/carton',sp:2.5,cost:2.0,free:false},
        ]},
        { id:9, label:'Phí Khác',           emoji:'➕', canAdd:true,  items:[] },
    ];

    // ── State ────────────────────────────────────────────────────────────────
    var _customers     = [];
    var _selectedSecs  = new Set();
    var _createRows    = {};   // { sectionId: [row …] }
    var _listOffset    = 0;
    var _listLimit     = 50;
    var _listTotal     = 0;
    var _viewingSlipId = null;
    var _initialized   = false;
    var _activeTab     = 'create';
    var _listDirty     = false;
    var _summaryDirty  = false;

    // ── CSS (injected once into head) ────────────────────────────────────────
    var WB_CSS = [
        '.wb-tab-bar{display:flex;gap:2px;background:var(--bg-secondary);border:1px solid var(--border);border-radius:10px;padding:3px;width:fit-content;}',
        '.wb-tab-btn{display:inline-flex;align-items:center;gap:6px;padding:7px 15px;border:none;border-radius:7px;font-size:13px;font-weight:500;color:var(--text-secondary);background:transparent;cursor:pointer;transition:all .16s;white-space:nowrap;}',
        '.wb-tab-btn:hover{color:var(--text-primary);}',
        '.wb-tab-btn.wb-active{background:var(--bg-primary);color:var(--primary);box-shadow:0 1px 4px rgba(0,0,0,.10);}',
        /* 2-col */
        '.wb-create-wrap{display:grid;grid-template-columns:1fr 256px;gap:18px;align-items:start;}',
        '@media(max-width:860px){.wb-create-wrap{grid-template-columns:1fr;}}',
        /* Left panel */
        '.wb-right{display:flex;flex-direction:column;gap:14px;position:sticky;top:calc(var(--header-height,64px) + 24px);}',
        '.wb-panel{background:var(--bg-primary);border:1px solid var(--border);border-radius:10px;padding:16px;}',
        '.wb-panel-title{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:var(--text-secondary);margin-bottom:12px;}',
        /* Chips — vertical */
        '.wb-chips{display:flex;flex-wrap:wrap;gap:6px;}',
        '.wb-chip{display:flex;align-items:center;gap:8px;padding:8px 12px;border-radius:8px;font-size:13px;font-weight:500;border:1.5px solid var(--border);background:var(--bg-secondary);color:var(--text-secondary);cursor:pointer;transition:all .16s;user-select:none;text-align:left;}',
        '.wb-chip:hover{border-color:var(--primary);color:var(--primary);background:var(--primary-light);}',
        '.wb-chip.wb-on{border-color:var(--primary);background:var(--primary-light);color:var(--primary);}',
        '.wb-chip-check{margin-left:auto;opacity:0;transition:opacity .15s;}',
        '.wb-chip.wb-on .wb-chip-check{opacity:1;}',
        /* Totals */
        '.wb-totals-block{display:flex;flex-direction:column;gap:8px;}',
        '.wb-total-row{display:flex;justify-content:space-between;align-items:center;padding:8px 10px;border-radius:7px;background:var(--bg-secondary);}',
        '.wb-total-lbl{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.4px;color:var(--text-secondary);}',
        '.wb-total-val{font-size:15px;font-weight:700;font-variant-numeric:tabular-nums;}',
        /* Section blocks */
        '.wb-sec-block{background:var(--bg-primary);border:1px solid var(--border);border-radius:10px;margin-bottom:12px;overflow:hidden;}',
        '.wb-sec-hd{display:flex;align-items:center;gap:8px;padding:9px 14px;border-bottom:1px solid var(--border);background:var(--bg-secondary);}',
        '.wb-sec-hd-lbl{flex:1;font-size:13px;font-weight:600;color:var(--primary);}',
        /* Table */
        '.wb-tbl{width:100%;border-collapse:collapse;}',
        '.wb-tbl th{text-align:left;padding:7px 10px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--text-secondary);background:var(--bg-secondary);border-bottom:1px solid var(--border);}',
        '.wb-tbl td{padding:8px 10px;font-size:13px;border-bottom:1px solid var(--border);vertical-align:middle;}',
        '.wb-tbl tr:last-child td{border-bottom:none;}',
        '.wb-tbl tr:hover td{background:var(--bg-secondary);}',
        /* List table (slightly bigger padding) */
        '.wb-ltbl{width:100%;border-collapse:collapse;}',
        '.wb-ltbl th{text-align:left;padding:9px 12px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--text-secondary);background:var(--bg-secondary);border-bottom:1px solid var(--border);}',
        '.wb-ltbl td{padding:10px 12px;font-size:13px;border-bottom:1px solid var(--border);vertical-align:middle;}',
        '.wb-ltbl tr:last-child td{border-bottom:none;}',
        '.wb-ltbl tr[data-slip]:hover td{background:var(--bg-secondary);cursor:pointer;}',
        /* Inputs */
        '.wb-inp{width:100%;padding:5px 8px;border:1px solid var(--border);border-radius:6px;font-size:12px;background:var(--bg-primary);color:var(--text-primary);transition:border-color .14s;box-sizing:border-box;}',
        '.wb-inp:focus{outline:none;border-color:var(--primary);box-shadow:0 0 0 2px rgba(37,99,235,.1);}',
        '.wb-inp-r{text-align:right;font-variant-numeric:tabular-nums;}',
        /* Buttons */
        '.wb-del-btn{display:inline-flex;align-items:center;justify-content:center;padding:4px 6px;border:1px solid transparent;border-radius:5px;background:none;color:var(--text-secondary);cursor:pointer;transition:all .14s;}',
        '.wb-del-btn:hover{border-color:var(--danger);color:var(--danger);background:var(--danger-light);}',
        '.wb-add-row-wrap{padding:7px 12px;border-top:1px dashed var(--border);}',
        '.wb-add-btn{display:inline-flex;align-items:center;gap:5px;font-size:12px;font-weight:500;color:var(--primary);background:none;border:none;cursor:pointer;padding:3px 0;}',
        '.wb-add-btn:hover{text-decoration:underline;}',
        '.wb-icon-btn{display:inline-flex;align-items:center;justify-content:center;padding:4px 7px;border:1px solid var(--border);border-radius:6px;background:var(--bg-primary);color:var(--text-secondary);cursor:pointer;transition:all .14s;}',
        '.wb-icon-btn:hover{border-color:var(--primary);color:var(--primary);}',
        /* Empty right */
        '.wb-empty-sec{border:2px dashed var(--border);border-radius:10px;padding:40px 20px;text-align:center;color:var(--text-secondary);}',
        '.wb-empty-sec p{font-size:13px;font-weight:500;margin-top:10px;}',
        /* Free badge */
        '.wb-free-badge{display:inline-block;padding:2px 7px;border-radius:4px;font-size:10px;font-weight:700;background:var(--success-light);color:#065f46;margin-left:4px;}',
        /* Stats row */
        '.wb-stat-row{display:grid;grid-template-columns:repeat(auto-fit,minmax(110px,1fr));gap:10px;margin-bottom:12px;}',
        '.wb-stat{padding:12px 14px;border:1px solid var(--border);border-radius:8px;background:var(--bg-primary);}',
        '.wb-stat-lbl{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--text-secondary);margin-bottom:4px;}',
        '.wb-stat-val{font-size:19px;font-weight:700;font-variant-numeric:tabular-nums;}',
        /* Context bar */
        '.wb-ctx-bar{display:flex;align-items:center;gap:8px;padding:9px 14px;border-radius:8px;background:var(--primary-light);border:1px solid var(--primary);color:var(--primary);font-size:12px;font-weight:500;margin-bottom:10px;}',
        '.wb-ctx-warn{display:flex;align-items:center;gap:8px;padding:9px 14px;border-radius:8px;background:#fef9c3;border:1px solid #ca8a04;color:#854d0e;font-size:12px;font-weight:500;margin-bottom:10px;}',
        /* Summary customer table */
        '.wb-sum-tbl{width:100%;border-collapse:collapse;}',
        '.wb-sum-tbl th{text-align:left;padding:9px 12px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--text-secondary);background:var(--bg-secondary);border-bottom:1px solid var(--border);}',
        '.wb-sum-tbl td{padding:10px 12px;font-size:13px;border-bottom:1px solid var(--border);vertical-align:middle;}',
        '.wb-sum-tbl tr.wb-sum-main:hover td{background:var(--bg-secondary);cursor:pointer;}',
        '.wb-sum-tbl tr.wb-sum-main td{border-bottom:none;}',
        '.wb-sum-tbl tr.wb-sum-detail td{background:var(--bg-secondary);border-bottom:1px solid var(--border);padding:0;}',
        '.wb-sum-detail-inner{padding:12px 16px 14px 28px;display:grid;grid-template-columns:1fr 1fr;gap:16px;}',
        '.wb-sum-detail-sec{font-size:12px;}',
        '.wb-sum-detail-hd{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--text-secondary);margin-bottom:6px;}',
        '.wb-sum-detail-row{display:flex;justify-content:space-between;padding:3px 0;border-bottom:1px dashed var(--border);}',
        '.wb-sum-detail-row:last-child{border-bottom:none;}',
        '.wb-sum-detail-lbl{color:var(--text-secondary);}',
        '.wb-expand-btn{display:inline-flex;align-items:center;gap:4px;font-size:11px;padding:3px 8px;border:1px solid var(--border);border-radius:5px;background:none;cursor:pointer;color:var(--text-secondary);transition:all .14s;}',
        '.wb-expand-btn:hover{border-color:var(--primary);color:var(--primary);}',
        /* Misc */
        '.wb-money{font-variant-numeric:tabular-nums;}',
    ].join('');

    // ── HTML ─────────────────────────────────────────────────────────────────
    var WB_HTML = [
        '<div id="wbRoot">',

        // Header + tabs
        '<div style="display:flex;align-items:center;gap:10px;margin-bottom:20px;flex-wrap:wrap;">',
        '  <div style="color:var(--primary);">' + IC.wh + '</div>',
        '  <div>',
        '    <h2 class="card-title" style="margin-bottom:1px;">Warehouse Billing</h2>',
        '    <p style="font-size:12px;color:var(--text-secondary);">Phiếu phí kho US — kiểm toán cuối tháng</p>',
        '  </div>',
        '  <div style="margin-left:auto;">',
        '    <div class="wb-tab-bar">',
        '      <button class="wb-tab-btn wb-active" data-wb-tab="create">' + IC.plus + ' Tạo Phiếu</button>',
        '      <button class="wb-tab-btn" data-wb-tab="list">' + IC.list + ' Danh Sách</button>',
        '      <button class="wb-tab-btn" data-wb-tab="summary">' + IC.chart + ' Tổng Hợp</button>',
        '    </div>',
        '  </div>',
        '</div>',

        // ══ CREATE ══
        '<div id="wb-tab-create" class="wb-pw">',
        '  <div class="wb-create-wrap">',


        // ── Left col: section blocks
        '    <div id="wbSectionBlocks">',

                // Chip picker
        '      <div class="wb-panel" style="margin-bottom:18px;">',
        '        <div class="wb-panel-title">Hạng mục phí</div>',
        '        <div class="wb-chips" id="wbChips"></div>',
        '      </div>',
        
        '      <div class="wb-empty-sec" id="wbEmptySec">',
        '        <div style="font-size:36px;">☝️</div>',
        '        <p>Chọn hạng mục phí ở trên để nhập</p>',
        '      </div>',
        '    </div>',

        // ── Right col
        '    <div class="wb-right">',

        // Meta
        '      <div class="wb-panel">',
        '        <div class="wb-panel-title">Thông tin phiếu</div>',
        '        <div class="form-group" style="margin-bottom:12px;">',
        '          <label class="form-label required" style="font-size:12px;">Khách hàng</label>',
        '          <select class="form-select" id="wbCreateCustomer" style="font-size:13px;padding:8px 10px;"><option value="">— Chọn —</option></select>',
        '        </div>',
        '        <div class="form-group" style="margin-bottom:12px;">',
        '          <label class="form-label required" style="font-size:12px;">Ngày phát sinh</label>',
        '          <input type="date" class="form-input" id="wbCreateDate" style="font-size:13px;padding:8px 10px;">',
        '        </div>',
        '        <div class="form-group" style="margin-bottom:0;">',
        '          <label class="form-label" style="font-size:12px;">Ghi chú</label>',
        '          <textarea class="form-input" id="wbCreateNote" rows="2" placeholder="VD: nhập đợt 3, kiểm kho T5…" style="font-size:12px;resize:vertical;padding:8px 10px;"></textarea>',
        '        </div>',
        '      </div>',

        // Totals + actions (hidden until a section is selected)
        '      <div class="wb-panel" id="wbTotalsPanel" style="display:none;">',
        '        <div class="wb-panel-title">Tổng phiếu</div>',
        '        <div class="wb-totals-block">',
        '          <div class="wb-total-row">',
        '            <span class="wb-total-lbl">Revenue</span>',
        '            <span class="wb-total-val wb-money" style="color:var(--primary);">$<span id="wbTotalRevenue">0.00</span></span>',
        '          </div>',
        '          <div class="wb-total-row">',
        '            <span class="wb-total-lbl">Cost</span>',
        '            <span class="wb-total-val wb-money" style="color:var(--danger);">$<span id="wbTotalCost">0.00</span></span>',
        '          </div>',
        '          <div class="wb-total-row" style="background:var(--primary-light);">',
        '            <span class="wb-total-lbl" style="color:var(--primary);">Profit</span>',
        '            <span class="wb-total-val wb-money" id="wbProfitSpan" style="color:var(--primary);">$<span id="wbTotalProfit">0.00</span></span>',
        '          </div>',
        '        </div>',
        '        <div style="margin-top:14px;display:flex;flex-direction:column;gap:8px;">',
        '          <button class="btn btn-primary" id="wbBtnSubmit" style="gap:6px;width:100%;justify-content:center;">' + IC.save + ' Lưu Phiếu</button>',
        '          <button class="btn" id="wbBtnReset" style="gap:6px;width:100%;justify-content:center;">' + IC.reset + ' Đặt lại</button>',
        '        </div>',
        '      </div>',

        '    </div>',

        '  </div>',
        '</div>',

        // ══ LIST ══
        '<div id="wb-tab-list" class="wb-pw" style="display:none;">',
        '  <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-bottom:16px;">',
        '    <div class="filter-group"><span class="filter-label">Tháng</span>',
        '      <input type="month" class="form-input" id="wbListMonth" style="font-size:13px;width:148px;"></div>',
        '    <div class="filter-group"><span class="filter-label">Khách hàng</span>',
        '      <select class="form-select" id="wbListCustomer" style="font-size:13px;"><option value="">Tất cả</option></select></div>',
        '    <button class="btn btn-sm" id="wbBtnLoadList" style="gap:5px;">' + IC.refresh + ' Lọc</button>',
        '  </div>',
        '  <div class="content-card" style="padding:0;overflow:hidden;">',
        '    <table class="wb-ltbl">',
        '      <thead><tr>',
        '        <th style="width:44px;">#</th><th>Ngày</th><th>Khách hàng</th><th>Ghi chú</th>',
        '        <th style="text-align:right;">Revenue</th><th style="text-align:right;">Cost</th><th style="text-align:right;">Profit</th>',
        '        <th>Tạo bởi</th><th style="width:36px;"></th>',
        '      </tr></thead>',
        '      <tbody id="wbListBody"></tbody>',
        '    </table>',
        '    <div id="wbListEmpty" style="display:none;text-align:center;padding:48px;color:var(--text-secondary);font-size:13px;">Không có phiếu nào</div>',
        '  </div>',
        '  <div class="pagination" style="margin-top:12px;">',
        '    <span class="pagination-info" id="wbListInfo"></span>',
        '    <div class="pagination-controls">',
        '      <button class="page-btn" id="wbBtnPrev" disabled>' + IC.chevL + '</button>',
        '      <button class="page-btn" id="wbBtnNext" disabled>' + IC.chevR + '</button>',
        '    </div>',
        '  </div>',
        '</div>',

        // ══ SUMMARY ══
        '<div id="wb-tab-summary" class="wb-pw" style="display:none;">',
        '  <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-bottom:16px;">',
        '    <div class="filter-group"><span class="filter-label">Tháng</span>',
        '      <input type="month" class="form-input" id="wbSummaryMonth" style="font-size:13px;width:148px;"></div>',
        '    <div class="filter-group"><span class="filter-label">Khách hàng</span>',
        '      <select class="form-select" id="wbSummaryCustomer" style="font-size:13px;"><option value="">Tất cả</option></select></div>',
        '    <button class="btn btn-primary btn-sm" id="wbBtnLoadSummary" style="gap:5px;">' + IC.chart + ' Xem</button>',
        '  </div>',

        '  <div id="wbSummaryBody2" style="display:none;">',

        // Context bar
        '    <div id="wbSumCtxBar" class="wb-ctx-bar"></div>',
        '    <div id="wbSumWarnBar" class="wb-ctx-warn" style="display:none;"></div>',

        // Row 1 — OMS Orders
        '    <div class="wb-stat-row" id="wbSumRow1">',
        '      <div class="wb-stat"><div class="wb-stat-lbl">OMS Revenue</div><div class="wb-stat-val wb-money" style="color:var(--primary);" id="wbSumOmsRev">—</div></div>',
        '      <div class="wb-stat"><div class="wb-stat-lbl">OMS Cost</div><div class="wb-stat-val wb-money" style="color:var(--danger);" id="wbSumOmsCost">—</div></div>',
        '      <div class="wb-stat"><div class="wb-stat-lbl">OMS Profit</div><div class="wb-stat-val wb-money" style="color:var(--success);" id="wbSumOmsProfit">—</div></div>',
        '      <div class="wb-stat"><div class="wb-stat-lbl">Đơn hàng</div><div class="wb-stat-val" style="color:var(--warning);" id="wbSumOmsCount">—</div></div>',
        '    </div>',

        // Row 2 — WH + Combined
        '    <div class="wb-stat-row" id="wbSumRow2">',
        '      <div class="wb-stat"><div class="wb-stat-lbl">WH Revenue</div><div class="wb-stat-val wb-money" style="color:var(--primary);" id="wbSumWhRev">—</div></div>',
        '      <div class="wb-stat"><div class="wb-stat-lbl">WH Cost</div><div class="wb-stat-val wb-money" style="color:var(--danger);" id="wbSumWhCost">—</div></div>',
        '      <div class="wb-stat"><div class="wb-stat-lbl">Total Revenue</div><div class="wb-stat-val wb-money" style="color:var(--primary);" id="wbSumCombRev">—</div></div>',
        '      <div class="wb-stat" style="background:var(--primary-light);border-color:var(--primary);"><div class="wb-stat-lbl" style="color:var(--primary);">Total Profit</div><div class="wb-stat-val wb-money" style="color:var(--primary);" id="wbSumCombProfit">—</div></div>',
        '    </div>',

        // Customer table
        '    <div class="content-card" style="padding:0;overflow:hidden;margin-top:4px;">',
        '      <table class="wb-sum-tbl">',
        '        <thead><tr>',
        '          <th style="width:32px;"></th>',
        '          <th>Khách hàng</th>',
        '          <th style="text-align:right;">OMS (đơn)</th>',
        '          <th style="text-align:right;">Phiếu kho</th>',
        '          <th style="text-align:right;">Total Rev</th>',
        '          <th style="text-align:right;">Total Cost</th>',
        '          <th style="text-align:right;">Profit</th>',
        '          <th style="text-align:right;">Margin</th>',
        '        </tr></thead>',
        '        <tbody id="wbSummaryTbody"></tbody>',
        '      </table>',
        '    </div>',

        '  </div>',
        '  <div id="wbSummaryEmpty" style="display:none;text-align:center;padding:48px;color:var(--text-secondary);font-size:13px;">Không có dữ liệu tháng này</div>',
        '</div>',

        '</div>',

        // ══ MODAL ══
        '<div class="modal-overlay" id="wbSlipModal">',
        '  <div class="modal" style="max-width:940px;width:95%;max-height:90vh;overflow-y:auto;padding:26px;">',
        '    <div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:8px;">',
        '      <h3 id="wbModalTitle" style="font-size:15px;font-weight:600;">Chi tiết phiếu phí</h3>',
        '      <button class="wb-icon-btn" id="wbBtnModalClose">' + IC.close + '</button>',
        '    </div>',
        '    <div id="wbModalMeta" style="display:flex;gap:16px;flex-wrap:wrap;font-size:13px;color:var(--text-secondary);margin-bottom:14px;padding-bottom:14px;border-bottom:1px solid var(--border);"></div>',
        '    <div class="table-container">',
        '      <table class="wb-ltbl" style="font-size:12px;">',
        '        <thead><tr>',
        '          <th>Hạng mục</th><th>Tên phí</th><th>Đơn vị</th>',
        '          <th style="text-align:right;">SL</th><th style="text-align:right;">Selling</th><th style="text-align:right;">Cost</th>',
        '          <th style="text-align:right;">Sub Rev.</th><th style="text-align:right;">Sub Cost</th><th style="text-align:right;">Sub Profit</th>',
        '          <th>Ghi chú</th>',
        '        </tr></thead>',
        '        <tbody id="wbModalRows"></tbody>',
        '      </table>',
        '    </div>',
        '    <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:18px;padding-top:14px;border-top:1px solid var(--border);">',
        '      <button class="btn btn-danger" id="wbBtnDelete" style="gap:5px;">' + IC.trash + ' Xoá phiếu</button>',
        '      <button class="btn" id="wbBtnModalClose2">Đóng</button>',
        '    </div>',
        '  </div>',
        '</div>',
    ].join('\n');

    // ════════════════════════════════════════════════════════════════════════
    // INIT
    // ════════════════════════════════════════════════════════════════════════
    function init() {
        var mount = document.getElementById('section-admin-warehouse-billing-mount');
        if (!mount || _initialized) return;

        // Inject CSS once
        if (!document.getElementById('wb-style')) {
            var s = document.createElement('style');
            s.id = 'wb-style';
            s.textContent = WB_CSS;
            document.head.appendChild(s);
        }

        mount.innerHTML = WB_HTML;
        _initialized = true;

        _setDefaultDates();
        _renderChips();
        _bindTabButtons();
        _bindCreateForm();
        _bindListTab();
        _bindSummaryTab();
        _bindModal();
    }

    function onActivate() {
        if (!_initialized) init();
        _loadCustomersDropdown();
        _loadList(0);
    }

    // ════════════════════════════════════════════════════════════════════════
    // HELPERS
    // ════════════════════════════════════════════════════════════════════════
    function _pad(n) { return String(n).padStart(2,'0'); }
    function _todayIso() { var d=new Date(); return d.getFullYear()+'-'+_pad(d.getMonth()+1)+'-'+_pad(d.getDate()); }
    function _thisMonth() { var d=new Date(); return d.getFullYear()+'-'+_pad(d.getMonth()+1); }
    function _fmt(n) { if(n==null||n==='') return '—'; return Number(n).toFixed(2); }
    function _fmtDate(d) { return d ? String(d).slice(0,10) : '—'; }
    function _genId() { return Math.random().toString(36).slice(2,9); }

    function _apiFetch(url, opts) {
        return fetch(url, opts).then(function(r){
            return r.json().then(function(data){
                if (!data.success) throw new Error(data.message || 'Lỗi không xác định');
                return data;
            });
        });
    }

    function _setDefaultDates() {
        var cd=document.getElementById('wbCreateDate');
        var lm=document.getElementById('wbListMonth');
        var sm=document.getElementById('wbSummaryMonth');
        if (cd) cd.value = _todayIso();
        if (lm) lm.value = _thisMonth();
        if (sm) sm.value = _thisMonth();
    }

    // ════════════════════════════════════════════════════════════════════════
    // CUSTOMERS
    // ════════════════════════════════════════════════════════════════════════
    function _loadCustomersDropdown() {
        fetch(API + '/admin/customers?limit=500')
            .then(function(r){ return r.json(); })
            .then(function(r){
                _customers = (r.data && r.data.customers) || [];
                _populateSelects();
            }).catch(function(e){ console.warn('WB: customers failed',e); });
    }

    function _populateSelects() {
        [
            ['wbCreateCustomer','— Chọn khách hàng —'],
            ['wbListCustomer','Tất cả'],
            ['wbSummaryCustomer','Tất cả'],
        ].forEach(function(pair){
            var el = document.getElementById(pair[0]);
            if (!el) return;
            el.innerHTML = '<option value="">' + pair[1] + '</option>';
            _customers.forEach(function(c){
                var o = document.createElement('option');
                o.value = c.id;
                o.textContent = c.customer_code + ' — ' + c.customer_name;
                el.appendChild(o);
            });
        });
    }

    // ════════════════════════════════════════════════════════════════════════
    // TABS
    // ════════════════════════════════════════════════════════════════════════
    function _bindTabButtons() {
        document.querySelectorAll('.wb-tab-btn').forEach(function(btn){
            btn.addEventListener('click', function(){ _switchTab(this.getAttribute('data-wb-tab')); });
        });
    }

    function _switchTab(tab) {
        _activeTab = tab;
        document.querySelectorAll('.wb-tab-btn').forEach(function(b){
            b.classList.toggle('wb-active', b.getAttribute('data-wb-tab')===tab);
        });
        document.querySelectorAll('.wb-pw').forEach(function(p){ p.style.display='none'; });
        var panel = document.getElementById('wb-tab-'+tab);
        if (panel) panel.style.display = 'block';

        if (tab==='list'    && _listDirty)    { _listDirty=false;    _loadList(0); }
        if (tab==='summary' && _summaryDirty) { _summaryDirty=false; _loadSummary(); }
    }

    // ════════════════════════════════════════════════════════════════════════
    // CREATE — chips
    // ════════════════════════════════════════════════════════════════════════
    function _renderChips() {
        var c = document.getElementById('wbChips');
        if (!c) return;
        c.innerHTML = '';
        SECTIONS.forEach(function(sec){
            var btn = document.createElement('button');
            btn.className = 'wb-chip';
            btn.setAttribute('data-sec-id', sec.id);
            btn.innerHTML = '<span style="font-size:15px;">' + sec.emoji + '</span>'
                + '<span style="flex:1;font-size:12px;">' + esc(sec.label) + '</span>'
                + '<span class="wb-chip-check" style="font-size:14px;">✓</span>';
            btn.addEventListener('click', function(){ _toggleSection(sec.id); });
            c.appendChild(btn);
        });
    }

    function _toggleSection(secId) {
        if (_selectedSecs.has(secId)) {
            _selectedSecs.delete(secId);
            delete _createRows[secId];
        } else {
            _selectedSecs.add(secId);
            var sec = SECTIONS.find(function(s){ return s.id===secId; });
            if (sec) {
                _createRows[secId] = sec.items.map(function(item,idx){
                    return {
                        _id:_genId(), section_id:sec.id, section_label:sec.label,
                        item_id:item.id, name:item.name, unit:item.unit,
                        is_free:item.free,
                        selling_price: item.free ? 0 : (item.sp!=null ? item.sp : ''),
                        cost_price:    item.free ? 0 : (item.cost!=null ? item.cost : ''),
                        quantity:1, note:'', sort_order:idx,
                    };
                });
            }
        }
        _syncChipStyles();
        _renderSectionBlocks();
        _recalcTotals();
    }

    function _syncChipStyles() {
        document.querySelectorAll('#wbChips .wb-chip').forEach(function(chip){
            chip.classList.toggle('wb-on', _selectedSecs.has(Number(chip.getAttribute('data-sec-id'))));
        });
    }

    // ════════════════════════════════════════════════════════════════════════
    // CREATE — section blocks
    // ════════════════════════════════════════════════════════════════════════
    function _renderSectionBlocks() {
        var container  = document.getElementById('wbSectionBlocks');
        var emptyEl    = document.getElementById('wbEmptySec');
        var totalsPanel = document.getElementById('wbTotalsPanel');
        if (!container) return;

        container.querySelectorAll('.wb-sec-block').forEach(function(b){ b.remove(); });

        var hasAny = _selectedSecs.size > 0;
        if (emptyEl)    emptyEl.style.display    = hasAny ? 'none'  : 'block';
        if (totalsPanel) totalsPanel.style.display = hasAny ? 'block' : 'none';
        if (!hasAny) return;

        SECTIONS.forEach(function(sec){
            if (!_selectedSecs.has(sec.id)) return;
            container.appendChild(_buildSecBlock(sec));
        });
    }

    function _buildSecBlock(sec) {
        var rows = _createRows[sec.id] || [];
        var wrapper = document.createElement('div');
        wrapper.className = 'wb-sec-block';
        wrapper.setAttribute('data-sec-block', sec.id);

        // Header
        var hd = document.createElement('div');
        hd.className = 'wb-sec-hd';

        var lbl = document.createElement('span');
        lbl.className = 'wb-sec-hd-lbl';
        lbl.innerHTML = '<span style="margin-right:6px;">' + sec.emoji + '</span>' + esc(sec.label);
        hd.appendChild(lbl);

        // "Bỏ chọn" button
        var removeBtn = document.createElement('button');
        removeBtn.className = 'btn btn-sm';
        removeBtn.style.cssText = 'gap:4px;font-size:11px;padding:4px 10px;color:var(--text-secondary);';
        removeBtn.innerHTML = IC.x + ' Bỏ chọn';
        removeBtn.addEventListener('click', function(){ _toggleSection(sec.id); });
        hd.appendChild(removeBtn);
        wrapper.appendChild(hd);

        // Table
        var tableWrap = document.createElement('div');
        tableWrap.style.overflowX = 'auto';
        var table = document.createElement('table');
        table.className = 'wb-tbl';

        var thead = document.createElement('thead');
        thead.innerHTML = '<tr>'
            + '<th style="min-width:150px;">Tên phí</th>'
            + '<th style="width:100px;">Đơn vị</th>'
            + '<th style="width:70px;text-align:right;">SL</th>'
            + '<th style="width:108px;text-align:right;">Selling ($)</th>'
            + '<th style="width:108px;text-align:right;">Cost ($)</th>'
            + '<th>Ghi chú</th>'
            + '<th style="width:36px;"></th>'
            + '</tr>';
        table.appendChild(thead);

        var tbody = document.createElement('tbody');
        tbody.setAttribute('data-sec-body', sec.id);
        rows.forEach(function(row,idx){ tbody.appendChild(_buildRow(sec,row,idx)); });
        table.appendChild(tbody);
        tableWrap.appendChild(table);
        wrapper.appendChild(tableWrap);

        // Add-row for canAdd sections
        if (sec.canAdd) {
            var addWrap = document.createElement('div');
            addWrap.className = 'wb-add-row-wrap';
            var addBtn = document.createElement('button');
            addBtn.className = 'wb-add-btn';
            addBtn.innerHTML = IC.plus + ' Thêm dòng';
            addBtn.addEventListener('click', function(){ _addRow(sec.id); });
            addWrap.appendChild(addBtn);
            wrapper.appendChild(addWrap);
        }

        return wrapper;
    }

    function _buildRow(sec, row) {
        var tr = document.createElement('tr');
        var isEditable = sec.id===9 || row.item_id==='custom';

        // ── Name
        var tdName = document.createElement('td');
        if (isEditable) {
            tdName.appendChild(_makeInp('text','name',row,''));
            tdName.lastChild.placeholder = 'Tên phí…';
            tdName.lastChild.style.textAlign = 'left';
        } else {
            tdName.innerHTML = '<span style="font-size:13px;">' + esc(row.name) + '</span>'
                + (row.is_free ? '<span class="wb-free-badge">FREE</span>' : '');
        }
        tr.appendChild(tdName);

        // ── Unit
        var tdUnit = document.createElement('td');
        if (isEditable) {
            var ui = _makeInp('text','unit',row,'');
            ui.style.width='86px'; ui.style.textAlign='left'; ui.placeholder='/carton…';
            tdUnit.appendChild(ui);
        } else {
            tdUnit.style.cssText = 'color:var(--text-secondary);font-size:12px;';
            tdUnit.textContent = row.unit || '';
        }
        tr.appendChild(tdUnit);

        // ── Qty
        var tdQty = document.createElement('td');
        tdQty.style.textAlign='right';
        if (row.is_free) {
            tdQty.innerHTML = '<span style="color:var(--text-secondary);font-size:12px;">—</span>';
        } else {
            var qi = _makeInp('number','quantity',row,1);
            qi.min='0.01'; qi.step='0.01'; qi.style.width='58px';
            tdQty.appendChild(qi);
        }
        tr.appendChild(tdQty);

        // ── Selling
        var tdSp = document.createElement('td');
        tdSp.style.textAlign='right';
        if (row.is_free) {
            tdSp.innerHTML = '<span class="wb-free-badge">FREE</span>';
        } else {
            var si = _makeInp('number','selling_price',row,'');
            si.min='0'; si.step='0.01'; si.placeholder='0.00';
            tdSp.appendChild(si);
        }
        tr.appendChild(tdSp);

        // ── Cost
        var tdCost = document.createElement('td');
        tdCost.style.textAlign='right';
        if (row.is_free) {
            tdCost.innerHTML = '<span class="wb-free-badge">FREE</span>';
        } else {
            var ci = _makeInp('number','cost_price',row,'');
            ci.min='0'; ci.step='0.01'; ci.placeholder='0.00';
            tdCost.appendChild(ci);
        }
        tr.appendChild(tdCost);

        // ── Note
        var tdNote = document.createElement('td');
        var ni = _makeInp('text','note',row,'');
        ni.style.textAlign='left'; ni.placeholder='Ghi chú…';
        tdNote.appendChild(ni);
        tr.appendChild(tdNote);

        // ── Delete row
        var tdDel = document.createElement('td');
        tdDel.style.textAlign='center';
        var delBtn = document.createElement('button');
        delBtn.className='wb-del-btn'; delBtn.title='Xoá dòng'; delBtn.innerHTML=IC.trash;
        delBtn.addEventListener('click', function(){ _removeRow(sec.id, row._id); });
        tdDel.appendChild(delBtn);
        tr.appendChild(tdDel);

        return tr;
    }

    function _makeInp(type, field, row, defaultVal) {
        var inp = document.createElement('input');
        inp.type = type;
        inp.className = 'wb-inp' + (type==='number' ? ' wb-inp-r' : '');
        inp.value = row[field] != null ? row[field] : defaultVal;
        inp.setAttribute('data-field', field);
        inp.setAttribute('data-row-id', row._id);
        inp.setAttribute('data-sec-id', row.section_id);
        inp.addEventListener('input', function(){
            var r = (_createRows[row.section_id]||[]).find(function(x){ return x._id===row._id; });
            if (!r) return;
            var v = this.value;
            if (field==='quantity'||field==='selling_price'||field==='cost_price') {
                v = v==='' ? null : Number(v);
            }
            r[field] = v;
            _recalcTotals();
        });
        return inp;
    }

    function _addRow(secId) {
        var sec = SECTIONS.find(function(s){ return s.id===secId; });
        if (!sec) return;
        if (!_createRows[secId]) _createRows[secId] = [];
        _createRows[secId].push({
            _id:_genId(), section_id:secId, section_label:sec.label,
            item_id:'custom', name:'', unit:'/carton',
            is_free:false, selling_price:'', cost_price:'',
            quantity:1, note:'', sort_order:_createRows[secId].length,
        });
        _replaceBlock(secId);
    }

    function _removeRow(secId, rowId) {
        if (!_createRows[secId]) return;
        _createRows[secId] = _createRows[secId].filter(function(r){ return r._id!==rowId; });
        _replaceBlock(secId);
        _recalcTotals();
    }

    function _replaceBlock(secId) {
        var sec = SECTIONS.find(function(s){ return s.id===secId; });
        var old = document.querySelector('[data-sec-block="'+secId+'"]');
        var container = document.getElementById('wbSectionBlocks');
        if (old && container && sec) container.replaceChild(_buildSecBlock(sec), old);
    }

    function _recalcTotals() {
        var rev=0, cost=0;
        Object.keys(_createRows).forEach(function(sid){
            (_createRows[sid]||[]).forEach(function(r){
                if (r.is_free) return;
                var qty=Number(r.quantity)||1;
                rev  += (Number(r.selling_price)||0)*qty;
                cost += (Number(r.cost_price)||0)*qty;
            });
        });
        var profit = rev-cost;
        var se=function(id,v){ var el=document.getElementById(id); if(el) el.textContent=(Math.round(v*10000)/10000).toFixed(2); };
        se('wbTotalRevenue',rev); se('wbTotalCost',cost); se('wbTotalProfit',profit);
        var pw=document.getElementById('wbProfitSpan');
        if (pw) pw.style.color = profit>=0 ? 'var(--success)' : 'var(--danger)';
    }

    // ════════════════════════════════════════════════════════════════════════
    // CREATE — submit & reset
    // ════════════════════════════════════════════════════════════════════════
    function _bindCreateForm() {
        addClick('wbBtnSubmit', _submitSlip);
        addClick('wbBtnReset',  _resetCreate);
    }

    function _submitSlip() {
        var customerId = val('wbCreateCustomer');
        var slipDate   = val('wbCreateDate');
        var note       = val('wbCreateNote').trim();

        if (!customerId) { toast('Vui lòng chọn khách hàng', false); return; }
        if (!slipDate)   { toast('Vui lòng chọn ngày phát sinh', false); return; }
        if (_selectedSecs.size===0) { toast('Vui lòng chọn ít nhất 1 hạng mục', false); return; }

        var allRows=[], sortIdx=0, valid=true;
        SECTIONS.forEach(function(sec){
            if (!_selectedSecs.has(sec.id)) return;
            (_createRows[sec.id]||[]).forEach(function(r){
                if (!r.name||!String(r.name).trim()) {
                    valid=false;
                    toast('Tên phí không được trống ('+sec.label+')', false);
                    return;
                }
                allRows.push({
                    section_id:r.section_id, section_label:r.section_label,
                    item_id: r.item_id!=='custom' ? r.item_id : null,
                    name:String(r.name).trim(), unit:r.unit||null,
                    is_free:Boolean(r.is_free),
                    selling_price:r.selling_price, cost_price:r.cost_price,
                    quantity:Number(r.quantity)||1, note:r.note||null, sort_order:sortIdx++,
                });
            });
        });

        if (!valid) return;
        if (!allRows.length) { toast('Phiếu cần ít nhất 1 dòng phí', false); return; }

        var btn=document.getElementById('wbBtnSubmit');
        if (btn) { btn.disabled=true; btn.innerHTML=IC.save+' Đang lưu…'; }

        _apiFetch(WB_API,{
            method:'POST', headers:{'Content-Type':'application/json'},
            body:JSON.stringify({customer_id:Number(customerId), slip_date:slipDate, note:note||null, rows:allRows}),
        })
        .then(function(data){
            toast('Tạo phiếu thành công! ID #'+data.data.id);
            _resetCreate();
            _listDirty=true; _summaryDirty=true;
        })
        .catch(function(err){ toast('Lỗi: '+err.message, false); })
        .finally(function(){ if(btn){btn.disabled=false;btn.innerHTML=IC.save+' Lưu Phiếu';} });
    }

    function _resetCreate() {
        var d=document.getElementById('wbCreateDate');
        var n=document.getElementById('wbCreateNote');
        var c=document.getElementById('wbCreateCustomer');
        if (d) d.value=_todayIso();
        if (n) n.value='';
        if (c) c.value='';
        _selectedSecs.clear(); _createRows={};
        _syncChipStyles(); _renderSectionBlocks(); _recalcTotals();
    }

    // ════════════════════════════════════════════════════════════════════════
    // LIST TAB
    // ════════════════════════════════════════════════════════════════════════
    function _bindListTab() {
        addClick('wbBtnLoadList', function(){ _loadList(0); });
        addClick('wbBtnPrev', function(){ if(_listOffset>0) _loadList(Math.max(0,_listOffset-_listLimit)); });
        addClick('wbBtnNext', function(){ if(_listOffset+_listLimit<_listTotal) _loadList(_listOffset+_listLimit); });
    }

    function _loadList(offset) {
        _listOffset=offset||0;
        var params=new URLSearchParams({limit:_listLimit,offset:_listOffset});
        var month=val('wbListMonth'), custId=val('wbListCustomer');
        if (month)  params.set('year_month',month);
        if (custId) params.set('customer_id',custId);
        var infoEl=document.getElementById('wbListInfo');
        if (infoEl) infoEl.textContent='Đang tải…';
        _apiFetch(WB_API+'?'+params.toString())
            .then(function(data){
                var d=data.data; _listTotal=d.total;
                var slips=d.slips||[];
                _renderListRows(slips);
                var empty=document.getElementById('wbListEmpty');
                if (empty) empty.style.display=slips.length?'none':'block';
                if (infoEl) infoEl.textContent=_listTotal===0?'0 phiếu'
                    :(_listOffset+1)+'–'+(_listOffset+slips.length)+' / '+_listTotal+' phiếu';
                var bp=document.getElementById('wbBtnPrev'),bn=document.getElementById('wbBtnNext');
                if(bp) bp.disabled=_listOffset===0;
                if(bn) bn.disabled=_listOffset+slips.length>=_listTotal;
            })
            .catch(function(err){ toast('Lỗi tải danh sách: '+err.message, false); });
    }

    function _renderListRows(slips) {
        var tbody=document.getElementById('wbListBody');
        if (!tbody) return;
        tbody.innerHTML='';
        slips.forEach(function(slip){
            var tr=document.createElement('tr');
            tr.setAttribute('data-slip',slip.id);
            var profit=Number(slip.total_profit)||0;
            var pc=profit>=0?'var(--success)':'var(--danger)';
            tr.innerHTML='<td style="color:var(--text-secondary);font-size:12px;">'+slip.id+'</td>'
                +'<td style="white-space:nowrap;font-size:12px;font-variant-numeric:tabular-nums;">'+_fmtDate(slip.slip_date)+'</td>'
                +'<td><span style="font-weight:500;font-size:13px;">'+esc(slip.customer_code||'')+'</span>'
                +'<span style="color:var(--text-secondary);font-size:12px;"> — '+esc(slip.customer_name||'')+'</span></td>'
                +'<td style="max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--text-secondary);font-size:12px;">'+esc(slip.note||'—')+'</td>'
                +'<td class="wb-money" style="text-align:right;color:var(--primary);">$'+_fmt(slip.total_revenue)+'</td>'
                +'<td class="wb-money" style="text-align:right;color:var(--danger);">$'+_fmt(slip.total_cost)+'</td>'
                +'<td class="wb-money" style="text-align:right;font-weight:600;color:'+pc+';">$'+_fmt(slip.total_profit)+'</td>'
                +'<td style="color:var(--text-secondary);font-size:12px;">'+esc(slip.created_by||'—')+'</td>'
                +'<td style="text-align:center;"><button class="wb-icon-btn" data-view="'+slip.id+'">'+IC.eye+'</button></td>';
            tr.querySelector('[data-view]').addEventListener('click',function(e){
                e.stopPropagation(); _openSlipModal(Number(this.getAttribute('data-view')));
            });
            tr.addEventListener('click',function(){ _openSlipModal(Number(this.getAttribute('data-slip'))); });
            tbody.appendChild(tr);
        });
    }

    // ════════════════════════════════════════════════════════════════════════
    // MODAL
    // ════════════════════════════════════════════════════════════════════════
    function _bindModal() {
        addClick('wbBtnModalClose',  _closeModal);
        addClick('wbBtnModalClose2', _closeModal);
        addClick('wbBtnDelete',      _deleteSlip);
        var ov=document.getElementById('wbSlipModal');
        if (ov) ov.addEventListener('click',function(e){ if(e.target===ov) _closeModal(); });
    }

    function _openSlipModal(slipId) {
        _viewingSlipId=slipId;
        var modal=document.getElementById('wbSlipModal');
        if (!modal) return;
        modal.classList.add('show');
        var t=document.getElementById('wbModalTitle'),m=document.getElementById('wbModalMeta'),r=document.getElementById('wbModalRows');
        if(t) t.textContent='Phiếu phí #'+slipId+' — đang tải…';
        if(m) m.innerHTML='';
        if(r) r.innerHTML='';
        _apiFetch(WB_API+'/'+slipId)
            .then(function(data){ _renderModal(data.data); })
            .catch(function(err){ toast('Lỗi tải phiếu: '+err.message, false); _closeModal(); });
    }

    function _renderModal(slip) {
        var t=document.getElementById('wbModalTitle'),m=document.getElementById('wbModalMeta'),r=document.getElementById('wbModalRows');
        if(t) t.textContent='Phiếu phí #'+slip.id+' — '+_fmtDate(slip.slip_date);
        if(m) m.innerHTML=''
            +'<span><strong>KH:</strong> '+esc(slip.customer_code)+' — '+esc(slip.customer_name)+'</span>'
            +'<span><strong>Ngày:</strong> '+_fmtDate(slip.slip_date)+'</span>'
            +'<span style="color:var(--primary);"><strong>Revenue:</strong> $'+_fmt(slip.total_revenue)+'</span>'
            +'<span><strong>Cost:</strong> $'+_fmt(slip.total_cost)+'</span>'
            +'<span style="color:var(--success);"><strong>Profit:</strong> $'+_fmt(slip.total_profit)+'</span>'
            +(slip.note?'<span><strong>Ghi chú:</strong> '+esc(slip.note)+'</span>':'')
            +(slip.created_by?'<span style="color:var(--text-secondary);"><strong>Tạo bởi:</strong> '+esc(slip.created_by)+'</span>':'');
        if(r) {
            r.innerHTML='';
            (slip.rows||[]).forEach(function(row){
                var tr=document.createElement('tr');
                tr.innerHTML='<td style="color:var(--text-secondary);">'+esc(row.section_label)+'</td>'
                    +'<td>'+esc(row.name)+(row.is_free?'<span class="wb-free-badge">FREE</span>':'')+'</td>'
                    +'<td style="color:var(--text-secondary);">'+esc(row.unit||'—')+'</td>'
                    +'<td class="wb-money" style="text-align:right;">'+_fmt(row.quantity)+'</td>'
                    +'<td class="wb-money" style="text-align:right;">'+(row.is_free?'—':'$'+_fmt(row.selling_price))+'</td>'
                    +'<td class="wb-money" style="text-align:right;">'+(row.is_free?'—':'$'+_fmt(row.cost_price))+'</td>'
                    +'<td class="wb-money" style="text-align:right;color:var(--primary);">$'+_fmt(row.subtotal_revenue)+'</td>'
                    +'<td class="wb-money" style="text-align:right;color:var(--danger);">$'+_fmt(row.subtotal_cost)+'</td>'
                    +'<td class="wb-money" style="text-align:right;font-weight:600;color:var(--success);">$'+_fmt(row.subtotal_profit)+'</td>'
                    +'<td style="color:var(--text-secondary);">'+esc(row.note||'—')+'</td>';
                r.appendChild(tr);
            });
        }
    }

    function _closeModal() {
        var modal=document.getElementById('wbSlipModal');
        if(modal) modal.classList.remove('show');
        _viewingSlipId=null;
    }

    function _deleteSlip() {
        if(!_viewingSlipId) return;
        if(!confirm('Xác nhận xoá phiếu #'+_viewingSlipId+'?')) return;
        _apiFetch(WB_API+'/'+_viewingSlipId,{method:'DELETE'})
            .then(function(){
                toast('Đã xoá phiếu #'+_viewingSlipId);
                _closeModal(); _loadList(_listOffset); _summaryDirty=true;
            })
            .catch(function(err){ toast('Lỗi xoá: '+err.message, false); });
    }

    // ════════════════════════════════════════════════════════════════════════
    // SUMMARY
    // ════════════════════════════════════════════════════════════════════════
    var _expandedCustomers = new Set();

    function _bindSummaryTab() { addClick('wbBtnLoadSummary', _loadSummary); }

    function _loadSummary() {
        var month  = val('wbSummaryMonth');
        var custId = val('wbSummaryCustomer');
        if (!month) { toast('Vui lòng chọn tháng', false); return; }
        var body = document.getElementById('wbSummaryBody2');
        var ee   = document.getElementById('wbSummaryEmpty');
        if (body) body.style.display = 'none';
        if (ee)   ee.style.display   = 'none';
        _expandedCustomers.clear();
        var params = 'year_month=' + month;
        if (custId) params += '&customer_id=' + custId;
        _apiFetch(WB_API + '/summary/monthly?' + params)
            .then(function(data) { _renderSummary(data.data); })
            .catch(function(err) { toast('Lỗi tải tổng hợp: ' + err.message, false); });
    }

    function _renderSummary(d) {
        var body = document.getElementById('wbSummaryBody2');
        var ee   = document.getElementById('wbSummaryEmpty');
        if (!d.by_customer || !d.by_customer.length) {
            if (ee) ee.style.display = 'block';
            return;
        }

        // Context bar
        var ctx = document.getElementById('wbSumCtxBar');
        var warn = document.getElementById('wbSumWarnBar');
        var oc = d.oms_context || {};
        if (ctx) ctx.textContent = 'Tháng ' + (d.year_month || '').replace('-', '/') + ': '
            + (oc.monthly_total != null ? oc.monthly_total : '?') + ' đơn toàn hệ thống'
            + ' → Tier ' + (oc.tier || 1) + ' (' + (oc.tier_label || '') + ')  ·  Cost tính realtime';
        if (warn) {
            if (oc.has_incomplete_pricing && oc.incomplete_order_count > 0) {
                warn.textContent = oc.incomplete_order_count + ' đơn chưa có đủ thông tin giá (fulfillment hoặc shipping chưa tính)';
                warn.style.display = 'flex';
            } else {
                warn.style.display = 'none';
            }
        }

        // Grand total cards
        var g = d.grand_total || {};
        var go = g.oms_orders || {};
        var gw = g.warehouse_billing || {};
        var gc = g.combined || {};
        var sx = function(id, v) { var el = document.getElementById(id); if (el) el.textContent = v; };
        sx('wbSumOmsRev',    '$' + _fmt(go.revenue && go.revenue.total));
        sx('wbSumOmsCost',   '$' + _fmt(go.cost && go.cost.total));
        sx('wbSumOmsProfit', '$' + _fmt(go.profit));
        sx('wbSumOmsCount',  (go.order_count || 0) + ' đơn');
        sx('wbSumWhRev',    '$' + _fmt(gw.total_revenue));
        sx('wbSumWhCost',   '$' + _fmt(gw.total_cost));
        sx('wbSumCombRev',  '$' + _fmt(gc.total_revenue));
        sx('wbSumCombProfit', '$' + _fmt(gc.total_profit) + ' (' + (gc.margin_percent || 0) + '%)');

        // Customer table
        var tbody = document.getElementById('wbSummaryTbody');
        if (!tbody) { if (body) body.style.display = 'block'; return; }
        tbody.innerHTML = '';

        d.by_customer.forEach(function(c) {
            var cid = c.customer_id;
            var comb = c.combined || {};
            var oms  = c.oms_orders || null;
            var wh   = c.warehouse_billing || null;
            var profit = Number(comb.total_profit) || 0;
            var pc = profit >= 0 ? 'var(--success)' : 'var(--danger)';

            // Main row
            var tr = document.createElement('tr');
            tr.className = 'wb-sum-main';
            tr.setAttribute('data-cid', cid);
            tr.innerHTML = ''
                + '<td style="text-align:center;">'
                + '<button class="wb-expand-btn" data-expand="' + cid + '">'
                + '<span data-expand-arrow="' + cid + '">▶</span>'
                + '</button></td>'
                + '<td><span style="font-weight:600;">' + esc(c.customer_code || '') + '</span>'
                + ' <span style="color:var(--text-secondary);font-size:12px;">' + esc(c.customer_name || '') + '</span></td>'
                + '<td style="text-align:right;">' + (oms ? oms.order_count : '—') + '</td>'
                + '<td style="text-align:right;">' + (wh ? wh.slip_count : '—') + '</td>'
                + '<td class="wb-money" style="text-align:right;color:var(--primary);">$' + _fmt(comb.total_revenue) + '</td>'
                + '<td class="wb-money" style="text-align:right;color:var(--danger);">$' + _fmt(comb.total_cost) + '</td>'
                + '<td class="wb-money" style="text-align:right;font-weight:600;color:' + pc + ';">$' + _fmt(comb.total_profit) + '</td>'
                + '<td style="text-align:right;">' + (comb.margin_percent || 0) + '%</td>';
            tbody.appendChild(tr);

            // Detail row (hidden by default)
            var trd = document.createElement('tr');
            trd.className = 'wb-sum-detail';
            trd.setAttribute('data-detail', cid);
            trd.style.display = 'none';
            var td = document.createElement('td');
            td.colSpan = 8;
            td.innerHTML = _buildDetailHtml(oms, wh);
            trd.appendChild(td);
            tbody.appendChild(trd);

            // Expand toggle
            tr.querySelector('[data-expand]').addEventListener('click', function(e) {
                e.stopPropagation();
                _toggleExpand(cid);
            });
            tr.addEventListener('click', function() { _toggleExpand(cid); });
        });

        if (body) body.style.display = 'block';
    }

    function _buildDetailHtml(oms, wh) {
        var html = '<div class="wb-sum-detail-inner">';

        // OMS section
        html += '<div class="wb-sum-detail-sec">';
        html += '<div class="wb-sum-detail-hd">OMS Orders</div>';
        if (oms) {
            var r = oms.revenue || {}, co = oms.cost || {};
            html += '<div class="wb-sum-detail-row"><span class="wb-sum-detail-lbl">Shipping</span>'
                + '<span>Rev $' + _fmt(r.shipping) + ' · Cost $' + _fmt(co.shipping) + '</span></div>';
            html += '<div class="wb-sum-detail-row"><span class="wb-sum-detail-lbl">Fulfillment</span>'
                + '<span>Rev $' + _fmt(r.fulfillment) + ' · Cost $' + _fmt(co.fulfillment) + '</span></div>';
            html += '<div class="wb-sum-detail-row"><span class="wb-sum-detail-lbl">Packaging Material</span>'
                + '<span>Rev $' + _fmt(r.packaging_material) + ' · Cost $' + _fmt(co.packaging_material) + '</span></div>';
            html += '<div class="wb-sum-detail-row"><span class="wb-sum-detail-lbl">Additional</span>'
                + '<span>$' + _fmt(r.additional) + '</span></div>';
        } else {
            html += '<div style="color:var(--text-secondary);font-size:12px;padding:6px 0;">Không có đơn OMS tháng này</div>';
        }
        html += '</div>';

        // WH section
        html += '<div class="wb-sum-detail-sec">';
        html += '<div class="wb-sum-detail-hd">Warehouse Billing</div>';
        if (wh && wh.breakdown_by_section && wh.breakdown_by_section.length) {
            wh.breakdown_by_section.forEach(function(sec) {
                html += '<div class="wb-sum-detail-row"><span class="wb-sum-detail-lbl">' + esc(sec.section_label) + '</span>'
                    + '<span>Rev $' + _fmt(sec.total_revenue) + ' · Cost $' + _fmt(sec.total_cost) + '</span></div>';
            });
        } else {
            html += '<div style="color:var(--text-secondary);font-size:12px;padding:6px 0;">Không có phiếu kho tháng này</div>';
        }
        html += '</div>';

        html += '</div>';
        return html;
    }

    function _toggleExpand(cid) {
        var detailRow = document.querySelector('[data-detail="' + cid + '"]');
        var arrow     = document.querySelector('[data-expand-arrow="' + cid + '"]');
        if (!detailRow) return;
        var expanded = _expandedCustomers.has(cid);
        if (expanded) {
            _expandedCustomers.delete(cid);
            detailRow.style.display = 'none';
            if (arrow) arrow.textContent = '▶';
        } else {
            _expandedCustomers.add(cid);
            detailRow.style.display = '';
            if (arrow) arrow.textContent = '▼';
        }
    }

    // ════════════════════════════════════════════════════════════════════════
    // EXPOSE
    // ════════════════════════════════════════════════════════════════════════
    global.WarehouseBilling = { init:init, onActivate:onActivate };

}(window));