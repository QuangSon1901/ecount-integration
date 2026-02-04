const axios = require('axios');
const logger = require('../../utils/logger');

const docNoLookupService = require('./ecount-docno-lookup.service');

/**
 * Extract error message safely from axios error (avoid circular structure)
 */
function getErrorMessage(error) {
    if (axios.isAxiosError(error)) {
        // Extract relevant info from axios error
        const responseData = error.response?.data;
        const statusText = error.response?.statusText;
        const status = error.response?.status;

        if (responseData) {
            // Try to get error message from response data
            if (typeof responseData === 'string') {
                return responseData;
            }
            if (responseData.StatusText) {
                return responseData.StatusText;
            }
            if (responseData.message) {
                return responseData.message;
            }
            if (responseData.error) {
                return typeof responseData.error === 'string'
                    ? responseData.error
                    : JSON.stringify(responseData.error);
            }
            // Return stringified response data (safe, no circular refs)
            try {
                return JSON.stringify(responseData);
            } catch {
                return `HTTP ${status}: ${statusText}`;
            }
        }

        if (status) {
            return `HTTP ${status}: ${statusText || 'Unknown error'}`;
        }

        // Network error or request error
        return error.message || 'Network error';
    }

    // Regular error
    return error.message || 'Unknown error';
}

class ECountOrderService {
    constructor() {
        this.baseUrl = process.env.ECOUNT_OAPI_BASE_URL || 'https://oapi.ecount.com';
        this.zone = process.env.ECOUNT_ZONE || '';
        this.sessionId = null;
        this.sessionExpiry = null;
    }

    /**
     * Login to ECount OAPI
     */
    async login() {
        // Check if session is still valid
        if (this.sessionId && this.sessionExpiry && Date.now() < this.sessionExpiry) {
            logger.debug('Using cached ECount session');
            return this.sessionId;
        }

        try {
            const url = `${this.baseUrl}/OAPI/V2/OAPILogin`;
            
            const response = await axios.post(url, {
                COM_CODE: process.env.ECOUNT_COMPANY_CODE,
                USER_ID: process.env.ECOUNT_ID,
                API_CERT_KEY: process.env.ECOUNT_API_CERT_KEY,
                ZONE: this.zone
            }, {
                headers: { 'Content-Type': 'application/json' },
                timeout: 30000
            });

            // Check for errors first
            if (response.data?.Error) {
                const errorCode = response.data.Error.Code;
                const errorMessage = response.data.Error.Message || 'Unknown error';
                throw new Error(`ECount login failed [Code ${errorCode}]: ${errorMessage}`);
            }

            // Check for successful login
            if (response.data?.Status === 200 && response.data?.Data?.Code === '00') {
                // Session ID is in Data.Datas.SESSION_ID
                this.sessionId = response.data.Data.Datas.SESSION_ID;
                
                if (!this.sessionId) {
                    throw new Error('Session ID not found in response');
                }

                // Session valid for 30 minutes
                this.sessionExpiry = Date.now() + (25 * 60 * 1000); // 25 min for safety
                
                logger.info('ECount OAPI login successful', {
                    sessionId: this.sessionId.substring(0, 20) + '...',
                    comCode: response.data.Data.Datas.COM_CODE,
                    userId: response.data.Data.Datas.USER_ID
                });
                
                return this.sessionId;
            } else {
                throw new Error(`ECount login failed: Status=${response.data?.Status}, Code=${response.data?.Data?.Code}`);
            }

        } catch (error) {
            const errorMsg = getErrorMessage(error);
            logger.error('ECount OAPI login failed:', errorMsg);
            throw new Error(`Failed to login to ECount: ${errorMsg}`);
        }
    }

