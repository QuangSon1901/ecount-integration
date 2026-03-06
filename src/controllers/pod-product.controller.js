// src/controllers/pod-product.controller.js
const PodProductModel = require('../models/pod-product.model');
const xlsx = require('xlsx');
const { successResponse, errorResponse } = require('../utils/response');
const logger = require('../utils/logger');

// Excel header → DB field mapping
const HEADER_MAP = {
    'Item name': 'itemName',
    "Onos's SKU": 'warehouseSku',
    'Product color': 'productColor',
    'Size': 'size',
    'WEIGHT': 'weight',
    'LENGTH': 'length',
    'WIDTH': 'width',
    'HEIGHT': 'height',
    'GROSS PRICE': 'grossPrice',
    'Nhóm sản phẩm': 'productGroup',
    'Key of SKU': 'skuKey',
    "THG's SKU_SBSL": 'thgSkuSbsl',
    "THG's SKU_SBTT": 'thgSkuSbtt',
    'US IMPORT TAX/UNIT': 'usImportTaxUnit',
    'CUSTOMS FEE/ORDER': 'customsFeeOrder'
};

// Set of known DB field keys for filtering metadata
const KNOWN_FIELDS = new Set(Object.values(HEADER_MAP));

class PodProductController {
    /**
     * GET /
     * List products with filters and pagination
     */
    async list(req, res, next) {
        try {
            const { podWarehouse, search, productGroup, status, limit = 50, offset = 0 } = req.query;

            const filters = {
                podWarehouse,
                search,
                productGroup,
                status,
                limit: parseInt(limit),
                offset: parseInt(offset)
            };

            const [products, total] = await Promise.all([
                PodProductModel.list(filters),
                PodProductModel.count(filters)
            ]);

            return successResponse(res, {
                products,
                pagination: {
                    total,
                    limit: parseInt(limit),
                    offset: parseInt(offset),
                    pages: Math.ceil(total / parseInt(limit))
                }
            }, 'Products retrieved successfully');

        } catch (error) {
            next(error);
        }
    }

    /**
     * GET /:id
     * Get product by ID
     */
    async getById(req, res, next) {
        try {
            const { id } = req.params;

            const product = await PodProductModel.findById(id);

            if (!product) {
                return errorResponse(res, 'Product not found', 404);
            }

            return successResponse(res, product, 'Product retrieved successfully');

        } catch (error) {
            next(error);
        }
    }

    /**
     * POST /
     * Create new product
     */
    async create(req, res, next) {
        try {
            const {
                podWarehouse, itemName, warehouseSku, productColor, size,
                weight, length, width, height, grossPrice,
                productGroup, skuKey, thgSkuSbsl, thgSkuSbtt,
                thgPriceSbsl, thgPriceSbtt,
                usImportTaxUnit, customsFeeOrder, metadata, status
            } = req.body;

            if (!podWarehouse || !warehouseSku) {
                return errorResponse(res, 'podWarehouse and warehouseSku are required', 400);
            }

            // Check if product already exists
            const existing = await PodProductModel.findByWarehouseSku(podWarehouse, warehouseSku);
            if (existing) {
                return errorResponse(res, 'Product with this warehouse SKU already exists', 409, {
                    error_code: 'DUPLICATE_WAREHOUSE_SKU'
                });
            }

            const productId = await PodProductModel.create({
                podWarehouse, itemName, warehouseSku, productColor, size,
                weight, length, width, height, grossPrice,
                productGroup, skuKey, thgSkuSbsl, thgSkuSbtt,
                thgPriceSbsl, thgPriceSbtt,
                usImportTaxUnit, customsFeeOrder, metadata, status
            });

            logger.info('Created POD product', { productId, podWarehouse, warehouseSku });

            return successResponse(res, { id: productId }, 'Product created successfully', 201);

        } catch (error) {
            logger.error('Failed to create POD product:', error);
            next(error);
        }
    }

