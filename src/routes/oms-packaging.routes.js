// src/routes/oms-packaging.routes.js
//
// Routes cho admin quản lý vật liệu đóng gói + mapping SKU → material.
// Mounted ở api-v1 dưới /admin/oms-packaging-materials và /admin/oms-sku-packaging-mappings.

const express = require('express');
const ctrl = require('../controllers/oms-packaging.controller');
const { requireRole } = require('../middlewares/rbac.middleware');

const materialsRouter = express.Router();
materialsRouter.get('/',       requireRole('admin'), ctrl.listMaterials.bind(ctrl));
materialsRouter.post('/',      requireRole('admin'), ctrl.createMaterial.bind(ctrl));
materialsRouter.put('/:id',    requireRole('admin'), ctrl.updateMaterial.bind(ctrl));
materialsRouter.delete('/:id', requireRole('admin'), ctrl.deleteMaterial.bind(ctrl));

const mappingsRouter = express.Router();
mappingsRouter.get('/',       requireRole('admin'), ctrl.listMappings.bind(ctrl));
mappingsRouter.post('/',      requireRole('admin'), ctrl.createMapping.bind(ctrl));
mappingsRouter.delete('/:id', requireRole('admin'), ctrl.deleteMapping.bind(ctrl));

module.exports = { materialsRouter, mappingsRouter };
