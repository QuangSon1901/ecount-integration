module.exports = {
    env: process.env.NODE_ENV || 'development',
    port: process.env.PORT || 3000,
    apiKey: process.env.API_KEY,
    
    database: {
        host: process.env.DB_HOST || 'localhost',
        port: parseInt(process.env.DB_PORT) || 3306,
        database: process.env.DB_NAME || 'yunexpress_integration',
        user: process.env.DB_USER || 'root',
        password: process.env.DB_PASSWORD || '',
        waitForConnections: true,
        connectionLimit: 10,
        queueLimit: 0
    },
    
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
    },
    
    cron: {
        trackingEnabled: process.env.CRON_TRACKING_ENABLED === 'true',
        trackingSchedule: process.env.CRON_TRACKING_SCHEDULE || '*/30 * * * *',
        updateErpEnabled: process.env.CRON_UPDATE_ERP_ENABLED === 'true'
    },

    redis: {
        url: process.env.REDIS_URL,
        
        // Hoặc dùng host/port riêng lẻ (local Redis)
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT) || 6379,
        
        // Authentication
        username: process.env.REDIS_USERNAME || undefined,
        password: process.env.REDIS_PASSWORD || undefined,
        
        // TLS cho Redis Cloud
        tls: process.env.REDIS_TLS === 'true' ? {} : undefined,
        
        // Database number
        db: parseInt(process.env.REDIS_DB) || 0,
        
        // Connection options
        maxRetriesPerRequest: null,
        enableReadyCheck: false,
        connectTimeout: 10000
    }
};