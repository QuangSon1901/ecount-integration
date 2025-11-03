class BaseCarrier {
    constructor(config) {
        this.config = config;
        this.name = '';
    }

    /**
     * Tạo đơn hàng và lấy tracking number
     * @param {Object} orderData - Dữ liệu đơn hàng
     * @returns {Promise<Object>} - Kết quả với tracking number
     */
    async createOrder(orderData) {
        throw new Error('Method createOrder() must be implemented');
    }

    /**
     * Lấy label (nếu cần)
     * @param {string} trackingNumber
     * @returns {Promise<Object>}
     */
    async getLabel(trackingNumber) {
        throw new Error('Method getLabel() must be implemented');
    }

    /**
     * Tracking đơn hàng
     * @param {string} trackingNumber
     * @returns {Promise<Object>}
     */
    async trackOrder(trackingNumber) {
        throw new Error('Method trackOrder() must be implemented');
    }

    /**
     * Validate dữ liệu đơn hàng
     * @param {Object} orderData
     * @returns {boolean}
     */
    validateOrderData(orderData) {
        throw new Error('Method validateOrderData() must be implemented');
    }
}

module.exports = BaseCarrier;