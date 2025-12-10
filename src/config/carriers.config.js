// Cấu hình các nhà vận chuyển
module.exports = {
    YUNEXPRESS: {
        name: 'YunExpress',
        code: 'YUNEXPRESS',
        enabled: true,
        productCodes: ['VN-YTYCPREC', 'VNTHZXR', 'VNBKZXR', 'VNMUZXR', 'S1002'] // Các mã sản phẩm có sẵn
    },
    YUNEXPRESS_CN: {
        name: 'YunExpress China',
        code: 'YUNEXPRESS_CN',
        enabled: true,
        productCodes: ['YTYCPREG', 'YTYCPREC', 'FZZXR', 'BKPHR', 'THPHR', 'THZXR', 'BKZXR', 'MUZXR', 'ZBZXRPH'] // Các mã sản phẩm có sẵn
    }
};