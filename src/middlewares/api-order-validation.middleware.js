const Joi = require('joi');
const { errorResponse } = require('../utils/response');

/**
 * Custom validation messages in Vietnamese/English
 */
const customMessages = {
    'string.empty': '{#label} is required',
    'string.pattern.base': '{#label} format is invalid',
    'any.required': '{#label} is required',
    'number.min': '{#label} must be at least {#limit}',
    'number.positive': '{#label} must be a positive number',
    'array.min': '{#label} must have at least {#limit} item(s)',
    'object.unknown': 'Unknown field: {#label}'
};

const declarationItemSchema = Joi.object({
    skuCode: Joi.string().max(100).optional(),
    nameEn: Joi.string().max(255).required()
        .messages({ 'any.required': 'Product name (English) is required' }),
    nameCN: Joi.string().max(255).optional().allow(''),
    quantity: Joi.number().integer().min(1).default(1),
    
    // Dimensions trong declaration
    unitWeight: Joi.number().min(0).required()
        .messages({ 'any.required': 'Unit weight is required' }),
    
    // Prices
    unitPrice: Joi.number().min(0).required()
        .messages({ 'any.required': 'Unit price is required' }),
    sellingPrice: Joi.number().min(0).required()
        .messages({ 'any.required': 'Selling price is required' }),
    
    hsCode: Joi.string().max(20).optional().allow(''),
    currency: Joi.string().length(3).default('USD')
});

const packagesSchema = Joi.object({
    length: Joi.number().positive().required()
        .messages({ 'any.required': 'Package length (cm) is required' }),
    width: Joi.number().positive().required()
        .messages({ 'any.required': 'Package width (cm) is required' }),
    height: Joi.number().positive().required()
        .messages({ 'any.required': 'Package height (cm) is required' }),
    weight: Joi.number().positive().required()
        .messages({ 'any.required': 'Package weight (kg) is required' }),
})

const receiverSchema = Joi.object({
    name: Joi.string().max(255).required()
        .messages({ 'any.required': 'Receiver name is required (Name*)' }),
    firstName: Joi.string().max(100).optional(),
    lastName: Joi.string().max(100).optional(),
    countryCode: Joi.string().length(2).required()
        .messages({ 'any.required': 'Country code is required (2-letter code like US, VN)' }),
    province: Joi.string().max(100).required()
        .messages({ 'any.required': 'State/Province is required (State*)' }),
    city: Joi.string().max(100).required()
        .messages({ 'any.required': 'City is required (City*)' }),
    addressLine1: Joi.string().max(500).required()
        .messages({ 'any.required': 'Street address is required (Street line 1*)' }),
    addressLine2: Joi.string().max(500).optional().allow(''),
    zipCode: Joi.string().max(20).optional().allow(''), // ĐỔI TỪ postalCode
    phone: Joi.string().max(50).optional().allow(''),
    email: Joi.string().email().max(100).optional().allow('')
});

/**
 * Customs number schema - THÊM MỚI
 */
const customsNumberSchema = Joi.object({
    IOSSCode: Joi.string().max(50).optional().allow(''),
    VATCode: Joi.string().max(50).optional().allow(''),
    EORINumber: Joi.string().max(50).optional().allow('')
});

/**
 * Schema for single order - CẬP NHẬT
 */
