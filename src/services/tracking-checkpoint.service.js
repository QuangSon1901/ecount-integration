// src/services/tracking-checkpoint.service.js - UPDATE
const db = require('../database/connection');
const telegram = require('../utils/telegram');
const logger = require('../utils/logger');

class TrackingCheckpointService {
    constructor() {
        // Định nghĩa các node codes theo category
        this.NODE_CATEGORIES = {
            ABNORMAL: [
                'CUSTOMS_EXCEPTION', 'CUSTOMS_INSPCTION', 'CUSTOMS_HOLD', 'CUSTOMS_DELAY',
                'AIRPORT_INSPECTION', 'AIRPORT_HOLD', 'PACKAGE_EXCEPTION', 'PACKAGE_LOST',
                'DELIVERY_FAILURE', 'IN_TRANSIT_CARRIER' // (khi có delay/exception)
            ],
            RETURN: [
                'RETURNED', 'RETURNED_TO_SENDER', 'RETURNED_BACK'
            ],
            DELIVERED: ['DELIVERED'],
            IN_TRANSIT: [
                'PRE_ADVICING', 'PRE_INFO', 'ORDER_CREATION', 'PICKED_UP',
                'FIRST_MILE_ARRIVE', 'FIRST_MILE_DEPART', 'TRANSIT_IN', 'TRANSIT_OUT',
                'ARRIVE_CONFIRM_OC', 'DEPART_CONFIRM_OC', 'MAIN_LINE_DEPART', 'MAIN_LINE_ARRIVE',
                'CUSTOMS_PROCESSING', 'CUSTOMS_COMPLETE', 'CUSTOMS_RELEASE',
                'TRANSITHUB_ARRIVE', 'IN_TRANSIT', 'CARRIER_PICKUP', 'IN_TRANSIT_CARRIER',
                'DELIVERY_ATTEMPT', 'EDD'
            ]
        };

        // Mapping node code sang message tiếng Việt
        this.NODE_CODE_MESSAGES = {
            // Abnormal - Customs
            'CUSTOMS_EXCEPTION': 'Hải quan phát hiện bất thường',
            'CUSTOMS_INSPCTION': 'Hải quan đang kiểm tra chi tiết',
            'CUSTOMS_HOLD': 'Hải quan tạm giữ hàng hóa',
            'CUSTOMS_DELAY': 'Quá trình hải quan bị chậm',

            // Abnormal - Airport
            'AIRPORT_INSPECTION': 'Sân bay đang kiểm tra an ninh',
            'AIRPORT_HOLD': 'Sân bay tạm giữ hàng hóa',

            // Abnormal - Package
            'PACKAGE_EXCEPTION': 'Kiện hàng gặp vấn đề bất thường',
            'PACKAGE_LOST': 'Kiện hàng bị thất lạc',

            // Abnormal - Delivery
            'DELIVERY_FAILURE': 'Giao hàng thất bại',

            // Return
            'RETURNED': 'Đơn hàng đã được trả về',
            'RETURNED_TO_SENDER': 'Đơn hàng đang được trả về người gửi',
            'RETURNED_BACK': 'Đơn hàng đang trên đường trả về',
        };
    }

    /**
     * Update checkpoints từ tracking events
     */
    async updateCheckpoints(orderId, trackingNumber, trackEvents) {
        const connection = await db.getConnection();

        try {
            // Tìm hoặc tạo checkpoint record
            let checkpoint = await this.findOrCreateCheckpoint(orderId, trackingNumber);

            // Parse events và update timestamps
            const updates = this.parseTrackingEvents(trackEvents, checkpoint);

            if (Object.keys(updates).length > 0) {
                await this.updateCheckpointTimestamps(orderId, updates);
                logger.info(`Updated checkpoints for order ${orderId}`, updates);
            }

            // Check warnings cho 6 giai đoạn
            await this.checkWarnings(orderId, trackingNumber);

            // ✨ NEW: Check abnormal & return statuses
            await this.checkAbnormalAndReturn(orderId, trackingNumber, trackEvents);

        } finally {
            connection.release();
        }
    }

