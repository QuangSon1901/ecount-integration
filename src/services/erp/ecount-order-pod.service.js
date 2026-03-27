// src/services/erp/ecount-order-pod.service.js
// POD Ecount OAPI service - uses separate POD account credentials
// Same logic as ecount-order.service.js but with ECOUNT_POD_* env vars

const axios = require('axios');
const logger = require('../../utils/logger');

function getErrorMessage(error) {
    if (axios.isAxiosError(error)) {
        const responseData = error.response?.data;
        const statusText = error.response?.statusText;
        const status = error.response?.status;

        if (responseData) {
            if (typeof responseData === 'string') return responseData;
            if (responseData.StatusText) return responseData.StatusText;
            if (responseData.message) return responseData.message;
            if (responseData.error) {
                return typeof responseData.error === 'string'
                    ? responseData.error
                    : JSON.stringify(responseData.error);
            }
            try { return JSON.stringify(responseData); }
            catch { return `HTTP ${status}: ${statusText}`; }
        }

        if (status) return `HTTP ${status}: ${statusText || 'Unknown error'}`;
        return error.message || 'Network error';
    }
    return error.message || 'Unknown error';
}

class ECountOrderPodService {
    constructor() {
        this.baseUrl = process.env.ECOUNT_POD_OAPI_BASE_URL || process.env.ECOUNT_OAPI_BASE_URL || 'https://oapi.ecount.com';
        this.zone = process.env.ECOUNT_POD_ZONE || process.env.ECOUNT_ZONE || '';
        this.sessionId = null;
        this.sessionExpiry = null;
    }

    async login() {
        if (this.sessionId && this.sessionExpiry && Date.now() < this.sessionExpiry) {
            logger.debug('[POD OAPI] Using cached session');
            return this.sessionId;
        }

        try {
            const url = `${this.baseUrl}/OAPI/V2/OAPILogin`;

            const response = await axios.post(url, {
                COM_CODE: process.env.ECOUNT_POD_COMPANY_CODE,
                USER_ID: process.env.ECOUNT_POD_ID,
                API_CERT_KEY: process.env.ECOUNT_POD_API_CERT_KEY,
                ZONE: this.zone
            }, {
                headers: { 'Content-Type': 'application/json' },
                timeout: 30000
            });

            if (response.data?.Error) {
                const errorCode = response.data.Error.Code;
                const errorMessage = response.data.Error.Message || 'Unknown error';
                throw new Error(`[POD] ECount login failed [Code ${errorCode}]: ${errorMessage}`);
            }

            if (response.data?.Status === 200 && response.data?.Data?.Code === '00') {
                this.sessionId = response.data.Data.Datas.SESSION_ID;

                if (!this.sessionId) {
                    throw new Error('[POD] Session ID not found in response');
                }

                this.sessionExpiry = Date.now() + (25 * 60 * 1000);
                return this.sessionId;
            } else {
                throw new Error(`[POD] ECount login failed: Status=${response.data?.Status}`);
            }

        } catch (error) {
            const errorMsg = getErrorMessage(error);
            logger.error('[POD OAPI] Login failed:', errorMsg);
            throw new Error(`[POD] Failed to login to ECount: ${errorMsg}`);
        }
    }

