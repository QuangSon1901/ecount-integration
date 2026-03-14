// src/models/pod-product.model.js
const db = require('../database/connection');
const logger = require('../utils/logger');

class PodProductModel {
    /**
     * Create new POD product
     */
    static async create(data) {
        const connection = await db.getConnection();

        try {
            const [result] = await connection.query(
                `INSERT INTO pod_products (
                    pod_warehouse, item_name, warehouse_sku, warehouse_id, product_color, size,
                    weight, length, width, height, gross_price,
                    product_group, sku_key, thg_sku_sbsl, thg_sku_sbtt,
                    thg_price_sbsl, thg_price_sbtt,
                    us_import_tax_unit, customs_fee_order, metadata, status
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    data.podWarehouse,
                    data.itemName || null,
                    data.warehouseSku,
                    data.warehouseId || null,
                    data.productColor || null,
                    data.size || null,
                    data.weight || null,
                    data.length || null,
                    data.width || null,
                    data.height || null,
                    data.grossPrice || null,
                    data.productGroup || null,
                    data.skuKey || null,
                    data.thgSkuSbsl || null,
                    data.thgSkuSbtt || null,
                    data.thgPriceSbsl || null,
                    data.thgPriceSbtt || null,
                    data.usImportTaxUnit || null,
                    data.customsFeeOrder || null,
                    JSON.stringify(data.metadata || {}),
                    data.status || 'active'
                ]
            );

            return result.insertId;
        } finally {
            connection.release();
        }
    }

    /**
     * Update product by ID (dynamic field update)
     */
    static async update(id, updateData) {
        const connection = await db.getConnection();

        try {
            const fields = [];
            const values = [];

            if (updateData.podWarehouse !== undefined) {
                fields.push('pod_warehouse = ?');
                values.push(updateData.podWarehouse);
            }
            if (updateData.itemName !== undefined) {
                fields.push('item_name = ?');
                values.push(updateData.itemName);
            }
            if (updateData.warehouseSku !== undefined) {
                fields.push('warehouse_sku = ?');
                values.push(updateData.warehouseSku);
            }
            if (updateData.warehouseId !== undefined) {
                fields.push('warehouse_id = ?');
                values.push(updateData.warehouseId);
            }
            if (updateData.productColor !== undefined) {
                fields.push('product_color = ?');
                values.push(updateData.productColor);
            }
            if (updateData.size !== undefined) {
                fields.push('size = ?');
                values.push(updateData.size);
            }
            if (updateData.weight !== undefined) {
                fields.push('weight = ?');
                values.push(updateData.weight);
            }
            if (updateData.length !== undefined) {
                fields.push('length = ?');
                values.push(updateData.length);
            }
            if (updateData.width !== undefined) {
                fields.push('width = ?');
                values.push(updateData.width);
            }
            if (updateData.height !== undefined) {
                fields.push('height = ?');
                values.push(updateData.height);
            }
            if (updateData.grossPrice !== undefined) {
                fields.push('gross_price = ?');
                values.push(updateData.grossPrice);
            }
            if (updateData.productGroup !== undefined) {
                fields.push('product_group = ?');
                values.push(updateData.productGroup);
            }
            if (updateData.skuKey !== undefined) {
                fields.push('sku_key = ?');
                values.push(updateData.skuKey);
            }
            if (updateData.thgSkuSbsl !== undefined) {
                fields.push('thg_sku_sbsl = ?');
                values.push(updateData.thgSkuSbsl);
            }
            if (updateData.thgSkuSbtt !== undefined) {
                fields.push('thg_sku_sbtt = ?');
                values.push(updateData.thgSkuSbtt);
            }
            if (updateData.thgPriceSbsl !== undefined) {
                fields.push('thg_price_sbsl = ?');
                values.push(updateData.thgPriceSbsl);
            }
            if (updateData.thgPriceSbtt !== undefined) {
                fields.push('thg_price_sbtt = ?');
                values.push(updateData.thgPriceSbtt);
            }
            if (updateData.usImportTaxUnit !== undefined) {
                fields.push('us_import_tax_unit = ?');
                values.push(updateData.usImportTaxUnit);
            }
            if (updateData.customsFeeOrder !== undefined) {
                fields.push('customs_fee_order = ?');
                values.push(updateData.customsFeeOrder);
            }
            if (updateData.metadata !== undefined) {
                fields.push('metadata = ?');
                values.push(JSON.stringify(updateData.metadata));
            }
            if (updateData.status !== undefined) {
                fields.push('status = ?');
                values.push(updateData.status);
            }

            if (fields.length === 0) return false;

            values.push(id);

            const [result] = await connection.query(
                `UPDATE pod_products SET ${fields.join(', ')} WHERE id = ?`,
                values
            );

            return result.affectedRows > 0;
        } finally {
            connection.release();
        }
    }

    /**
     * Delete product by ID
     */
    static async delete(id) {
        const connection = await db.getConnection();

        try {
            const [result] = await connection.query(
                'DELETE FROM pod_products WHERE id = ?',
                [id]
            );

            return result.affectedRows > 0;
        } finally {
            connection.release();
        }
    }

    /**
     * Find product by ID
     */
    static async findById(id) {
        const connection = await db.getConnection();

        try {
            const [rows] = await connection.query(
                'SELECT * FROM pod_products WHERE id = ?',
                [id]
            );

            return rows[0] || null;
        } finally {
            connection.release();
        }
    }

    /**
     * Find product by warehouse + SKU
     */
    static async findByWarehouseSku(podWarehouse, sku) {
        const connection = await db.getConnection();

        try {
            const [rows] = await connection.query(
                'SELECT * FROM pod_products WHERE pod_warehouse = ? AND warehouse_sku = ?',
                [podWarehouse, sku]
            );

            return rows[0] || null;
        } finally {
            connection.release();
        }
    }

    /**
     * List products with filters and pagination
     */
    static async list(filters = {}) {
        const connection = await db.getConnection();

        try {
            let query = 'SELECT * FROM pod_products WHERE 1=1';
            const params = [];

            if (filters.podWarehouse) {
                query += ' AND pod_warehouse = ?';
                params.push(filters.podWarehouse);
            }

            if (filters.search) {
                query += ' AND (item_name LIKE ? OR warehouse_sku LIKE ? OR thg_sku_sbsl LIKE ? OR thg_sku_sbtt LIKE ?)';
                const searchTerm = `%${filters.search}%`;
                params.push(searchTerm, searchTerm, searchTerm, searchTerm);
            }

            if (filters.productGroup) {
                query += ' AND product_group = ?';
                params.push(filters.productGroup);
            }

            if (filters.status) {
                query += ' AND status = ?';
                params.push(filters.status);
            }

            query += ' ORDER BY created_at DESC';

            if (filters.limit) {
                query += ' LIMIT ?';
                params.push(parseInt(filters.limit));
            }

            if (filters.offset) {
                query += ' OFFSET ?';
                params.push(parseInt(filters.offset));
            }

            const [rows] = await connection.query(query, params);
            return rows;
        } finally {
            connection.release();
        }
    }

    /**
     * Count products with filters (for pagination)
     */
    static async count(filters = {}) {
        const connection = await db.getConnection();

        try {
            let query = 'SELECT COUNT(*) as total FROM pod_products WHERE 1=1';
            const params = [];

            if (filters.podWarehouse) {
                query += ' AND pod_warehouse = ?';
                params.push(filters.podWarehouse);
            }

            if (filters.search) {
                query += ' AND (item_name LIKE ? OR warehouse_sku LIKE ? OR thg_sku_sbsl LIKE ? OR thg_sku_sbtt LIKE ?)';
                const searchTerm = `%${filters.search}%`;
                params.push(searchTerm, searchTerm, searchTerm, searchTerm);
            }

            if (filters.productGroup) {
                query += ' AND product_group = ?';
                params.push(filters.productGroup);
            }

            if (filters.status) {
                query += ' AND status = ?';
                params.push(filters.status);
            }

            const [rows] = await connection.query(query, params);
            return rows[0].total;
        } finally {
            connection.release();
        }
    }

    /**
     * Lookup product by THG SKU (SBSL or SBTT)
     */
    static async lookupByThgSku(podWarehouse, thgSku) {
        const connection = await db.getConnection();

        try {
            const [rows] = await connection.query(
                `SELECT * FROM pod_products
                 WHERE pod_warehouse = ? AND (thg_sku_sbsl = ? OR thg_sku_sbtt = ?) AND status = 'active'`,
                [podWarehouse, thgSku, thgSku]
            );

            return rows[0] || null;
        } finally {
            connection.release();
        }
    }

    /**
     * Batch lookup products by THG SKU array
     */
    static async bulkLookupByThgSkus(podWarehouse, thgSkuArray) {
        const connection = await db.getConnection();

        try {
            if (!thgSkuArray || thgSkuArray.length === 0) return [];

            const [rows] = await connection.query(
                `SELECT * FROM pod_products
                 WHERE pod_warehouse = ? AND (thg_sku_sbsl IN (?) OR thg_sku_sbtt IN (?)) AND status = 'active'`,
                [podWarehouse, thgSkuArray, thgSkuArray]
            );

            return rows;
        } finally {
            connection.release();
        }
    }

    /**
     * Batch upsert products (INSERT ... ON DUPLICATE KEY UPDATE)
     */
    static async bulkCreate(items) {
        const connection = await db.getConnection();

        try {
            if (!items || items.length === 0) return { created: 0, updated: 0 };

            const values = items.map(item => [
                item.podWarehouse,
                item.itemName || null,
                item.warehouseSku,
                item.warehouseId || null,
                item.productColor || null,
                item.size || null,
                item.weight || null,
                item.length || null,
                item.width || null,
                item.height || null,
                item.grossPrice || null,
                item.productGroup || null,
                item.skuKey || null,
                item.thgSkuSbsl || null,
                item.thgSkuSbtt || null,
                item.thgPriceSbsl || null,
                item.thgPriceSbtt || null,
                item.usImportTaxUnit || null,
                item.customsFeeOrder || null,
                JSON.stringify(item.metadata || {}),
                item.status || 'active'
            ]);

            const [result] = await connection.query(
                `INSERT INTO pod_products (
                    pod_warehouse, item_name, warehouse_sku, warehouse_id, product_color, size,
                    weight, length, width, height, gross_price,
                    product_group, sku_key, thg_sku_sbsl, thg_sku_sbtt,
                    thg_price_sbsl, thg_price_sbtt,
                    us_import_tax_unit, customs_fee_order, metadata, status
                ) VALUES ?
                ON DUPLICATE KEY UPDATE
                    item_name = VALUES(item_name),
                    product_color = VALUES(product_color),
                    size = VALUES(size),
                    weight = VALUES(weight),
                    length = VALUES(length),
                    width = VALUES(width),
                    height = VALUES(height),
                    gross_price = VALUES(gross_price),
                    product_group = VALUES(product_group),
                    sku_key = VALUES(sku_key),
                    thg_sku_sbsl = VALUES(thg_sku_sbsl),
                    thg_sku_sbtt = VALUES(thg_sku_sbtt),
                    thg_price_sbsl = VALUES(thg_price_sbsl),
                    thg_price_sbtt = VALUES(thg_price_sbtt),
                    us_import_tax_unit = VALUES(us_import_tax_unit),
                    customs_fee_order = VALUES(customs_fee_order),
                    metadata = VALUES(metadata),
                    status = VALUES(status)`,
                [values]
            );

            // affectedRows: 1 per insert, 2 per update, 0 if unchanged
            const created = result.affectedRows - result.changedRows;
            const updated = result.changedRows;

            return { created, updated };
        } finally {
            connection.release();
        }
    }

    /**
     * Find products by warehouse that are missing warehouse_id
     */
    static async findMissingWarehouseId(podWarehouse) {
        const connection = await db.getConnection();

        try {
            const [rows] = await connection.query(
                `SELECT * FROM pod_products WHERE pod_warehouse = ?`,
                [podWarehouse]
            );

            return rows;
        } finally {
            connection.release();
        }
    }

    /**
     * Bulk update warehouse_id by matching warehouse_sku
     */
    static async bulkUpdateWarehouseId(podWarehouse, skuToIdMap) {
        const connection = await db.getConnection();

        try {
            let updated = 0;
            for (const [sku, warehouseId] of Object.entries(skuToIdMap)) {
                const [result] = await connection.query(
                    `UPDATE pod_products SET warehouse_id = ? WHERE pod_warehouse = ? AND warehouse_sku = ?`,
                    [String(warehouseId), podWarehouse, sku]
                );
                if (result.affectedRows > 0) updated++;
            }

            return updated;
        } finally {
            connection.release();
        }
    }

    /**
     * Get distinct product groups for a warehouse
     */
    static async getProductGroups(podWarehouse) {
        const connection = await db.getConnection();

        try {
            let query = 'SELECT DISTINCT product_group FROM pod_products WHERE product_group IS NOT NULL';
            const params = [];

            if (podWarehouse) {
                query += ' AND pod_warehouse = ?';
                params.push(podWarehouse);
            }

            query += ' ORDER BY product_group ASC';

            const [rows] = await connection.query(query, params);

            return rows.map(row => row.product_group);
        } finally {
            connection.release();
        }
    }
}

module.exports = PodProductModel;