const apiOrderSchema = Joi.object({
    // Basic info
    ioDate: Joi.string().pattern(/^\d{8}$/).optional()
        .messages({ 'string.pattern.base': 'ioDate must be in YYYYMMDD format' }),
    customerCode: Joi.string().max(50).optional(),
    customerName: Joi.string().max(255).optional(),
    warehouseCode: Joi.string().max(50).optional().allow(''),
    employeeCode: Joi.string().max(50).allow('').optional(),

    // Order info - required
    orderNumber: Joi.string().max(100).required()
        .messages({ 'any.required': 'Order number is required' }),
    platformOrderNumber: Joi.string().max(100).allow('').optional(),

    // Order memos
    orderMemo1: Joi.string().max(255).allow('').optional(),
    orderMemo2: Joi.string().max(255).allow('').optional(),
    orderMemo3: Joi.string().max(255).allow('').optional(),
    orderMemo4: Joi.string().max(255).allow('').optional(),
    orderMemo5: Joi.string().max(255).allow('').optional(),

    // Receiver info - required object with nested validation
    receiver: receiverSchema.required()
        .messages({ 'any.required': 'Receiver information is required' }),

    // Declaration info - required (chứa cả dimensions)
    declarationInfo: Joi.array().items(declarationItemSchema).min(1).required()
        .messages({
            'any.required': 'Declaration info is required',
            'array.min': 'At least one declaration item is required'
        }),

    packages: Joi.array().items(packagesSchema).min(1).required()
        .messages({
            'any.required': 'Packages is required',
            'array.min': 'At least one packages is required'
        }),

    // Customs number - THÊM MỚI
    customsNumber: customsNumberSchema.optional(),

    // Product info - BỎ quantity và price ở root level
    productSize: Joi.string().max(100).allow('').optional(),

    // Service info - required
    serviceType: Joi.string().max(100).required()
        .messages({ 'any.required': 'Service type is required' }),
    additionalService: Joi.string().max(100).required()
        .messages({ 'any.required': 'Additional Service is required' }),
    trackingNumber: Joi.string().max(100).allow('').optional(),

    // ERP integration
    erpOrderCode: Joi.string().max(100).allow('').optional(),
    ecountLink: Joi.string().max(500).allow('').optional(),

    // Custom fields for ECount
    customFields: Joi.object().optional()
}).messages(customMessages);

/**
 * Transform and normalize order data
 */
function normalizeOrderData(order) {
    const normalized = { ...order };

    // Không cần merge legacy receiver fields nữa vì API mới đã chuẩn

    // Extract dimensions và prices từ declarationInfo (không còn packages array)
    if (normalized.declarationInfo && normalized.declarationInfo.length > 0) {
        const decl = normalized.declarationInfo[0];
        
        if (!normalized.customFields) {
            normalized.customFields = {};
        }
        
        // Lưu dimensions từ declaration
        normalized.customFields.weight = decl.unitWeight;
        normalized.customFields.declaredValue = decl.unitPrice;
        normalized.customFields.sellingPrice = decl.sellingPrice;
        normalized.customFields.productENName = decl.nameEn;
        normalized.customFields.productCNName = decl.nameCN || '';
    }

    // Extract customs info
    if (normalized.customsNumber) {
        if (!normalized.customFields) {
            normalized.customFields = {};
        }
        normalized.customFields.IOSSCode = normalized.customsNumber.IOSSCode || '';
        normalized.customFields.VATCode = normalized.customsNumber.VATCode || '';
        normalized.customFields.EORINumber = normalized.customsNumber.EORINumber || '';
    }

    return normalized;
}

/**
 * Additional business validation after Joi
 */
function validateBusinessRules(order, index = null) {
    const errors = [];
    const prefix = index !== null ? `Order[${index}]` : '';

    // Validate receiver has required fields
    if (order.receiver) {
        if (!order.receiver.name || order.receiver.name.trim() === '') {
            errors.push({
                field: `${prefix}receiver.name`,
                message: 'Receiver name is required (maps to Name* in ECount)',
                ecountField: 'U_MEMO2'
            });
        }
        if (!order.receiver.countryCode || order.receiver.countryCode.trim() === '') {
            errors.push({
                field: `${prefix}receiver.countryCode`,
                message: 'Country code is required (2-letter code)',
                ecountField: 'ADD_TXT_05_T'
            });
        }
        if (!order.receiver.addressLine1 || order.receiver.addressLine1.trim() === '') {
            errors.push({
                field: `${prefix}receiver.addressLine1`,
                message: 'Street address is required',
                ecountField: 'ADD_TXT_06_T'
            });
        }
        if (!order.receiver.city || order.receiver.city.trim() === '') {
            errors.push({
                field: `${prefix}receiver.city`,
                message: 'City is required',
                ecountField: 'ADD_TXT_08_T'
            });
        }
        if (!order.receiver.province || order.receiver.province.trim() === '') {
            errors.push({
                field: `${prefix}receiver.province`,
                message: 'State/Province is required',
                ecountField: 'ADD_TXT_09_T'
            });
        }
    }

    // Validate declaration info (bây giờ chứa cả dimensions)
    if (!order.declarationInfo || order.declarationInfo.length === 0) {
        errors.push({
            field: `${prefix}declarationInfo`,
            message: 'At least one declaration item with product name, dimensions, and prices is required',
            ecountField: 'Multiple fields'
        });
    } else {
        const decl = order.declarationInfo[0];
        
        if (!decl.nameEn || decl.nameEn.trim() === '') {
            errors.push({
                field: `${prefix}declarationInfo[0].nameEn`,
                message: 'Product name (English) is required',
                ecountField: 'ADD_TXT_06'
            });
        }
        
        if (decl.unitPrice === undefined || decl.unitPrice === null) {
            errors.push({
                field: `${prefix}declarationInfo[0].unitPrice`,
                message: 'Unit price is required',
                ecountField: 'Declared value'
            });
        }
        
        if (decl.sellingPrice === undefined || decl.sellingPrice === null) {
            errors.push({
                field: `${prefix}declarationInfo[0].sellingPrice`,
                message: 'Selling price is required',
                ecountField: 'ADD_NUM_02'
            });
        }
    }

    // Validate service type
    if (!order.serviceType || order.serviceType.trim() === '') {
        errors.push({
            field: `${prefix}serviceType`,
            message: 'Service type is required',
            ecountField: 'ADD_LTXT_02_T'
        });
    }
    
    // Validate additional service
    if (!order.additionalService || order.additionalService.trim() === '') {
        errors.push({
            field: `${prefix}additionalService`,
            message: 'Additional service is required',
            ecountField: 'ADD_TXT_07_T'
        });
    }

    return errors;
}

