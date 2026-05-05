// src/models/oms-sku-packaging-mapping.model.js
//
// CRUD cho oms_sku_packaging_mapping. Một SKU có thể có nhiều mapping:
//   - 1 record customer-specific (customer_id = X)
//   - 1 record default (customer_id = NULL)
// Khi lookup cho 1 đơn của customer X, ưu tiên record customer-specific,
// rồi fallback về default.

const db = require('../database/connection');

class OmsSkuPackagingMappingModel {
    static async findById(id) {
        const conn = await db.getConnection();
        try {
            const [rows] = await conn.query(
                `SELECT m.*, mat.name AS material_name, mat.sell_price AS material_sell_price,
                        c.customer_code, c.customer_name
                 FROM oms_sku_packaging_mapping m
                 LEFT JOIN oms_packaging_materials mat ON mat.id = m.material_id
                 LEFT JOIN api_customers c ON c.id = m.customer_id
                 WHERE m.id = ?`,
                [id]
            );
            return rows[0] || null;
        } finally {
            conn.release();
        }
    }

    /**
     * Lookup mapping cho danh sách SKU + customerId.
     * Trả về Map<sku, mapping_record> — ưu tiên customer-specific, fallback default.
     *
     * @param {string[]} skus
     * @param {number|null} customerId
     */
    static async lookupBySkus(skus, customerId) {
        if (!Array.isArray(skus) || skus.length === 0) return new Map();

        const placeholders = skus.map(() => '?').join(', ');
        const conn = await db.getConnection();
        try {
            const params = [...skus];
            // Nếu có customerId → lấy cả 2 loại (customer-specific + default)
            // Nếu không → chỉ lấy default
            let whereCustomer;
            if (customerId) {
                whereCustomer = '(m.customer_id = ? OR m.customer_id IS NULL)';
                params.push(customerId);
            } else {
                whereCustomer = 'm.customer_id IS NULL';
            }

            const [rows] = await conn.query(
                `SELECT m.*, mat.name AS material_name, mat.sell_price AS material_sell_price
                 FROM oms_sku_packaging_mapping m
                 INNER JOIN oms_packaging_materials mat ON mat.id = m.material_id
                 WHERE m.sku IN (${placeholders})
                   AND ${whereCustomer}
                   AND mat.is_active = 1`,
                params
            );

            // Pick: customer-specific thắng default
            const out = new Map();
            for (const row of rows) {
                const existing = out.get(row.sku);
                if (!existing) { out.set(row.sku, row); continue; }
                // Nếu mới có customer_id và cũ là NULL → thay
                if (row.customer_id !== null && existing.customer_id === null) {
                    out.set(row.sku, row);
                }
            }
            return out;
        } finally {
            conn.release();
        }
    }

    static async list({ customerId, sku, limit = 200, offset = 0 } = {}) {
        const conn = await db.getConnection();
        try {
            const clauses = [];
            const params  = [];
            if (customerId === null) {
                clauses.push('m.customer_id IS NULL');
            } else if (customerId !== undefined) {
                clauses.push('m.customer_id = ?');
                params.push(customerId);
            }
            if (sku) {
                clauses.push('m.sku LIKE ?');
                params.push('%' + sku + '%');
            }

            let sql = `SELECT m.*, mat.name AS material_name, mat.sell_price AS material_sell_price,
                              c.customer_code, c.customer_name
                       FROM oms_sku_packaging_mapping m
                       LEFT JOIN oms_packaging_materials mat ON mat.id = m.material_id
                       LEFT JOIN api_customers c ON c.id = m.customer_id`;
            if (clauses.length) sql += ' WHERE ' + clauses.join(' AND ');
            sql += ' ORDER BY m.sku ASC, m.customer_id IS NULL ASC LIMIT ? OFFSET ?';
            params.push(parseInt(limit), parseInt(offset));

            const [rows] = await conn.query(sql, params);
            return rows;
        } finally {
            conn.release();
        }
    }

    static async create(data) {
        const conn = await db.getConnection();
        try {
            const [result] = await conn.query(
                `INSERT INTO oms_sku_packaging_mapping (sku, material_id, customer_id)
                 VALUES (?, ?, ?)`,
                [data.sku, data.material_id, data.customer_id ?? null]
            );
            return result.insertId;
        } finally {
            conn.release();
        }
    }

    static async delete(id) {
        const conn = await db.getConnection();
        try {
            const [result] = await conn.query(
                'DELETE FROM oms_sku_packaging_mapping WHERE id = ?',
                [id]
            );
            return result.affectedRows > 0;
        } finally {
            conn.release();
        }
    }
}

module.exports = OmsSkuPackagingMappingModel;
