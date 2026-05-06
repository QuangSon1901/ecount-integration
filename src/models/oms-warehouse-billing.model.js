// src/models/oms-warehouse-billing.model.js

const db = require('../database/connection');

function _buildWhere(filters = {}) {
    const clauses = [];
    const params  = [];

    if (filters.customer_id) {
        clauses.push('s.customer_id = ?');
        params.push(filters.customer_id);
    }
    if (filters.year_month) {
        clauses.push("DATE_FORMAT(s.slip_date, '%Y-%m') = ?");
        params.push(filters.year_month);
    }
    if (filters.date_from) {
        clauses.push('s.slip_date >= ?');
        params.push(filters.date_from);
    }
    if (filters.date_to) {
        clauses.push('s.slip_date <= ?');
        params.push(filters.date_to);
    }

    return { clauses, params };
}

class OmsWarehouseBillingModel {
    static async create(payload, rows, createdBy) {
        const conn = await db.getConnection();
        try {
            await conn.beginTransaction();

            const [slipResult] = await conn.query(
                `INSERT INTO oms_warehouse_billing_slips
                    (customer_id, slip_date, note, total_revenue, total_cost, total_profit, created_by)
                 VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [
                    payload.customer_id,
                    payload.slip_date,
                    payload.note || null,
                    payload.total_revenue,
                    payload.total_cost,
                    payload.total_profit,
                    createdBy || null,
                ]
            );
            const slipId = slipResult.insertId;

            if (rows && rows.length > 0) {
                const rowValues = rows.map((r, idx) => [
                    slipId,
                    r.section_id,
                    r.section_label,
                    r.item_id || null,
                    r.name,
                    r.unit || null,
                    r.is_free ? 1 : 0,
                    r.selling_price != null ? r.selling_price : null,
                    r.cost_price != null ? r.cost_price : null,
                    Number(r.quantity) || 1,
                    r.note || null,
                    r.sort_order != null ? r.sort_order : idx,
                ]);
                await conn.query(
                    `INSERT INTO oms_warehouse_billing_rows
                        (slip_id, section_id, section_label, item_id, name, unit,
                         is_free, selling_price, cost_price, quantity, note, sort_order)
                     VALUES ?`,
                    [rowValues]
                );
            }

            await conn.commit();
            return slipId;
        } catch (err) {
            await conn.rollback();
            throw err;
        } finally {
            conn.release();
        }
    }

    static async findById(id) {
        const conn = await db.getConnection();
        try {
            const [slips] = await conn.query(
                `SELECT s.*, c.customer_code, c.customer_name
                 FROM oms_warehouse_billing_slips s
                 LEFT JOIN api_customers c ON c.id = s.customer_id
                 WHERE s.id = ?`,
                [id]
            );
            if (!slips[0]) return null;

            const [rows] = await conn.query(
                `SELECT * FROM oms_warehouse_billing_rows
                 WHERE slip_id = ?
                 ORDER BY sort_order ASC, id ASC`,
                [id]
            );

            return { ...slips[0], rows };
        } finally {
            conn.release();
        }
    }

    static async list(filters = {}) {
        const conn = await db.getConnection();
        try {
            const { clauses, params } = _buildWhere(filters);
            let sql = `
                SELECT s.*, c.customer_code, c.customer_name
                FROM oms_warehouse_billing_slips s
                LEFT JOIN api_customers c ON c.id = s.customer_id
                WHERE 1=1
            `;
            if (clauses.length) sql += ' AND ' + clauses.join(' AND ');
            sql += ' ORDER BY s.slip_date DESC, s.id DESC';

            const limitVal  = parseInt(filters.limit)  || 50;
            const offsetVal = parseInt(filters.offset) || 0;
            sql += ' LIMIT ? OFFSET ?';
            params.push(limitVal, offsetVal);

            const [rows] = await conn.query(sql, params);
            return rows;
        } finally {
            conn.release();
        }
    }

    static async count(filters = {}) {
        const conn = await db.getConnection();
        try {
            const { clauses, params } = _buildWhere(filters);
            let sql = `SELECT COUNT(*) AS total FROM oms_warehouse_billing_slips s WHERE 1=1`;
            if (clauses.length) sql += ' AND ' + clauses.join(' AND ');
            const [rows] = await conn.query(sql, params);
            return rows[0].total;
        } finally {
            conn.release();
        }
    }

    static async monthlySummary(yearMonth) {
        const conn = await db.getConnection();
        try {
            const [rows] = await conn.query(
                `SELECT
                    s.customer_id,
                    c.customer_code,
                    c.customer_name,
                    COUNT(s.id)            AS slip_count,
                    SUM(s.total_revenue)   AS total_revenue,
                    SUM(s.total_cost)      AS total_cost,
                    SUM(s.total_profit)    AS total_profit
                 FROM oms_warehouse_billing_slips s
                 LEFT JOIN api_customers c ON c.id = s.customer_id
                 WHERE DATE_FORMAT(s.slip_date, '%Y-%m') = ?
                 GROUP BY s.customer_id, c.customer_code, c.customer_name
                 ORDER BY total_revenue DESC`,
                [yearMonth]
            );
            return rows;
        } finally {
            conn.release();
        }
    }

    static async monthlySummaryBySection(yearMonth, customerId) {
        const conn = await db.getConnection();
        try {
            const params = [yearMonth];
            let customerFilter = '';
            if (customerId) {
                customerFilter = 'AND s.customer_id = ?';
                params.push(customerId);
            }
            const [rows] = await conn.query(
                `SELECT
                    r.section_id,
                    r.section_label,
                    SUM(CASE WHEN r.is_free = 0 THEN r.selling_price * r.quantity ELSE 0 END) AS total_revenue,
                    SUM(CASE WHEN r.is_free = 0 THEN r.cost_price    * r.quantity ELSE 0 END) AS total_cost,
                    COUNT(r.id) AS row_count
                 FROM oms_warehouse_billing_rows r
                 JOIN oms_warehouse_billing_slips s ON s.id = r.slip_id
                 WHERE DATE_FORMAT(s.slip_date, '%Y-%m') = ?
                 ${customerFilter}
                 GROUP BY r.section_id, r.section_label
                 ORDER BY r.section_id ASC`,
                params
            );
            return rows;
        } finally {
            conn.release();
        }
    }

    static async monthlyAggregate(yearMonth, customerId) {
        const conn = await db.getConnection();
        try {
            const params = [yearMonth];
            let customerFilter = '';
            if (customerId) { customerFilter = 'AND s.customer_id = ?'; params.push(customerId); }
            const [rows] = await conn.query(
                `SELECT s.customer_id, c.customer_code, c.customer_name,
                        COUNT(DISTINCT s.id) AS slip_count,
                        SUM(s.total_revenue) AS total_revenue,
                        SUM(s.total_cost)    AS total_cost,
                        SUM(s.total_profit)  AS total_profit
                 FROM oms_warehouse_billing_slips s
                 LEFT JOIN api_customers c ON c.id = s.customer_id
                 WHERE DATE_FORMAT(s.slip_date, '%Y-%m') = ?
                 ${customerFilter}
                 GROUP BY s.customer_id, c.customer_code, c.customer_name`,
                params
            );
            return rows;
        } finally {
            conn.release();
        }
    }

    static async monthlyBillingSectionBreakdown(yearMonth, customerId) {
        const conn = await db.getConnection();
        try {
            const params = [yearMonth];
            let customerFilter = '';
            if (customerId) { customerFilter = 'AND s.customer_id = ?'; params.push(customerId); }
            const [rows] = await conn.query(
                `SELECT s.customer_id,
                        r.section_id,
                        r.section_label,
                        SUM(CASE WHEN r.is_free = 0 THEN r.selling_price * r.quantity ELSE 0 END) AS total_revenue,
                        SUM(CASE WHEN r.is_free = 0 THEN r.cost_price    * r.quantity ELSE 0 END) AS total_cost
                 FROM oms_warehouse_billing_slips s
                 JOIN oms_warehouse_billing_rows r ON r.slip_id = s.id
                 WHERE DATE_FORMAT(s.slip_date, '%Y-%m') = ?
                 ${customerFilter}
                 GROUP BY s.customer_id, r.section_id, r.section_label
                 ORDER BY s.customer_id, r.section_id`,
                params
            );
            return rows;
        } finally {
            conn.release();
        }
    }

    static async deleteById(id) {
        const conn = await db.getConnection();
        try {
            // rows cascade-deleted by FK
            const [result] = await conn.query(
                'DELETE FROM oms_warehouse_billing_slips WHERE id = ?',
                [id]
            );
            return result.affectedRows > 0;
        } finally {
            conn.release();
        }
    }
}

module.exports = OmsWarehouseBillingModel;
