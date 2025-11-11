const crypto = require('crypto');

class KeyGenerator {
    /**
     * Generate label access key với base36 timestamp (compact)
     * Format: {timestamp_base36}{random}
     * Example: l5x7k2a1b2c3d4e5f6g7h8i9
     * @returns {string} - ~8 chars timestamp + 20 chars random = 28 chars
     */
    static generateLabelAccessKey() {
        const timestamp = Date.now().toString(36); // Base36: ~8 chars
        const random = crypto.randomBytes(10).toString('hex'); // 20 chars
        return `${timestamp}${random}`; // Total: ~28 chars
    }
}

module.exports = KeyGenerator;