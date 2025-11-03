const db = require('../database/connection');
const logger = require('../utils/logger');

class OrderModel {
    /**
     * Tạo order mới
     */
    static async create(orderData) {
        const connection = await db.getConnection();
        
        try {
            const [result] = await connection.query(
                `INSERT INTO orders (
                    order_number, customer_order_number, platform_order_number, erp_order_code,
                    carrier, product_code, waybill_number, tracking_number, bar_codes,
                    package_weight, package_length, package_width, package_height,
                    weight_unit, size_unit,
                    receiver_name, receiver_country, receiver_state, receiver_city,
                    receiver_postal_code, receiver_phone, receiver_email,
                    declared_value, declared_currency, items_count,
                    status, track_type, remote_area,
                    erp_status, ecount_link,
                    extra_services, sensitive_type, goods_type,
                    vat_number, ioss_code, eori_number,
                    order_data, carrier_response
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    orderData.orderNumber,
                    orderData.customerOrderNumber || null,
                    orderData.platformOrderNumber || null,
                    orderData.erpOrderCode || null,
                    orderData.carrier,
                    orderData.productCode || null,
                    orderData.waybillNumber || null,
                    orderData.trackingNumber || null,
                    orderData.barCodes || null,
                    orderData.packageWeight || null,
                    orderData.packageLength || null,
                    orderData.packageWidth || null,
                    orderData.packageHeight || null,
                    orderData.weightUnit || 'KG',
                    orderData.sizeUnit || 'CM',
                    orderData.receiverName || null,
                    orderData.receiverCountry || null,
                    orderData.receiverState || null,
                    orderData.receiverCity || null,
                    orderData.receiverPostalCode || null,
                    orderData.receiverPhone || null,
                    orderData.receiverEmail || null,
                    orderData.declaredValue || null,
                    orderData.declaredCurrency || 'USD',
                    orderData.itemsCount || 1,
                    orderData.status || 'pending',
                    orderData.trackType || null,
                    orderData.remoteArea || null,
                    orderData.erpStatus || 'Chờ xử lý',
                    orderData.ecountLink || null,
                    JSON.stringify(orderData.extraServices || []),
                    orderData.sensitiveType || null,
                    orderData.goodsType || null,
                    orderData.vatNumber || null,
                    orderData.iossCode || null,
                    orderData.eoriNumber || null,
                    JSON.stringify(orderData.orderData || {}),
                    JSON.stringify(orderData.carrierResponse || {})
                ]
            );
            
            return result.insertId;
        } finally {
            connection.release();
        }
    }

    /**
     * Cập nhật order
     */
    static async update(id, updateData) {
        const connection = await db.getConnection();
        
        try {
            const fields = [];
            const values = [];
            
            if (updateData.trackingNumber !== undefined) {
                fields.push('tracking_number = ?');
                values.push(updateData.trackingNumber);
            }
            if (updateData.status !== undefined) {
                fields.push('status = ?');
                values.push(updateData.status);
            }
            if (updateData.erpStatus !== undefined) {
                fields.push('erp_status = ?');
                values.push(updateData.erpStatus);
            }
            if (updateData.erpUpdated !== undefined) {
                fields.push('erp_updated = ?');
                values.push(updateData.erpUpdated);
            }
            if (updateData.carrierResponse !== undefined) {
                fields.push('carrier_response = ?');
                values.push(JSON.stringify(updateData.carrierResponse));
            }
            if (updateData.trackingInfo !== undefined) {
                fields.push('tracking_info = ?');
                values.push(JSON.stringify(updateData.trackingInfo));
            }
            if (updateData.deliveredAt !== undefined) {
                fields.push('delivered_at = ?');
                values.push(updateData.deliveredAt);
            }
            
            values.push(id);
            
            const [result] = await connection.query(
                `UPDATE orders SET ${fields.join(', ')} WHERE id = ?`,
                values
            );
            
            return result.affectedRows > 0;
        } finally {
            connection.release();
        }
    }

    /**
     * Tìm order theo ID
     */
    static async findById(id) {
        const connection = await db.getConnection();
        
        try {
            const [rows] = await connection.query(
                'SELECT * FROM orders WHERE id = ?',
                [id]
            );
            
            return rows[0] || null;
        } finally {
            connection.release();
        }
    }

    /**
     * Tìm order theo tracking number
     */
    static async findByTrackingNumber(trackingNumber) {
        const connection = await db.getConnection();
        
        try {
            const [rows] = await connection.query(
                'SELECT * FROM orders WHERE tracking_number = ?',
                [trackingNumber]
            );
            
            return rows[0] || null;
        } finally {
            connection.release();
        }
    }

    /**
     * Tìm order theo ERP order code
     */
    static async findByErpOrderCode(erpOrderCode) {
        const connection = await db.getConnection();
        
        try {
            const [rows] = await connection.query(
                'SELECT * FROM orders WHERE erp_order_code = ?',
                [erpOrderCode]
            );
            
            return rows[0] || null;
        } finally {
            connection.release();
        }
    }

    /**
     * Lấy orders chưa hoàn tất (để tracking)
     */
    static async findPendingOrders(limit = 50) {
        const connection = await db.getConnection();
        
        try {
            const [rows] = await connection.query(
                `SELECT * FROM orders 
                WHERE status IN ('pending', 'created', 'in_transit') 
                AND tracking_number IS NOT NULL
                ORDER BY created_at ASC
                LIMIT ?`,
                [limit]
            );
            
            return rows;
        } finally {
            connection.release();
        }
    }

    /**
     * Lấy orders cần cập nhật ERP
     */
    static async findOrdersNeedErpUpdate(limit = 20) {
        const connection = await db.getConnection();
        
        try {
            const [rows] = await connection.query(
                `SELECT * FROM orders 
                WHERE erp_updated = FALSE 
                AND erp_order_code IS NOT NULL
                AND tracking_number IS NOT NULL
                AND status NOT IN ('failed', 'cancelled')
                ORDER BY created_at ASC
                LIMIT ?`,
                [limit]
            );
            
            return rows;
        } finally {
            connection.release();
        }
    }

    /**
     * Đếm orders theo status
     */
    static async countByStatus() {
        const connection = await db.getConnection();
        
        try {
            const [rows] = await connection.query(
                'SELECT status, COUNT(*) as count FROM orders GROUP BY status'
            );
            
            return rows.reduce((acc, row) => {
                acc[row.status] = row.count;
                return acc;
            }, {});
        } finally {
            connection.release();
        }
    }
}

module.exports = OrderModel;