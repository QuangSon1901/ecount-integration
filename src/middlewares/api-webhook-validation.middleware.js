const Joi = require('joi');
const { errorResponse } = require('../utils/response');

const VALID_EVENTS = ['tracking.updated', 'order.status', 'order.exception'];

const webhookSchema = Joi.object({
    url: Joi.string().uri({ scheme: ['http', 'https'] }).max(2083).required()
        .messages({ 'any.required': 'Webhook URL is required' }),
    secret: Joi.string().min(8).max(255).required()
        .messages({ 'any.required': 'Secret is required (min 8 characters)' }),
    events: Joi.array()
        .items(Joi.string().valid(...VALID_EVENTS))
        .min(1)
        .unique()
        .required()
        .messages({
            'any.required': 'events array is required',
            'array.min': 'Subscribe at least 1 event',
            'any.only': `Invalid event. Allowed: ${VALID_EVENTS.join(', ')}`
        })
});

/**
 * POST /api/v1/webhooks — validate body
 */
const validateWebhookCreate = (req, res, next) => {
    const { error, value } = webhookSchema.validate(req.body, { abortEarly: false });

    if (error) {
        const errors = error.details.map(detail => ({
            field: detail.path.join('.'),
            message: detail.message
        }));
        return errorResponse(res, 'Validation failed', 400, { errors });
    }

    req.body = value;
    next();
};

module.exports = { validateWebhookCreate };
