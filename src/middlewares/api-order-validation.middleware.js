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

/**
 * Package/Dimension schema
 */
const packageSchema = Joi.object({
    length: Joi.number().positive().required()
        .messages({ 'any.required': 'Length (cm) is required' }),
    width: Joi.number().positive().required()
        .messages({ 'any.required': 'Width (cm) is required' }),
    height: Joi.number().positive().required()
        .messages({ 'any.required': 'Height (cm) is required' }),
    weight: Joi.number().positive().optional()
});

/**
 * Declaration item schema
 */
const declarationItemSchema = Joi.object({
    skuCode: Joi.string().max(100).optional(),
    nameEn: Joi.string().max(255).required()
        .messages({ 'any.required': 'Product name (English) is required' }),
    nameLocal: Joi.string().max(255).optional(),
    quantity: Joi.number().integer().min(1).default(1),
    unitPrice: Joi.number().min(0).required()
        .messages({ 'any.required': 'Unit price is required' }),
    unitWeight: Joi.number().min(0).optional(),
    hsCode: Joi.string().max(20).optional().allow(''),
    currency: Joi.string().length(3).default('USD')
});

/**
 * Receiver schema - all required fields for ECount
 */
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
    postalCode: Joi.string().max(20).optional().allow(''),
    phone: Joi.string().max(50).optional().allow(''),
    email: Joi.string().email().max(100).optional().allow('')
});

/**
 * Schema for single order - matching ECount required fields
 */
const apiOrderSchema = Joi.object({
    // Basic info
    ioDate: Joi.string().pattern(/^\d{8}$/).optional()
        .messages({ 'string.pattern.base': 'ioDate must be in YYYYMMDD format' }),
    customerCode: Joi.string().max(50).optional(),
    customerName: Joi.string().max(255).optional(),
    warehouseCode: Joi.string().max(20).optional().default('HCM'),
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

    // Legacy receiver fields (for backward compatibility, will be merged into receiver)
    receiverName: Joi.string().max(255).optional(),
    receiverCountry: Joi.string().max(50).optional(),
    receiverAddress: Joi.string().max(500).optional(),
    receiverCity: Joi.string().max(100).optional(),
    receiverState: Joi.string().max(100).optional(),
    receiverPostalCode: Joi.string().max(20).optional(),
    receiverPhone: Joi.string().max(50).optional(),
    receiverEmail: Joi.string().email().max(100).optional(),

    // Package dimensions - required
    packages: Joi.array().items(packageSchema).min(1).required()
        .messages({
            'any.required': 'Package dimensions are required',
            'array.min': 'At least one package with dimensions is required'
        }),

    // Declaration info - required
    declarationInfo: Joi.array().items(declarationItemSchema).min(1).required()
        .messages({
            'any.required': 'Declaration info is required',
            'array.min': 'At least one declaration item is required'
        }),

    // Product info - required
    productSize: Joi.string().max(100).allow('').optional(),
    quantity: Joi.number().integer().min(1).default(1),
    price: Joi.number().min(0).required()
        .messages({ 'any.required': 'Price/Selling price is required' }),

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
    customFields: Joi.object({
        length: Joi.number().positive().optional(),
        width: Joi.number().positive().optional(),
        height: Joi.number().positive().optional(),
        weight: Joi.number().min(0).optional(),
        declaredValue: Joi.number().min(0).optional(),
        productDescription: Joi.string().max(500).optional(),
        ecountFields: Joi.object().optional()
    }).optional()
}).messages(customMessages);

/**
 * Transform and normalize order data
 */
function normalizeOrderData(order) {
    const normalized = { ...order };

    // Merge legacy receiver fields into receiver object if receiver object is incomplete
    if (!normalized.receiver || Object.keys(normalized.receiver).length === 0) {
        normalized.receiver = {
            name: order.receiverName || order.orderMemo2 || '',
            countryCode: order.receiverCountry || '',
            province: order.receiverState || '',
            city: order.receiverCity || '',
            addressLine1: order.receiverAddress || '',
            postalCode: order.receiverPostalCode || '',
            phone: order.receiverPhone || '',
            email: order.receiverEmail || ''
        };
    }

    // Extract dimensions from packages if customFields not provided
    if (normalized.packages && normalized.packages.length > 0 && !normalized.customFields) {
        const pkg = normalized.packages[0];
        normalized.customFields = {
            length: pkg.length,
            width: pkg.width,
            height: pkg.height,
            weight: pkg.weight
        };
    }

    // Extract product description from declaration if not provided
    if (normalized.declarationInfo && normalized.declarationInfo.length > 0) {
        if (!normalized.customFields) {
            normalized.customFields = {};
        }
        if (!normalized.customFields.productDescription) {
            normalized.customFields.productDescription = normalized.declarationInfo[0].nameEn;
        }
        if (!normalized.customFields.declaredValue) {
            normalized.customFields.declaredValue = normalized.declarationInfo[0].unitPrice;
        }
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

    // Validate packages have dimensions
    if (!order.packages || order.packages.length === 0) {
        errors.push({
            field: `${prefix}packages`,
            message: 'At least one package with dimensions (length, width, height) is required',
            ecountField: 'ADD_TXT_02, ADD_TXT_03, ADD_TXT_04'
        });
    } else {
        const pkg = order.packages[0];
        if (!pkg.length || pkg.length <= 0) {
            errors.push({
                field: `${prefix}packages[0].length`,
                message: 'Package length is required and must be positive',
                ecountField: 'ADD_TXT_02'
            });
        }
        if (!pkg.width || pkg.width <= 0) {
            errors.push({
                field: `${prefix}packages[0].width`,
                message: 'Package width is required and must be positive',
                ecountField: 'ADD_TXT_03'
            });
        }
        if (!pkg.height || pkg.height <= 0) {
            errors.push({
                field: `${prefix}packages[0].height`,
                message: 'Package height is required and must be positive',
                ecountField: 'ADD_TXT_04'
            });
        }
    }

    // Validate declaration info
    if (!order.declarationInfo || order.declarationInfo.length === 0) {
        errors.push({
            field: `${prefix}declarationInfo`,
            message: 'At least one declaration item with product name and price is required',
            ecountField: 'ADD_TXT_06, ADD_NUM_02'
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

    // Validate price
    if (order.price === undefined || order.price === null || order.price < 0) {
        errors.push({
            field: `${prefix}price`,
            message: 'Price must be provided and non-negative',
            ecountField: 'PRICE'
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
