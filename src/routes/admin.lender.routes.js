const express = require('express');
const router = express.Router();
const lenderController = require('../controllers/admin.lender.controller');
const { authenticate } = require('../middleware/auth.middleware');
const { requireRole } = require('../middleware/role.middleware');

router.use(authenticate);
router.use(requireRole('SUPER_ADMIN', 'CRED2TECH_MEMBER'));

// Lenders
router.get('/', lenderController.getLenders);
router.post('/', lenderController.createLender);
router.patch('/:id', lenderController.updateLender);
router.delete('/:id', lenderController.deleteLender);

// Products
router.get('/:id/products', lenderController.getLenderProducts);
router.post('/:id/products', lenderController.createLenderProduct);

// Schemes
router.get('/products/:id/schemes', lenderController.getSchemesByProduct);
router.post('/products/:id/schemes', lenderController.createScheme);
router.patch('/schemes/:id', lenderController.updateScheme);
router.delete('/schemes/:id', lenderController.deleteScheme);

// Parameters & Matrices
router.get('/products/:id/matrix', lenderController.getProductMatrix);
router.get('/parameters/master', lenderController.getParameterMaster);
router.get('/schemes/:id/parameters', lenderController.getSchemeParameters);
router.put('/schemes/:id/parameters', lenderController.updateSchemeParameter);

module.exports = router;
