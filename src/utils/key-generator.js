const crypto = require('crypto');

class KeyGenerator {
    /**
     * Generate label access key (vĩnh viễn)
     * @returns {string} - 32 ký tự random hex
     */
    static generateLabelAccessKey() {
        return crypto.randomBytes(16).toString('hex');
    }
}

module.exports = KeyGenerator;