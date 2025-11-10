// Cấu hình các nhà vận chuyển
module.exports = {
    YUNEXPRESS: {
        name: 'YunExpress',
        code: 'YUNEXPRESS',
        enabled: true,
        productCodes: ['YTYCPREC', 'VN-YTYCPREC', 'VNTHZXR', 'VNMUZXR'] // Các mã sản phẩm có sẵn
    },
    YUNEXPRESS_CN: {
        name: 'YunExpress China',
        code: 'YUNEXPRESS_CN',
        enabled: true,
        productCodes: ['ZBZXRPH', 'YTYCPREG', 'YTYCPREC', 'FZZXR', 'BKPHR', 'THPHR', 'THZXR', 'BKZXR', 'MUZXR'] // Các mã sản phẩm có sẵn
    },
    // DHL: {
    //     name: 'DHL',
    //     code: 'DHL',
    //     enabled: false
    // },
    // FEDEX: {
    //     name: 'FedEx',
    //     code: 'FEDEX',
    //     enabled: false
    // }
};