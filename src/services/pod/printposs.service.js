// src/services/pod/printposs.service.js
const axios = require('axios');
const BasePodWarehouse = require('./base.pod-warehouse');
const logger = require('../../utils/logger');

class PrintpossService extends BasePodWarehouse {
    constructor(config) {
        super(config);
        this.name = 'Printposs';
        this.code = 'PRINTPOSS';
        this.baseUrl = config.printposs.baseUrl;
        this.apiKey = config.printposs.apiKey;
    }

    getHeaders() {
        return {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
            'Accept': 'application/json'
        };
    }

    async createOrder(orderData) {
        const payload = {
            store_id: orderData.storeId,
            external_order_id: orderData.externalOrderId,
            items: orderData.items.map(item => ({
                product_variant_id: item.productVariantId,
                quantity: item.quantity || 1,
                design_image_url: item.designImageUrl,
                shipping_label_url: item.shippingLabelUrl || null
            })),
            shipping_address: {
                name: orderData.shippingAddress.name,
                address_line_1: orderData.shippingAddress.addressLine1,
                address_line_2: orderData.shippingAddress.addressLine2 || '',
                city: orderData.shippingAddress.city,
                state: orderData.shippingAddress.state || '',
                postal_code: orderData.shippingAddress.postalCode,
                country_code: orderData.shippingAddress.countryCode,
                phone: orderData.shippingAddress.phone || '',
                email: orderData.shippingAddress.email || ''
            }
        };

        try {
            const response = await axios.post(
                `${this.baseUrl}/api/v1/seller/orders`,
                payload,
                { headers: this.getHeaders(), timeout: 60000 }
            );

            if (!response.data?.success) {
                throw new Error(`Printposs create order failed: ${JSON.stringify(response.data)}`);
            }

            const data = response.data?.data;

            logger.info('[PRINTPOSS] Order created', {
                printpossOrderId: data?.id,
                externalOrderId: orderData.externalOrderId
            });

            return {
                success: true,
                warehouseOrderId: String(data?.id || ''),
                rawResponse: response.data
            };
        } catch (error) {
            // Handle rate limit
            if (error.response?.status === 429) {
                logger.warn('[PRINTPOSS] Rate limited, retry later');
            }
            logger.error('[PRINTPOSS] Create order failed:', error.response?.data || error.message);
            throw new Error(`Printposs create order failed: ${error.response?.data?.message || error.message}`);
        }
    }

    async getOrder(warehouseOrderId) {
        try {
            const response = await axios.get(
                `${this.baseUrl}/api/v1/seller/orders/${warehouseOrderId}`,
                { headers: this.getHeaders(), timeout: 30000 }
            );

            if (!response.data?.success) {
                throw new Error(`Printposs get order failed: ${JSON.stringify(response.data)}`);
            }

            const data = response.data?.data;

            return {
                id: data?.id,
                externalOrderId: data?.external_order_id,
                status: data?.status,
                trackingNumber: data?.tracking_number || null,
                shippingCarrier: data?.shipping_carrier || null,
                trackingUrl: data?.tracking_url || null,
                labelUrl: data?.label_url || null,
                items: data?.items || [],
                shippingAddress: data?.shipping_address || null,
                rawResponse: response.data
            };
        } catch (error) {
            logger.error('[PRINTPOSS] Get order failed:', error.message);
            throw new Error(`Printposs get order failed: ${error.message}`);
        }
    }

    async getTracking(warehouseOrderId) {
        // Printposs: tracking info is embedded in order detail
        const order = await this.getOrder(warehouseOrderId);

        return {
            trackingNumber: order.trackingNumber || null,
            carrier: order.shippingCarrier || null,
            trackingUrl: order.trackingUrl || null,
            shipmentStatus: order.status || null,
            events: [] // Printposs doesn't provide shipment events
        };
    }

    async cancelOrder(warehouseOrderId) {
        // Printposs docs unclear on cancel endpoint
        logger.warn('[PRINTPOSS] Cancel order not fully documented, attempting...');
        try {
            const response = await axios.delete(
                `${this.baseUrl}/api/v1/seller/orders/${warehouseOrderId}`,
                { headers: this.getHeaders(), timeout: 30000 }
            );
            return { success: true, rawResponse: response.data };
        } catch (error) {
            logger.error('[PRINTPOSS] Cancel order failed:', error.message);
            throw new Error(`Printposs cancel order failed: ${error.message}`);
        }
    }

    /**
     * Transform API unified format → Printposs format
     * API: { receiver, items: [{product_variant_id, design_image_url}], customerOrderNumber }
     * Printposs: { externalOrderId, storeId, shippingAddress: {name, addressLine1, countryCode}, items: [{productVariantId, designImageUrl}] }
     */
    transformOrderData(apiData) {
        const receiver = apiData.receiver || {};
        const fullName = [receiver.firstName, receiver.lastName].filter(Boolean).join(' ') || receiver.name || '';

        return {
            ...apiData,
            externalOrderId: apiData.externalOrderId || apiData.customerOrderNumber,
            storeId: apiData.storeId || this.config.printposs.storeId || 1,
            shippingAddress: apiData.shippingAddress || {
                name: fullName,
                addressLine1: receiver.addressLines?.[0] || receiver.address1 || '',
                addressLine2: receiver.addressLines?.[1] || receiver.address2 || '',
                city: receiver.city || '',
                state: receiver.province || '',
                postalCode: receiver.postalCode || '',
                countryCode: receiver.countryCode || '',
                phone: receiver.phoneNumber || '',
                email: receiver.email || ''
            },
            items: (apiData.items || []).map(item => ({
                ...item,
                productVariantId: item.productVariantId || item.product_variant_id,
                designImageUrl: item.designImageUrl || item.design_image_url,
                shippingLabelUrl: item.shippingLabelUrl || item.shipping_label_url || null,
                quantity: item.quantity || 1
            }))
        };
    }

    validateOrderData(orderData) {
        if (!orderData.storeId) throw new Error('Printposs: storeId is required');
        if (!orderData.externalOrderId) throw new Error('Printposs: externalOrderId is required');
        if (!orderData.items || orderData.items.length === 0) throw new Error('Printposs: items is required');
        if (!orderData.shippingAddress) throw new Error('Printposs: shippingAddress is required');
        if (!orderData.shippingAddress.name) throw new Error('Printposs: shippingAddress.name is required');
        if (!orderData.shippingAddress.addressLine1) throw new Error('Printposs: shippingAddress.addressLine1 is required');
        if (!orderData.shippingAddress.countryCode) throw new Error('Printposs: shippingAddress.countryCode is required');

        for (const item of orderData.items) {
            if (!item.productVariantId) throw new Error('Printposs: item.productVariantId is required');
            if (!item.designImageUrl) throw new Error('Printposs: item.designImageUrl is required');
        }

        return true;
    }

    mapStatus(warehouseStatus) {
        const statusMap = {
            'pending': 'pod_pending',
            'processing': 'pod_in_production',
            'shipped': 'pod_shipped',
            'cancelled': 'pod_cancelled',
            'on_hold': 'pod_on_hold',
        };
        return statusMap[warehouseStatus] || 'pod_pending';
    }
}

module.exports = PrintpossService;
