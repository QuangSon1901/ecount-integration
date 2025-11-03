const Joi = require('joi');
const { errorResponse } = require('../utils/response');

// Schema cho receiver
const receiverSchema = Joi.object({
    firstName: Joi.string().required(),
    lastName: Joi.string().allow(''),
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
    name_local: Joi.string().allow(''), // Tên tiếng Trung/Việt
    name_en: Joi.string().required(), // Tên tiếng Anh - BẮT BUỘC
    quantity: Joi.number().integer().positive().required(),
    unit_price: Joi.number().positive().required(), // FOB Price
    selling_price: Joi.number().positive().allow(null), // Giá bán thực tế (nếu có)
    unit_weight: Joi.number().positive().required(),
    hs_code: Joi.string().allow(''),
    sales_url: Joi.string().uri().allow(''),
    currency: Joi.string().length(3).default('USD'), // Mã tiền tệ 3 ký tự
    material: Joi.string().allow(''),
    purpose: Joi.string().allow(''), // Use/Mục đích sử dụng
    brand: Joi.string().allow(''),
    spec: Joi.string().allow(''), // Specs/Thông số kỹ thuật
    model: Joi.string().allow(''), // Model Type
    remark: Joi.string().allow(''),
    fabric_creation_method: Joi.string().valid('K', 'W', '').allow(''), // K=Knitted, W=Woven
    manufacturer_id: Joi.string().allow(''),
    manufacturer_name: Joi.string().allow(''),
    manufacturer_address: Joi.string().allow(''),
    manufacturer_city: Joi.string().allow(''),
    manufacturer_province: Joi.string().allow(''),
    manufacturer_country: Joi.string().allow(''),
    manufacturer_postalcode: Joi.string().allow('')
});

// Schema chính cho order
const orderSchema = Joi.object({
    carrier: Joi.string().valid('YUNEXPRESS', 'DHL', 'FEDEX').default('YUNEXPRESS'),
    productCode: Joi.string().required(), // VN-YTYCPREC trong mẫu Excel
    customerOrderNumber: Joi.string().allow(''), // Mã đơn tự sinh nếu để trống
    platformOrderNumber: Joi.string().allow(''), // 114-0545205-6217035 (Amazon Order ID)
    trackingNumber: Joi.string().allow(''), // Để trống nếu không có tracking sẵn
    referenceNumbers: Joi.array().items(Joi.string()).max(5),
    
    weightUnit: Joi.string().valid('KG', 'G', 'LBS').default('KG'),
    sizeUnit: Joi.string().valid('CM', 'INCH').default('CM'),
    
    packages: Joi.array().items(packageSchema).min(1).required(),
    receiver: receiverSchema.required(),
    declarationInfo: Joi.array().items(declarationSchema).min(1).required(), // BẮT BUỘC phải có
    
    sender: receiverSchema, // Optional
    
    customsNumber: Joi.object({
        tax_number: Joi.string().allow(''),
        ioss_code: Joi.string().allow(''), // IOSS Code cho EU
        vat_code: Joi.string().allow(''), // VAT Number
        eori_number: Joi.string().allow('') // EORI Number cho EU
    }),
    
    extraServices: Joi.array().items(Joi.object({
        extra_code: Joi.string().required(),
        extra_value: Joi.string().allow('')
    })),
    
    // Platform info (optional)
    platform: Joi.object({
        platform_name: Joi.string().allow(''),
        province: Joi.string().allow(''),
        address: Joi.string().allow(''),
        postal_code: Joi.string().allow(''),
        phone_number: Joi.string().allow(''),
        email: Joi.string().email().allow(''),
        platform_code: Joi.string().allow('') // E-commerce Platform Code
    }),
    
    // Payment info (optional)
    payment: Joi.object({
        pay_platform: Joi.string().allow(''),
        pay_account: Joi.string().allow(''),
        pay_transaction: Joi.string().allow('')
    }),
    
    platformAccountCode: Joi.string().allow(''),
    sourceCode: Joi.string().default('YT'),
    sensitiveType: Joi.string().valid('W', 'D', 'F', 'L').default('W'), // W=package, D=document, F=sub-order, L=envelope
    labelType: Joi.string().valid('PDF', 'ZPL', 'PNG').default('PDF'),
    goodsType: Joi.string().valid('W', 'F', 'O').allow(''), // W=Online shopping, F=FS goods, O=Other
    dangerousGoodsType: Joi.string().allow(''), // Mã hàng nguy hiểm nếu có
    
    // Pickup point (cho dịch vụ self-pickup)
    pointRelaisNum: Joi.string().allow(''),
    
    // ERP fields
    erpOrderCode: Joi.string().allow(''),
    erpStatus: Joi.string().default('Đang xử lý'),
    ecountLink: Joi.string().allow('')
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