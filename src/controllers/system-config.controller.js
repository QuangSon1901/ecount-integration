// src/controllers/system-config.controller.js
//
// Quản lý system_configs. Hiện tại expose CRUD cho seller_profiles.
// Các config key khác (ví dụ: oms_audit_config) có thể thêm sau.

const SystemConfigModel = require('../models/system-config.model');
const { successResponse, errorResponse } = require('../utils/response');

const SELLER_PROFILES_KEY = 'seller_profiles';

function generateId() {
    return Math.random().toString(36).substring(2, 10) + Date.now().toString(36);
}

class SystemConfigController {
    // ─── Seller Profiles ─────────────────────────────────────────────

    async listSellerProfiles(req, res, next) {
        try {
            const profiles = await SystemConfigModel.getValue(SELLER_PROFILES_KEY, []);
            return successResponse(res, profiles);
        } catch (err) {
            next(err);
        }
    }

    async createSellerProfile(req, res, next) {
        try {
            const { profileName, name, address1, address2, city, state, postalCode, country, phone, isDefault } = req.body || {};
            if (!profileName || !name || !address1 || !city || !country) {
                return errorResponse(res, 'Thiếu trường bắt buộc: profileName, name, address1, city, country', 400);
            }

            const profiles = await SystemConfigModel.getValue(SELLER_PROFILES_KEY, []);
            const newProfile = {
                id: generateId(),
                profileName,
                name,
                address1,
                address2: address2 || '',
                city,
                state: state || '',
                postalCode: postalCode || '',
                country,
                phone: phone || '',
                isDefault: !!isDefault,
            };

            if (newProfile.isDefault) {
                profiles.forEach(p => { p.isDefault = false; });
            }
            // Nếu chưa có profile nào, profile đầu tiên tự động là default
            if (profiles.length === 0) {
                newProfile.isDefault = true;
            }

            profiles.push(newProfile);
            await SystemConfigModel.set(SELLER_PROFILES_KEY, profiles, 'Thông tin seller cho ITC label');
            return successResponse(res, newProfile, 'Đã tạo seller profile', 201);
        } catch (err) {
            next(err);
        }
    }

    async updateSellerProfile(req, res, next) {
        try {
            const { id } = req.params;
            const { profileName, name, address1, address2, city, state, postalCode, country, phone } = req.body || {};

            const profiles = await SystemConfigModel.getValue(SELLER_PROFILES_KEY, []);
            const idx = profiles.findIndex(p => p.id === id);
            if (idx === -1) return errorResponse(res, 'Seller profile không tồn tại', 404);

            if (profileName !== undefined) profiles[idx].profileName = profileName;
            if (name      !== undefined) profiles[idx].name       = name;
            if (address1  !== undefined) profiles[idx].address1   = address1;
            if (address2  !== undefined) profiles[idx].address2   = address2;
            if (city      !== undefined) profiles[idx].city       = city;
            if (state     !== undefined) profiles[idx].state      = state;
            if (postalCode !== undefined) profiles[idx].postalCode = postalCode;
            if (country   !== undefined) profiles[idx].country    = country;
            if (phone     !== undefined) profiles[idx].phone      = phone;

            await SystemConfigModel.set(SELLER_PROFILES_KEY, profiles, 'Thông tin seller cho ITC label');
            return successResponse(res, profiles[idx], 'Đã cập nhật seller profile');
        } catch (err) {
            next(err);
        }
    }

    async setDefaultSellerProfile(req, res, next) {
        try {
            const { id } = req.params;
            const profiles = await SystemConfigModel.getValue(SELLER_PROFILES_KEY, []);
            const idx = profiles.findIndex(p => p.id === id);
            if (idx === -1) return errorResponse(res, 'Seller profile không tồn tại', 404);

            profiles.forEach((p, i) => { p.isDefault = (i === idx); });
            await SystemConfigModel.set(SELLER_PROFILES_KEY, profiles, 'Thông tin seller cho ITC label');
            return successResponse(res, profiles[idx], 'Đã đặt default seller profile');
        } catch (err) {
            next(err);
        }
    }

    async deleteSellerProfile(req, res, next) {
        try {
            const { id } = req.params;
            let profiles = await SystemConfigModel.getValue(SELLER_PROFILES_KEY, []);
            const idx = profiles.findIndex(p => p.id === id);
            if (idx === -1) return errorResponse(res, 'Seller profile không tồn tại', 404);

            const wasDefault = profiles[idx].isDefault;
            profiles.splice(idx, 1);

            // Nếu xoá profile đang là default, gán default cho profile đầu tiên còn lại
            if (wasDefault && profiles.length > 0) {
                profiles[0].isDefault = true;
            }

            await SystemConfigModel.set(SELLER_PROFILES_KEY, profiles, 'Thông tin seller cho ITC label');
            return successResponse(res, null, 'Đã xoá seller profile');
        } catch (err) {
            next(err);
        }
    }

    // ─── Generic config (đọc/ghi thô cho các key khác) ───────────────

    async getConfig(req, res, next) {
        try {
            const { key } = req.params;
            const row = await SystemConfigModel.get(key);
            if (!row) return errorResponse(res, `Config key '${key}' không tồn tại`, 404);
            return successResponse(res, row);
        } catch (err) {
            next(err);
        }
    }

    async setConfig(req, res, next) {
        try {
            const { key } = req.params;
            const { value, description } = req.body || {};
            if (value === undefined) return errorResponse(res, 'Thiếu trường value', 400);
            await SystemConfigModel.set(key, value, description);
            return successResponse(res, { key, value }, 'Đã lưu config');
        } catch (err) {
            next(err);
        }
    }
}

module.exports = new SystemConfigController();
