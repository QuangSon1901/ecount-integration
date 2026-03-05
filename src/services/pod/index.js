// src/services/pod/index.js
const config = require('../../config');
const podWarehousesConfig = require('../../config/pod-warehouses.config');
const OnosService = require('./onos.service');
const S2BDIYService = require('./s2bdiy.service');
const PrintpossService = require('./printposs.service');
const logger = require('../../utils/logger');

class PodWarehouseFactory {
    constructor() {
        this.warehouses = new Map();
        this.initializeWarehouses();
    }

    initializeWarehouses() {
        if (podWarehousesConfig.ONOS?.enabled) {
            this.warehouses.set('ONOS', new OnosService(config));
            logger.info('POD Warehouse registered: ONOS');
        }

        if (podWarehousesConfig.S2BDIY?.enabled) {
            this.warehouses.set('S2BDIY', new S2BDIYService(config));
            logger.info('POD Warehouse registered: S2BDIY');
        }

        if (podWarehousesConfig.PRINTPOSS?.enabled) {
            this.warehouses.set('PRINTPOSS', new PrintpossService(config));
            logger.info('POD Warehouse registered: PRINTPOSS');
        }
    }

    getWarehouse(warehouseCode) {
        const code = warehouseCode.toUpperCase();
        const warehouse = this.warehouses.get(code);

        if (!warehouse) {
            throw new Error(`POD Warehouse '${warehouseCode}' not found or not enabled`);
        }

        return warehouse;
    }

    getAvailableWarehouses() {
        return Array.from(this.warehouses.keys());
    }

    isWarehouseEnabled(warehouseCode) {
        return this.warehouses.has(warehouseCode.toUpperCase());
    }
}

module.exports = new PodWarehouseFactory();
