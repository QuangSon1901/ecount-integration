const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
const fs = require('fs');

const orderRoutes = require('./routes/order.routes');
const ecountRoutes = require('./routes/ecount.routes');
const labelRoutes = require('./routes/label.routes');
const extensionRoutes = require('./routes/extension.routes');

const apiV1Routes = require('./routes/api-v1.routes');

const errorMiddleware = require('./middlewares/error.middleware');
const logger = require('./utils/logger');
const db = require('./database/connection');


const app = express();
app.set('trust proxy', true);

// Security middleware
app.use(helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" }
}));
app.use(cors({
  origin: "https://loginia.ecount.com",
  credentials: true
}));

const getClientIp = (req) => {
    return req.headers['x-forwarded-for']?.split(',')[0].trim() ||
           req.headers['x-real-ip'] || 
           req.connection.remoteAddress ||
           req.socket.remoteAddress ||
           req.ip;
};

// Rate limiting
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 1000,
    message: 'Too many requests from this IP, please try again later.'
});
app.use('/api/', limiter);

// Body parser
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

const uploadsDir = path.join(__dirname, '../public/uploads');
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
    logger.info('Created uploads directory:', uploadsDir);
}

app.use('/uploads', express.static(path.join(__dirname, '../public/uploads'), {
    maxAge: '7d', // Cache 7 ngày
    etag: true,
    lastModified: true
}));


app.use('/js', express.static(path.join(__dirname, '../public/js'), {
    maxAge: '1d',
    etag: true
}));

// Request logging
// app.use((req, res, next) => {
//     logger.info(`${req.method} ${req.path}`, {
//         ip: req.ip,
//         body: req.method === 'POST' ? req.body : undefined
//     });
//     next();
// });

app.use((req, res, next) => {
    const clientIp = getClientIp(req);
    logger.info(`${req.method} ${req.path}`, {
        ip: clientIp,
        originalIp: req.ip, // Log cả IP gốc để debug
        headers: {
            'x-forwarded-for': req.headers['x-forwarded-for'],
            'x-real-ip': req.headers['x-real-ip']
        },
        body: req.method === 'POST' ? req.body : undefined
    });
    next();
});


// Health check
// app.get('/health', async (req, res) => {
//     try {
//         await db.testConnection();
//         res.json({ 
//             status: 'OK', 
//             timestamp: new Date().toISOString(),
//             database: 'connected',
//             ip: getClientIp(req) // Trả về IP thực trong health check để test
//         });
//     } catch (error) {
//         res.status(503).json({
//             status: 'ERROR',
//             timestamp: new Date().toISOString(),
//             database: 'disconnected',
//             error: error.message
//         });
//     }
// });

// Routes
app.use('/api/v1', apiV1Routes);

app.use('/api/orders', orderRoutes);
app.use('/api/ecount', ecountRoutes);
app.use('/api/labels', labelRoutes);
app.use('/extensions', extensionRoutes);

// 404 handler
app.use((req, res) => {
    res.status(404).json({
        success: false,
        message: 'Route not found'
    });
});

// Error handler
app.use(errorMiddleware);

db.testConnection().catch(err => {
    logger.error('DB failed:', err);
    process.exit(1);
});

module.exports = app;