    /**
     * ✨ NEW: Check và cảnh báo các trạng thái Abnormal và Return
     */
    async checkAbnormalAndReturn(orderId, trackingNumber, trackEvents) {
        if (!trackEvents || !Array.isArray(trackEvents)) return;

        const connection = await db.getConnection();
        
        try {
            // Lấy thông tin order và checkpoint
            const [rows] = await connection.query(
                `SELECT 
                    o.id,
                    o.erp_order_code,
                    o.customer_order_number,
                    o.waybill_number,
                    o.tracking_number,
                    o.carrier,
                    tc.last_warning_stage,
                    tc.last_warning_at
                FROM orders o
                LEFT JOIN tracking_checkpoints tc ON tc.order_id = o.id
                WHERE o.id = ?`,
                [orderId]
            );

            if (rows.length === 0) return;

            const order = rows[0];

            // Sort events theo thời gian (mới nhất trước)
            const sortedEvents = [...trackEvents].sort((a, b) => 
                new Date(b.process_time) - new Date(a.process_time)
            );

            // Kiểm tra event mới nhất
            for (const event of sortedEvents.slice(0, 3)) { // Chỉ check 3 events mới nhất
                const nodeCode = event.track_node_code?.toUpperCase() || '';
                const content = event.process_content || '';
                const nodeLabels = event.node_labels || [];
                
                // ✨ Tạo unique key cho event này (bao gồm cả process_time)
                const eventKey = `${nodeCode}_${event.process_time}`;
                
                // Check Abnormal
                if (this.isAbnormalStatus(nodeCode, content)) {
                    const warningKey = `abnormal_${eventKey}`;
                    
                    // ✨ Chỉ check đã warning chưa, không check thời gian
                    if (!await this.hasWarned(orderId, warningKey)) {
                        await this.sendAbnormalWarning(order, event, nodeLabels);
                        await this.markWarned(orderId, warningKey);
                    }
                    break; // Chỉ cảnh báo 1 lần cho event mới nhất
                }
                
                // Check Return
                if (this.isReturnStatus(nodeCode, content)) {
                    const warningKey = `return_${eventKey}`;
                    
                    // ✨ Chỉ check đã warning chưa, không check thời gian
                    if (!await this.hasWarned(orderId, warningKey)) {
                        await this.sendReturnWarning(order, event, nodeLabels);
                        await this.markWarned(orderId, warningKey);
                    }
                    break;
                }
            }

        } finally {
            connection.release();
        }
    }

    async hasWarned(orderId, warningKey) {
        const connection = await db.getConnection();
        
        try {
            const [rows] = await connection.query(
                `SELECT id FROM tracking_checkpoints 
                WHERE order_id = ? 
                AND last_warning_stage = ?`,
                [orderId, warningKey]
            );
            
            return rows.length > 0;
            
        } finally {
            connection.release();
        }
    }

    /**
     * Check xem có phải abnormal status không
     */
    isAbnormalStatus(nodeCode, content) {
        // Check theo node code
        if (this.NODE_CATEGORIES.ABNORMAL.includes(nodeCode)) {
            return true;
        }

        // Check theo content (keywords)
        const abnormalKeywords = [
            'exception', 'abnormal', 'delay', 'failed', 'failure',
            'inspection', 'hold', 'lost', 'missing', 'detention',
            'abandoned', 'seized'
        ];

        const contentLower = content.toLowerCase();
        return abnormalKeywords.some(keyword => contentLower.includes(keyword));
    }

    /**
     * Check xem có phải return status không
     */
    isReturnStatus(nodeCode, content) {
        // Check theo node code
        if (this.NODE_CATEGORIES.RETURN.includes(nodeCode)) {
            return true;
        }

        // Check theo content
        const returnKeywords = ['return', 'returned', 'return to sender'];
        const contentLower = content.toLowerCase();
        return returnKeywords.some(keyword => contentLower.includes(keyword));
    }

