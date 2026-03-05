// src/services/pod/s2bdiy.service.js
const axios = require('axios');
const BasePodWarehouse = require('./base.pod-warehouse');
const logger = require('../../utils/logger');

class S2BDIYService extends BasePodWarehouse {
    constructor(config) {
        super(config);
        this.name = 'S2BDIY';
        this.code = 'S2BDIY';
        this.baseUrl = config.s2bdiy.baseUrl;
        this.appKey = config.s2bdiy.appKey;
        this.appSecret = config.s2bdiy.appSecret;

        // Token cache
        this.token = null;
        this.tokenExpiry = null;
        this.TOKEN_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours (refresh periodically)
    }

    async getToken() {
        if (this.token && this.tokenExpiry && Date.now() < this.tokenExpiry) {
            return this.token;
        }

        try {
            const response = await axios.post(
                `${this.baseUrl}/getToken`,
                `app_key=${this.appKey}&app_secret=${this.appSecret}`,
                {
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                    timeout: 30000
                }
            );

            // S2BDIY returns token as string directly or in response.data
            const token = typeof response.data === 'string' ? response.data : response.data?.data;

            if (!token) {
                throw new Error('S2BDIY getToken returned empty token');
            }

            this.token = token;
            this.tokenExpiry = Date.now() + this.TOKEN_TTL_MS;

            logger.info('[S2BDIY] Token obtained');
            return this.token;
        } catch (error) {
            logger.error('[S2BDIY] getToken failed:', error.message);
            throw new Error(`S2BDIY authentication failed: ${error.message}`);
        }
    }

    getHeaders() {
        // S2BDIY: Authorization header WITHOUT "Bearer" prefix
        return {
            'Authorization': this.token,
            'Content-Type': 'application/json'
        };
    }

    async createOrder(orderData) {
        await this.getToken();

        const payload = {
            third_order_id: orderData.thirdOrderId,
            third_user_id: orderData.thirdUserId || 1,
            platform: orderData.platform || 9, // 9 = Other
            store_id: orderData.storeId || 406,
            remark: orderData.remark || '',
            logistics_id: orderData.logisticsId || 999,
            address: {
                firstname: orderData.address.firstName,
                lastname: orderData.address.lastName || '',
                country: orderData.address.country,
                province: orderData.address.province || '',
                city: orderData.address.city || '',
                postcode: orderData.address.postcode || '',
                mobile_phone: orderData.address.phone || '',
                telephone: orderData.address.telephone || '',
                address: orderData.address.address,
                ioss: orderData.address.ioss || null
            },
            items: orderData.items.map(item => {
                const mapped = {
                    third_product_id: item.thirdProductId || 0,
                    third_product_image_url: item.thirdProductImageUrl || '',
                    product_id: item.productId,
                    num: item.quantity || 1,
                    size_id: item.sizeId,
                    color_id: item.colorId
                };

                // Custom design (buyer design)
                if (item.productDesign) {
                    mapped.product_id = 0;
                    mapped.product_design = {
                        basic_product_id: item.productDesign.basicProductId,
                        name: item.productDesign.name || '',
                        views: item.productDesign.views || []
                    };
                }

                return mapped;
            })
        };

        try {
            const response = await axios.post(
                `${this.baseUrl}/order`,
                payload,
                { headers: this.getHeaders(), timeout: 60000 }
            );

            const data = response.data?.data;

            if (response.data?.status !== 'success' && response.data?.status_code !== 200) {
                throw new Error(`S2BDIY create order failed: ${response.data?.msg || 'Unknown error'}`);
            }

            logger.info('[S2BDIY] Order created', {
                s2bdiyOrderId: data?.id,
                thirdOrderId: orderData.thirdOrderId
            });

            return {
                success: true,
                warehouseOrderId: String(data?.id || ''),
                rawResponse: response.data
            };
        } catch (error) {
            logger.error('[S2BDIY] Create order failed:', error.response?.data || error.message);
            throw new Error(`S2BDIY create order failed: ${error.response?.data?.msg || error.message}`);
        }
    }

    async getOrder(warehouseOrderId) {
        await this.getToken();

        try {
            const response = await axios.get(
                `${this.baseUrl}/order/orderDetails?ids=${warehouseOrderId}`,
                { headers: this.getHeaders(), timeout: 30000 }
            );

            const orders = response.data?.data;
            const order = Array.isArray(orders) ? orders[0] : orders;

            if (!order) {
                throw new Error(`S2BDIY order ${warehouseOrderId} not found`);
            }

            return {
                id: order.id,
                thirdOrderId: order.third_order_id,
                status: order.status,
                trackingNumber: order.order_logistics?.logisticss_track_number || null,
                labelBarcode: order.order_logistics?.label_barcode || null,
                logisticsTime: order.order_logistics?.logisticss_time || null,
                producedTime: order.produced_time,
                deliveryTime: order.delivery_time,
                productAmount: order.product_amount,
                shippingAmount: order.shipping_amount,
                totalAmount: order.total_amount,
                rawResponse: response.data
            };
        } catch (error) {
            logger.error('[S2BDIY] Get order failed:', error.message);
            throw new Error(`S2BDIY get order failed: ${error.message}`);
        }
    }

