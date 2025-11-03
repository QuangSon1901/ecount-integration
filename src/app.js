const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const orderRoutes = require('./routes/order.routes');
const errorMiddleware = require('./middlewares/error.middleware');
const logger = require('./utils/logger');
const db = require('./database/connection');
const trackingCron = require('./jobs/tracking.cron');
const queueService = require('./services/queue/queue.service');

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
        // Test database connection
        await db.testConnection();
        logger.info('✅ Database connected');

        // Start cron jobs
        trackingCron.start();
        logger.info('✅ Cron jobs started');

    } catch (error) {
        logger.error('❌ Failed to initialize app:', error);
        process.exit(1);
    }
};

// Initialize when app starts
// initializeApp();

// Graceful shutdown
process.on('SIGTERM', async () => {
    logger.info('SIGTERM signal received: closing services');
    
    try {
        // Close Redis queues
        await queueService.closeAll();
        
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