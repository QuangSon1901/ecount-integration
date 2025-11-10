const config = require('../../config');
const carriersConfig = require('../../config/carriers.config');
const YunExpressService = require('./yunexpress.service');
const YunExpressServiceCN = require('./yunexpress_cn.service');
// const DHLService = require('./dhl.service');
// const FedExService = require('./fedex.service');

class CarrierFactory {
    constructor() {
        this.carriers = new Map();
        this.initializeCarriers();
    }

    initializeCarriers() {
        // Initialize YunExpress
        if (carriersConfig.YUNEXPRESS.enabled) {
            this.carriers.set('YUNEXPRESS', new YunExpressService(config));
        }

        if (carriersConfig.YUNEXPRESS_CN.enabled) {
            this.carriers.set('YUNEXPRESS_CN', new YunExpressServiceCN(config));
        }

        // if (carriersConfig.DHL.enabled) {
        //     this.carriers.set('DHL', new DHLService(config));
        // }
    }

    getCarrier(carrierCode) {
        const carrier = this.carriers.get(carrierCode.toUpperCase());
        if (!carrier) {
            throw new Error(`Carrier ${carrierCode} not found or not enabled`);
        }
        return carrier;
    }

    getAvailableCarriers() {
        return Array.from(this.carriers.keys());
    }
}

module.exports = new CarrierFactory();