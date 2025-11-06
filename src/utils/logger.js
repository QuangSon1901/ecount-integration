const winston = require('winston');
const path = require('path');

const logDir = path.join(__dirname, '../../logs');

// Custom format
const customFormat = winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.errors({ stack: true }),
    winston.format.printf(({ timestamp, level, message, ...meta }) => {
        let log = `${timestamp} [${level.toUpperCase()}]: ${message}`;
        if (Object.keys(meta).length > 0) {
            log += ` ${JSON.stringify(meta)}`;
        }
        return log;
    })
);

const transports = [
    // File transport - errors
    new winston.transports.File({
        filename: path.join(logDir, 'error.log'),
        level: 'error',
        maxsize: 5242880, // 5MB
        maxFiles: 5
    }),
    // File transport - all logs
    new winston.transports.File({
        filename: path.join(logDir, 'combined.log'),
        maxsize: 5242880, // 5MB
        maxFiles: 5
    })
];

if (process.env.NODE_ENV === 'development') {
    transports.push(
        new winston.transports.Console({
            format: winston.format.combine(
                winston.format.colorize(),
                customFormat
            )
        })
    );
}

// Create logger
const logger = winston.createLogger({
    level: process.env.LOG_LEVEL || 'info',
    format: customFormat,
    transports: transports
});

// Create logs directory if not exists
const fs = require('fs');
if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
}

// ============================================
// THÊM TELEGRAM INTEGRATION
// ============================================

// Import telegram sau khi logger đã được tạo để tránh circular dependency
let telegramNotifier;
const loadTelegram = () => {
    if (!telegramNotifier) {
        try {
            telegramNotifier = require('./telegram');
        } catch (e) {
            // Telegram module not loaded yet
        }
    }
    return telegramNotifier;
};

// Override error method để gửi Telegram
const originalError = logger.error.bind(logger);
logger.error = function (message, meta = {}) {
    // Log bình thường
    originalError(message, meta);

    // Gửi Telegram nếu enabled
    const telegram = loadTelegram();
    if (telegram && process.env.TELEGRAM_ON_ERROR === 'true') {
        // Chỉ gửi telegram cho các error quan trọng
        const shouldNotify =
            typeof message === 'string' && (
                message.includes('Failed') ||
                message.includes('Error') ||
                message.includes('Lỗi') ||
                meta.critical === true
            );

        if (shouldNotify) {
            // Async fire-and-forget
            telegram.notifyError(
                typeof message === 'object' ? message : new Error(message),
                {
                    ...meta,
                    environment: process.env.NODE_ENV
                }
            ).catch(err => {
                // Không log lỗi telegram để tránh infinite loop
                console.error('Telegram notification failed:', err.message);
            });
        }
    }
};

module.exports = logger;