/**
 * Validate single order
 */
const validateApiOrder = (req, res, next) => {
    // Normalize data first
    const normalizedOrder = normalizeOrderData(req.body);

    // Joi validation
    const { error, value } = apiOrderSchema.validate(normalizedOrder, {
        abortEarly: false,
        stripUnknown: false
    });

    if (error) {
        const errors = error.details.map(detail => ({
            field: detail.path.join('.'),
            message: detail.message,
            type: detail.type
        }));

        return errorResponse(res, 'Validation failed', 400, {
            errors,
            hint: 'Please check required fields for ECount integration'
        });
    }

    // Additional business validation
    const businessErrors = validateBusinessRules(value);
    if (businessErrors.length > 0) {
        return errorResponse(res, 'Business validation failed', 400, {
            errors: businessErrors,
            hint: 'These fields are required by ECount'
        });
    }

    req.body = value;
    next();
};

/**
 * Validate bulk orders
 */
const validateApiBulkOrders = (req, res, next) => {
    const { orders } = req.body;

    // Basic array validation
    if (!orders || !Array.isArray(orders)) {
        return errorResponse(res, 'orders must be an array', 400);
    }

    if (orders.length === 0) {
        return errorResponse(res, 'orders array cannot be empty', 400);
    }

    if (orders.length > 100) {
        return errorResponse(res, 'Maximum 100 orders per request', 400);
    }

    const validationErrors = [];
    const validatedOrders = [];

    orders.forEach((order, index) => {
        // Normalize data first
        const normalizedOrder = normalizeOrderData(order);

        // Joi validation
        const { error, value } = apiOrderSchema.validate(normalizedOrder, {
            abortEarly: false,
            stripUnknown: false
        });

        let orderErrors = [];

        if (error) {
            orderErrors = error.details.map(detail => ({
                field: detail.path.join('.'),
                message: detail.message,
                type: detail.type
            }));
        }

        // Additional business validation
        const businessErrors = validateBusinessRules(value || normalizedOrder, index);
        orderErrors = orderErrors.concat(businessErrors);

        if (orderErrors.length > 0) {
            validationErrors.push({
                orderIndex: index,
                orderNumber: order.orderNumber || `Order ${index + 1}`,
                errors: orderErrors
            });
        } else {
            validatedOrders.push(value);
        }
    });

    // If any validation errors, return all of them
    if (validationErrors.length > 0) {
        return errorResponse(res, 'Validation failed for some orders', 400, {
            summary: {
                total: orders.length,
                valid: validatedOrders.length,
                invalid: validationErrors.length
            },
            validationErrors,
            hint: 'Fix all validation errors before submitting. This prevents unnecessary API calls to ECount.'
        });
    }

    req.body.orders = validatedOrders;
    next();
};

module.exports = {
    validateApiOrder,
    validateApiBulkOrders,
    apiOrderSchema,
    normalizeOrderData,
    validateBusinessRules
};
