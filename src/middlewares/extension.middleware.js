const { errorResponse } = require('../utils/response');

const extensionMiddleware = (req, res, next) => {
    const apiKey = req.headers['x-api-key'];
    
    if (!apiKey || apiKey !== process.env.EXTENSION_API_KEY) {
        return errorResponse(res, 'Unauthorized', 401);
    }
    
    next();
};

module.exports = extensionMiddleware;