module.exports = {
    headless: process.env.PLAYWRIGHT_HEADLESS === 'true' ? true : false,
    timeout: parseInt(process.env.PLAYWRIGHT_TIMEOUT) || 60000,
    concurrentBrowsers: parseInt(process.env.PLAYWRIGHT_CONCURRENT_BROWSERS) || 2,
    
    launchOptions: {
        headless: process.env.PLAYWRIGHT_HEADLESS === 'true' ? true : false,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--disable-gpu',
            '--disable-blink-features=AutomationControlled',
            '--disable-web-security',
            '--disable-features=IsolateOrigins,site-per-process'
        ]
    },
    
    contextOptions: {
        viewport: { width: 1366, height: 768 },
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        locale: 'vi-VN',
        timezoneId: 'Asia/Ho_Chi_Minh'
    }
};