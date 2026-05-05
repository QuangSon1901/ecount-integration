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
