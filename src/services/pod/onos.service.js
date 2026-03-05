// src/services/pod/onos.service.js
const axios = require('axios');
const BasePodWarehouse = require('./base.pod-warehouse');
const logger = require('../../utils/logger');

class OnosService extends BasePodWarehouse {
    constructor(config) {
        super(config);
        this.name = 'ONOS POD';
        this.code = 'ONOS';
        this.baseUrl = config.onos.baseUrl;
        this.email = config.onos.email;
        this.password = config.onos.password;

        // Token cache (refresh every 24h as safety measure, ONOS tokens don't expire per docs)
        this.token = null;
        this.tokenExpiry = null;
        this.TOKEN_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
    }

    async getToken() {
        if (this.token && this.tokenExpiry && Date.now() < this.tokenExpiry) {
            return this.token;
        }

        try {
            const response = await axios.post(`${this.baseUrl}/login`, {
                email: this.email,
                password: this.password
            }, {
                headers: { 'Content-Type': 'application/json' },
                timeout: 30000
            });

            if (!response.data?.status || !response.data?.data?.token) {
                throw new Error('ONOS login failed: ' + JSON.stringify(response.data));
            }

            this.token = response.data.data.token;
            this.tokenExpiry = Date.now() + this.TOKEN_TTL_MS;

            logger.info('[ONOS] Login successful');
            return this.token;
        } catch (error) {
            logger.error('[ONOS] Login failed:', error.message);
            throw new Error(`ONOS authentication failed: ${error.message}`);
        }
    }

    getHeaders() {
        return {
            'Authorization': `Bearer ${this.token}`,
            'Content-Type': 'application/json'
        };
    }

    async createOrder(orderData) {
        await this.getToken();

        const payload = {
            order_id: orderData.orderId || orderData.customerOrderNumber,
            referent_id: orderData.referentId || '',
            identifier: orderData.identifier || 'THG_EXPRESS',
            customer_note: orderData.customerNote || '',
            order_name: orderData.orderName || '',
            reference_id: orderData.referenceId || '',
            note: orderData.note || '',
            items: orderData.items.map(item => ({
                sku: item.sku,
                product_id: item.productId,
                name: item.name,
                quantity: item.quantity || 1,
                price: item.price,
                currency: item.currency || 'USD',
                image: item.image || '',
                attributes: item.attributes || [],
                print_areas: item.printAreas || []
            })),
            shipping_info: {
                full_name: orderData.shippingInfo.fullName,
                address_1: orderData.shippingInfo.address1,
                address_2: orderData.shippingInfo.address2 || '',
                city: orderData.shippingInfo.city,
                state: orderData.shippingInfo.state || '',
                country: orderData.shippingInfo.country,
                postcode: orderData.shippingInfo.postcode,
                phone: orderData.shippingInfo.phone || '',
                email: orderData.shippingInfo.email || ''
            },
            shipping_method: orderData.shippingMethod || 'ONOSEXPRESS'
        };

        // THG cung cấp label sẵn
        if (orderData.tracking) {
            payload.tracking = {
                tracking_number: orderData.tracking.trackingNumber,
                carrier: orderData.tracking.carrier,
                link_print: orderData.tracking.linkPrint
            };
        }

        try {
            const response = await axios.post(
                `${this.baseUrl}/order/create/test`,
                payload,
                { headers: this.getHeaders(), timeout: 60000 }
            );

            // ONOS trả HTTP 200 nhưng status: false khi có lỗi
            if (response.data?.status === false) {
                const errorMsg = response.data?.error || response.data?.message || 'Unknown ONOS error';
                logger.error('[ONOS] Create order API error:', { error: errorMsg, payload: { order_id: payload.order_id, shipping_method: payload.shipping_method } });
                throw new Error(`ONOS API error: ${errorMsg}`);
            }

            const data = response.data?.data;

            logger.info('[ONOS] Order created', {
                onosOrderId: data?.id,
                thgOrderId: orderData.orderId
            });

            return {
                success: true,
                warehouseOrderId: data?.id || '',
                trackingNumber: data?.tracking?.tracking || null,
                rawResponse: response.data
            };
        } catch (error) {
            logger.error('[ONOS] Create order failed:', error.response?.data || error.message);
            throw new Error(`ONOS create order failed: ${error.response?.data?.error || error.response?.data?.message || error.message}`);
        }
    }

