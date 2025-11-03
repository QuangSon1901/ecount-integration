module.exports = {
    env: process.env.NODE_ENV || 'development',
    port: process.env.PORT || 3000,
    apiKey: process.env.API_KEY,
    
    yunexpress: {
        baseUrl: process.env.YUNEXPRESS_BASE_URL,
        appId: process.env.YUNEXPRESS_APP_ID,
        appSecret: process.env.YUNEXPRESS_APP_SECRET,
        sourceKey: process.env.YUNEXPRESS_SOURCE_KEY
    },
    
    ecount: {
        companyCode: process.env.ECOUNT_COMPANY_CODE,
        id: process.env.ECOUNT_ID,
        password: process.env.ECOUNT_PASSWORD,
        baseUrl: process.env.ECOUNT_BASE_URL
    },
    
    puppeteer: {
        headless: process.env.PUPPETEER_HEADLESS === 'true',
        timeout: parseInt(process.env.PUPPETEER_TIMEOUT) || 40000
    }
};