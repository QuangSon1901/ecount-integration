// src/controllers/oms-packaging.controller.js
//
// Admin endpoints cho hai bảng:
//   - oms_packaging_materials  (danh mục vật liệu đóng gói)
//   - oms_sku_packaging_mapping (map SKU → vật liệu, theo customer hoặc default)

const OmsPackagingMaterialModel = require('../models/oms-packaging-material.model');
const OmsSkuPackagingMappingModel = require('../models/oms-sku-packaging-mapping.model');
const { successResponse, errorResponse } = require('../utils/response');
const logger = require('../utils/logger');

class OmsPackagingController {

    // ─── Materials ──────────────────────────────────────────────────────────

    async listMaterials(req, res, next) {
        try {
            const { active_only, q } = req.query;
            const rows = await OmsPackagingMaterialModel.list({
                activeOnly: active_only === '1' || active_only === 'true',
                search:     q ? String(q).trim() : null,
            });
            return successResponse(res, { materials: rows }, 'Materials retrieved');
        } catch (err) { next(err); }
    }

    async createMaterial(req, res, next) {
        try {
            const { name, description, cost_price, sell_price, is_active } = req.body || {};
            if (!name || typeof name !== 'string') {
                return errorResponse(res, 'name is required', 400);
            }
            if (sell_price === undefined || sell_price === null || sell_price === '') {
                return errorResponse(res, 'sell_price is required', 400);
            }
            const sp = Number(sell_price);
            if (!Number.isFinite(sp) || sp < 0) {
                return errorResponse(res, 'sell_price must be a number >= 0', 400);
            }
            let cp = null;
            if (cost_price !== undefined && cost_price !== null && cost_price !== '') {
                cp = Number(cost_price);
                if (!Number.isFinite(cp) || cp < 0) {
                    return errorResponse(res, 'cost_price must be a number >= 0', 400);
                }
            }

            const id = await OmsPackagingMaterialModel.create({
                name: name.trim(),
                description: description ?? null,
                cost_price: cp,
                sell_price: sp,
                is_active: is_active === undefined ? true : !!is_active,
            });
            const row = await OmsPackagingMaterialModel.findById(id);
            logger.info('[OMS-PACKAGING] material created', { id, name });
            return successResponse(res, row, 'Material created', 201);
        } catch (err) { next(err); }
    }

    async updateMaterial(req, res, next) {
        try {
            const id = parseInt(req.params.id);
            if (!Number.isFinite(id)) return errorResponse(res, 'Invalid id', 400);
            const exists = await OmsPackagingMaterialModel.findById(id);
            if (!exists) return errorResponse(res, 'Material not found', 404);

            const update = {};
            if (req.body.name !== undefined)        update.name = req.body.name;
            if (req.body.description !== undefined) update.description = req.body.description;
            if (req.body.is_active !== undefined)   update.is_active = !!req.body.is_active;
            if (req.body.cost_price !== undefined) {
                if (req.body.cost_price === null || req.body.cost_price === '') {
                    update.cost_price = null;
                } else {
                    const cp = Number(req.body.cost_price);
                    if (!Number.isFinite(cp) || cp < 0) {
                        return errorResponse(res, 'cost_price must be a number >= 0', 400);
                    }
                    update.cost_price = cp;
                }
            }
            if (req.body.sell_price !== undefined) {
                const sp = Number(req.body.sell_price);
                if (!Number.isFinite(sp) || sp < 0) {
                    return errorResponse(res, 'sell_price must be a number >= 0', 400);
                }
                update.sell_price = sp;
            }

            await OmsPackagingMaterialModel.update(id, update);
            const row = await OmsPackagingMaterialModel.findById(id);
            return successResponse(res, row, 'Material updated');
        } catch (err) { next(err); }
    }

    async deleteMaterial(req, res, next) {
        try {
            const id = parseInt(req.params.id);
            if (!Number.isFinite(id)) return errorResponse(res, 'Invalid id', 400);
            const exists = await OmsPackagingMaterialModel.findById(id);
            if (!exists) return errorResponse(res, 'Material not found', 404);

            await OmsPackagingMaterialModel.delete(id);
            logger.info('[OMS-PACKAGING] material deleted', { id });
            return successResponse(res, null, 'Material deleted');
        } catch (err) { next(err); }
    }

    // ─── SKU mappings ──────────────────────────────────────────────────────

    async listMappings(req, res, next) {
        try {
            const { customer_id, sku, limit = 200, offset = 0 } = req.query;

            let cid;
            if (customer_id === 'null' || customer_id === '0') cid = null;
            else if (customer_id !== undefined && customer_id !== '') cid = parseInt(customer_id);

            const rows = await OmsSkuPackagingMappingModel.list({
                customerId: cid,
                sku:        sku ? String(sku).trim() : null,
                limit, offset,
            });
            return successResponse(res, { mappings: rows }, 'Mappings retrieved');
        } catch (err) { next(err); }
    }

    async createMapping(req, res, next) {
        try {
            const { sku, material_id, customer_id } = req.body || {};
            if (!sku || typeof sku !== 'string') {
                return errorResponse(res, 'sku is required', 400);
            }
            const mid = parseInt(material_id);
            if (!Number.isFinite(mid)) {
                return errorResponse(res, 'material_id is required', 400);
            }

            const mat = await OmsPackagingMaterialModel.findById(mid);
            if (!mat) return errorResponse(res, 'material_id does not exist', 400);

            let cid = null;
            if (customer_id !== undefined && customer_id !== null && customer_id !== '') {
                cid = parseInt(customer_id);
                if (!Number.isFinite(cid)) {
                    return errorResponse(res, 'customer_id must be an integer or null', 400);
                }
            }

            try {
                const id = await OmsSkuPackagingMappingModel.create({
                    sku: sku.trim(), material_id: mid, customer_id: cid,
                });
                const row = await OmsSkuPackagingMappingModel.findById(id);
                logger.info('[OMS-PACKAGING] mapping created', { id, sku, material_id: mid, customer_id: cid });
                return successResponse(res, row, 'Mapping created', 201);
            } catch (err) {
                if (err.code === 'ER_DUP_ENTRY') {
                    return errorResponse(res, 'Mapping for this sku + customer already exists', 409,
                        { error_code: 'DUPLICATE' });
                }
                throw err;
            }
        } catch (err) { next(err); }
    }

    async deleteMapping(req, res, next) {
        try {
            const id = parseInt(req.params.id);
            if (!Number.isFinite(id)) return errorResponse(res, 'Invalid id', 400);
            const exists = await OmsSkuPackagingMappingModel.findById(id);
            if (!exists) return errorResponse(res, 'Mapping not found', 404);

            await OmsSkuPackagingMappingModel.delete(id);
            logger.info('[OMS-PACKAGING] mapping deleted', { id });
            return successResponse(res, null, 'Mapping deleted');
        } catch (err) { next(err); }
    }
}

module.exports = new OmsPackagingController();
