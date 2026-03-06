// src/routes/pod-product.routes.js
const express = require('express');
const router = express.Router();
const multer = require('multer');
const controller = require('../controllers/pod-product.controller');

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        if (file.originalname.match(/\.(xlsx|xls)$/)) cb(null, true);
        else cb(new Error('Only Excel files are allowed'));
    }
});

router.get('/', controller.list.bind(controller));
router.get('/product-groups', controller.getProductGroups.bind(controller));
router.get('/:id', controller.getById.bind(controller));
router.post('/', controller.create.bind(controller));
router.patch('/:id', controller.update.bind(controller));
router.delete('/:id', controller.delete.bind(controller));
router.post('/import', upload.single('file'), controller.importExcel.bind(controller));

module.exports = router;
