// src/services/pod/base.pod-warehouse.js
const logger = require('../../utils/logger');

class BasePodWarehouse {
    constructor(config) {
        this.config = config;
        this.name = '';
        this.code = '';
    }

    /**
     * Tạo đơn hàng trên xưởng POD
     * @param {Object} orderData - Dữ liệu đơn hàng
     * @returns {Promise<{success: boolean, warehouseOrderId: string, rawResponse: Object}>}
     */
    async createOrder(orderData) {
        throw new Error(`${this.name}: createOrder() must be implemented`);
    }

    /**
     * Lấy thông tin đơn hàng từ xưởng
     * @param {string} warehouseOrderId - ID đơn trong hệ thống xưởng
     * @returns {Promise<Object>}
     */
    async getOrder(warehouseOrderId) {
        throw new Error(`${this.name}: getOrder() must be implemented`);
    }

    /**
     * Lấy tracking info (shipment events)
     * @param {string} warehouseOrderId
     * @returns {Promise<{trackingNumber: string|null, carrier: string|null, trackingUrl: string|null, events: Array}>}
     */
    async getTracking(warehouseOrderId) {
        throw new Error(`${this.name}: getTracking() must be implemented`);
    }

    /**
     * Hủy đơn hàng
     * @param {string} warehouseOrderId
     * @returns {Promise<{success: boolean}>}
     */
    async cancelOrder(warehouseOrderId) {
        throw new Error(`${this.name}: cancelOrder() must be implemented`);
    }

    /**
     * Transform data từ API unified format sang warehouse-specific format
     * API format: { receiver: {firstName, lastName, countryCode, addressLines, ...}, items: [{product_id, sku, ...}], customerOrderNumber, ... }
     * Mỗi warehouse implement riêng để map sang format API warehouse đó
     * @param {Object} apiData - Data từ API /labels/purchase
     * @returns {Object} - Data đã transform cho warehouse API
     */
    transformOrderData(apiData) {
        return apiData;
    }

    /**
     * Validate dữ liệu trước khi tạo đơn (data đã qua transformOrderData)
     * @param {Object} orderData
     * @returns {boolean}
     */
    validateOrderData(orderData) {
        throw new Error(`${this.name}: validateOrderData() must be implemented`);
    }

    /**
     * Map status từ xưởng sang unified POD status
     * @param {string|number} warehouseStatus - Status gốc từ xưởng
     * @returns {string} - Unified POD status (pod_pending, pod_in_production, etc.)
     */
    mapStatus(warehouseStatus) {
        throw new Error(`${this.name}: mapStatus() must be implemented`);
    }
}

module.exports = BasePodWarehouse;