    /**
     * ✨ Send abnormal warning
     */
    async sendAbnormalWarning(order, event, nodeLabels) {
        const nodeCode = event.track_node_code || '';
        const nodeName = this.NODE_CODE_MESSAGES[nodeCode] || 'Có vấn đề bất thường';

        let msg = `<b>CẢNH BÁO: ĐƠN HÀNG BẤT THƯỜNG</b>\n\n`;
        msg += `- <b>ERP Code:</b> <code>${order.erp_order_code}</code>\n`;
        msg += `- <b>Tracking:</b> <code>${order.tracking_number}</code>\n`;

        if (order.waybill_number) {
            msg += `- <b>Waybill:</b> <code>${order.waybill_number}</code>\n`;
        }

        msg += `\n<b>Trạng thái bất thường:</b>\n`;
        msg += `└ <b>Node Code:</b> <code>${nodeCode}</code>\n`;
        msg += `└ <b>Vấn đề:</b> ${nodeName}\n`;
        msg += `└ <b>Mô tả:</b> ${event.process_content}\n`;

        // Location info
        if (event.process_location) {
            msg += `└ <b>Địa điểm:</b> ${event.process_location}\n`;
        }

        msg += `└ <b>Thời gian xảy ra:</b> ${this.formatDateTime(event.process_time)}\n`;

        // ✨ Node Labels (chi tiết lỗi)
        if (nodeLabels && nodeLabels.length > 0) {
            msg += `\n<b>Chi tiết lỗi:</b>\n`;
            nodeLabels.forEach((label, index) => {
                msg += `${index + 1}. <b>${label.label_name}</b>\n`;
                if (label.label_name_en && label.label_name_en !== label.label_name) {
                    msg += `   └ <i>${label.label_name_en}</i>\n`;
                }
            });
        }

        // Action suggestion
        // msg += `\n<b>Hành động cần thực hiện:</b>\n`;
        // msg += this.getAbnormalActionSuggestion(nodeCode);

        msg += `\n====================================================`;

        await telegram.sendMessage(msg, {
            chatId: process.env.TELEGRAM_CHAT_ID_ERROR,
            parseMode: 'HTML'
        });

        logger.warn(`Sent abnormal warning for order ${order.id}`, {
            nodeCode,
            erpOrderCode: order.erp_order_code
        });
    }

    /**
     * ✨ Send return warning
     */
    async sendReturnWarning(order, event, nodeLabels) {
        const nodeCode = event.track_node_code || '';
        const nodeName = this.NODE_CODE_MESSAGES[nodeCode] || 'Đơn hàng đang được trả về';

        let msg = `<b>THÔNG BÁO: ĐƠN HÀNG BỊ TRẢ LẠI</b>\n\n`;
        msg += `- <b>ERP Code:</b> <code>${order.erp_order_code}</code>\n`;
        msg += `- <b>Tracking:</b> <code>${order.tracking_number}</code>\n`;

        if (order.waybill_number) {
            msg += `- <b>Waybill:</b> <code>${order.waybill_number}</code>\n`;
        }

        msg += `\n<b>Trạng thái trả hàng:</b>\n`;
        msg += `└ <b>Node Code:</b> <code>${nodeCode}</code>\n`;
        msg += `└ <b>Tình trạng:</b> ${nodeName}\n`;
        msg += `└ <b>Mô tả:</b> ${event.process_content}\n`;

        // Location info
        if (event.process_location) {
            msg += `└ <b>Địa điểm:</b> ${event.process_location}\n`;
        }

        msg += `└ <b>Thời gian xảy ra:</b> ${this.formatDateTime(event.process_time)}\n`;

        // ✨ Node Labels (lý do trả hàng)
        if (nodeLabels && nodeLabels.length > 0) {
            msg += `\n<b>Lý do trả hàng:</b>\n`;
            nodeLabels.forEach((label, index) => {
                msg += `${index + 1}. <b>${label.label_name}</b>\n`;
                if (label.label_name_en && label.label_name_en !== label.label_name) {
                    msg += `   └ <i>${label.label_name_en}</i>\n`;
                }
            });
        }

        // Action suggestion
        // msg += `\n<b>Hành động cần thực hiện:</b>\n`;
        // msg += this.getReturnActionSuggestion(nodeCode);

        msg += `\n====================================================`;

        await telegram.sendMessage(msg, {
            chatId: process.env.TELEGRAM_CHAT_ID_ERROR,
            parseMode: 'HTML'
        });

        logger.warn(`Sent return warning for order ${order.id}`, {
            nodeCode,
            erpOrderCode: order.erp_order_code
        });
    }

