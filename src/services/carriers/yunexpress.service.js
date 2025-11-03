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
        const params = {};
        
        if (body) {
            params.body = body;
        }
        
        params.date = timestamp;
        params.method = method;
        params.uri = uri;
        
        const sortedKeys = Object.keys(params).sort();
        
        const queryString = sortedKeys
            .map(key => `${key}=${params[key]}`)
            .join('&');
        
        return queryString;
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
            const timestamp = Date.now().toString(); // Bỏ + '000'

            const token = await this.getToken();

            const bodyData = this.transformOrderData(orderData);
            const bodyString = JSON.stringify(bodyData);

            // Signature content cho POST: body={JSON}&date=xxx&method=POST&uri=xxx
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
                customerOrderNumber: orderData.customerOrderNumber,
                signatureContent: signatureContent.substring(0, 100) + '...'
            });

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
     * Tracking đơn hàng
     * API: GET /v1/track-service/info/get?order_number={trackingNumber}
     */
    async trackOrder(trackingNumber) {
        try {
            const method = 'GET';
            const uri = '/v1/track-service/info/get';
            const url = `${this.baseUrl}${uri}?order_number=${trackingNumber}`;
            const timestamp = Date.now().toString();

            const token = await this.getToken();

            const signatureContent = this.generateSignatureContent(
                timestamp,
                method,
                uri
            );
            
            const signature = this.generateSha256Signature(
                signatureContent,
                this.appSecret
            );

            logger.info('🔍 Đang tracking đơn hàng:', trackingNumber);

            const response = await axios.get(url, {
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json',
                    'token': token,
                    'date': timestamp,
                    'sign': signature
                },
                timeout: 30000
            });

            // Parse response đúng cấu trúc của YunExpress
            const responseData = response.data?.response || response.data;
            
            // Kiểm tra success
            if (!responseData.success) {
                logger.error('❌ YunExpress tracking failed:', {
                    code: responseData.code,
                    message: responseData.msg
                });
                throw new Error(responseData.msg || 'Tracking failed');
            }

            // Lấy tracking info từ result array
            const trackingData = responseData.result?.[0];
            
            if (!trackingData) {
                throw new Error('No tracking data found in response');
            }

            const trackInfo = trackingData.track_Info;

            logger.info('✅ Đã lấy thông tin tracking:', {
                trackingNumber,
                waybillNumber: trackInfo?.waybill_number,
                status: trackingData.package_status,
                productName: trackInfo?.product_name,
                eventsCount: trackInfo?.track_events?.length || 0
            });

            return {
                success: true,
                trackingNumber: trackingNumber,
                waybillNumber: trackInfo?.waybill_number,
                customerOrderNumber: trackInfo?.customer_order_number,
                packageStatus: trackingData.package_status,
                trackingInfo: {
                    package_status: trackingData.package_status,
                    productCode: trackInfo?.product_code,
                    productName: trackInfo?.product_name,
                    channelCode: trackInfo?.channel_code,
                    checkInTime: trackInfo?.check_in_time,
                    checkOutTime: trackInfo?.check_out_time,
                    actualWeight: trackInfo?.actual_weight,
                    lastMileName: trackInfo?.last_mile_name,
                    lastMileSite: trackInfo?.last_mile_site,
                    phoneNumber: trackInfo?.phone_number,
                    originCode: trackInfo?.origin_code,
                    destinationCode: trackInfo?.destination_code
                },
                events: trackInfo?.track_events || [],
                status: this.parseTrackingStatus(trackingData.package_status, trackInfo),
                lastUpdate: trackInfo?.track_events?.[trackInfo.track_events.length - 1]?.process_time || new Date().toISOString()
            };

        } catch (error) {
            // Xử lý lỗi response từ YunExpress
            if (error.response?.data) {
                const errorData = error.response.data;
                
                logger.error('❌ YunExpress API Error:', {
                    code: errorData.code,
                    message: errorData.msg,
                    trackingNumber
                });
                throw new Error(`YunExpress tracking failed: ${errorData.msg || errorData.code}`);
            }
            
            logger.error('❌ Lỗi khi tracking:', {
                message: error.message,
                response: error.response?.data
            });
            throw new Error(`YunExpress tracking failed: ${error.response?.data?.response?.msg || error.message}`);
        }
    }

    /**
     * Parse tracking status từ YunExpress sang status chuẩn
     * YunExpress package_status codes:
     * - "T" = In Transit
     * - "D" = Delivered
     * - "C" = Created/Pending
     * - "R" = Returned
     * - "X" = Exception/Problem
     */
    parseTrackingStatus(packageStatus, trackInfo = null) {
        const statusMap = {
            'N': 'not_found',       // Order not found
            'F': 'created',         // Electronic forecast information reception (chưa có vận đơn thật)
            'T': 'in_transit',      // In transit
            'D': 'delivered',       // Successful delivery
            'E': 'exception',       // May be abnormal
            'R': 'returned',        // Package returned
            'C': 'cancelled'        // Order Cancellation
        };
        
        const baseStatus = statusMap[packageStatus?.toUpperCase()];
        
        if (!baseStatus) {
            logger.warn('Unknown package status:', packageStatus);
            return 'unknown';
        }
        
        // Nếu có track_events, kiểm tra thêm để chính xác hơn
        if (trackInfo?.track_events?.length > 0) {
            const latestEvent = trackInfo.track_events[trackInfo.track_events.length - 1];
            const eventCode = latestEvent.track_node_code?.toLowerCase() || '';
            
            // Override status nếu có event code rõ ràng hơn
            if (eventCode.includes('delivered') || eventCode.includes('pod') || eventCode.includes('signed')) {
                return 'delivered';
            }
            if (eventCode.includes('exception') || eventCode.includes('problem') || eventCode.includes('failed')) {
                return 'exception';
            }
            if (eventCode.includes('returned') || eventCode.includes('return_to_sender')) {
                return 'returned';
            }
            if (eventCode.includes('cancelled') || eventCode.includes('cancel')) {
                return 'cancelled';
            }
        }
        
        return baseStatus;
    }

    /**
     * Transform dữ liệu từ format chung sang format YunExpress
     */
    transformOrderData(orderData) {
        return {
            product_code: orderData.productCode || '',
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

        const receiverRequired = ['firstName', 'lastName', 'countryCode', 'city', 'addressLines', 'phoneNumber'];
        for (const field of receiverRequired) {
            if (!orderData.receiver[field]) {
                throw new Error(`Missing required receiver field: ${field}`);
            }
        }

        return true;
    }
}

module.exports = YunExpressService;