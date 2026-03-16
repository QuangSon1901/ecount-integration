// src/services/pod/s2bdiy.service.js
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const FormData = require('form-data');
const BasePodWarehouse = require('./base.pod-warehouse');
const logger = require('../../utils/logger');

// Supported file extensions that S2BDIY accepts
const DIRECT_FILE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp', '.pdf', '.svg'];
const UPLOADS_DIR = path.join(__dirname, '../../../public/uploads/pod');

class S2BDIYService extends BasePodWarehouse {
    constructor(config) {
        super(config);
        this.name = 'S2BDIY';
        this.code = 'S2BDIY';
        this.baseUrl = config.s2bdiy.baseUrl;
        this.appKey = config.s2bdiy.appKey;
        this.appSecret = config.s2bdiy.appSecret;
        this.storeId = config.s2bdiy.storeId || 406;

        // Token cache
        this.token = null;
        this.tokenExpiry = null;
        this.TOKEN_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours (refresh periodically)

        // Logistics ID mapping based on shippingMethod
        this.LOGISTICS_MAP = {
            'SBTT': 194,  // US USPS manual label upload
            'SBSL': 391,  // S2BDIY handles shipping
        };
        this.DEFAULT_LOGISTICS_ID = 391;
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
     * Resolve logistics_id from shippingMethod
     * SBTT = 194 (USPS manual label upload)
     * SBSL = 391 (S2BDIY handles shipping)
     */
    resolveLogisticsId(shippingMethod) {
        if (!shippingMethod) return this.DEFAULT_LOGISTICS_ID;
        const method = shippingMethod.toUpperCase();
        return this.LOGISTICS_MAP[method] || this.DEFAULT_LOGISTICS_ID;
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

        // Build lookup: code -> product
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
            const normalizedItemSize = normalize(itemSize);
            let matchedSize = itemSize
                ? product.sizes.find(s => {
                    const normalizedApiSize = normalize(s.en_name);
                    return normalizedApiSize.includes(normalizedItemSize) || normalizedItemSize.includes(normalizedApiSize);
                })
                : null;

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

    /**
     * Extract Google Drive file ID from various URL formats
     * Supports: /file/d/{id}/..., ?id={id}, /open?id={id}
     */
    extractGoogleDriveFileId(url) {
        if (!url) return null;
        const dMatch = url.match(/\/d\/([a-zA-Z0-9_-]+)/);
        if (dMatch) return dMatch[1];
        const idMatch = url.match(/[?&]id=([a-zA-Z0-9_-]+)/);
        if (idMatch) return idMatch[1];
        return null;
    }

    /**
     * Check if a URL has a direct file extension that S2BDIY accepts
     * e.g., .png, .jpg, .pdf
     */
    hasDirectFileExtension(url) {
        if (!url) return false;
        try {
            const pathname = new URL(url).pathname;
            const ext = path.extname(pathname).toLowerCase();
            return DIRECT_FILE_EXTENSIONS.includes(ext);
        } catch {
            return false;
        }
    }

    /**
     * Detect file extension from buffer content (magic bytes)
     */
    detectFileExtension(buffer) {
        if (!buffer || buffer.length < 4) return '.bin';
        const hex = buffer.slice(0, 8).toString('hex').toUpperCase();

        if (hex.startsWith('89504E47')) return '.png';
        if (hex.startsWith('FFD8FF')) return '.jpg';
        if (hex.startsWith('47494638')) return '.gif';
        if (hex.startsWith('25504446')) return '.pdf';
        if (hex.startsWith('424D')) return '.bmp';
        if (hex.startsWith('52494646') && buffer.slice(8, 12).toString('ascii') === 'WEBP') return '.webp';

        return '.png'; // default to png for images
    }

    /**
     * Ensure URL has a direct file extension that S2BDIY accepts.
     * If URL already ends with .png/.jpg/.pdf etc, return as-is.
     * If not (e.g. Google Drive share link), download the file,
     * save to public/uploads/pod/, return system URL.
     *
     * @param {string} url - Original URL (may be Google Drive, etc.)
     * @returns {Promise<string>} - URL with proper file extension
     */
    async ensureDirectFileUrl(url) {
        if (!url) return url;

        // Only download & save locally for Google Drive links
        // Other URLs (shortlinks, CDN, etc.) are passed through as-is
        const fileId = this.extractGoogleDriveFileId(url);
        if (!fileId) {
            return url;
        }

        // Download the file from Google Drive
        const buffer = await this.downloadFileAsBuffer(url);

        // Detect file type from content
        const ext = this.detectFileExtension(buffer);

        // Generate unique filename
        const hash = crypto.createHash('md5').update(url).digest('hex').substring(0, 12);
        const timestamp = Date.now();
        const filename = `${timestamp}_${hash}${ext}`;

        // Ensure directory exists
        if (!fs.existsSync(UPLOADS_DIR)) {
            fs.mkdirSync(UPLOADS_DIR, { recursive: true });
        }

        // Save file locally
        const filePath = path.join(UPLOADS_DIR, filename);
        fs.writeFileSync(filePath, buffer);

        // Build system URL
        const systemUrl = `${this.config.baseUrl}/uploads/pod/${filename}`;

        logger.info('[S2BDIY] File saved locally for S2BDIY', {
            originalUrl: url,
            systemUrl,
            fileSize: buffer.length,
            extension: ext
        });

        return systemUrl;
    }

    /**
     * Download a file from URL and return as Buffer
     * Handles Google Drive share links with confirmation page bypass
     * @param {string} url - URL to download from
     * @returns {Promise<Buffer>} - File content as Buffer
     */
    async downloadFileAsBuffer(url) {
        try {
            const fileId = this.extractGoogleDriveFileId(url);
            let downloadUrl = fileId
                ? `https://drive.google.com/uc?export=download&id=${fileId}&confirm=t`
                : url;

            const response = await axios.get(downloadUrl, {
                responseType: 'arraybuffer',
                timeout: 60000,
                maxRedirects: 10,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                }
            });

            let buffer = Buffer.from(response.data);

            // Check if Google Drive returned an HTML confirmation page instead of the file
            if (fileId && buffer.length < 200000) {
                const content = buffer.toString('utf-8', 0, Math.min(buffer.length, 1000));
                if (content.includes('virus scan') || content.includes('confirm=') || content.includes('Google Drive')) {
                    const confirmUrl = `https://drive.usercontent.google.com/download?id=${fileId}&export=download&confirm=t`;
                    const retryResponse = await axios.get(confirmUrl, {
                        responseType: 'arraybuffer',
                        timeout: 60000,
                        maxRedirects: 10,
                        headers: {
                            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                        }
                    });
                    buffer = Buffer.from(retryResponse.data);
                    logger.info(`[S2BDIY] Downloaded file from Google Drive (retry)`, {
                        url, fileId, size: buffer.length
                    });
                    return buffer;
                }
            }

            logger.info(`[S2BDIY] Downloaded file from URL`, {
                url, size: buffer.length, isGoogleDrive: !!fileId
            });

            return buffer;
        } catch (error) {
            logger.error('[S2BDIY] Failed to download file:', { url, error: error.message });
            throw new Error(`S2BDIY: Failed to download file from ${url}: ${error.message}`);
        }
    }

    /**
     * Upload tracking label (shipping label PDF) to S2BDIY for an order
     * Used for SBTT orders where tracking comes from Ecount
     *
     * POST /v1/order/{orderId}/logistics
     * Content-Type: multipart/form-data
     * - id: order ID
     * - file: shipping label PDF binary
     * - track_number: tracking number
     *
     * @param {string} orderId - S2BDIY order ID
     * @param {string} trackingNumber - Tracking number from Ecount
     * @param {string} labelUrl - URL to shipping label PDF (e.g., Google Drive link)
     * @returns {Promise<Object>}
     */
    async uploadTrackingLabel(orderId, trackingNumber, labelUrl) {
        await this.getToken();

        try {
            // Download the shipping label PDF
            const pdfBuffer = await this.downloadFileAsBuffer(labelUrl);

            // Build multipart form data
            const form = new FormData();
            form.append('id', String(orderId));
            form.append('track_number', trackingNumber || '');
            form.append('file', pdfBuffer, {
                filename: `label_${orderId}.pdf`,
                contentType: 'application/pdf'
            });

            const response = await axios.post(
                `${this.baseUrl}/v1/order/${orderId}/logistics`,
                form,
                {
                    headers: {
                        'Authorization': this.token,
                        ...form.getHeaders()
                    },
                    timeout: 60000
                }
            );

            if (response.data?.status !== 'success' && response.data?.status_code !== 200) {
                throw new Error(`Upload tracking label failed: ${response.data?.msg || 'Unknown error'}`);
            }

            logger.info('[S2BDIY] Tracking label uploaded successfully', {
                orderId,
                trackingNumber,
                labelUrl
            });

            return {
                success: true,
                rawResponse: response.data
            };
        } catch (error) {
            logger.error('[S2BDIY] Upload tracking label failed:', {
                orderId,
                trackingNumber,
                labelUrl,
                error: error.response?.data || error.message
            });
            throw new Error(`S2BDIY upload tracking label failed: ${error.response?.data?.msg || error.message}`);
        }
    }

    async createOrder(orderData) {
        await this.getToken();

        // Resolve product_id, color_id, size_id from S2BDIY Products API
        const resolvedItems = await this.resolveProductInfo(orderData.items);

        // Resolve logistics_id from shippingMethod (SBTT=194, SBSL=391)
        const shippingMethod = orderData.shippingMethod || orderData.podShippingMethod || '';
        const logisticsId = this.resolveLogisticsId(shippingMethod);
        
        const payload = {
            third_order_id: orderData.thirdOrderId,
            third_user_id: 1,
            platform: 99,
            store_id: this.storeId,
            remark: orderData.remark || '',
            logistics_id: logisticsId,
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
            items: await Promise.all(resolvedItems.map(async (item) => {
                const designImageUrl = item.print_areas && item.print_areas.length > 0 ? item.print_areas[0].value : '';
                // Ensure URL has proper file extension for S2BDIY
                const directImageUrl = designImageUrl ? await this.ensureDirectFileUrl(designImageUrl) : '';

                return {
                    third_product_id: 1,
                    third_product_image_url: directImageUrl,
                    product_id: 0,
                    num: item.quantity || 1,
                    size_id: item.sizeId,
                    color_id: item.colorId,
                    product_design: {
                        basic_product_id: item.productId,
                        name: item.name || '',
                        views: [
                            {
                                view_id: 1,
                                objects: [
                                    {
                                        type: "image",
                                        image_src: directImageUrl,
                                        design_type: 1
                                    }
                                ]
                            }
                        ]
                    }
                };
            }))
        };

        try {
            logger.info('[S2BDIY] Creating order', {
                thirdOrderId: orderData.thirdOrderId,
                itemCount: resolvedItems.length,
                shippingMethod,
                logisticsId,
                payload: JSON.stringify(payload)
            });

            const response = await axios.post(
                `${this.baseUrl}/v1/order/createWithDesign`,
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

            const warehouseOrderId = String(data?.id || '');

            logger.info('[S2BDIY] Order created', {
                s2bdiyOrderId: warehouseOrderId,
                thirdOrderId: orderData.thirdOrderId,
                shippingMethod,
                logisticsId
            });

            // SBTT: Don't upload tracking label immediately - S2BDIY order needs to be paid first
            // The cron job (pod-fetch-tracking) will check pay_status and upload when ready
            const isSBTT = shippingMethod.toUpperCase() === 'SBTT';
            const tracking = orderData.tracking;

            if (isSBTT && tracking) {
                logger.info('[S2BDIY] SBTT order created - tracking label will be uploaded by cron after payment', {
                    orderId: warehouseOrderId,
                    trackingNumber: tracking.trackingNumber,
                    linkPrint: tracking.linkPrint
                });
            }

            return {
                success: true,
                warehouseOrderId,
                // Pass tracking through for SBTT orders so worker can save to DB
                tracking: isSBTT && tracking ? {
                    tracking: tracking.trackingNumber || null,
                    carrier: tracking.carrier || 'USPS',
                    shipping_label: tracking.linkPrint || null
                } : null,
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

    /**
     * Get order details from S2BDIY
     * GET /v1/order/{orderId}
     * Returns order with tracking info for SBSL orders
     */
    async getOrder(warehouseOrderId) {
        await this.getToken();

        try {
            const response = await axios.get(
                `${this.baseUrl}/v1/order/${warehouseOrderId}`,
                { headers: this.getHeaders(), timeout: 30000 }
            );

            const order = response.data?.data;

            if (!order) {
                throw new Error(`S2BDIY order ${warehouseOrderId} not found`);
            }

            return {
                success: true,
                data: {
                    id: order.id,
                    thirdOrderId: order.third_order_id,
                    status: order.status,
                    statusText: order.status_text,
                    payStatus: order.pay_status,         // 1:Pending 2:In progress 3:Completed 4:Failed
                    payStatusText: order.pay_status_text,
                    trackingNumber: order.order_logistics?.logisticss_track_number || null,
                    labelUrl: order.order_logistics?.oss_file_src || null,
                    labelBarcode: order.order_logistics?.label_barcode || null,
                    logisticsTime: order.order_logistics?.logisticss_time || null,
                    logisticsStatus: order.order_logistics?.logisticss_status || null, // 1:Awaiting 2:In transit 3:Arrived 4:Delivered 5:Delayed 6:Failed 7:Anomaly
                    logisticsPlatform: order.logistics_platform,
                    producedTime: order.produced_time,
                    deliveryTime: order.delivery_time,
                    productAmount: order.product_amount,
                    shippingAmount: order.shipping_amount,
                    totalAmount: order.total_amount,
                },
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
            const orderResult = await this.getOrder(warehouseOrderId);
            const order = orderResult.data;
            const orderNo = order.thirdOrderId || warehouseOrderId;

            const response = await axios.get(
                `${this.baseUrl}/logistics/orderLogisticsTracking?order_no=${orderNo}`,
                { headers: this.getHeaders(), timeout: 30000 }
            );

            const data = response.data?.data;

            return {
                trackingNumber: order.trackingNumber || null,
                labelUrl: order.labelUrl || null,
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
            2: 'pod_processing',       // Unpaid
            3: 'pod_processing',       // Under review
            4: 'pod_processing', // In queue
            5: 'pod_in_production', // In production
            6: 'pod_shipped',       // Shipped
            7: 'pod_cancelled',     // Cancelled
        };
        return statusMap[status] || 'pod_processing';
    }
}

module.exports = S2BDIYService;