    /**
     * Create sale order on ECount
     */
    async createSaleOrder(orderData) {
        try {
            // Get session
            const sessionId = await this.login();

            const url = `${this.baseUrl}/OAPI/V2/Sale/SaveSale?SESSION_ID=${sessionId}`;
            
            // Transform data to ECount format
            const ecountPayload = this.transformToECountFormat(orderData);

            logger.info('Creating order on ECount', {
                customerCode: orderData.customerCode,
                itemsCount: ecountPayload.SaleList?.length || 0
            });

            const response = await axios.post(url, ecountPayload, {
                headers: { 'Content-Type': 'application/json' },
                timeout: 60000
            });

            // Check for Error object first
            if (response.data?.Error) {
                const errorCode = response.data.Error.Code;
                const errorMessage = response.data.Error.Message || 'Unknown error';
                throw new Error(`ECount API Error [Code ${errorCode}]: ${errorMessage}`);
            }

            // Check response status
            if (response.data?.Status === 200 || response.data?.Status === "200") {
                const data = response.data.Data;
                
                
                // Check if there are any failures
                if (data.FailCnt > 0) {
                    // Extract error details
                    const errorDetails = data.ResultDetails
                        .filter(detail => !detail.IsSuccess)
                        .map(detail => ({
                            error: detail.TotalError,
                            fields: detail.Errors?.map(e => `${e.ColCd}: ${e.Message}`).join(', ')
                        }));

                    logger.error('ECount order validation failed', {
                        successCount: data.SuccessCnt,
                        failCount: data.FailCnt,
                        errors: errorDetails
                    });

                    throw new Error(
                        `ECount validation failed (${data.FailCnt} errors): ${errorDetails[0]?.error || 'Unknown validation error'}`
                    );
                }

                // Success case
                if (data.SuccessCnt > 0 && data.SlipNos?.length > 0) {
                    const slipNo = data.SlipNos[0]; // First slip number
                    
                    logger.info('ECount order created successfully', {
                        slipNo: slipNo,
                        successCount: data.SuccessCnt,
                        traceId: data.TRACE_ID
                    });

                    return {
                        success: true,
                        ecountOrderId: slipNo,
                        successCount: data.SuccessCnt,
                        failCount: data.FailCnt,
                        traceId: data.TRACE_ID,
                        resultDetails: data.ResultDetails,
                        rawResponse: response.data
                    };
                } else {
                    throw new Error('ECount order created but no SlipNo returned');
                }
            } else {
                throw new Error(
                    `ECount API returned unexpected status: ${response.data?.Status}`
                );
            }

        } catch (error) {
            const errorMsg = getErrorMessage(error);
            logger.error('Failed to create ECount order:', errorMsg);
            
            // Re-throw with more context
            if (error.response?.data) {
                throw new Error(
                    `ECount order creation failed: ${errorMsg} | Response: ${JSON.stringify(error.response.data)}`
                );
            }
            
            throw new Error(`ECount order creation failed: ${errorMsg}`);
        }
    }

    /**
     * Create multiple sale orders on ECount in one API call
     */
    async createBulkSaleOrders(ordersData) {
        try {
            // Get session
            const sessionId = await this.login();

            const url = `${this.baseUrl}/OAPI/V2/Sale/SaveSale?SESSION_ID=${sessionId}`;
            
            // Transform tất cả orders sang ECount format
            const saleList = ordersData.map((orderData, _) => {
                return this.transformToECountFormatSingle({...orderData, index: _});
            });

            const ecountPayload = {
                SaleList: saleList
            };

            logger.info('Creating bulk orders on ECount', {
                orderCount: ordersData.length,
                customerCodes: [...new Set(ordersData.map(o => o.customerCode))]
            });

            const response = await axios.post(url, ecountPayload, {
                headers: { 'Content-Type': 'application/json' },
                timeout: 120000 // 2 minutes for bulk
            });
            

            // Check for Error object first
            if (response.data?.Error) {
                const errorCode = response.data.Error.Code;
                const errorMessage = response.data.Error.Message || 'Unknown error';
                throw new Error(`ECount API Error [Code ${errorCode}]: ${errorMessage}`);
            }

            // Check response status
            if (response.data?.Status === 200 || response.data?.Status === "200") {
                const data = response.data.Data;
                
                // Check if there are any failures
                if (data.FailCnt > 0) {
                    // Extract error details
                    const errorDetails = data.ResultDetails
                        .map((detail, index) => ({
                            index: index,
                            isSuccess: detail.IsSuccess,
                            error: detail.TotalError,
                            fields: detail.Errors?.map(e => `${e.ColCd}: ${e.Message}`).join(', ')
                        }));

                    logger.warn('ECount bulk order validation - some failures', {
                        successCount: data.SuccessCnt,
                        failCount: data.FailCnt,
                        errors: errorDetails.filter(e => !e.isSuccess)
                    });

                    // Nếu tất cả đều fail thì throw error
                    if (data.SuccessCnt === 0) {
                        throw new Error(
                            `ECount validation failed - all orders failed: ${errorDetails[0]?.error || 'Unknown validation error'}`
                        );
                    }
                }

                // Success case - có ít nhất 1 order thành công
                if (data.SuccessCnt > 0 && data.SlipNos?.length > 0) {
                    logger.info('ECount bulk orders created', {
                        totalOrders: ordersData.length,
                        successCount: data.SuccessCnt,
                        failCount: data.FailCnt,
                        slipNos: data.SlipNos,
                        traceId: data.TRACE_ID
                    });

                    return {
                        success: true,
                        slipNos: data.SlipNos, // Array of slip numbers
                        successCount: data.SuccessCnt,
                        failCount: data.FailCnt,
                        traceId: data.TRACE_ID,
                        resultDetails: data.ResultDetails,
                        rawResponse: response.data
                    };
                } else {
                    throw new Error('ECount orders created but no SlipNos returned');
                }
            } else {
                throw new Error(
                    `ECount API returned unexpected status: ${response.data?.Status}`
                );
            }

        } catch (error) {
            const errorMsg = getErrorMessage(error);
            logger.error('Failed to create ECount bulk orders:', errorMsg);
            
            // Re-throw with more context
            if (error.response?.data) {
                throw new Error(
                    `ECount bulk order creation failed: ${errorMsg} | Response: ${JSON.stringify(error.response.data)}`
                );
            }
            
            throw new Error(`ECount bulk order creation failed: ${errorMsg}`);
        }
    }