    /**
     * Get action suggestion cho abnormal status
     */
    getAbnormalActionSuggestion(nodeCode) {
        const suggestions = {
            'CUSTOMS_EXCEPTION': '└ Kiểm tra hải quan, có thể cần bổ sung giấy tờ hoặc chứng từ\n└ Liên hệ Carrier để biết chi tiết',
            'CUSTOMS_INSPCTION': '└ Theo dõi sát, hải quan đang kiểm tra\n└ Chuẩn bị giấy tờ phòng trường hợp cần bổ sung',
            'CUSTOMS_HOLD': '└ KHẨN CẤP: Hàng bị tạm giữ\n└ Liên hệ ngay Carrier và kiểm tra lý do\n└ Chuẩn bị giấy tờ chứng minh hợp pháp',
            'CUSTOMS_DELAY': '└ Theo dõi tiến độ\n└ Nếu quá 72h, liên hệ Carrier',
            'AIRPORT_INSPECTION': '└ Đợi kết quả kiểm tra an ninh sân bay\n└ Thường giải quyết trong 24-48h',
            'AIRPORT_HOLD': '└ KHẨN CẤP: Hàng bị giữ tại sân bay\n└ Liên hệ Carrier ngay lập tức',
            'PACKAGE_EXCEPTION': '└ Kiểm tra nguyên nhân cụ thể\n└ Liên hệ Carrier để giải quyết',
            'PACKAGE_LOST': '└ KHẨN CẤP: Hàng bị thất lạc\n└ Yêu cầu Carrier điều tra\n└ Chuẩn bị claim bồi thường',
            'DELIVERY_FAILURE': '└ Kiểm tra địa chỉ giao hàng\n└ Liên hệ người nhận\n└ Yêu cầu USPS giao lại',
        };

        return suggestions[nodeCode] || '└ Liên hệ Carrier để biết chi tiết và xử lý\n└ Theo dõi sát tình hình';
    }

    /**
     * Get action suggestion cho return status
     */
    getReturnActionSuggestion(nodeCode) {
        const suggestions = {
            'RETURNED': '└ Kiểm tra lý do trả hàng\n└ Xác nhận địa chỉ nhận hàng trả về\n└ Chuẩn bị xử lý đơn hàng (hoàn tiền/gửi lại)',
            'RETURNED_TO_SENDER': '└ Hàng đang trên đường trả về\n└ Theo dõi tiến độ\n└ Liên hệ khách hàng thông báo',
            'RETURNED_BACK': '└ Hàng đang được trả về\n└ Chuẩn bị nhận hàng trả về\n└ Xử lý refund/resend cho khách',
        };

        return suggestions[nodeCode] || '└ Kiểm tra lý do trả hàng\n└ Liên hệ khách hàng\n└ Xử lý refund hoặc gửi lại';
    }

    /**
     * Check if was warned recently (trong 24h) - UPDATE để hỗ trợ warning key mới
     */
    wasWarnedRecently(order, warningKey) {
        if (!order.last_warning_stage || !order.last_warning_at) {
            return false;
        }

        // Check exact match
        if (order.last_warning_stage === warningKey) {
            const hoursSinceWarning = this.getHoursDiff(order.last_warning_at, new Date());
            return hoursSinceWarning < 24;
        }

        return false;
    }

    // ... (giữ nguyên các methods cũ: parseTrackingEvents, checkWarnings, etc.)

