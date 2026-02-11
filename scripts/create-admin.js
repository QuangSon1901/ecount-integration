/**
 * scripts/create-admin.js
 *
 * Script tạo admin user
 * Usage: node scripts/create-admin.js <username> <password> [full_name] [email]
 */

require('dotenv').config();
const bcrypt = require('bcrypt');
const AdminUserModel = require('../src/models/admin-user.model');
const logger = require('../src/utils/logger');
const db = require('../src/database/connection');

async function createAdmin() {
    const args = process.argv.slice(2);

    if (args.length < 2) {
        console.error('Usage: node scripts/create-admin.js <username> <password> [full_name] [email]');
        process.exit(1);
    }

    const [username, password, fullName, email] = args;

    try {
        // Check if username already exists
        const existing = await AdminUserModel.findByUsername(username);
        if (existing) {
            logger.error('Admin username already exists:', username);
            console.error(`❌ Username "${username}" đã tồn tại!`);
            process.exit(1);
        }

        // Hash password
        const passwordHash = await bcrypt.hash(password, 10);

        // Create admin
        const adminId = await AdminUserModel.create({
            username,
            passwordHash,
            fullName: fullName || null,
            email: email || null
        });

        logger.info('Admin created successfully', { adminId, username });
        console.log('\n✅ Admin created successfully!');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log(`ID:        ${adminId}`);
        console.log(`Username:  ${username}`);
        console.log(`Password:  ${password}`);
        console.log(`Full Name: ${fullName || '(not set)'}`);
        console.log(`Email:     ${email || '(not set)'}`);
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
        console.log('🔐 Bạn có thể login tại: http://localhost:3000/login');

        process.exit(0);
    } catch (err) {
        logger.error('Error creating admin:', err);
        console.error('❌ Lỗi:', err.message);
        process.exit(1);
    }
}

createAdmin();