    /**
     * Create sale order và lookup DOC_NO
     */
    async createSaleOrderWithDocNo(orderData) {
        try {
            // Create order trên ECount
            const result = await this.createSaleOrder(orderData);
            
            if (!result.success || !result.ecountOrderId) {
                return result;
            }

            // Lookup DOC_NO từ SlipNo
            try {
                const mapping = await docNoLookupService.lookupDocNos([result.ecountOrderId]);
                const docNo = mapping[result.ecountOrderId];
                
                if (docNo) {
                    result.docNo = docNo;
                    result.erpOrderCode = docNo;
                    logger.info('DOC_NO found', { 
                        slipNo: result.ecountOrderId, 
                        docNo 
                    });
                } else {
                    logger.warn('DOC_NO not found for SlipNo', { 
                        slipNo: result.ecountOrderId 
                    });
                }
            } catch (lookupError) {
                logger.error('Failed to lookup DOC_NO:', lookupError);
                // Không throw error, vẫn trả về kết quả với SlipNo
                result.docNoLookupError = lookupError.message;
            }

            return result;

        } catch (error) {
            throw error;
        }
    }

    /**
     * Create bulk sale orders và lookup DOC_NO
     */
    async createBulkSaleOrdersWithDocNo(ordersData) {
        try {
            const result = await this.createBulkSaleOrders(ordersData);
            
            if (!result.success || !result.slipNos || result.slipNos.length === 0) {
                return result;
            }

            result.resultDetails = result.resultDetails.map((detail, index) => {
                const slipNo = result.slipNos[index];
                return {
                    ...detail,
                    slipNo,
                };
            });

            return result;
        } catch (error) {
            throw error;
        }
    }

