const Joi = require('joi');
const { errorResponse } = require('../utils/response');

// Schema cho receiver
const receiverSchema = Joi.object({
    firstName: Joi.string().min(1).max(50).required()
        .messages({
            'string.empty': 'firstName is required',
            'string.min': 'firstName must be at least 1 character',
            'string.max': 'firstName must not exceed 50 characters'
        }),
    lastName: Joi.string().max(50).allow('')
        .messages({
            'string.max': 'lastName must not exceed 50 characters'
        }),
    company: Joi.string().max(50).allow('')
        .messages({
            'string.max': 'company must not exceed 50 characters'
        }),
    countryCode: Joi.string().length(2).required()
        .messages({
            'string.empty': 'countryCode is required',
            'string.length': 'countryCode must be exactly 2 characters'
        }),
    province: Joi.string().max(50).allow('')
        .messages({
            'string.max': 'province must not exceed 50 characters'
        }),
    city: Joi.string().max(50).required()
        .messages({
            'string.empty': 'city is required',
            'string.max': 'city must not exceed 50 characters'
        }),
    addressLines: Joi.array()
        .items(Joi.string().min(1).max(200))
        .min(1)
        .max(3)
        .allow('')
        .messages({
            'array.min': 'addressLines must have at least 1 item',
            'array.max': 'addressLines must not exceed 3 items',
            'string.min': 'Each address line must be at least 1 character',
            'string.max': 'Each address line must not exceed 200 characters'
        }),
    postalCode: Joi.string().min(1).max(20).required()
        .messages({
            'string.empty': 'postalCode is required',
            'string.min': 'postalCode must be at least 1 character',
            'string.max': 'postalCode must not exceed 20 characters'
        }),
    phoneNumber: Joi.string().min(1).max(50).required()
        .messages({
            'string.empty': 'phoneNumber is required',
            'string.min': 'phoneNumber must be at least 1 character',
            'string.max': 'phoneNumber must not exceed 50 characters'
        }),
    email: Joi.string().email().max(100).allow('')
        .messages({
            'string.email': 'email must be a valid email address',
            'string.max': 'email must not exceed 100 characters'
        }),
    certificateType: Joi.string().max(3).allow('')
        .messages({
            'string.max': 'certificateType must not exceed 3 characters'
        }),
    certificateCode: Joi.string().max(50).allow('')
        .messages({
            'string.max': 'certificateCode must not exceed 50 characters'
        })
});

// Schema cho package
const packageSchema = Joi.object({
    length: Joi.number().min(0).max(10000).allow(null)
        .messages({
            'number.min': 'length must be at least 0',
            'number.max': 'length must not exceed 10000'
        }),
    width: Joi.number().min(0).max(10000).allow(null)
        .messages({
            'number.min': 'width must be at least 0',
            'number.max': 'width must not exceed 10000'
        }),
    height: Joi.number().min(0).max(10000).allow(null)
        .messages({
            'number.min': 'height must be at least 0',
            'number.max': 'height must not exceed 10000'
        }),
    weight: Joi.number().min(0.001).max(10000).required()
        .messages({
            'number.base': 'weight must be a number',
            'number.min': 'weight must be at least 0.001',
            'number.max': 'weight must not exceed 10000',
            'any.required': 'weight is required'
        })
});