    async getOrder(warehouseOrderId) {
        await this.getToken();

        try {
            const response = await axios.get(
                `${this.baseUrl}/order/${warehouseOrderId}`,
                { headers: this.getHeaders(), timeout: 30000 }
            );

            const data = response.data?.data;

            return {
                id: data?.id,
                orderId: data?.order_id,
                status: data?.status,
                tracking: data?.tracking || null,
                productionAt: data?.production_at,
                paidAt: data?.paid_at,
                fulfillmentCost: data?.fulfillment_cost,
                shipCost: data?.ship_cost,
                rawResponse: response.data
            };
        } catch (error) {
            logger.error('[ONOS] Get order failed:', error.message);
            throw new Error(`ONOS get order failed: ${error.message}`);
        }
    }

    async getTracking(warehouseOrderId) {
        await this.getToken();

        try {
            const response = await axios.get(
                `${this.baseUrl}/order/${warehouseOrderId}/shipment/events`,
                { headers: this.getHeaders(), timeout: 30000 }
            );

            const data = response.data?.data;

            return {
                trackingNumber: data?.tracking?.tracking || null,
                carrier: data?.tracking?.carrier || null,
                trackingUrl: data?.tracking?.url || null,
                shipmentStatus: data?.status || null,
                events: data?.events || []
            };
        } catch (error) {
            logger.error('[ONOS] Get tracking failed:', error.message);
            throw new Error(`ONOS get tracking failed: ${error.message}`);
        }
    }

    async cancelOrder(warehouseOrderId) {
        await this.getToken();

        try {
            const response = await axios.delete(
                `${this.baseUrl}/order/${warehouseOrderId}`,
                { headers: this.getHeaders(), timeout: 30000 }
            );

            return { success: true, rawResponse: response.data };
        } catch (error) {
            logger.error('[ONOS] Cancel order failed:', error.message);
            throw new Error(`ONOS cancel order failed: ${error.message}`);
        }
    }

    /**
     * Transform API unified format → ONOS format
     * API: { receiver, items: [{product_id, print_areas}], customerOrderNumber }
     * ONOS: { orderId, shippingInfo: {fullName, address1, country}, items: [{productId, printAreas}] }
     */
    transformOrderData(apiData) {
        const receiver = apiData.receiver || {};
        const fullName = [receiver.firstName, receiver.lastName].filter(Boolean).join(' ') || receiver.name || '';

        return {
            ...apiData,
            orderId: apiData.customerOrderNumber || apiData.orderId,
            shippingInfo: apiData.shippingInfo || {
                fullName: fullName,
                address1: receiver.addressLines?.[0] || receiver.address1 || '',
                address2: receiver.addressLines?.[1] || receiver.address2 || '',
                city: receiver.city || '',
                state: receiver.province || '',
                country: receiver.countryCode || '',
                postcode: receiver.postalCode || '',
                phone: receiver.phoneNumber || '',
                email: receiver.email || ''
            },
            items: (apiData.items || []).map(item => ({
                ...item,
                productId: item.productId || item.product_id,
                printAreas: item.printAreas || item.print_areas || [],
                designUrls: item.designUrls || item.design_urls || []
            })),
            shippingMethod: apiData.shippingMethod || apiData.podShippingMethod || 'ONOSEXPRESS'
        };
    }

    validateOrderData(orderData) {
        if (!orderData.orderId && !orderData.customerOrderNumber) throw new Error('ONOS: orderId is required');
        if (!orderData.items || orderData.items.length === 0) throw new Error('ONOS: items is required');
        if (!orderData.shippingInfo) throw new Error('ONOS: shippingInfo is required');
        if (!orderData.shippingInfo.fullName) throw new Error('ONOS: shippingInfo.fullName is required');
        if (!orderData.shippingInfo.address1) throw new Error('ONOS: shippingInfo.address1 is required');
        if (!orderData.shippingInfo.country) throw new Error('ONOS: shippingInfo.country is required');

        for (const item of orderData.items) {
            if (!item.sku) throw new Error('ONOS: item.sku is required');
            if (!item.productId) throw new Error('ONOS: item.productId is required');
        }

        return true;
    }

    mapStatus(warehouseStatus) {
        const statusMap = {
            'Pending': 'pod_pending',
            'Processing': 'pod_in_production',
            'Fulfilled': 'pod_shipped',
            'Cancelled': 'pod_cancelled',
        };
        return statusMap[warehouseStatus] || 'pod_pending';
    }
}

module.exports = OnosService;