    transformToECountFormatSingle(orderData) {
        const {
            // Basic info
            index,
            ioDate,
            customerCode,
            customerName,
            warehouseCode = '',
            employeeCode = '',

            // Order info
            orderNumber,
            orderMemo1 = '',
            orderMemo2 = '',
            orderMemo3 = '',
            orderMemo4 = '',
            orderMemo5 = '',

            // Receiver info
            receiverName = '',
            receiverCountry = '',
            receiverAddress1 = '',
            receiverAddress2 = '',
            receiverCity = '',
            receiverState = '',
            receiverZipCode = '',
            receiverPhone = '',
            receiverEmail = '',

            // Customs info
            customsEORINumber = '',
            customsIOSSCode = '',
            customsVAT = '',

            // Service info
            additionalService = '',
            serviceType = '',
            trackingNumber = '',

            // Product info
            productSize = '',
            quantity = 1,

            // Custom fields
            customFields = {}

        } = orderData;

        // Extract dimensions and prices from customFields
        const length = customFields.length || '';
        const width = customFields.width || '';
        const height = customFields.height || '';
        const weight = customFields.weight || '';
        const declaredValue = customFields.declaredValue || '';
        const sellingPrice = customFields.sellingPrice || '';
        const productENName = customFields.productENName || '';
        const productCNName = customFields.productCNName || '';

        // Calculate total weight
        const totalWeight = weight && quantity ? (parseFloat(weight) * quantity).toString() : '';

        // Build bulk data
        const bulkData = {
            // Header fields
            IO_DATE: '',
            UPLOAD_SER_NO: index,
            CUST: customerCode,
            CUST_DES: customerName,
            EMP_CD: employeeCode,
            WH_CD: warehouseCode,
            IO_TYPE: '',
            EXCHANGE_TYPE: '',
            EXCHANGE_RATE: '',
            SITE: '',
            PJT_CD: '',
            TTL_CTT: '',

            // Order memo fields - MAPPING ĐÚNG
            U_MEMO1: orderMemo1, // Zip code
            U_MEMO2: orderMemo2, // Receiver name
            U_MEMO3: orderMemo3,
            U_MEMO4: orderMemo4, // Email
            U_MEMO5: orderMemo5, // Address line 2

            // Additional text fields (Header - Receiver info) - MAPPING ĐÚNG
            ADD_TXT_01_T: '',
            ADD_TXT_02_T: '',
            ADD_TXT_03_T: receiverPhone, // Phone
            ADD_TXT_04_T: '',
            ADD_TXT_05_T: receiverCountry, // Country code*
            ADD_TXT_06_T: receiverAddress1, // Street line 1*
            ADD_TXT_07_T: additionalService, // Additional service*
            ADD_TXT_08_T: receiverCity, // City*
            ADD_TXT_09_T: receiverState, // State/Province*
            ADD_TXT_10_T: customsEORINumber, // EORI number

            // Additional number fields (Header)
            ADD_NUM_01_T: customsVAT, // VAT
            ADD_NUM_02_T: '',
            ADD_NUM_03_T: '',
            ADD_NUM_04_T: '',
            ADD_NUM_05_T: '',

            // Additional code fields (Header)
            ADD_CD_01_T: '',
            ADD_CD_02_T: '',
            ADD_CD_03_T: '',

            // Additional date fields (Header)
            ADD_DATE_01_T: '',
            ADD_DATE_02_T: '',
            ADD_DATE_03_T: '',

            // Order tracking
            U_TXT1: orderNumber, // Internal order number

            // Additional long text fields (Header)
            ADD_LTXT_01_T: trackingNumber, // Tracking number
            ADD_LTXT_02_T: serviceType, // Service type*
            ADD_LTXT_03_T: customsIOSSCode, // IOSS code

            // Product info (first item)
            PROD_CD: process.env.API_PRODUCT_CODE, // Must be registered in ECount
            PROD_DES: process.env.API_PRODUCT_NAME,
            SIZE_DES: productSize,
            UQTY: '',
            QTY: quantity.toString(),
            PRICE: '', // Shipping fee
            USER_PRICE_VAT: '',
            SUPPLY_AMT: '',
            SUPPLY_AMT_F: '',
            VAT_AMT: '',
            REMARKS: '',
            ITEM_CD: '',

            // Product remarks
            P_REMARKS1: '',
            P_REMARKS2: '',
            P_REMARKS3: '',

            // Product additional text fields - Dimensions - MAPPING ĐÚNG
            ADD_TXT_01: '',
            ADD_TXT_02: length.toString(), // Length (cm)*
            ADD_TXT_03: width.toString(), // Width (cm)*
            ADD_TXT_04: height.toString(), // Height (cm)*
            ADD_TXT_05: productCNName, // Product name CN
            ADD_TXT_06: productENName, // Product name EN*

            // Relation fields
            REL_DATE: '',
            REL_NO: '',
            MAKE_FLAG: '',
            CUST_AMT: '',
            P_AMT1: '',
            P_AMT2: '',

            // Product additional numbers - MAPPING ĐÚNG
            ADD_NUM_01: '', // Extra fee
            ADD_NUM_02: sellingPrice.toString(), // Selling price*
            ADD_NUM_03: weight.toString(), // Unit weight*
            ADD_NUM_04: totalWeight, // Total weight (unit weight * qty)
            ADD_NUM_05: declaredValue.toString(), // Unit price/Declared value*

            // Product additional codes
            ADD_CD_01: '',
            ADD_CD_02: '',
            ADD_CD_03: '',
            ADD_CD_NM_01: '',
            ADD_CD_NM_02: '',
            ADD_CD_NM_03: '',
            ADD_CDNM_01: '',
            ADD_CDNM_02: '',
            ADD_CDNM_03: '',

            // Product additional dates
            ADD_DATE_01: '',
            ADD_DATE_02: '',
            ADD_DATE_03: ''
        };

        // Override with custom ecountFields if provided
        if (customFields.ecountFields) {
            Object.assign(bulkData, customFields.ecountFields);
        }

        return {
            BulkDatas: bulkData
        };
    }

    /**
     * Transform order data to ECount format
     */
    transformToECountFormat(orderData) {
        return {
            SaleList: [this.transformToECountFormatSingle(orderData)]
        };
    }

    /**
     * Clear session
     */
    clearSession() {
        this.sessionId = null;
        this.sessionExpiry = null;
    }
}

module.exports = new ECountOrderService();