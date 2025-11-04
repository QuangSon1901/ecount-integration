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

            logger.info('Đang lấy token từ YunExpress...');

            const response = await axios.post(url, data, {
                headers: {
                    'Content-Type': 'application/json'
                },
                timeout: 30000
            });

            if (response.data && response.data.accessToken) {
                this.tokenCache = response.data.accessToken;
                this.tokenExpiry = Date.now() + (90 * 60 * 1000);
                
                logger.info('Đã lấy token thành công');
                return this.tokenCache;
            } else {
                throw new Error('Invalid token response');
            }
        } catch (error) {
            logger.error('Lỗi khi lấy token:', error.message);
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
            const timestamp = Date.now().toString();

            const token = await this.getToken();

            const bodyData = this.transformOrderData(orderData);
            const bodyString = JSON.stringify(bodyData);

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

            logger.info('Đang tạo đơn hàng YunExpress...', {
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

            logger.info('Response từ YunExpress:', response.data);

            const result = response.data.result || response.data;

            return {
                success: true,
                waybillNumber: result.waybill_number,
                customerOrderNumber: result.customer_order_number,
                trackingNumber: result.tracking_number || '', // Có thể rỗng
                barCodes: result.bar_codes || '',
                trackType: result.track_type,
                remoteArea: result.remote_area,
                carrierResponse: response.data,
                carrier: 'YUNEXPRESS'
            };

        } catch (error) {
            logger.error('Lỗi khi tạo đơn YunExpress:', error.response?.data || error.message);
            throw new Error(`YunExpress order creation failed: ${error.response?.data?.msg || error.message}`);
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

            logger.info('Đang tracking đơn hàng:', trackingNumber);

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
                logger.error('YunExpress tracking failed:', {
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

            logger.info('Đã lấy thông tin tracking:', {
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
                
                logger.error('YunExpress API Error:', {
                    code: errorData.code,
                    message: errorData.msg,
                    trackingNumber
                });
                throw new Error(`YunExpress tracking failed: ${errorData.msg || errorData.code}`);
            }
            
            logger.error('Lỗi khi tracking:', {
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
     * Lấy danh sách sản phẩm vận chuyển có sẵn
     * API: GET /v1/basic-data/products/getlist?country_code={countryCode}
     * @param {string} countryCode - Mã quốc gia 2 ký tự (US, GB, AU...). Để trống = lấy tất cả
     * @returns {Promise<Object>}
     */
    async getProductList(countryCode = '') {
        try {
            const method = 'GET';
            const uri = '/v1/basic-data/products/getlist';
            
            // Build URL with query params
            let url = `${this.baseUrl}${uri}`;
            if (countryCode) {
                url += `?country_code=${countryCode}`;
            }
            
            const timestamp = Date.now().toString();

            const token = await this.getToken();

            // Signature cho GET không có body
            const signatureContent = this.generateSignatureContent(
                timestamp,
                method,
                uri
            );
            
            const signature = this.generateSha256Signature(
                signatureContent,
                this.appSecret
            );

            logger.info('Đang lấy danh sách products...', {
                countryCode: countryCode || 'ALL'
            });

            const response = await axios.get(url, {
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json',
                    'Accept-Language': 'en-US',
                    'token': token,
                    'date': timestamp,
                    'sign': signature
                },
                timeout: 30000
            });

            if (response.data && response.data.success) {
                const products = response.data.detail || [];
                
                logger.info('Đã lấy danh sách products:', {
                    total: products.length,
                    countryCode: countryCode || 'ALL'
                });

                return {
                    success: true,
                    total: products.length,
                    products: products,
                    timestamp: response.data.t
                };
            } else {
                throw new Error('Invalid response from YunExpress products API');
            }

        } catch (error) {
            logger.error('Lỗi khi lấy danh sách products:', error.message);
            
            if (error.response?.data) {
                logger.error('API Error Details:', {
                    code: error.response.data.code,
                    message: error.response.data.msg
                });
            }
            
            throw new Error(`Failed to get YunExpress products: ${error.message}`);
        }
    }

    /**
     * Lấy thông tin chi tiết đơn hàng
     * API: GET /v1/order/info/get?order_number={orderNumber}
     * @param {string} orderNumber - Waybill number, customer order number, hoặc tracking number
     * @returns {Promise<Object>}
     */
    async getOrderInfo(orderNumber) {
        try {
            const method = 'GET';
            const uri = '/v1/order/info/get';
            const url = `${this.baseUrl}${uri}?order_number=${orderNumber}`;
            const timestamp = Date.now().toString();

            const token = await this.getToken();

            // Signature cho GET không có body
            const signatureContent = this.generateSignatureContent(
                timestamp,
                method,
                uri
            );
            
            const signature = this.generateSha256Signature(
                signatureContent,
                this.appSecret
            );

            logger.info('Đang lấy thông tin đơn hàng:', orderNumber);

            const response = await axios.get(url, {
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json',
                    'Accept-Language': 'en-US',
                    'token': token,
                    'date': timestamp,
                    'sign': signature
                },
                timeout: 30000
            });

            if (response.data && response.data.success) {
                const result = response.data.result;
                
                logger.info('Đã lấy thông tin đơn hàng:', {
                    waybillNumber: result.waybill_number,
                    customerOrderNumber: result.customer_order_number,
                    trackingNumber: result.tracking_number,
                    status: result.status,
                    productCode: result.product_code
                });

                return {
                    success: true,
                    data: {
                        waybillNumber: result.waybill_number,
                        customerOrderNumber: result.customer_order_number,
                        trackingNumber: result.tracking_number,
                        productCode: result.product_code,
                        platformAccountCode: result.platform_account_code,
                        pieces: result.pieces,
                        weightUnit: result.weight_unit,
                        sizeUnit: result.size_unit,
                        status: result.status,
                        statusDescription: this.parseOrderStatus(result.status),
                        sensitiveType: result.sensitive_type,
                        sourceCode: result.source_code,
                        chargeWeight: result.chargeWeight,
                        packages: result.packages,
                        receiver: result.receiver,
                        sender: result.sender,
                        declarationInfo: result.declaration_info
                    },
                    timestamp: response.data.t
                };
            } else {
                throw new Error('Invalid response from YunExpress order info API');
            }

        } catch (error) {
            logger.error('Lỗi khi lấy thông tin đơn hàng:', error.message);
            
            if (error.response?.data) {
                logger.error('API Error Details:', {
                    code: error.response.data.code,
                    message: error.response.data.msg
                });
                throw new Error(`YunExpress API Error: ${error.response.data.msg || error.response.data.code}`);
            }
            
            throw new Error(`Failed to get YunExpress order info: ${error.message}`);
        }
    }

    /**
     * Parse order status từ YunExpress
     * @param {string} status - Status code từ YunExpress
     * @returns {string} Status description
     */
    parseOrderStatus(status) {
        const statusMap = {
            'Draft': 'Nháp',
            'T': 'Đã xử lý',
            'C': 'Đã xóa',
            'S': 'Đã dự báo',
            'R': 'Đã nhận',
            'D': 'Hết hàng',
            'F': 'Đã trả lại',
            'Q': 'Đã hủy bỏ',
            'P': 'Đã nhận bồi thường',
            'V': 'Đã ký nhận'
        };
        
        return statusMap[status] || status;
    }

    /**
     * Transform dữ liệu từ format chung sang format YunExpress
     */
    transformOrderData(orderData) {
        // Validate required fields
        if (!orderData.declarationInfo || orderData.declarationInfo.length === 0) {
            throw new Error('Declaration info is required for YunExpress orders');
        }

        const transformedData = {
            product_code: orderData.productCode, // VN-YTYCPREC
            customer_order_number: orderData.customerOrderNumber || '',
            
            order_numbers: {
                waybill_number: '', // Để trống, hệ thống sẽ tự sinh
                platform_order_number: orderData.platformOrderNumber || '', // Amazon Order ID
                tracking_number: orderData.trackingNumber || '', // Để trống nếu chưa có
                reference_numbers: orderData.referenceNumbers || []
            },
            
            weight_unit: orderData.weightUnit || 'KG',
            size_unit: orderData.sizeUnit || 'CM',
            
            packages: orderData.packages.map(pkg => ({
                length: pkg.length || 1,
                width: pkg.width || 1,
                height: pkg.height || 1,
                weight: pkg.weight
            })),
            
            receiver: {
                first_name: orderData.receiver.firstName, // Aniya
                last_name: orderData.receiver.lastName || '', // bahar
                company: orderData.receiver.company || '',
                country_code: orderData.receiver.countryCode, // US
                province: orderData.receiver.province || '', // IL
                city: orderData.receiver.city, // CHICAGO
                address_lines: orderData.receiver.addressLines, // ["4734 S PRAIRIE AVE APT 3"]
                postal_code: orderData.receiver.postalCode || '', // 60615-1688
                phone_number: orderData.receiver.phoneNumber, // +1 314-282-9402
                email: orderData.receiver.email || '',
                certificate_type: orderData.receiver.certificateType || '',
                certificate_code: orderData.receiver.certificateCode || ''
            },
            
            // Declaration info - QUAN TRỌNG
            declaration_info: orderData.declarationInfo.map(item => {
                const declItem = {
                    sku_code: item.sku_code || '',
                    name_local: item.name_local || '', // "定制贴纸"
                    name_en: item.name_en, // "Custom Decal" - BẮT BUỘC
                    quantity: item.quantity, // 1
                    unit_price: item.unit_price, // 60 (FOB Price)
                    unit_weight: item.unit_weight, // 0.023
                    hs_code: item.hs_code || '',
                    sales_url: item.sales_url || '',
                    currency: item.currency || 'USD',
                    material: item.material || '',
                    purpose: item.purpose || '', // Mục đích sử dụng
                    brand: item.brand || '',
                    spec: item.spec || '',
                    model: item.model || '',
                    remark: item.remark || ''
                };
                
                // Thêm selling_price nếu có
                if (item.selling_price !== undefined && item.selling_price !== null) {
                    declItem.selling_price = item.selling_price;
                }
                
                // Thêm fabric_creation_method nếu có
                if (item.fabric_creation_method) {
                    declItem.fabric_creation_method = item.fabric_creation_method;
                }
                
                // Thêm manufacturer info nếu có
                if (item.manufacturer_id) declItem.manufacturer_id = item.manufacturer_id;
                if (item.manufacturer_name) declItem.manufacturer_name = item.manufacturer_name;
                if (item.manufacturer_address) declItem.manufacturer_address = item.manufacturer_address;
                if (item.manufacturer_city) declItem.manufacturer_city = item.manufacturer_city;
                if (item.manufacturer_province) declItem.manufacturer_province = item.manufacturer_province;
                if (item.manufacturer_country) declItem.manufacturer_country = item.manufacturer_country;
                if (item.manufacturer_postalcode) declItem.manufacturer_postalcode = item.manufacturer_postalcode;
                
                return declItem;
            }),
            
            // Sender info (optional)
            ...(orderData.sender && {
                sender: {
                    first_name: orderData.sender.firstName,
                    last_name: orderData.sender.lastName || '',
                    company: orderData.sender.company || '',
                    country_code: orderData.sender.countryCode,
                    province: orderData.sender.province || '',
                    city: orderData.sender.city,
                    address_lines: orderData.sender.addressLines,
                    postal_code: orderData.sender.postalCode || '',
                    phone_number: orderData.sender.phoneNumber,
                    email: orderData.sender.email || '',
                    certificate_type: orderData.sender.certificateType || '',
                    certificate_code: orderData.sender.certificateCode || '',
                    usci_code: orderData.sender.usci_code || '' // Unified Social Credit Code
                }
            }),
            
            // Customs number
            customs_number: {
                tax_number: orderData.customsNumber?.tax_number || '',
                ioss_code: orderData.customsNumber?.ioss_code || '',
                vat_code: orderData.customsNumber?.vat_code || '',
                eori_number: orderData.customsNumber?.eori_number || ''
            },
            
            // Extra services
            extra_services: orderData.extraServices || [],
            
            // Platform info
            ...(orderData.platform && {
                platform: {
                    platform_name: orderData.platform.platform_name || '',
                    province: orderData.platform.province || '',
                    address: orderData.platform.address || '',
                    postal_code: orderData.platform.postal_code || '',
                    phone_number: orderData.platform.phone_number || '',
                    email: orderData.platform.email || '',
                    platform_code: orderData.platform.platform_code || ''
                }
            }),
            
            // Payment info
            ...(orderData.payment && {
                payment: {
                    pay_platform: orderData.payment.pay_platform || '',
                    pay_account: orderData.payment.pay_account || '',
                    pay_transaction: orderData.payment.pay_transaction || ''
                }
            }),
            
            platform_account_code: orderData.platformAccountCode || '',
            source_code: orderData.sourceCode || 'YT',
            sensitive_type: orderData.sensitiveType || 'W',
            label_type: orderData.labelType || 'PDF',
            
            // Goods type
            ...(orderData.goodsType && {
                goods_type: orderData.goodsType
            }),
            
            // Dangerous goods
            ...(orderData.dangerousGoodsType && {
                dangerous_goods_type: orderData.dangerousGoodsType
            }),
            
            // Pickup point
            ...(orderData.pointRelaisNum && {
                point_relais_num: orderData.pointRelaisNum
            }),
            
            // Manufacturer sales name và credit code (cho Trung Quốc)
            ...(orderData.manufactureSalesName && {
                manufacture_sales_name: orderData.manufactureSalesName
            }),
            ...(orderData.creditCode && {
                credit_code: orderData.creditCode
            })
        };
        
        return transformedData;
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

        const receiverRequired = ['firstName', 'countryCode', 'city', 'addressLines', 'phoneNumber'];
        for (const field of receiverRequired) {
            if (!orderData.receiver[field]) {
                throw new Error(`Missing required receiver field: ${field}`);
            }
        }

        return true;
    }
}

module.exports = YunExpressService;