// src/models/oms-packaging-material.model.js
//
// CRUD cho oms_packaging_materials (vật liệu đóng gói cho OMS).

const db = require('../database/connection');

class OmsPackagingMaterialModel {
    static async findById(id) {
        const conn = await db.getConnection();
        try {
            const [rows] = await conn.query(
                'SELECT * FROM oms_packaging_materials WHERE id = ?',
                [id]
            );
            return rows[0] || null;
        } finally {
            conn.release();
        }
    }

    static async list({ activeOnly = false, search = null } = {}) {
        const conn = await db.getConnection();
        try {
            const clauses = [];
            const params  = [];
            if (activeOnly) clauses.push('is_active = 1');
            if (search) {
                clauses.push('(name LIKE ? OR description LIKE ?)');
                const like = '%' + search + '%';
                params.push(like, like);
            }
            let sql = 'SELECT * FROM oms_packaging_materials';
            if (clauses.length) sql += ' WHERE ' + clauses.join(' AND ');
            sql += ' ORDER BY id DESC';
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
                `INSERT INTO oms_packaging_materials (name, description, cost_price, sell_price, is_active)
                 VALUES (?, ?, ?, ?, ?)`,
                [
                    data.name,
                    data.description ?? null,
                    data.cost_price ?? null,
                    data.sell_price,
                    data.is_active === undefined ? 1 : (data.is_active ? 1 : 0),
                ]
            );
            return result.insertId;
        } finally {
            conn.release();
        }
    }

    static async update(id, data) {
        const fields = [];
        const values = [];
        if (data.name !== undefined)        { fields.push('name = ?');        values.push(data.name); }
        if (data.description !== undefined) { fields.push('description = ?'); values.push(data.description); }
        if (data.cost_price !== undefined)  { fields.push('cost_price = ?');  values.push(data.cost_price); }
        if (data.sell_price !== undefined)  { fields.push('sell_price = ?');  values.push(data.sell_price); }
        if (data.is_active !== undefined)   { fields.push('is_active = ?');   values.push(data.is_active ? 1 : 0); }
        if (!fields.length) return false;

        values.push(id);
        const conn = await db.getConnection();
        try {
            const [result] = await conn.query(
                `UPDATE oms_packaging_materials SET ${fields.join(', ')} WHERE id = ?`,
                values
            );
            return result.affectedRows > 0;
        } finally {
            conn.release();
        }
    }

    /**
     * Bulk lookup SKU → material cost/sell price. Ưu tiên default (customer_id NULL).
     * @param {string[]} skus
     * @returns {Promise<Map<string, { cost_price: number|null, sell_price: number, material_name: string }>>}
     */
    static async findMappingsBySkus(skus) {
        if (!Array.isArray(skus) || skus.length === 0) return new Map();
        const conn = await db.getConnection();
        try {
            const placeholders = skus.map(() => '?').join(', ');
            const [rows] = await conn.query(
                `SELECT m.sku, mat.cost_price, mat.sell_price, mat.name AS material_name,
                        m.customer_id
                 FROM oms_sku_packaging_mapping m
                 INNER JOIN oms_packaging_materials mat ON mat.id = m.material_id
                 WHERE m.sku IN (${placeholders}) AND mat.is_active = 1
                 ORDER BY (m.customer_id IS NULL) DESC`,
                skus
            );
            const out = new Map();
            for (const row of rows) {
                if (!out.has(row.sku)) {
                    out.set(row.sku, {
                        cost_price:    row.cost_price != null ? Number(row.cost_price) : null,
                        sell_price:    Number(row.sell_price),
                        material_name: row.material_name,
                    });
                }
            }
            return out;
        } finally {
            conn.release();
        }
    }

    static async delete(id) {
        const conn = await db.getConnection();
        try {
            const [result] = await conn.query(
                'DELETE FROM oms_packaging_materials WHERE id = ?',
                [id]
            );
            return result.affectedRows > 0;
        } finally {
            conn.release();
        }
    }
}

module.exports = OmsPackagingMaterialModel;
