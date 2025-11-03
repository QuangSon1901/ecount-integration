const Joi = require('joi');
const { errorResponse } = require('../utils/response');

// Schema cho receiver
const receiverSchema = Joi.object({
    firstName: Joi.string().required(),
    lastName: Joi.string().required(),
    company: Joi.string().allow(''),
    countryCode: Joi.string().required(),
    province: Joi.string().allow(''),
    city: Joi.string().required(),
    addressLines: Joi.array().items(Joi.string()).min(1).required(),
    postalCode: Joi.string().allow(''),
    phoneNumber: Joi.string().required(),
    email: Joi.string().email().allow(''),
    certificateType: Joi.string().allow(''),
    certificateCode: Joi.string().allow('')
});

// Schema cho package
const packageSchema = Joi.object({
    length: Joi.number().positive().required(),
    width: Joi.number().positive().required(),
    height: Joi.number().positive().required(),
    weight: Joi.number().positive().required()
});

// Schema cho declaration item
const declarationSchema = Joi.object({
    sku_code: Joi.string().allow(''),
    name_local: Joi.string().allow(''),
    name_en: Joi.string().required(),
    quantity: Joi.number().integer().positive().required(),
    unit_price: Joi.number().positive().required(),
    unit_weight: Joi.number().positive(),
    hs_code: Joi.string().allow(''),
    sales_url: Joi.string().allow(''),
    currency: Joi.string().allow(''),
    material: Joi.string().allow(''),
    purpose: Joi.string().allow(''),
    brand: Joi.string().allow(''),
    spec: Joi.string().allow(''),
    model: Joi.string().allow(''),
    remark: Joi.string().allow('')
});

// Schema chính cho order
const orderSchema = Joi.object({
    carrier: Joi.string().valid('YUNEXPRESS', 'DHL', 'FEDEX').default('YUNEXPRESS'),
    productCode: Joi.string().default('S1002'),
    customerOrderNumber: Joi.string().allow(''),
    platformOrderNumber: Joi.string().allow(''),
    referenceNumbers: Joi.array().items(Joi.string()),
    weightUnit: Joi.string().valid('KG', 'LB').default('KG'),
    sizeUnit: Joi.string().valid('CM', 'IN').default('CM'),
    packages: Joi.array().items(packageSchema).min(1).required(),
    receiver: receiverSchema.required(),
    declarationInfo: Joi.array().items(declarationSchema),
    sender: receiverSchema,
    customsNumber: Joi.object({
        tax_number: Joi.string().allow(''),
        ioss_code: Joi.string().allow(''),
        vat_code: Joi.string().allow(''),
        eori_number: Joi.string().allow('')
    }),
    extraServices: Joi.array().items(Joi.object({
        extra_code: Joi.string(),
        extra_value: Joi.string()
    })),
    platformAccountCode: Joi.string().allow(''),
    sourceCode: Joi.string().default('YT'),
    sensitiveType: Joi.string().valid('D', 'N').default('D'),
    labelType: Joi.string().valid('PNG', 'PDF').default('PNG'),
    
    // ERP fields - QUAN TRỌNG: ecountLink từ extension
    erpOrderCode: Joi.string().allow(''),
    erpStatus: Joi.string().default('Đã hoàn tất'),
    ecountLink: Joi.string().allow('').description('Full hash link từ ECount, ví dụ: #menuType=MENUTREE_000004&menuSeq=MENUTREE_000030...')
});

// Schema cho ERP update
const erpUpdateSchema = Joi.object({
    erpOrderCode: Joi.string().required(),
    trackingNumber: Joi.string().required(),
    status: Joi.string().default('Đã hoàn tất'),
    ecountLink: Joi.string().allow('').description('Full hash link từ ECount')
});

/**
 * Middleware validate order data
 */
const validateOrder = (req, res, next) => {
    const { error, value } = orderSchema.validate(req.body, {
        abortEarly: false,
        stripUnknown: true
    });

    if (error) {
        const errors = error.details.map(detail => ({
            field: detail.path.join('.'),
            message: detail.message
        }));
        
        return errorResponse(res, 'Validation failed', 400, { errors });
    }

    req.body = value;
    next();
};

/**
 * Middleware validate ERP update
 */
const validateErpUpdate = (req, res, next) => {
    const { error, value } = erpUpdateSchema.validate(req.body, {
        abortEarly: false,
        stripUnknown: true
    });

    if (error) {
        const errors = error.details.map(detail => ({
            field: detail.path.join('.'),
            message: detail.message
        }));
        
        return errorResponse(res, 'Validation failed', 400, { errors });
    }

    req.body = value;
    next();
};

module.exports = {
    validateOrder,
    validateErpUpdate
};