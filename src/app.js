const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const orderRoutes = require('./routes/order.routes');
const ecountRoutes = require('./routes/ecount.routes');
const errorMiddleware = require('./middlewares/error.middleware');
const logger = require('./utils/logger');
const db = require('./database/connection');
const trackingCron = require('./jobs/tracking.cron');
const fetchTrackingCron = require('./jobs/fetch-tracking.cron');
const updateStatusCron = require('./jobs/update-status.cron');
const cleanupSessionsCron = require('./jobs/cleanup-sessions.cron');
const jobWorker = require('./jobs/worker');


const app = express();

// Security middleware
app.use(helmet());
app.use(cors());

// Rate limiting
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    message: 'Too many requests from this IP, please try again later.'
});
app.use('/api/', limiter);

// Body parser
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Request logging
app.use((req, res, next) => {
    logger.info(`${req.method} ${req.path}`, {
        ip: req.ip,
        body: req.method === 'POST' ? req.body : undefined
    });
    next();
});

// Health check
app.get('/health', async (req, res) => {
    try {
        await db.testConnection();
        res.json({ 
            status: 'OK', 
            timestamp: new Date().toISOString(),
            database: 'connected'
        });
    } catch (error) {
        res.status(503).json({
            status: 'ERROR',
            timestamp: new Date().toISOString(),
            database: 'disconnected',
            error: error.message
        });
    }
});

// Routes
app.use('/api/orders', orderRoutes);
app.use('/api/ecount', ecountRoutes);

// 404 handler
app.use((req, res) => {
    res.status(404).json({
        success: false,
        message: 'Route not found'
    });
});

// Error handler
app.use(errorMiddleware);

// Initialize database and start cron
const initializeApp = async () => {
    try {
        const connected = await db.testConnection();
        if (connected) {
            jobWorker.start();
            fetchTrackingCron.start();
            updateStatusCron.start();
            cleanupSessionsCron.start();
            
            // trackingCron.start();
        }

    } catch (error) {
        logger.error('Failed to initialize app:', error);
        process.exit(1);
    }
};

// Initialize when app starts
initializeApp();

process.on('SIGTERM', async () => {
    logger.info('SIGTERM signal received: closing services');
    
    try {
        // Stop job worker
        jobWorker.stop();
        
        // Close HTTP server
        server.close(() => {
            logger.info('HTTP server closed');
            process.exit(0);
        });
    } catch (error) {
        logger.error('Error during shutdown:', error);
        process.exit(1);
    }
});

module.exports = app;