    /**
     * PATCH /:id
     * Update product
     */
    async update(req, res, next) {
        try {
            const { id } = req.params;

            const product = await PodProductModel.findById(id);
            if (!product) {
                return errorResponse(res, 'Product not found', 404);
            }

            const {
                podWarehouse, itemName, warehouseSku, productColor, size,
                weight, length, width, height, grossPrice,
                productGroup, skuKey, thgSkuSbsl, thgSkuSbtt,
                thgPriceSbsl, thgPriceSbtt,
                usImportTaxUnit, customsFeeOrder, metadata, status
            } = req.body;

            const updateData = {};
            if (podWarehouse !== undefined) updateData.podWarehouse = podWarehouse;
            if (itemName !== undefined) updateData.itemName = itemName;
            if (warehouseSku !== undefined) updateData.warehouseSku = warehouseSku;
            if (productColor !== undefined) updateData.productColor = productColor;
            if (size !== undefined) updateData.size = size;
            if (weight !== undefined) updateData.weight = weight;
            if (length !== undefined) updateData.length = length;
            if (width !== undefined) updateData.width = width;
            if (height !== undefined) updateData.height = height;
            if (grossPrice !== undefined) updateData.grossPrice = grossPrice;
            if (productGroup !== undefined) updateData.productGroup = productGroup;
            if (skuKey !== undefined) updateData.skuKey = skuKey;
            if (thgSkuSbsl !== undefined) updateData.thgSkuSbsl = thgSkuSbsl;
            if (thgSkuSbtt !== undefined) updateData.thgSkuSbtt = thgSkuSbtt;
            if (thgPriceSbsl !== undefined) updateData.thgPriceSbsl = thgPriceSbsl;
            if (thgPriceSbtt !== undefined) updateData.thgPriceSbtt = thgPriceSbtt;
            if (usImportTaxUnit !== undefined) updateData.usImportTaxUnit = usImportTaxUnit;
            if (customsFeeOrder !== undefined) updateData.customsFeeOrder = customsFeeOrder;
            if (metadata !== undefined) updateData.metadata = metadata;
            if (status !== undefined) updateData.status = status;

            if (Object.keys(updateData).length === 0) {
                return errorResponse(res, 'No valid fields to update', 400);
            }

            await PodProductModel.update(id, updateData);

            logger.info('Updated POD product', { id, fields: Object.keys(updateData) });

            return successResponse(res, null, 'Product updated successfully');

        } catch (error) {
            logger.error('Failed to update POD product:', error);
            next(error);
        }
    }

    /**
     * DELETE /:id
     * Delete product
     */
    async delete(req, res, next) {
        try {
            const { id } = req.params;

            const product = await PodProductModel.findById(id);
            if (!product) {
                return errorResponse(res, 'Product not found', 404);
            }

            await PodProductModel.delete(id);

            logger.info('Deleted POD product', { id });

            return successResponse(res, null, 'Product deleted successfully');

        } catch (error) {
            logger.error('Failed to delete POD product:', error);
            next(error);
        }
    }

    /**
     * POST /import
     * Import products from Excel file
     */
    async importExcel(req, res, next) {
        try {
            if (!req.file) {
                return errorResponse(res, 'Excel file is required', 400);
            }

            const { podWarehouse } = req.body;
            if (!podWarehouse) {
                return errorResponse(res, 'podWarehouse is required', 400);
            }

            // Parse Excel from buffer
            const workbook = xlsx.read(req.file.buffer, { type: 'buffer' });
            const sheetName = workbook.SheetNames[0];
            const sheet = workbook.Sheets[sheetName];
            const rows = xlsx.utils.sheet_to_json(sheet);

            if (!rows || rows.length === 0) {
                return errorResponse(res, 'Excel file is empty or has no data rows', 400);
            }

            const items = [];
            const errors = [];

            for (let i = 0; i < rows.length; i++) {
                const row = rows[i];

                try {
                    const item = { podWarehouse };
                    const metadata = {};

                    // Map each column in the row
                    for (const [header, value] of Object.entries(row)) {
                        const fieldName = HEADER_MAP[header];

                        if (fieldName) {
                            item[fieldName] = value;
                        } else {
                            // Unknown columns go into metadata
                            metadata[header] = value;
                        }
                    }

                    // warehouseSku is required
                    if (!item.warehouseSku) {
                        errors.push({
                            row: i + 2, // +2 for header row + 0-index
                            error: "Missing required field: Onos's SKU"
                        });
                        continue;
                    }

                    item.metadata = metadata;
                    items.push(item);

                } catch (err) {
                    errors.push({
                        row: i + 2,
                        error: err.message
                    });
                }
            }

            let created = 0;
            let updated = 0;

            if (items.length > 0) {
                const result = await PodProductModel.bulkCreate(items);
                created = result.created;
                updated = result.updated;
            }

            const summary = {
                total: rows.length,
                created,
                updated,
                errors: errors.length
            };

            logger.info('POD product import completed', { podWarehouse, ...summary });

            return successResponse(res, {
                summary,
                errors: errors.length > 0 ? errors : undefined
            }, `Import completed: ${created} created, ${updated} updated`, 201);

        } catch (error) {
            logger.error('Failed to import POD products:', error);
            next(error);
        }
    }

    /**
     * GET /product-groups
     * Get distinct product groups for a warehouse
     */
    async getProductGroups(req, res, next) {
        try {
            const { podWarehouse } = req.query;

            const groups = await PodProductModel.getProductGroups(podWarehouse || null);

            return successResponse(res, { groups }, 'Product groups retrieved successfully');

        } catch (error) {
            next(error);
        }
    }
}

module.exports = new PodProductController();
