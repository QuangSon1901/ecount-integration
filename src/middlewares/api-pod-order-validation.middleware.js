const Joi = require('joi');
const { errorResponse } = require('../utils/response');

const podItemSchema = Joi.object({
    sku: Joi.string().max(100).required()
        .messages({ 'any.required': 'Product SKU is required' }),
    productId: Joi.string().max(100).default('THG'),
    name: Joi.string().max(255).required()
        .messages({ 'any.required': 'Product name is required' }),
    quantity: Joi.number().integer().min(1).required()
        .messages({ 'any.required': 'Quantity is required' }),
    price: Joi.number().min(0).required()
        .messages({ 'any.required': 'Price is required' }),
    productSize: Joi.string().max(50).allow('').optional(),
    productColor: Joi.string().max(50).allow('').optional(),
    designUrls: Joi.array().items(Joi.object({
        key: Joi.string().required(),
        value: Joi.string().uri().required()
    })).optional().default([]),
    mockupUrl: Joi.string().max(1000).allow('').optional()
});

const podReceiverSchema = Joi.object({
    name: Joi.string().max(255).required()
        .messages({ 'any.required': 'Receiver name is required' }),
    countryCode: Joi.string().length(2).required()
        .messages({ 'any.required': 'Country code is required (2-letter code)' }),
    province: Joi.string().max(100).required()
        .messages({ 'any.required': 'State/Province is required' }),
    city: Joi.string().max(100).required()
        .messages({ 'any.required': 'City is required' }),
    addressLine1: Joi.string().max(500).required()
        .messages({ 'any.required': 'Address line 1 is required' }),
    addressLine2: Joi.string().max(500).allow('').optional(),
    zipCode: Joi.string().max(20).required()
        .messages({ 'any.required': 'Zip code is required' }),
    phone: Joi.string().max(50).required()
        .messages({ 'any.required': 'Phone number is required' }),
    email: Joi.string().email().max(100).allow('').optional()
});

const podTrackingSchema = Joi.object({
    trackingNumber: Joi.string().max(100).allow('').optional(),
    linkPrint: Joi.string().max(1000).allow('').optional(),
    carrier: Joi.string().max(50).allow('').optional()
});

// For SBTT: tracking with trackingNumber and linkPrint is required
const podTrackingSBTTSchema = Joi.object({
    trackingNumber: Joi.string().max(100).required()
        .messages({ 'any.required': 'trackingNumber is required for SBTT (Ship by TikTok)' }),
    linkPrint: Joi.string().max(1000).required()
        .messages({ 'any.required': 'linkPrint is required for SBTT (Ship by TikTok)' }),
    carrier: Joi.string().max(50).allow('').optional()
});

const podOrderSchema = Joi.object({
    orderNumber: Joi.string().max(100).required()
        .messages({ 'any.required': 'Order number is required' }),
    warehouseCode: Joi.string().valid('001', '002', '004').required()
        .messages({
            'any.required': 'Warehouse code is required (001, 002, or 004)',
            'any.only': 'Warehouse code must be one of: 001 (US-POD09), 002 (VN-POD08), 004 (US-POD13)'
        }),
    shippingMethod: Joi.string().valid('SBSL', 'SBTT', 'COD', 'VNTHZXR', 'WEB').required()
        .messages({
            'any.required': 'Shipping method is required',
            'any.only': 'Shipping method must be one of: SBSL, SBTT, COD, VNTHZXR, WEB'
        }),

    receiver: podReceiverSchema.required()
        .messages({ 'any.required': 'Receiver information is required' }),

    items: Joi.array().items(podItemSchema).min(1).required()
        .messages({
            'any.required': 'Items array is required',
            'array.min': 'At least one item is required'
        }),

    tracking: Joi.when('shippingMethod', {
        is: 'SBTT',
        then: podTrackingSBTTSchema.required()
            .messages({ 'any.required': 'tracking is required for SBTT (Ship by TikTok). Must include trackingNumber and linkPrint.' }),
        otherwise: podTrackingSchema.optional()
    }),

    // Optional ERP fields
    customerCode: Joi.string().max(50).optional(),
    customerName: Joi.string().max(255).optional(),

    // Custom fields passthrough
    customFields: Joi.object().optional()
});

/**
 * Validate bulk POD orders
 */
const validateApiBulkPodOrders = (req, res, next) => {
    const { orders } = req.body;

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
        const { error, value } = podOrderSchema.validate(order, {
            abortEarly: false,
            stripUnknown: false
        });

        if (error) {
            validationErrors.push({
                orderIndex: index,
                orderNumber: order.orderNumber || `Order ${index + 1}`,
                errors: error.details.map(detail => ({
                    field: detail.path.join('.'),
                    message: detail.message,
                    type: detail.type
                }))
            });
        } else {
            validatedOrders.push(value);
        }
    });

    if (validationErrors.length > 0) {
        return errorResponse(res, 'Validation failed for some orders', 400, {
            summary: {
                total: orders.length,
                valid: validatedOrders.length,
                invalid: validationErrors.length
            },
            validationErrors,
            hint: 'Fix all validation errors before submitting.'
        });
    }

    req.body.orders = validatedOrders;
    next();
};

module.exports = {
    validateApiBulkPodOrders,
    podOrderSchema
};
