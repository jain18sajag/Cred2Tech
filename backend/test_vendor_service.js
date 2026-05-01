const vendorService = require('./src/services/vendor.service');

async function test() {
  const data = await vendorService.getVendors();
  console.log(JSON.stringify(data, null, 2));
}

test().catch(console.error);