// Schema cho declaration item
const declarationSchema = Joi.object({
    sku_code: Joi.string().max(50).allow('')
        .messages({
            'string.max': 'sku_code must not exceed 50 characters'
        }),
    name_local: Joi.string().min(1).max(50).allow('')
        .messages({
            'string.min': 'name_local must be at least 1 character',
            'string.max': 'name_local must not exceed 50 characters'
        }),
    name_en: Joi.string().max(50).required()
        .messages({
            'string.empty': 'name_en is required',
            'string.max': 'name_en must not exceed 50 characters'
        }),
    quantity: Joi.number().integer().min(1).max(10000).required()
        .messages({
            'number.base': 'quantity must be a number',
            'number.integer': 'quantity must be an integer',
            'number.min': 'quantity must be at least 1',
            'number.max': 'quantity must not exceed 10000',
            'any.required': 'quantity is required'
        }),
    unit_price: Joi.number().min(0.001).max(1000000).required()
        .messages({
            'number.base': 'unit_price must be a number',
            'number.min': 'unit_price must be at least 1',
            'number.max': 'unit_price must not exceed 1000000',
            'any.required': 'unit_price is required'
        }),
    unit_weight: Joi.number().min(0.001).max(1000000).required()
        .messages({
            'number.base': 'unit_weight must be a number',
            'number.min': 'unit_weight must be at least 1',
            'number.max': 'unit_weight must not exceed 1000000',
            'any.required': 'unit_weight is required'
        }),
    hs_code: Joi.string().max(50).allow('')
        .messages({
            'string.max': 'hs_code must not exceed 50 characters'
        }),
    sales_url: Joi.string().uri().max(200).allow('')
        .messages({
            'string.uri': 'sales_url must be a valid URI',
            'string.max': 'sales_url must not exceed 200 characters'
        }),
    currency: Joi.string().length(3).default('USD')
        .messages({
            'string.length': 'currency must be exactly 3 characters'
        }),
    material: Joi.string().max(50).allow('')
        .messages({
            'string.max': 'material must not exceed 50 characters'
        }),
    purpose: Joi.string().max(50).allow('')
        .messages({
            'string.max': 'purpose must not exceed 50 characters'
        }),
    brand: Joi.string().max(50).allow('')
        .messages({
            'string.max': 'brand must not exceed 50 characters'
        }),
    spec: Joi.string().max(50).allow('')
        .messages({
            'string.max': 'spec must not exceed 50 characters'
        }),
    model: Joi.string().max(50).allow('')
        .messages({
            'string.max': 'model must not exceed 50 characters'
        }),
    remark: Joi.string().max(100).allow('')
        .messages({
            'string.max': 'remark must not exceed 100 characters'
        }),
    fabric_creation_method: Joi.string().allow(''),
    manufacturer_id: Joi.string().max(50).allow('')
        .messages({
            'string.max': 'manufacturer_id must not exceed 50 characters'
        }),
    manufacturer_name: Joi.string().allow(''),
    manufacturer_address: Joi.string().allow(''),
    manufacturer_city: Joi.string().allow(''),
    manufacturer_province: Joi.string().allow(''),
    manufacturer_country: Joi.string().allow(''),
    manufacturer_postalcode: Joi.string().allow(''),
    selling_price: Joi.number().positive().allow('')
        .messages({
            'number.positive': 'selling_price must be greater than 0'
        })
});

const customsNumberSchema = Joi.object({
    tax_number: Joi.string().max(100).allow('')
        .messages({
            'string.max': 'tax_number must not exceed 100 characters'
        }),
    ioss_code: Joi.string().max(100).allow('')
        .messages({
            'string.max': 'ioss_code must not exceed 100 characters'
        }),
    vat_code: Joi.string().max(100).allow('')
        .messages({
            'string.max': 'vat_code must not exceed 100 characters'
        }),
    eori_number: Joi.string().max(100).allow('')
        .messages({
            'string.max': 'eori_number must not exceed 100 characters'
        })
});

const extraServicesSchema = Joi.object({
    extra_code: Joi.string().max(20).required()
        .messages({
            'string.empty': 'extra_code is required',
            'string.max': 'extra_code must not exceed 20 characters'
        }),
    extra_value: Joi.string().max(128).allow('')
        .messages({
            'string.max': 'extra_value must not exceed 128 characters'
        }),
    extra_cost: Joi.number().allow(null)
});

const platformSchema = Joi.object({
    platform_name: Joi.string().min(1).max(50).allow('')
        .messages({
            'string.min': 'platform_name must be at least 1 character',
            'string.max': 'platform_name must not exceed 50 characters'
        }),
    province: Joi.string().min(1).max(50).allow('')
        .messages({
            'string.min': 'province must be at least 1 character',
            'string.max': 'province must not exceed 50 characters'
        }),
    address: Joi.string().min(1).max(200).allow('')
        .messages({
            'string.min': 'address must be at least 1 character',
            'string.max': 'address must not exceed 200 characters'
        }),
    postal_code: Joi.string().min(1).max(20).allow('')
        .messages({
            'string.min': 'postal_code must be at least 1 character',
            'string.max': 'postal_code must not exceed 20 characters'
        }),
    phone_number: Joi.string().min(1).max(50).allow('')
        .messages({
            'string.min': 'phone_number must be at least 1 character',
            'string.max': 'phone_number must not exceed 50 characters'
        }),
    email: Joi.string().email().min(1).max(100).allow('')
        .messages({
            'string.email': 'email must be a valid email address',
            'string.min': 'email must be at least 1 character',
            'string.max': 'email must not exceed 100 characters'
        }),
    sale_platform_url: Joi.string().allow(''),
    goods_type: Joi.string().allow(''),
    platform_code: Joi.string().min(1).max(50).allow('')
        .messages({
            'string.min': 'platform_code must be at least 1 character',
            'string.max': 'platform_code must not exceed 50 characters'
        })
});