    /**
     * Parse tracking events và xác định timestamps
     */
    parseTrackingEvents(trackEvents, currentCheckpoint) {
        const updates = {};

        if (!trackEvents || !Array.isArray(trackEvents)) {
            return updates;
        }

        // Sort events theo thời gian (cũ nhất trước để lấy timestamp đầu tiên)
        const sortedEvents = [...trackEvents].sort((a, b) =>
            new Date(a.process_time) - new Date(b.process_time)
        );

        for (const event of sortedEvents) {
            const nodeCode = event.track_node_code?.toUpperCase() || '';
            const content = (event.process_content || '').toLowerCase();
            const processTime = event.process_time;

            // Giai đoạn 2: Carrier received
            if (!currentCheckpoint.carrier_received_at) {
                if (nodeCode === 'FIRST_MILE_ARRIVE' ||
                    content.includes('arrived at origin facility')) {
                    updates.carrier_received_at = this.safeDate(processTime);
                }
            }

            // Giai đoạn 3: Customs start
            if (!currentCheckpoint.customs_start_at) {
                if (nodeCode === 'CUSTOMS_PROCESSING' ||
                    content.includes('clearance processing') ||
                    content.includes('in clearance')) {
                    updates.customs_start_at = this.safeDate(processTime);
                }
            }

            // Giai đoạn 3: Customs completed
            if (!currentCheckpoint.customs_completed_at) {
                if (nodeCode === 'CUSTOMS_COMPLETE' ||
                    content.includes('clearance processing completed')) {
                    updates.customs_completed_at = this.safeDate(processTime);
                }
            }

            // Giai đoạn 4: Clearance completed
            if (!currentCheckpoint.clearance_completed_at) {
                if (nodeCode === 'CUSTOMS_COMPLETE' ||
                    content.includes('clearance processing completed')) {
                    updates.clearance_completed_at = this.safeDate(processTime);
                }
            }

            // Giai đoạn 5: USPS received
            if (!currentCheckpoint.usps_received_at) {
                if (nodeCode === 'TRANSITHUB_ARRIVE' ||
                    content.includes('delivered to local carrier')) {
                    updates.usps_received_at = this.safeDate(processTime);
                }
            }

            // Giai đoạn 5: Out for delivery
            if (!currentCheckpoint.out_for_delivery_at) {
                if (nodeCode === 'DELIVERY_ATTEMPT' ||
                    content.includes('out for delivery')) {
                    updates.out_for_delivery_at = this.safeDate(processTime);
                }
            }

            // Giai đoạn 6: Delivered
            if (!currentCheckpoint.delivered_at) {
                if (nodeCode === 'DELIVERED' ||
                    content.includes('delivered')) {
                    updates.delivered_at = this.safeDate(processTime);
                }
            }
        }

        return updates;
    }

    safeDate(value) {
        if (!value) return null;
        const d = new Date(value);
        if (isNaN(d.getTime()) || d.getFullYear() < 1970) return null;
        return d;
    }

    /**
     * Find or create checkpoint
     */
    async findOrCreateCheckpoint(orderId, trackingNumber) {
        const connection = await db.getConnection();

        try {
            const [rows] = await connection.query(
                'SELECT * FROM tracking_checkpoints WHERE order_id = ?',
                [orderId]
            );

            if (rows.length > 0) {
                return rows[0];
            }

            // Create new
            await connection.query(
                `INSERT INTO tracking_checkpoints (order_id, tracking_number) 
                 VALUES (?, ?)`,
                [orderId, trackingNumber]
            );

            const [newRows] = await connection.query(
                'SELECT * FROM tracking_checkpoints WHERE order_id = ?',
                [orderId]
            );

            return newRows[0];

        } finally {
            connection.release();
        }
    }

    /**
     * Update checkpoint timestamps
     */
    async updateCheckpointTimestamps(orderId, updates) {
        const connection = await db.getConnection();

        try {
            const fields = [];
            const values = [];

            Object.entries(updates).forEach(([key, value]) => {
                fields.push(`${key} = ?`);
                values.push(value);
            });

            if (fields.length === 0) return;

            values.push(orderId);

            await connection.query(
                `UPDATE tracking_checkpoints 
                 SET ${fields.join(', ')}
                 WHERE order_id = ?`,
                values
            );

        } finally {
            connection.release();
        }
    }

