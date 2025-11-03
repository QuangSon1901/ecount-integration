const axios = require('axios');
const crypto = require('crypto');
const BaseCarrier = require('./base.carrier');
const logger = require('../../utils/logger');

class YunExpressService extends BaseCarrier {
    constructor(config) {
        super(config);
        this.name = 'YunExpress';
        this.baseUrl = config.yunexpress.baseUrl;
        this.appId = config.yunexpress.appId;
        this.appSecret = config.yunexpress.appSecret;
        this.sourceKey = config.yunexpress.sourceKey;
        this.tokenCache = null;
        this.tokenExpiry = null;
    }

    /**
     * Tạo signature content
     */
    generateSignatureContent(timestamp, method, uri, body = null) {
        const params = {
            date: timestamp,
            method: method,
            uri: uri
        };
        
        if (body) {
            params.body = body;
        }
        
        // Sort keys
        const sortedKeys = Object.keys(params).sort();
        const sortedParams = {};
        sortedKeys.forEach(key => {
            sortedParams[key] = params[key];
        });
        
        // Build query string
        const queryString = Object.entries(sortedParams)
            .map(([key, value]) => `${key}=${value}`)
            .join('&');
        
        return decodeURIComponent(queryString);
    }

    /**
     * Tạo SHA256 signature
     */
    generateSha256Signature(data, key) {
        const hmac = crypto.createHmac('sha256', key);
        hmac.update(data);
        return hmac.digest('base64');
    }

    /**
     * Lấy access token
     */
    async getToken() {
        // Check cache
        if (this.tokenCache && this.tokenExpiry && Date.now() < this.tokenExpiry) {
            return this.tokenCache;
        }

        try {
            const url = `${this.baseUrl}/openapi/oauth2/token`;
            const data = {
                grantType: 'client_credentials',
                appId: this.appId,
                appSecret: this.appSecret,
                sourceKey: this.sourceKey
            };

            logger.info('🔑 Đang lấy token từ YunExpress...');

            const response = await axios.post(url, data, {
                headers: {
                    'Content-Type': 'application/json'
                },
                timeout: 30000
            });

            if (response.data && response.data.accessToken) {
                this.tokenCache = response.data.accessToken;
                // Token expires in 2 hours, cache for 1.5 hours
                this.tokenExpiry = Date.now() + (90 * 60 * 1000);
                
                logger.info('✅ Đã lấy token thành công');
                return this.tokenCache;
            } else {
                throw new Error('Invalid token response');
            }
        } catch (error) {
            logger.error('❌ Lỗi khi lấy token:', error.message);
            throw new Error(`Failed to get YunExpress token: ${error.message}`);
        }
    }

    /**
     * Tạo đơn hàng
     */
    async createOrder(orderData) {
        try {
            const method = 'POST';
            const uri = '/v1/order/package/create';
            const url = `${this.baseUrl}${uri}`;
            const timestamp = Date.now().toString() + '000';

            // Get token
            const token = await this.getToken();

            // Prepare body
            const bodyData = this.transformOrderData(orderData);
            const bodyString = JSON.stringify(bodyData);

            // Generate signature
            const signatureContent = this.generateSignatureContent(
                timestamp,
                method,
                uri,
                bodyString
            );
            const signature = this.generateSha256Signature(
                signatureContent,
                this.appSecret
            );

            logger.info('📦 Đang tạo đơn hàng YunExpress...', {
                customerOrderNumber: orderData.customerOrderNumber
            });

            // Make request
            const response = await axios.post(url, bodyString, {
                headers: {
                    'Content-Type': 'application/json',
                    'token': token,
                    'date': timestamp,
                    'sign': signature
                },
                timeout: 30000
            });

            logger.info('✅ Đã tạo đơn hàng thành công:', response.data);

            return {
                success: true,
                trackingNumber: response.data.waybill_number || response.data.tracking_number,
                carrierResponse: response.data,
                carrier: 'YUNEXPRESS'
            };

        } catch (error) {
            logger.error('❌ Lỗi khi tạo đơn YunExpress:', error.response?.data || error.message);
            throw new Error(`YunExpress order creation failed: ${error.response?.data?.message || error.message}`);
        }
    }

    /**
     * Transform dữ liệu từ format chung sang format YunExpress
     */
    transformOrderData(orderData) {
        return {
            product_code: orderData.productCode || 'S1002',
            customer_order_number: orderData.customerOrderNumber || '',
            order_numbers: {
                waybill_number: '',
                platform_order_number: orderData.platformOrderNumber || '',
                tracking_number: '',
                reference_numbers: orderData.referenceNumbers || []
            },
            weight_unit: orderData.weightUnit || 'KG',
            size_unit: orderData.sizeUnit || 'CM',
            packages: orderData.packages || [{
                length: 10,
                width: 10,
                height: 10,
                weight: 0.5
            }],
            receiver: {
                first_name: orderData.receiver.firstName,
                last_name: orderData.receiver.lastName,
                company: orderData.receiver.company || '',
                country_code: orderData.receiver.countryCode,
                province: orderData.receiver.province || '',
                city: orderData.receiver.city,
                address_lines: orderData.receiver.addressLines,
                postal_code: orderData.receiver.postalCode,
                phone_number: orderData.receiver.phoneNumber,
                email: orderData.receiver.email || '',
                certificate_type: orderData.receiver.certificateType || '',
                certificate_code: orderData.receiver.certificateCode || ''
            },
            declaration_info: orderData.declarationInfo || [],
            sender: orderData.sender ? {
                first_name: orderData.sender.firstName,
                last_name: orderData.sender.lastName,
                company: orderData.sender.company || '',
                country_code: orderData.sender.countryCode,
                province: orderData.sender.province || '',
                city: orderData.sender.city,
                address_lines: orderData.sender.addressLines,
                postal_code: orderData.sender.postalCode,
                phone_number: orderData.sender.phoneNumber,
                email: orderData.sender.email || '',
                certificate_type: orderData.sender.certificateType || '',
                certificate_code: orderData.sender.certificateCode || ''
            } : undefined,
            customs_number: orderData.customsNumber || {},
            extra_services: orderData.extraServices || [],
            platform_account_code: orderData.platformAccountCode || '',
            source_code: orderData.sourceCode || 'YT',
            sensitive_type: orderData.sensitiveType || 'D',
            label_type: orderData.labelType || 'PNG'
        };
    }

    /**
     * Validate dữ liệu đơn hàng
     */
    validateOrderData(orderData) {
        const required = ['receiver'];
        
        for (const field of required) {
            if (!orderData[field]) {
                throw new Error(`Missing required field: ${field}`);
            }
        }

        // Validate receiver
        const receiverRequired = ['firstName', 'lastName', 'countryCode', 'city', 'addressLines', 'phoneNumber'];
        for (const field of receiverRequired) {
            if (!orderData.receiver[field]) {
                throw new Error(`Missing required receiver field: ${field}`);
            }
        }

        return true;
    }

    /**
     * Tracking đơn hàng
     */
    async trackOrder(trackingNumber) {
        // Implement tracking logic if needed
        logger.info(`Tracking order: ${trackingNumber}`);
        return { trackingNumber, status: 'pending' };
    }
}

module.exports = YunExpressService;