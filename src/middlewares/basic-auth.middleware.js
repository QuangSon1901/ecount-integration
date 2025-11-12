const basicAuth = require('express-basic-auth');
const logger = require('../utils/logger');
const { validateUser } = require('../../config/htpasswd');

const basicAuthMiddleware = basicAuth({
    authorizer: (username, password) => {
        const isValid = validateUser(username, password);
        
        if (isValid) {
            logger.info('Basic auth success', { username });
        } else {
            logger.warn('Basic auth failed', { username });
        }
        
        return isValid;
    },
    challenge: true, // Show browser login popup
    realm: 'ECount Extension Downloads', // Title của popup
    unauthorizedResponse: (req) => {
        return {
            success: false,
            message: 'Invalid credentials'
        };
    }
});

module.exports = basicAuthMiddleware;