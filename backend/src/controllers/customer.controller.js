const customerService = require('../services/customer.service');

async function checkCustomer(req, res) {
  try {
    const { pan } = req.query;
    if (!pan) {
      return res.status(400).json({ error: 'PAN is required' });
    }

    const tenant_id = req.user.tenant_id;
    const customer = await customerService.checkCustomerByPan(pan, tenant_id);

    if (!customer) {
      return res.status(404).json({ message: 'Customer not found in your tenant.' });
    }

    res.json(customer);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error while checking customer.' });
  }
}

async function createOrAttach(req, res) {
  try {
    const { business_pan, business_mobile, business_email, business_name, customer_id } = req.body;
    
    if (!business_pan && !customer_id) {
      return res.status(400).json({ error: 'business_pan or customer_id is required.' });
    }

    const tenant_id = req.user.tenant_id;
    const user_id = req.user.id;

    const customer = await customerService.createOrAttachCustomer({
      customer_id,
      business_pan,
      business_mobile,
      business_email,
      business_name
    }, tenant_id, user_id);

    res.status(200).json(customer);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error while creating or attaching customer.' });
  }
}

module.exports = {
  checkCustomer,
  createOrAttach
};