    /**
     * Check warnings cho 6 giai đoạn
     */
    async checkWarnings(orderId, trackingNumber) {
        const connection = await db.getConnection();
        
        try {
            const [rows] = await connection.query(
                `SELECT 
                    tc.*,
                    o.erp_order_code,
                    o.customer_order_number,
                    o.waybill_number,
                    o.erp_status
                FROM tracking_checkpoints tc
                JOIN orders o ON o.id = tc.order_id
                WHERE tc.order_id = ?`,
                [orderId]
            );
            
            if (rows.length === 0) return;
            
            const checkpoint = rows[0];
            const now = new Date();
            
            // Giai đoạn 1: THG -> Carrier (48h)
            if (checkpoint.thg_received_at && !checkpoint.carrier_received_at) {
                const hoursSinceTHG = this.getHoursDiff(checkpoint.thg_received_at, now);
                
                // ✨ Chỉ check đã warning chưa, không check thời gian
                if (hoursSinceTHG > 48 && !await this.hasWarned(orderId, 'stage_1')) {
                    await this.sendWarning(checkpoint, 'stage_1', {
                        title: '<b>CẢNH BÁO: ĐƠN HÀNG CHƯA ĐƯỢC CARRIER TIẾP NHẬN</b>',
                        stage: 'Giai đoạn 1: THG → Carrier Received',
                        issue: `Đã ${Math.floor(hoursSinceTHG)} giờ kể từ THG Received nhưng Carrier vẫn chưa scan nhận hàng`,
                        threshold: '48 giờ',
                        action: 'Cần liên hệ THG kiểm tra tình trạng đơn hàng'
                    });
                }
            }
            
            // Giai đoạn 2: Carrier -> Shipped (24h)
            if (checkpoint.carrier_received_at && !checkpoint.customs_start_at) {
                const hoursSinceCarrier = this.getHoursDiff(checkpoint.carrier_received_at, now);
                
                if (hoursSinceCarrier > 24 && !await this.hasWarned(orderId, 'stage_2')) {
                    await this.sendWarning(checkpoint, 'stage_2', {
                        title: 'CẢNH BÁO: ĐƠN HÀNG CHƯA ĐƯỢC CHUYỂN ĐI',
                        stage: 'Giai đoạn 2: Carrier Received → Shipped',
                        issue: `Đã ${Math.floor(hoursSinceCarrier)} giờ kể từ Carrier nhận hàng nhưng chưa chuyển sang trạng thái Shipped`,
                        threshold: '24 giờ',
                        action: 'Cần liên hệ Carrier kiểm tra - nghi ngờ hàng bị mất'
                    });
                }
            }
            
            // Giai đoạn 3: Customs inspection (72h)
            if (checkpoint.customs_start_at && !checkpoint.customs_completed_at) {
                const hoursSinceCustoms = this.getHoursDiff(checkpoint.customs_start_at, now);
                
                if (hoursSinceCustoms > 72 && !await this.hasWarned(orderId, 'stage_3')) {
                    await this.sendWarning(checkpoint, 'stage_3', {
                        title: 'CẢNH BÁO: HẢI QUAN KIỂM TRA QUÁ LÂU',
                        stage: 'Giai đoạn 3: Hải quan kiểm hóa',
                        issue: `Đã ${Math.floor(hoursSinceCustoms)} giờ trong quá trình kiểm hóa`,
                        threshold: '72 giờ (3 ngày)',
                        action: 'Kiểm tra tình trạng hải quan, có thể cần bổ sung giấy tờ'
                    });
                }
            }
            
            // Giai đoạn 4: Clearance -> USPS (96h)
            if (checkpoint.clearance_completed_at && !checkpoint.usps_received_at) {
                const hoursSinceClearance = this.getHoursDiff(checkpoint.clearance_completed_at, now);
                
                if (hoursSinceClearance > 96 && !await this.hasWarned(orderId, 'stage_4')) {
                    await this.sendWarning(checkpoint, 'stage_4', {
                        title: 'CẢNH BÁO: ĐƠN HÀNG CHƯA ĐẾN USPS',
                        stage: 'Giai đoạn 4: Clearance Completed → USPS',
                        issue: `Đã ${Math.floor(hoursSinceClearance)} giờ kể từ hoàn tất kiểm hóa nhưng chưa đến USPS`,
                        threshold: '96 giờ (4 ngày)',
                        action: 'Kiểm tra với Carrier về vị trí đơn hàng'
                    });
                }
            }
            
            // Giai đoạn 5: USPS -> Out for delivery (168h = 7 days)
            if (checkpoint.usps_received_at && !checkpoint.out_for_delivery_at) {
                const hoursSinceUSPS = this.getHoursDiff(checkpoint.usps_received_at, now);
                
                if (hoursSinceUSPS > 168 && !await this.hasWarned(orderId, 'stage_5')) {
                    await this.sendWarning(checkpoint, 'stage_5', {
                        title: 'CẢNH BÁO: ĐƠN HÀNG BỊ KẸT TẠI USPS',
                        stage: 'Giai đoạn 5: USPS → Out for Delivery',
                        issue: `Đã ${Math.floor(hoursSinceUSPS)} giờ (${Math.floor(hoursSinceUSPS/24)} ngày) tại USPS nhưng chưa chuyển sang trạng thái Out for Delivery`,
                        threshold: '168 giờ (7 ngày)',
                        action: 'Đơn hàng có vấn đề, cần kiểm tra với USPS'
                    });
                }
            }
            
        } finally {
            connection.release();
        }
    }

