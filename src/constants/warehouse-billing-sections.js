// src/constants/warehouse-billing-sections.js
// Danh sách section + item mặc định cho phiếu phí kho US.
// Hardcode ở đây, không lưu DB. Khi tạo phiếu chỉ lưu các dòng user đã chọn.

const SECTIONS = [
    {
        id: 1,
        label: 'Inbound Receiving',
        items: [
            { id: 'inb_01', name: 'Inbound Receiving', unit: '/shipment', default_sp: 0, default_cost: 0, free: true },
        ],
    },
    {
        id: 2,
        label: 'Inspection Fee',
        items: [
            { id: 'ins_01', name: 'Small parcels (<20 items/carton)',          unit: '/carton',         default_sp: 0,    default_cost: 0,    free: true },
            { id: 'ins_02', name: 'Single product type, quick check',           unit: '/carton',         default_sp: 2.5,  default_cost: 2.0,  free: false },
            { id: 'ins_03', name: 'Mixed carton, multiple product types',       unit: '/carton',         default_sp: 6.25, default_cost: 5.0,  free: false },
            { id: 'ins_04', name: 'Large items packed by CBM',                  unit: '/CBM',            default_sp: 38,   default_cost: 30,   free: false },
            { id: 'ins_05', name: 'Periodic inventory check (on request)',      unit: '/hr or /1500pcs', default_sp: 30,   default_cost: 20,   free: false, note: 'Cost $20–$25 tuỳ hàng' },
            { id: 'ins_06', name: 'Other cases',                                unit: '',                default_sp: null, default_cost: null, free: false, note: 'Quoted per specific case' },
        ],
    },
    {
        id: 3,
        label: 'Storage Fee',
        items: [
            { id: 'sto_01', name: 'Storage Fee', unit: '/pc/month or /CBM', default_sp: null, default_cost: null, free: false,
              note: 'Selling: $0.1/pc/month hoặc $20/CBM | Cost: $600/tháng cố định' },
        ],
    },
    {
        id: 6,
        label: 'Return Handling',
        items: [
            { id: 'ret_01', name: 'Return Handling', unit: '/shipment', default_sp: 0, default_cost: 0, free: true, note: 'Merchandise only' },
        ],
    },
    {
        id: 8,
        label: 'Return Export Fee',
        items: [
            { id: 'rex_01', name: 'Return Export Fee', unit: '/carton', default_sp: 2.5, default_cost: 2.0, free: false, note: 'Quoted trước khi xử lý' },
        ],
    },
    {
        id: 9,
        label: 'Phí Khác',
        items: [], // user tự nhập tên + giá
    },
];

const VALID_SECTION_IDS = new Set(SECTIONS.map(s => s.id));

module.exports = { SECTIONS, VALID_SECTION_IDS };
