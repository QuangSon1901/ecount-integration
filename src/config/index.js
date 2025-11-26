const { baseUrl } = require("../utils/telegram");

module.exports = {
    env: process.env.NODE_ENV || 'development',
    port: process.env.PORT || 3000,
    apiKey: process.env.API_KEY,
    baseUrl: process.env.BASE_URL,
    
    database: {
        host: process.env.DB_HOST || 'localhost',
        port: parseInt(process.env.DB_PORT) || 3306,
        database: process.env.DB_NAME || 'yunexpress_integration',
        user: process.env.DB_USER || 'root',
        password: process.env.DB_PASSWORD || '',
        waitForConnections: true,
        connectionLimit: 10,
        queueLimit: 0,
    },
    
    yunexpress: {
        baseUrl: process.env.YUNEXPRESS_BASE_URL,
        appId: process.env.YUNEXPRESS_APP_ID,
        appSecret: process.env.YUNEXPRESS_APP_SECRET,
        sourceKey: process.env.YUNEXPRESS_SOURCE_KEY
    },

    yunexpress_cn: {
        baseUrl: process.env.YUNEXPRESS_CN_BASE_URL,
        appId: process.env.YUNEXPRESS_CN_APP_ID,
        appSecret: process.env.YUNEXPRESS_CN_APP_SECRET,
        sourceKey: process.env.YUNEXPRESS_CN_SOURCE_KEY
    },
    
    ecount: {
        companyCode: process.env.ECOUNT_COMPANY_CODE,
        id: process.env.ECOUNT_ID,
        password: process.env.ECOUNT_PASSWORD,
        baseUrl: process.env.ECOUNT_BASE_URL
    },
    
    puppeteer: {
        headless: process.env.PUPPETEER_HEADLESS === 'true' ? 'new' : false,
        timeout: parseInt(process.env.PUPPETEER_TIMEOUT) || 40000,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--disable-gpu',
            '--lang=vi-VN',
            '--window-size=1366,768',
            '--disable-blink-features=AutomationControlled',
            process.env.NODE_ENV == 'production' ? '--single-process' : '', // for Docker
            '--disable-web-security',
            '--disable-features=IsolateOrigins,site-per-process'
        ],
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined
    },

    playwright: require('./playwright.config'),
    
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
    },

    telegram: {
        enabled: process.env.TELEGRAM_ENABLED === 'true',
        botToken: process.env.TELEGRAM_BOT_TOKEN,
        chatId: process.env.TELEGRAM_CHAT_ID,
        onError: process.env.TELEGRAM_ON_ERROR === 'true',
        includeStack: process.env.TELEGRAM_INCLUDE_STACK === 'true'
    }
};