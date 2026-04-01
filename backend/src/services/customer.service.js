const prisma = require('../../config/db');

async function checkCustomerByPan(business_pan, tenant_id) {
  const customer = await prisma.customer.findFirst({
    where: {
      business_pan,
      tenant_id
    }
  });
  return customer;
}

async function createOrAttachCustomer(data, tenant_id, user_id) {
  const { business_pan, business_mobile, business_email, business_name, customer_id } = data;

  if (customer_id) {
    return await prisma.customer.update({
      where: { id: parseInt(customer_id, 10) },
      data: {
        business_mobile,
        business_email,
        business_name
      }
    });
  }

  // Try to find the existing customer within this tenant
  let customer = await prisma.customer.findFirst({
    where: {
      business_pan,
      tenant_id
    }
  });

  // If not found, create a new one
  if (!customer) {
    customer = await prisma.customer.create({
      data: {
        tenant_id,
        business_pan,
        business_mobile,
        business_email,
        business_name,
        created_by_user_id: user_id
      }
    });
  } else {
    // Dynamically update fields if the user provided new data
    customer = await prisma.customer.update({
      where: { id: customer.id },
      data: {
        business_mobile: business_mobile || customer.business_mobile,
        business_email: business_email || customer.business_email,
        business_name: business_name || customer.business_name
      }
    });
  }

  return customer;
}

module.exports = {
  checkCustomerByPan,
  createOrAttachCustomer
};
