const crypto = require('crypto');

function hashPassword(password) {
    return crypto.createHash('sha256').update(password).digest('hex');
}

const users = {
    [process.env.EXTENSION_USER]: hashPassword(process.env.EXTENSION_PASSWORD)
};

// Validate user
function validateUser(username, password) {
    const hashedPassword = hashPassword(password);
    return users[username] && users[username] === hashedPassword;
}

module.exports = {
    users,
    validateUser,
    hashPassword
};