    async createBulkSaleOrders(ordersData) {
        try {
            const sessionId = await this.login();

            const url = `${this.baseUrl}/OAPI/V2/Sale/SaveSale?SESSION_ID=${sessionId}`;

            const saleList = ordersData.map(orderData => {
                return this.transformToECountFormatSingle(orderData);
            });

            const ecountPayload = { SaleList: saleList };

            logger.info('[POD OAPI] Creating bulk orders on ECount POD', {
                orderCount: ordersData.length,
            });

            const response = await axios.post(url, ecountPayload, {
                headers: { 'Content-Type': 'application/json' },
                timeout: 120000
            });

            if (response.data?.Error) {
                const errorCode = response.data.Error.Code;
                const errorMessage = response.data.Error.Message || 'Unknown error';
                throw new Error(`[POD] ECount API Error [Code ${errorCode}]: ${errorMessage}`);
            }

            if (response.data?.Status === 200 || response.data?.Status === "200") {
                const data = response.data.Data;

                if (data.FailCnt > 0 && data.SuccessCnt === 0) {
                    const errorDetails = data.ResultDetails
                        .map((detail, index) => ({
                            index,
                            isSuccess: detail.IsSuccess,
                            error: detail.TotalError,
                            fields: detail.Errors?.map(e => `${e.ColCd}: ${e.Message}`).join(', ')
                        }));
                    throw new Error(
                        `[POD] ECount validation failed: ${errorDetails[0]?.error || 'Unknown'}`
                    );
                }

                if (data.SuccessCnt > 0 && data.SlipNos?.length > 0) {
                    logger.info('[POD OAPI] Bulk orders created', {
                        successCount: data.SuccessCnt,
                        failCount: data.FailCnt,
                        slipNos: data.SlipNos,
                    });

                    return {
                        success: true,
                        slipNos: data.SlipNos,
                        successCount: data.SuccessCnt,
                        failCount: data.FailCnt,
                        traceId: data.TRACE_ID,
                        resultDetails: data.ResultDetails,
                        rawResponse: response.data
                    };
                } else {
                    throw new Error('[POD] ECount orders created but no SlipNos returned');
                }
            } else {
                throw new Error(`[POD] ECount API unexpected status: ${response.data?.Status}`);
            }

        } catch (error) {
            const errorMsg = getErrorMessage(error);
            logger.error('[POD OAPI] Failed to create bulk orders:', errorMsg);
            throw new Error(`[POD] ECount bulk order creation failed: ${errorMsg}`);
        }
    }

    async createBulkSaleOrdersWithDocNo(ordersData) {
        try {
            const result = await this.createBulkSaleOrders(ordersData);

            if (!result.success || !result.slipNos || result.slipNos.length === 0) {
                return result;
            }

            result.resultDetails = result.resultDetails.map((detail, index) => {
                const slipNo = result.slipNos[index];
                return { ...detail, slipNo };
            });

            return result;
        } catch (error) {
            throw error;
        }
    }