    async getTracking(warehouseOrderId) {
        await this.getToken();

        try {
            // First get order details to find third_order_id
            const order = await this.getOrder(warehouseOrderId);
            const orderNo = order.thirdOrderId || warehouseOrderId;

            const response = await axios.get(
                `${this.baseUrl}/logistics/orderLogisticsTracking?order_no=${orderNo}`,
                { headers: this.getHeaders(), timeout: 30000 }
            );

            const data = response.data?.data;

            return {
                trackingNumber: order.trackingNumber || null,
                carrier: null, // S2BDIY doesn't return carrier name directly
                trackingUrl: null,
                shipmentStatus: null,
                events: Array.isArray(data) ? data : []
            };
        } catch (error) {
            logger.error('[S2BDIY] Get tracking failed:', error.message);
            throw new Error(`S2BDIY get tracking failed: ${error.message}`);
        }
    }

    async cancelOrder(warehouseOrderId) {
        await this.getToken();

        try {
            const response = await axios.post(
                `${this.baseUrl}/order/cancelOrders`,
                { ids: parseInt(warehouseOrderId) },
                { headers: this.getHeaders(), timeout: 30000 }
            );

            return { success: true, rawResponse: response.data };
        } catch (error) {
            logger.error('[S2BDIY] Cancel order failed:', error.message);
            throw new Error(`S2BDIY cancel order failed: ${error.message}`);
        }
    }

    /**
     * Transform API unified format → S2BDIY format
     * API: { receiver, items: [{product_id, size_id, color_id, product_design}], customerOrderNumber }
     * S2BDIY: { thirdOrderId, address: {firstName, country, address}, items: [{productId, sizeId, colorId}] }
     */
    transformOrderData(apiData) {
        const receiver = apiData.receiver || {};
        const addressLine = receiver.addressLines?.[0] || receiver.address1 || '';
        const addressLine2 = receiver.addressLines?.[1] || receiver.address2 || '';
        const fullAddress = [addressLine, addressLine2].filter(Boolean).join(', ');

        return {
            ...apiData,
            thirdOrderId: apiData.thirdOrderId || apiData.customerOrderNumber,
            thirdUserId: apiData.thirdUserId || apiData.partnerID || 1,
            address: apiData.address || {
                firstName: receiver.firstName || '',
                lastName: receiver.lastName || '',
                country: receiver.countryCode || '',
                province: receiver.province || '',
                city: receiver.city || '',
                postcode: receiver.postalCode || '',
                phone: receiver.phoneNumber || '',
                telephone: '',
                address: fullAddress,
                ioss: null
            },
            items: (apiData.items || []).map(item => ({
                ...item,
                productId: item.productId || item.product_id,
                thirdProductId: item.thirdProductId || item.product_id || 0,
                thirdProductImageUrl: item.thirdProductImageUrl || item.design_image_url || '',
                sizeId: item.sizeId || item.size_id,
                colorId: item.colorId || item.color_id,
                quantity: item.quantity || item.num || 1,
                productDesign: item.productDesign || item.product_design || null
            }))
        };
    }

    validateOrderData(orderData) {
        if (!orderData.thirdOrderId) throw new Error('S2BDIY: thirdOrderId is required');
        if (!orderData.items || orderData.items.length === 0) throw new Error('S2BDIY: items is required');
        if (!orderData.address) throw new Error('S2BDIY: address is required');
        if (!orderData.address.firstName) throw new Error('S2BDIY: address.firstName is required');
        if (!orderData.address.country) throw new Error('S2BDIY: address.country is required');
        if (!orderData.address.address) throw new Error('S2BDIY: address.address is required');

        for (const item of orderData.items) {
            if (!item.productDesign && !item.productId) {
                throw new Error('S2BDIY: item.productId or item.productDesign is required');
            }
        }

        return true;
    }

    mapStatus(warehouseStatus) {
        const status = parseInt(warehouseStatus);
        const statusMap = {
            1: 'pod_pending',       // Unconfirmed
            2: 'pod_pending',       // Unpaid
            3: 'pod_pending',       // Under review
            4: 'pod_in_production', // In queue
            5: 'pod_in_production', // In production
            6: 'pod_shipped',       // Shipped
            7: 'pod_cancelled',     // Cancelled
        };
        return statusMap[status] || 'pod_pending';
    }
}

module.exports = S2BDIYService;
