const prisma = require('../../config/db');

// --- Lenders ---
exports.getLenders = async (req, res) => {
  try {
    const lenders = await prisma.lender.findMany({
      orderBy: { name: 'asc' },
      include: { products: true }
    });
    res.json(lenders);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed' });
  }
};

exports.createLender = async (req, res) => {
  try {
    const { name, code } = req.body;
    const lender = await prisma.lender.create({
      data: { name, code, created_by: req.user.id }
    });
    res.json(lender);
  } catch (error) {
    console.error('Error creating lender:', error);
    if (error.code === 'P2002') return res.status(400).json({ error: 'Code already exists.' });
    res.status(500).json({ error: 'Failed' });
  }
};

exports.updateLender = async (req, res) => {
  try {
    const { name, code, status } = req.body;
    const lender = await prisma.lender.update({
      where: { id: req.params.id },
      data: { name, code, status, updated_by: req.user.id }
    });
    res.json(lender);
  } catch (error) {
    res.status(500).json({ error: 'Failed' });
  }
};

exports.deleteLender = async (req, res) => {
  try {
    const lender = await prisma.lender.update({
      where: { id: req.params.id },
      data: { status: 'INACTIVE', updated_by: req.user.id }
    });
    res.json({ message: 'Lender marked inactive', lender });
  } catch (error) {
    res.status(500).json({ error: 'Failed' });
  }
};

// --- Products ---
exports.getLenderProducts = async (req, res) => {
  try {
    const products = await prisma.lenderProduct.findMany({
      where: { lender_id: req.params.id },
      include: { schemes: true }
    });
    res.json(products);
  } catch (error) {
    res.status(500).json({ error: 'Failed' });
  }
};

exports.createLenderProduct = async (req, res) => {
  try {
    const product = await prisma.lenderProduct.create({
      data: {
        lender_id: req.params.id,
        product_type: req.body.product_type
      }
    });

    // Auto-create default schemes
    const defaultSchemes = ['Salaried', 'GST Method', 'ABB Method'];
    const parameters = await prisma.parameterMaster.findMany();

    for (const sName of defaultSchemes) {
       const newScheme = await prisma.scheme.create({
          data: {
             product_id: product.id,
             scheme_name: sName,
             created_by: req.user.id
          }
       });

       // Auto-populate parameters for default schemes
       if (parameters.length > 0) {
          await prisma.schemeParameterValue.createMany({
             data: parameters.map(p => ({
                 scheme_id: newScheme.id,
                 parameter_id: p.id,
                 value: {},
                 created_by: req.user.id
             }))
          });
       }
    }

    res.json(product);
  } catch (error) {
    if (error.code === 'P2002') return res.status(400).json({ error: 'Product already exists for this lender.' });
    console.error(error);
    res.status(500).json({ error: 'Failed' });
  }
};

// --- Schemes ---
exports.getSchemesByProduct = async (req, res) => {
  try {
    const schemes = await prisma.scheme.findMany({
      where: { product_id: parseInt(req.params.id, 10), status: 'ACTIVE' },
      orderBy: { created_at: 'asc' }
    });
    res.json(schemes);
  } catch (error) {
    res.status(500).json({ error: 'Failed' });
  }
};

exports.createScheme = async (req, res) => {
  try {
    const scheme = await prisma.scheme.create({
      data: {
        product_id: parseInt(req.params.id, 10),
        scheme_name: req.body.scheme_name,
        created_by: req.user.id
      }
    });

    // If dup_scheme_id exists, copy parameter values from identical template
    if (req.body.dup_scheme_id) {
       const sourceParams = await prisma.schemeParameterValue.findMany({
         where: { scheme_id: parseInt(req.body.dup_scheme_id, 10) }
       });
       if (sourceParams.length > 0) {
         await prisma.schemeParameterValue.createMany({
           data: sourceParams.map(p => ({
              scheme_id: scheme.id,
              parameter_id: p.parameter_id,
              value: p.value || {},
              created_by: req.user.id
           }))
         });
       }
    } else {
       // Else, Auto-populate using master records
       const parameters = await prisma.parameterMaster.findMany();
       if (parameters.length > 0) {
          await prisma.schemeParameterValue.createMany({
             data: parameters.map(p => ({
                 scheme_id: scheme.id,
                 parameter_id: p.id,
                 value: {},
                 created_by: req.user.id
             }))
          });
       }
    }

    res.json(scheme);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed' });
  }
};

exports.updateScheme = async (req, res) => {
  try {
    const scheme = await prisma.scheme.update({
      where: { id: parseInt(req.params.id, 10) },
      data: {
        scheme_name: req.body.scheme_name,
        status: req.body.status,
        updated_by: req.user.id
      }
    });
    res.json(scheme);
  } catch (error) {
    res.status(500).json({ error: 'Failed' });
  }
};

exports.deleteScheme = async (req, res) => {
  try {
    const scheme = await prisma.scheme.update({
      where: { id: parseInt(req.params.id, 10) },
      data: { status: 'INACTIVE', updated_by: req.user.id }
    });
    res.json({ message: 'Deleted', scheme });
  } catch (error) {
    res.status(500).json({ error: 'Failed' });
  }
};

// --- Parameters & Matrix Values ---
exports.getProductMatrix = async (req, res) => {
  try {
    const productId = parseInt(req.params.id, 10);
    
    const schemes = await prisma.scheme.findMany({
      where: { product_id: productId, status: 'ACTIVE' },
      orderBy: { created_at: 'asc' }
    });

    const parameters = await prisma.parameterMaster.findMany({
      orderBy: { display_order: 'asc' }
    });

    const schemeIds = schemes.map(s => s.id);
    let values = [];
    
    if (schemeIds.length > 0) {
       values = await prisma.schemeParameterValue.findMany({
          where: { scheme_id: { in: schemeIds } }
       });
    }

    res.json({ schemes, parameters, values });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to fetch complex aggregated matrix payload.' });
  }
};

exports.getParameterMaster = async (req, res) => {
  try {
    const p = await prisma.parameterMaster.findMany({ orderBy: { display_order: 'asc' } });
    res.json(p);
  } catch (error) {
    res.status(500).json({ error: 'Failed' });
  }
};

exports.getSchemeParameters = async (req, res) => {
  try {
    const p = await prisma.schemeParameterValue.findMany({
      where: { scheme_id: parseInt(req.params.id, 10) }
    });
    res.json(p);
  } catch (error) {
    res.status(500).json({ error: 'Failed' });
  }
};

exports.updateSchemeParameter = async (req, res) => {
  try {
    const scheme_id = parseInt(req.params.id, 10);
    const { parameter_id, value } = req.body;
    
    // value must be explicitly JSON format as per schema enforcement.
    const record = await prisma.schemeParameterValue.upsert({
      where: { scheme_id_parameter_id: { scheme_id, parameter_id: parseInt(parameter_id, 10) } },
      update: { value, updated_by: req.user.id },
      create: { scheme_id, parameter_id: parseInt(parameter_id, 10), value, created_by: req.user.id }
    });
    res.json(record);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to update matrix value' });
  }
};