    /**
     * Send warning to Telegram (cho 6 giai đoạn)
     */
    async sendWarning(checkpoint, stage, warningData) {
        const message = this.formatWarningMessage(checkpoint, warningData);

        await telegram.sendMessage(message, {
            chatId: process.env.TELEGRAM_CHAT_ID_ERROR,
            parseMode: 'HTML'
        });

        // Update warning tracking
        await this.markWarned(checkpoint.order_id, stage);
    }

    /**
     * Format warning message (cho 6 giai đoạn)
     */
    formatWarningMessage(checkpoint, data) {
        let msg = `${data.title}\n\n`;
        msg += `- <b>ERP Code:</b> <code>${checkpoint.erp_order_code}</code>\n`;
        msg += `- <b>Tracking:</b> <code>${checkpoint.tracking_number}</code>\n`;

        if (checkpoint.waybill_number) {
            msg += `- <b>Waybill:</b> <code>${checkpoint.waybill_number}</code>\n`;
        }

        msg += `\n<b>${data.stage}</b>\n`;
        msg += `└ <b>Vấn đề:</b> ${data.issue}\n`;
        msg += `└ <b>Ngưỡng:</b> ${data.threshold}\n`;
        msg += `└ <b>Hành động:</b> ${data.action}\n`;

        // Timeline
        msg += `\n<b>Timeline:</b>\n`;
        if (checkpoint.thg_received_at) {
            msg += `└ THG Received: ${this.formatDateTime(checkpoint.thg_received_at)}\n`;
        }
        if (checkpoint.carrier_received_at) {
            msg += `└ Carrier Received: ${this.formatDateTime(checkpoint.carrier_received_at)}\n`;
        }
        if (checkpoint.customs_start_at) {
            msg += `└ Customs Start: ${this.formatDateTime(checkpoint.customs_start_at)}\n`;
        }
        if (checkpoint.customs_completed_at) {
            msg += `└ Customs Completed: ${this.formatDateTime(checkpoint.customs_completed_at)}\n`;
        }
        if (checkpoint.usps_received_at) {
            msg += `└ USPS Received: ${this.formatDateTime(checkpoint.usps_received_at)}\n`;
        }

        msg += `\n====================================================`;

        return msg;
    }

    /**
     * Check if was warned (cho 6 giai đoạn)
     */
    wasWarned(checkpoint, stage) {
        if (checkpoint.last_warning_stage === stage && checkpoint.last_warning_at) {
            const hoursSinceWarning = this.getHoursDiff(checkpoint.last_warning_at, new Date());
            return hoursSinceWarning < 24;
        }
        return false;
    }

    /**
     * Mark as warned
     */
    async markWarned(orderId, warningKey) {
        const connection = await db.getConnection();
        
        try {
            // ✨ Chỉ update last_warning_stage, không cần last_warning_at nữa
            await connection.query(
                `UPDATE tracking_checkpoints 
                SET last_warning_stage = ?,
                    warning_count = warning_count + 1,
                    updated_at = NOW()
                WHERE order_id = ?`,
                [warningKey, orderId]
            );
            
            logger.info(`Marked warning for order ${orderId}: ${warningKey}`);
            
        } finally {
            connection.release();
        }
    }

    /**
     * Get hours difference
     */
    getHoursDiff(startTime, endTime) {
        const start = new Date(startTime);
        const end = new Date(endTime);
        return (end - start) / (1000 * 60 * 60);
    }

    /**
     * Format datetime
     */
    formatDateTime(datetime) {
        return new Date(datetime).toLocaleString('vi-VN', {
            timeZone: 'Asia/Ho_Chi_Minh',
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    }
}

module.exports = new TrackingCheckpointService();