    /**
     * Transform POD order data to ECount format.
     * POD field mapping is DIFFERENT from Express:
     *   - U_MEMO1 = address line 2
     *   - U_MEMO2 = receiver name
     *   - U_MEMO3 = address line 1
     *   - U_MEMO5 = province
     *   - U_MEMO6 (P_DES6) = customer order number
     *   - ADD_TXT_01_T = postal code
     *   - ADD_TXT_02_T = email
     *   - ADD_TXT_04_T = city
     *   - ADD_TXT_05_T = country code
     *   - ADD_TXT_10_T = tracking number
     *   - ADD_TXT_11_T = phone
     *   - ADD_TXT_12_T = label print link
     *   - WH_CD = warehouse/carrier code (001/002/004)
     *   - PJT_CD = shipping method (SBSL, SBTT, etc.)
     *   - PROD_CD = item SKU
     *   - PROD_DES = item name
     *   - QTY = item quantity
     *   - PRICE = item price
     *   - ADD_TXT_03 = product size (detail)
     *   - ADD_TXT_04 = product color (detail)
     *   - ADD_TXT_07 = design URL (detail)
     *   - REMARKS = mockup URL (detail)
     */
    transformToECountFormatSingle(orderData) {
        const {
            index = 0,
            customerCode = '',
            customerName = '',
            warehouseCode = '',
            employeeCode = '',
            shippingMethod = '',
            orderNumber = '',
            customerOrderNumber = '',
            internalOrderNumber = '',

            // Receiver
            receiverName = '',
            receiverCountry = '',
            receiverAddress1 = '',
            receiverAddress2 = '',
            receiverCity = '',
            receiverProvince = '',
            receiverZipCode = '',
            receiverPhone = '',
            receiverEmail = '',

            // Tracking
            trackingNumber = '',
            linkPrint = '',

            // Item
            itemSku = '',
            itemName = '',
            itemQuantity = 1,
            itemPrice = 0,
            itemSize = '',
            itemColor = '',
            designUrl = '',
            mockupUrl = '',

            customFields = {}
        } = orderData;

        const bulkData = {
            // Header fields
            IO_DATE: '',
            UPLOAD_SER_NO: index,
            CUST: customerCode,
            CUST_DES: customerName,
            EMP_CD: employeeCode,
            WH_CD: warehouseCode,               // 001/002/004
            IO_TYPE: '',
            EXCHANGE_TYPE: '',
            EXCHANGE_RATE: '',
            SITE: '',
            PJT_CD: shippingMethod,              // SBSL, SBTT, etc.
            TTL_CTT: '',

            // Order memo fields — POD mapping
            U_MEMO1: receiverAddress2,           // Address line 2
            U_MEMO2: receiverName,               // Receiver name
            U_MEMO3: receiverAddress1,           // Address line 1
            U_MEMO4: '',                        // IOSS number
            U_MEMO5: receiverProvince,           // Province/State

            // Header additional text fields — POD mapping
            ADD_TXT_01_T: receiverZipCode,       // Postal code
            ADD_TXT_02_T: receiverEmail,         // Email
            ADD_TXT_03_T: '',
            ADD_TXT_04_T: receiverCity,          // City
            ADD_TXT_05_T: receiverCountry,       // Country code
            ADD_TXT_06_T: '',
            ADD_TXT_07_T: '',
            ADD_TXT_08_T: '',
            ADD_TXT_09_T: '',
            ADD_TXT_10_T: trackingNumber,        // Tracking number
            ADD_TXT_11_T: '',
            ADD_TXT_12_T: '',

            // Header additional number fields
            ADD_NUM_01_T: '', ADD_NUM_02_T: '', ADD_NUM_03_T: '', ADD_NUM_04_T: '', ADD_NUM_05_T: '',

            // Header additional code fields
            ADD_CD_01_T: '', ADD_CD_02_T: '', ADD_CD_03_T: '',

            // Header additional date fields
            ADD_DATE_01_T: '', ADD_DATE_02_T: '', ADD_DATE_03_T: '',

            // Internal reference
            U_TXT1: orderNumber,

            // Header long text fields
            ADD_LTXT_01: designUrl,              // Design URL
            ADD_LTXT_01_T: receiverPhone,       // Phone
            ADD_LTXT_02_T: linkPrint,          // Label print link
            ADD_LTXT_03_T: '',

            // Detail fields — Item
            PROD_CD: itemSku,                    // SKU
            PROD_DES: itemName,                  // Product name
            SIZE_DES: '',
            UQTY: '',
            QTY: String(itemQuantity),           // Quantity
            PRICE: String(itemPrice),            // Price
            USER_PRICE_VAT: '',
            SUPPLY_AMT: '',
            SUPPLY_AMT_F: '',
            VAT_AMT: '',
            REMARKS: mockupUrl,                  // Mockup URL
            ITEM_CD: '',

            P_REMARKS1: '',
            P_REMARKS2: '',
            P_REMARKS3: '',

            // Detail additional text fields — POD mapping
            ADD_TXT_01: '',
            ADD_TXT_02: '',
            ADD_TXT_03: itemSize,                // Product size
            ADD_TXT_04: itemColor,               // Product color
            ADD_TXT_05: '',
            ADD_TXT_06: '',
            ADD_TXT_07: '',

            // Detail relation fields
            REL_DATE: '', REL_NO: '', MAKE_FLAG: '', CUST_AMT: '', P_AMT1: '', P_AMT2: '',

            // Detail additional numbers
            ADD_NUM_01: '', ADD_NUM_02: '', ADD_NUM_03: '', ADD_NUM_04: '', ADD_NUM_05: '',

            // Detail additional codes
            ADD_CD_01: '', ADD_CD_02: '', ADD_CD_03: '',
            ADD_CD_NM_01: '', ADD_CD_NM_02: '', ADD_CD_NM_03: '',
            ADD_CDNM_01: '', ADD_CDNM_02: '', ADD_CDNM_03: '',

            // Detail additional dates
            ADD_DATE_01: '', ADD_DATE_02: '', ADD_DATE_03: ''
        };

        // Override with custom ecountFields if provided
        if (customFields.ecountFields) {
            Object.assign(bulkData, customFields.ecountFields);
        }

        return { BulkDatas: bulkData };
    }

    clearSession() {
        this.sessionId = null;
        this.sessionExpiry = null;
    }
}

module.exports = new ECountOrderPodService();