const paymentSchema = Joi.object({
    pay_platform: Joi.string().allow(''),
    pay_account: Joi.string().allow(''),
    pay_transaction: Joi.string().allow('')
});

// Schema chính cho order
const orderSchema = Joi.object({
    carrier: Joi.string().valid('YUNEXPRESS', 'YUNEXPRESS_CN').default('YUNEXPRESS'),
    productCode: Joi.string().min(1).max(50).required()
        .messages({
            'string.empty': 'product_code is required',
            'string.min': 'product_code must be at least 1 character',
            'string.max': 'product_code must not exceed 50 characters'
        }),
    customerOrderNumber: Joi.string().max(50).allow('')
        .messages({
            'string.max': 'customer_order_number must not exceed 50 characters'
        }),
    platformOrderNumber: Joi.string().max(20).allow('')
        .messages({
            'string.max': 'platform_account_code must not exceed 20 characters'
        }),
    trackingNumber: Joi.string().max(50).allow(''),
    referenceNumbers: Joi.array().items(Joi.string()).max(5),
    
    weightUnit: Joi.string()
        .valid('KG', 'kg', 'G', 'g', 'LBS', 'lbs')
        .default('KG')
        .messages({
            'any.only': 'weight_unit must be one of: KG, kg, G, g, LBS, lbs'
        }),
    sizeUnit: Joi.string()
        .valid('CM', 'cm', 'INCH', 'INCH')
        .default('CM')
        .messages({
            'any.only': 'size_unit must be one of: CM, cm, INCH'
        }),
    
    packages: Joi.array()
        .items(packageSchema)
        .min(1)
        .required()
        .messages({
            'array.min': 'packages must have at least 1 item',
            'any.required': 'packages is required'
        }),
    receiver: receiverSchema.required()
        .messages({
            'any.required': 'receiver is required'
        }),
    declarationInfo: Joi.array()
        .items(declarationSchema)
        .min(1)
        .required()
        .messages({
            'array.min': 'declaration_info must have at least 1 item',
            'any.required': 'declaration_info is required'
        }),
    
    sender: receiverSchema, // Optional
    
    customsNumber: customsNumberSchema,
    
    extraServices: Joi.array()
        .items(extraServicesSchema)
        .min(0)
        .messages({
            'array.min': 'extra_services must have at least 0 items'
        }),
    
    // Platform info (optional)
    platform: platformSchema,
    
    // Payment info (optional)
    payment: platformSchema,
    
    platformAccountCode: Joi.string().max(20).allow('')
        .messages({
            'string.max': 'platform_account_code must not exceed 20 characters'
        }),
    sourceCode: Joi.string().max(10).allow('')
        .messages({
            'string.max': 'source_code must not exceed 10 characters'
        }),
    sensitiveType: Joi.string()
        .valid('W', 'D', 'F', 'L')
        .allow('')
        .messages({
            'any.only': 'sensitive_type must be one of: W, D, F, L'
        }),
    labelType: Joi.string()
        .valid('PDF', 'ZPL', 'PNG')
        .allow('')
        .messages({
            'any.only': 'label_type must be one of: PDF, ZPL, PNG'
        }),
    goodsType: Joi.string().allow(''), // W=Online shopping, F=FS goods, O=Other
    dangerousGoodsType: Joi.string().max(30).allow('')
        .messages({
            'string.max': 'dangerous_goods_type must not exceed 30 characters'
        }),
    
    // Pickup point (cho dịch vụ self-pickup)
    pointRelaisNum: Joi.string().max(1000).allow('')
        .messages({
            'string.max': 'point_relais_num must not exceed 1000 characters'
        }),
    
    // ERP fields
    erpOrderCode: Joi.string().required(''),
    erpStatus: Joi.string().default('Đang xử lý'),
    ecountLink: Joi.string().required('')
});

