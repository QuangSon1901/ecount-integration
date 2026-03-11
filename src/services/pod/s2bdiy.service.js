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
        this.storeId = config.s2bdiy.storeId || 406;
        this.logisticsId = config.s2bdiy.logisticsId || 999;

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
            const token = response.data?.data?.token || null;
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

    /**
     * Fetch basic product info from S2BDIY API by product codes
     * GET /v1/basicProduct?codes={codes}&per_page=100
     * @param {string[]} codes - Array of product codes (e.g., ["PUSJK7", "ZU6NAW"])
     * @returns {Promise<Object[]>} - Array of product objects with id, colors[], sizes[]
     */
    async getBasicProducts(codes) {
        await this.getToken();

        const codesStr = codes.join(',');
        try {
            const response = await axios.get(
                `${this.baseUrl}/v1/basicProduct?codes=${codesStr}&per_page=100`,
                { headers: this.getHeaders(), timeout: 30000 }
            );

            const products = response.data?.data?.data;
            if (!Array.isArray(products)) {
                throw new Error(`S2BDIY basicProduct API returned unexpected format for codes: ${codesStr}`);
            }

            logger.info(`[S2BDIY] Fetched ${products.length} products for codes: ${codesStr}`);
            return products;
        } catch (error) {
            logger.error('[S2BDIY] getBasicProducts failed:', { codes: codesStr, error: error.response?.data || error.message });
            throw new Error(`S2BDIY getBasicProducts failed: ${error.response?.data?.msg || error.message}`);
        }
    }

    /**
     * Resolve product_id, color_id, size_id for each item from S2BDIY Products API
     *
     * Flow per item:
     *   1. Extract code from warehouse_sku: code = warehouse_sku.split('-')[0]
     *   2. Fetch product info from S2BDIY API by code
     *   3. Match color: normalize(item.color) === normalize(product.colors[].en_name)
     *   4. Match size: normalize(pod_products.size) includes normalize(product.sizes[].en_name), fallback to "One Size"
     *
     * @param {Object[]} items - Items with sku (warehouse_sku), catalogColor, catalogSize
     * @returns {Promise<Object[]>} - Items enriched with productId, colorId, sizeId
     */
    async resolveProductInfo(items) {
        // Step 2a: Extract unique codes from warehouse_sku
        const codeToItems = new Map();
        for (const item of items) {
            const warehouseSku = item.sku;
            if (!warehouseSku) {
                throw new Error(`S2BDIY: item missing warehouse_sku (sku field)`);
            }
            const code = warehouseSku.split('-')[0];
            if (!codeToItems.has(code)) {
                codeToItems.set(code, []);
            }
            codeToItems.get(code).push(item);
        }

        // Step 2b: Batch fetch all product info
        const codes = Array.from(codeToItems.keys());
        const products = await this.getBasicProducts(codes);

        // Build lookup: code → product
        const productByCode = new Map();
        for (const product of products) {
            productByCode.set(product.code, product);
        }

        const normalize = (s) => (s || '').toLowerCase().replace(/\s+/g, '');

        // Resolve each item
        const resolvedItems = [];
        for (const item of items) {
            const warehouseSku = item.sku;
            const code = warehouseSku.split('-')[0];
            const product = productByCode.get(code);

            if (!product) {
                throw new Error(`S2BDIY: Product not found for code "${code}" (warehouse_sku: ${warehouseSku})`);
            }

            const productId = product.id;

            // Step 2c: Resolve color_id
            const itemColor = item.color || item.catalogColor || '';
            if (!itemColor) {
                throw new Error(`S2BDIY: Missing color for item with sku "${warehouseSku}". Provide color in item data or pod_products.product_color`);
            }
            const normalizedItemColor = normalize(itemColor);
            const matchedColor = product.colors.find(c => normalize(c.en_name) === normalizedItemColor);
            if (!matchedColor) {
                const availableColors = product.colors.map(c => c.en_name).join(', ');
                throw new Error(`S2BDIY: Color "${itemColor}" not found for product "${code}". Available: ${availableColors}`);
            }
            const colorId = matchedColor.id;

            // Step 2d: Resolve size_id
            const itemSize = item.catalogSize || '';
            if (!itemSize) {
                throw new Error(`S2BDIY: Missing size for item with sku "${warehouseSku}". Check pod_products.size`);
            }
            const normalizedItemSize = normalize(itemSize);
            let matchedSize = product.sizes.find(s => {
                const normalizedApiSize = normalize(s.en_name);
                return normalizedApiSize.includes(normalizedItemSize) || normalizedItemSize.includes(normalizedApiSize);
            });

            // Fallback: try "One Size"
            if (!matchedSize) {
                matchedSize = product.sizes.find(s => normalize(s.en_name) === normalize('One Size'));
            }

            if (!matchedSize) {
                const availableSizes = product.sizes.map(s => s.en_name).join(', ');
                throw new Error(`S2BDIY: Size "${itemSize}" not found for product "${code}". Available: ${availableSizes}`);
            }
            const sizeId = matchedSize.id;

            logger.info(`[S2BDIY] Resolved product info for ${warehouseSku}`, {
                productId, colorId, sizeId,
                color: matchedColor.en_name,
                size: matchedSize.en_name
            });

            resolvedItems.push({
                ...item,
                productId,
                colorId,
                sizeId
            });
        }

        return resolvedItems;
    }

    async createOrder(orderData) {
        await this.getToken();

        // Resolve product_id, color_id, size_id from S2BDIY Products API
        const resolvedItems = await this.resolveProductInfo(orderData.items);

        const payload = {
            third_order_id: orderData.thirdOrderId,
            third_user_id: 1,
            platform: orderData.platform || 99,
            store_id: orderData.storeId || this.storeId,
            remark: orderData.remark || '',
            logistics_id: 391,
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
            items: resolvedItems.map(item => {
                const mapped = {
                    third_product_id: 1,
                    third_product_image_url: item.print_areas && item.print_areas.length > 0 ? item.print_areas[0].value : '',
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
            logger.info('[S2BDIY] Creating order', {
                thirdOrderId: orderData.thirdOrderId,
                itemCount: resolvedItems.length,
                payload: JSON.stringify(payload)
            });

            console.log('S2BDIY create order payload:', payload);

            const response = await axios.post(
                `${this.baseUrl}/v1/order`,
                payload,
                { headers: this.getHeaders(), timeout: 60000 }
            );

            const data = response.data?.data;

            if (response.data?.status !== 'success' && response.data?.status_code !== 200) {
                logger.error('[S2BDIY] Create order API error', {
                    response: response.data,
                    thirdOrderId: orderData.thirdOrderId
                });
                throw new Error(`S2BDIY create order failed: ${response.data?.msg || 'Unknown error'}`);
            }

            logger.info('[S2BDIY] Order created', {
                s2bdiyOrderId: data?.id,
                thirdOrderId: orderData.thirdOrderId
            });

            return {
                success: true,
                warehouseOrderId: String(data?.id || ''),
                rawResponse: response?.data || ''
            };
        } catch (error) {
            logger.error('[S2BDIY] Create order failed:', {
                error: error.response?.data || error.message,
                thirdOrderId: orderData.thirdOrderId
            });
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
     * Transform API unified format -> S2BDIY format
     * API: { receiver, items: [{sku, color, design_image_url, catalogSize, catalogColor}], customerOrderNumber }
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
                thirdProductId: item.thirdProductId || item.product_id || 1,
                thirdProductImageUrl: item.thirdProductImageUrl || item.design_image_url || '',
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
            if (!item.sku) {
                throw new Error('S2BDIY: item.sku (warehouse_sku) is required for product resolution');
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
