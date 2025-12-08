const OrderModel = require('../models/order.model');
const jobService = require('../services/queue/job.service');
const { successResponse, errorResponse } = require('../utils/response');
const logger = require('../utils/logger');
const xlsx = require('xlsx');
const path = require('path');

class BulkUpdateController {
    /**
     * POST /api/orders/bulk-check
     * Check orders từ file Excel
     */
    async bulkCheck(req, res, next) {
        try {
            if (!req.file) {
                return errorResponse(res, 'No file uploaded', 400);
            }

            logger.info('Processing Excel file:', {
                filename: req.file.originalname,
                size: req.file.size
            });

            // Đọc file Excel
            const workbook = xlsx.read(req.file.buffer, { type: 'buffer' });
            const sheetName = workbook.SheetNames[0];
            const sheet = workbook.Sheets[sheetName];
            
            // Convert sang JSON (bỏ qua header row)
            const data = xlsx.utils.sheet_to_json(sheet, { header: 1 });
            
            if (data.length < 2) {
                return errorResponse(res, 'File không có dữ liệu', 400);
            }

            // Bỏ header row
            const rows = data.slice(1);
            
            const results = [];
            const processedTrackings = new Set();
            const stats = {
                total: 0,
                found: 0,
                not_found: 0,
                duplicates: 0
            };

            for (const row of rows) {
                const originalCode = row[0]; // Cột đầu tiên
                
                if (!originalCode) continue;

                stats.total++;

                // Normalize tracking number
                const trackingNumber = this.normalizeTracking(String(originalCode));
                
                if (!trackingNumber) {
                    results.push({
                        original_code: originalCode,
                        tracking_number: null,
                        status: 'not_found',
                        note: 'Không thể trích xuất mã tracking'
                    });
                    stats.not_found++;
                    continue;
                }

                // Kiểm tra trùng lặp
                if (processedTrackings.has(trackingNumber)) {
                    results.push({
                        original_code: originalCode,
                        tracking_number: trackingNumber,
                        status: 'duplicate',
                        note: 'Mã tracking trùng lặp trong file'
                    });
                    stats.duplicates++;
                    continue;
                }

                processedTrackings.add(trackingNumber);

                // Tìm trong database
                const order = await this.findOrderByTracking(trackingNumber);
                
                if (order) {
                    results.push({
                        original_code: originalCode,
                        tracking_number: trackingNumber,
                        order_id: order.id,
                        erp_order_code: order.erp_order_code,
                        carrier: order.carrier,
                        current_status: order.erp_status,
                        status: 'found',
                        note: 'Tìm thấy trong hệ thống'
                    });
                    stats.found++;
                } else {
                    results.push({
                        original_code: originalCode,
                        tracking_number: trackingNumber,
                        status: 'not_found',
                        note: 'Không tìm thấy trong hệ thống'
                    });
                    stats.not_found++;
                }
            }

            logger.info('Bulk check completed:', stats);

            return successResponse(res, {
                summary: stats,
                results: results
            }, 'File processed successfully');

        } catch (error) {
            logger.error('Bulk check error:', error);
            next(error);
        }
    }

    /**
     * POST /api/orders/bulk-update-status
     * Tạo jobs để cập nhật status
     */
    async bulkUpdateStatus(req, res, next) {
        try {
            const { erp_order_codes, status } = req.body;

            if (!erp_order_codes || !Array.isArray(erp_order_codes)) {
                return errorResponse(res, 'erp_order_codes array is required', 400);
            }

            if (!status) {
                return errorResponse(res, 'status is required', 400);
            }

            logger.info(`Creating bulk update jobs for ${erp_order_codes.length} orders`);

            const jobIds = [];

            for (const erpOrderCode of erp_order_codes) {
                const jobId = await jobService.createUpdateErpJob({
                    erpOrderCode,
                    status,
                    source: 'bulk_update'
                });
                
                jobIds.push(jobId);
            }

            logger.info(`Created ${jobIds.length} bulk update jobs`);

            return successResponse(res, {
                jobs_created: jobIds.length,
                job_ids: jobIds
            }, `Created ${jobIds.length} jobs successfully`, 201);

        } catch (error) {
            logger.error('Bulk update error:', error);
            next(error);
        }
    }

    /**
     * Normalize tracking code
     */
    normalizeTracking(code) {
        if (!code) return '';
        
        // 1. Xoá GS (ASCII 29) nếu có
        code = code.replace(/\x1D/g, '|');
        
        // 2. Tách theo mọi ký tự không phải chữ/số
        let parts = code.split(/[^a-zA-Z0-9]+/).filter(Boolean);
        
        // 3. Lấy chuỗi dài nhất
        return parts.sort((a, b) => b.length - a.length)[0] || '';
    }

    /**
     * Tìm order theo tracking number (LIKE search)
     */
    async findOrderByTracking(trackingNumber) {
        const db = require('../database/connection');
        const connection = await db.getConnection();
        
        try {
            const [rows] = await connection.query(
                `SELECT * FROM orders 
                WHERE tracking_number LIKE ? 
                   OR waybill_number LIKE ?
                   OR customer_order_number LIKE ?
                LIMIT 1`,
                [`%${trackingNumber}%`, `%${trackingNumber}%`, `%${trackingNumber}%`]
            );
            
            return rows[0] || null;
        } finally {
            connection.release();
        }
    }
}

module.exports = new BulkUpdateController();