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
            external_order_id: orderData.externalOrderId,
            first_name: orderData.shippingAddress.firstName || '',
            last_name: orderData.shippingAddress.lastName || '',
            address_1: orderData.shippingAddress.addressLine1 || '',
            address_2: orderData.shippingAddress.addressLine2 || '',
            city: orderData.shippingAddress.city || '',
            region: orderData.shippingAddress.state || '',
            zip: orderData.shippingAddress.postalCode || '',
            country: orderData.shippingAddress.countryCode || '',
            email: orderData.shippingAddress.email || '',
            phone: orderData.shippingAddress.phone || '',
            store_id: orderData.storeId || null,
            notes: orderData.notes || '',
            is_sample: false,
            items: orderData.items.map(item => ({
                product_variant_id: parseInt(item.productVariantId),
                quantity: item.quantity || 1,
                design_image_url: item.designImageUrl,
                mockup_image_url: item.mockupImageUrl || null
            }))
        };
        const isSBTT = orderData.podShippingMethod.toUpperCase() === 'SBTT';
        const tracking = orderData.tracking;

        // SBTT: include shipping_label_url at order level
        if (isSBTT && orderData.shippingLabelUrl) {
            payload.shipping_label_url = orderData.shippingLabelUrl;
        }

        try {
            const response = await axios.post(
                `${this.baseUrl}/api/v1/seller/orders`,
                payload,
                { headers: this.getHeaders(), timeout: 180000 }
            );

            if (!response.data?.success) {
                throw new Error(`Printposs create order failed: ${JSON.stringify(response.data)}`);
            }

            const data = response.data?.data;

            logger.info('[PRINTPOSS] Order created', {
                orderNumber: data?.order_number,
                externalOrderId: orderData.externalOrderId
            });


            return {
                success: true,
                // order_number is the warehouseOrderId for PrintPoss (used in getOrder API)
                warehouseOrderId: String(data?.order_number || ''),
                tracking: isSBTT && tracking ? {
                    tracking: tracking.trackingNumber || null,
                    carrier: tracking.carrier || 'USPS',
                    shipping_label: tracking.linkPrint || null
                } : null,
                rawResponse: response.data
            };
        } catch (error) {
            if (error.response?.status === 429) {
                logger.warn('[PRINTPOSS] Rate limited, retry later');
            }

            // Format error message chi tiết từ response
            const responseData = error.response?.data;
            let errorDetail = '';

            if (responseData) {
                if (responseData.message) {
                    errorDetail = responseData.message;
                }
                // PrintPoss trả errors dạng { field: ["error1", "error2"] }
                if (responseData.errors && typeof responseData.errors === 'object') {
                    const fieldErrors = Object.entries(responseData.errors)
                        .map(([field, messages]) => `${field}: ${Array.isArray(messages) ? messages.join(', ') : messages}`)
                        .join(' | ');
                    errorDetail = errorDetail ? `${errorDetail} — ${fieldErrors}` : fieldErrors;
                }
            }

            if (!errorDetail) {
                errorDetail = error.message;
            }

            logger.error('[PRINTPOSS] Create order failed:', {
                status: error.response?.status,
                detail: errorDetail,
                responseData
            });

            throw new Error(`Printposs create order failed (${error.response?.status || 'network'}): ${errorDetail}`);
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

            // Extract tracking from packages
            const pkg = data?.packages?.[0] || {};

            return {
                id: data?.order_number,
                externalOrderId: data?.external_order_id,
                status: data?.order_status,
                trackingNumber: pkg.tracking_number || null,
                shippingCarrier: pkg.carrier || null,
                trackingUrl: pkg.tracking_link || null,
                labelUrl: pkg.shipping_label_url || null,
                items: data?.items || [],
                rawResponse: response.data
            };
        } catch (error) {
            logger.error('[PRINTPOSS] Get order failed:', error.message);
            throw new Error(`Printposs get order failed: ${error.message}`);
        }
    }

    async getTracking(warehouseOrderId) {
        const order = await this.getOrder(warehouseOrderId);

        return {
            trackingNumber: order.trackingNumber || null,
            carrier: order.shippingCarrier || null,
            trackingUrl: order.trackingUrl || null,
            shipmentStatus: order.status || null,
            events: []
        };
    }

    async cancelOrder(warehouseOrderId) {
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
     * Fetch products from PrintPoss API and return SKU → variant_id mapping
     */
    async fetchProducts() {
        try {
            const response = await axios.get(
                `${this.baseUrl}/api/v1/seller/products`,
                {
                    params: {
                        order_by: 'created_at',
                        order_direction: 'desc',
                        page: 1,
                        per_page: 50
                    },
                    headers: this.getHeaders(),
                    timeout: 30000
                }
            );

            if (!response.data?.success) {
                throw new Error(`Printposs fetch products failed: ${JSON.stringify(response.data)}`);
            }

            const skuToVariantId = {};
            const products = response.data?.data || [];

            for (const product of products) {
                for (const variant of (product.variants || [])) {
                    if (variant.sku) {
                        skuToVariantId[variant.sku] = variant.id;
                    }
                }
            }

            logger.info(`[PRINTPOSS] Fetched ${products.length} products, ${Object.keys(skuToVariantId).length} variants mapped`);

            return skuToVariantId;
        } catch (error) {
            logger.error('[PRINTPOSS] Fetch products failed:', error.response?.data || error.message);
            throw new Error(`Printposs fetch products failed: ${error.message}`);
        }
    }

    /**
     * Sync warehouse_id (variant_id) for PrintPoss products in pod_products table
     * Matches by warehouse_sku ↔ variant.sku
     */
    async syncWarehouseIds() {
        const PodProductModel = require('../../models/pod-product.model');

        try {
            const skuToVariantId = await this.fetchProducts();

            const products = await PodProductModel.findMissingWarehouseId('PRINTPOSS');

            if (products.length === 0) {
                logger.info('[PRINTPOSS] All products already have warehouse_id');
                return { synced: 0, total: 0 };
            }

            const updateMap = {};
            const notFound = [];

            for (const product of products) {
                const variantId = skuToVariantId[product.warehouse_sku];
                if (variantId) {
                    updateMap[product.warehouse_sku] = variantId;
                } else {
                    notFound.push(product.warehouse_sku);
                }
            }

            let synced = 0;
            if (Object.keys(updateMap).length > 0) {
                synced = await PodProductModel.bulkUpdateWarehouseId('PRINTPOSS', updateMap);
            }

            if (notFound.length > 0) {
                logger.warn(`[PRINTPOSS] ${notFound.length} SKUs not found on PrintPoss API`, { notFound });
            }

            logger.info(`[PRINTPOSS] Synced warehouse_id for ${synced}/${products.length} products`);

            return { synced, total: products.length, notFound };
        } catch (error) {
            logger.error('[PRINTPOSS] Sync warehouse IDs failed:', error.message);
            throw error;
        }
    }

    /**
     * Transform API unified format → Printposs format
     * Key difference: PrintPoss uses warehouse_id (variant_id) instead of SKU
     * SBTT orders include shipping_label_url instead of tracking_number
     */
    transformOrderData(apiData) {
        const receiver = apiData.receiver || {};
        const firstName = receiver.firstName || '';
        const lastName = receiver.lastName || '-';

        return {
            ...apiData,
            externalOrderId: apiData.customerOrderNumber,
            storeId: null,
            shippingAddress: {
                firstName: firstName,
                lastName: lastName,
                addressLine1: receiver.addressLines?.[0] || '',
                addressLine2: receiver.addressLines?.[1] || '',
                city: receiver.city || '',
                state: receiver.province || '',
                postalCode: receiver.postalCode || '',
                countryCode: receiver.countryCode || '',
                phone: receiver.phoneNumber || '',
                email: receiver.email || ''
            },
            // Map items: use warehouseId (variant_id) as productVariantId
            items: (apiData.items || []).map(item => ({
                ...item,
                productVariantId: item.warehouseId || null,
                designImageUrl: item.print_areas[0]?.value || null,
                mockupImageUrl: item.image || null,
                quantity: item.quantity || 1
            })),
            // SBTT: pass shipping label URL from tracking
            shippingLabelUrl: apiData.tracking?.linkPrint || null,
            podShippingMethod: apiData.shippingMethod || null
        };
    }

    validateOrderData(orderData) {
        if (!orderData.externalOrderId) throw new Error('Printposs: externalOrderId is required');
        if (!orderData.items || orderData.items.length === 0) throw new Error('Printposs: items is required');
        if (!orderData.shippingAddress) throw new Error('Printposs: shippingAddress is required');

        for (const item of orderData.items) {
            if (!item.productVariantId) throw new Error('Printposs: item.productVariantId is required (warehouse_id missing, sync products first)');
            if (!item.designImageUrl) throw new Error('Printposs: item.designImageUrl is required');
        }

        return true;
    }

    mapStatus(warehouseStatus) {
        const statusMap = {
            'pending': 'pod_pending',
            'draft': 'pod_processing',
            'in_production': 'pod_in_production',
            'shipped': 'pod_shipped',
            'delivered': 'pod_delivered',
            'cancelled': 'pod_cancelled',
            'failed': 'pod_cancelled',
        };
        return statusMap[warehouseStatus] || 'pod_processing';
    }
}

module.exports = PrintpossService;
