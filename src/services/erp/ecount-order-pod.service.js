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

    transformToECountFormatSingle(orderData) {
        const {
            index,
            customerCode,
            customerName,
            warehouseCode = '',
            employeeCode = '',
            orderNumber,
            orderMemo1 = '',
            orderMemo2 = '',
            orderMemo3 = '',
            orderMemo4 = '',
            orderMemo5 = '',
            receiverName = '',
            receiverCountry = '',
            receiverAddress1 = '',
            receiverCity = '',
            receiverState = '',
            receiverZipCode = '',
            receiverPhone = '',
            customsEORINumber = '',
            customsIOSSCode = '',
            customsVAT = '',
            additionalService = '',
            serviceType = '',
            trackingNumber = '',
            productSize = '',
            customFields = {}
        } = orderData;

        const length = customFields.length || '';
        const width = customFields.width || '';
        const height = customFields.height || '';
        const weight = customFields.weight || '';
        const declaredValue = customFields.declaredValue || '';
        const sellingPrice = customFields.sellingPrice || '';
        const productENName = customFields.productENName || '';
        const productCNName = customFields.productCNName || '';
        const quantity = customFields.quantity || '';

        const totalWeight = weight && quantity ? (parseFloat(weight) * quantity).toString() : '';

        const bulkData = {
            IO_DATE: '',
            UPLOAD_SER_NO: index,
            CUST: customerCode,
            CUST_DES: customerName,
            EMP_CD: employeeCode,
            WH_CD: warehouseCode,
            IO_TYPE: '', EXCHANGE_TYPE: '', EXCHANGE_RATE: '', SITE: '', PJT_CD: '', TTL_CTT: '',
            U_MEMO1: orderMemo1,
            U_MEMO2: orderMemo2,
            U_MEMO3: orderMemo3,
            U_MEMO4: orderMemo4,
            U_MEMO5: orderMemo5,
            ADD_TXT_01_T: '', ADD_TXT_02_T: '',
            ADD_TXT_03_T: receiverPhone,
            ADD_TXT_04_T: '',
            ADD_TXT_05_T: receiverCountry,
            ADD_TXT_06_T: receiverAddress1,
            ADD_TXT_07_T: additionalService,
            ADD_TXT_08_T: receiverCity,
            ADD_TXT_09_T: receiverState,
            ADD_TXT_10_T: customsEORINumber,
            ADD_NUM_01_T: customsVAT,
            ADD_NUM_02_T: '', ADD_NUM_03_T: '', ADD_NUM_04_T: '', ADD_NUM_05_T: '',
            ADD_CD_01_T: '', ADD_CD_02_T: '', ADD_CD_03_T: '',
            ADD_DATE_01_T: '', ADD_DATE_02_T: '', ADD_DATE_03_T: '',
            U_TXT1: orderNumber,
            ADD_LTXT_01_T: trackingNumber,
            ADD_LTXT_02_T: serviceType,
            ADD_LTXT_03_T: customsIOSSCode,
            PROD_CD: process.env.API_PRODUCT_CODE,
            PROD_DES: process.env.API_PRODUCT_NAME,
            SIZE_DES: productSize,
            UQTY: '',
            QTY: quantity.toString(),
            PRICE: '', USER_PRICE_VAT: '', SUPPLY_AMT: '', SUPPLY_AMT_F: '', VAT_AMT: '', REMARKS: '', ITEM_CD: '',
            P_REMARKS1: '', P_REMARKS2: '', P_REMARKS3: '',
            ADD_TXT_01: '',
            ADD_TXT_02: length.toString(),
            ADD_TXT_03: width.toString(),
            ADD_TXT_04: height.toString(),
            ADD_TXT_05: productCNName,
            ADD_TXT_06: productENName,
            REL_DATE: '', REL_NO: '', MAKE_FLAG: '', CUST_AMT: '', P_AMT1: '', P_AMT2: '',
            ADD_NUM_01: '',
            ADD_NUM_02: sellingPrice.toString(),
            ADD_NUM_03: weight.toString(),
            ADD_NUM_04: totalWeight,
            ADD_NUM_05: declaredValue.toString(),
            ADD_CD_01: '', ADD_CD_02: '', ADD_CD_03: '',
            ADD_CD_NM_01: '', ADD_CD_NM_02: '', ADD_CD_NM_03: '',
            ADD_CDNM_01: '', ADD_CDNM_02: '', ADD_CDNM_03: '',
            ADD_DATE_01: '', ADD_DATE_02: '', ADD_DATE_03: ''
        };

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