// Schema cho ERP update
const erpUpdateSchema = Joi.object({
    erpOrderCode: Joi.string().required(),
    trackingNumber: Joi.string().allow(''),
    status: Joi.string().default('Đã hoàn tất'),
    ecountLink: Joi.string().required().description('Full hash link từ ECount')
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

    const declarationInfo = value.declaration_info || value.declarationInfo || [];
    const skuErrors = validateSkuCode(declarationInfo);
    
    if (skuErrors.length > 0) {
        return errorResponse(res, 'Validation failed', 400, { errors: skuErrors });
    }

    req.body = value;
    next();
};

/**
 * Middleware validate multi orders
 */
const validateOrderMulti = (req, res, next) => {
    const { orders } = req.body;

    // Check orders array exists
    if (!orders || !Array.isArray(orders)) {
        return errorResponse(res, 'orders must be an array', 400);
    }

    if (orders.length === 0) {
        return errorResponse(res, 'orders array cannot be empty', 400);
    }

    if (orders.length > 50) {
        return errorResponse(res, 'Maximum 50 orders per request', 400);
    }

    // Validate từng order
    const validationErrors = [];
    const validatedOrders = [];

    orders.forEach((order, index) => {
        const { error, value } = orderSchema.validate(order, {
            abortEarly: false,
            stripUnknown: true
        });

        if (error) {
            const errors = error.details.map(detail => ({
                field: detail.path.join('.'),
                message: detail.message
            }));
            
            validationErrors.push({
                orderIndex: index,
                customerOrderNumber: order.customerOrderNumber || `Order ${index + 1}`,
                erpOrderCode: order.erpOrderCode,
                errors: errors
            });
        } else {
            const declarationInfo = value.declaration_info || value.declarationInfo || [];
            const skuErrors = validateSkuCode(declarationInfo);
            
            if (skuErrors.length > 0) {
                validationErrors.push({
                    orderIndex: index,
                    customerOrderNumber: order.customerOrderNumber || order.customer_order_number || `Order ${index + 1}`,
                    erpOrderCode: order.erpOrderCode || order.erp_order_code,
                    errors: skuErrors
                });
            } else {
                validatedOrders.push(value);
            }
        }
    });

    // Nếu có lỗi validation, trả về ngay
    if (validationErrors.length > 0) {
        return errorResponse(res, 'Validation failed for some orders', 400, { 
            summary: {
                total: orders.length,
                valid: validatedOrders.length,
                invalid: validationErrors.length
            },
            validationErrors 
        });
    }

    // Gán lại orders đã validate
    req.body.orders = validatedOrders;
    
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

const validateSkuCode = (declarationInfo) => {
    const errors = [];
    
    // Rule 1: Bắt buộc khi có > 1 item
    if (declarationInfo.length > 1) {
        declarationInfo.forEach((item, index) => {
            if (!item.sku_code || item.sku_code.trim() === '') {
                errors.push({
                    field: `declaration_info[${index}].sku_code`,
                    message: 'sku_code is required when there are multiple declaration items'
                });
            }
        });
    }
    
    // Rule 2: Uniqueness (chỉ check các giá trị khác rỗng)
    const skuCodes = declarationInfo
        .map((item, index) => ({ sku: item.sku_code?.trim(), index }))
        .filter(item => item.sku && item.sku !== '');
    
    const skuCodeMap = new Map();
    skuCodes.forEach(({ sku, index }) => {
        if (skuCodeMap.has(sku)) {
            errors.push({
                field: `declaration_info[${index}].sku_code`,
                message: `sku_code "${sku}" is duplicated. Uniqueness must be met when there is a value (also found at index ${skuCodeMap.get(sku)})`
            });
        } else {
            skuCodeMap.set(sku, index);
        }
    });
    
    return errors;
};

module.exports = {
    validateOrder,
    validateErpUpdate,
    validateOrderMulti
};