const vendorService = require('../services/vendor.service');

async function getVendors(req, res) {
  try {
    const vendors = await vendorService.getVendors();
    res.json({ success: true, vendors });
  } catch (error) {
    console.error('Error fetching vendors:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch vendors' });
  }
}

async function updateVendor(req, res) {
  try {
    const { id } = req.params;
    await vendorService.updateVendor(id, req.body);
    res.json({ success: true, message: 'Vendor updated successfully' });
  } catch (error) {
    console.error('Error updating vendor:', error);
    res.status(500).json({ success: false, message: 'Failed to update vendor' });
  }
}

async function updateVendorSlabs(req, res) {
  try {
    const { id } = req.params;
    const { slabs } = req.body;
    await vendorService.updateVendorSlabs(id, slabs);
    res.json({ success: true, message: 'Vendor slabs updated successfully' });
  } catch (error) {
    console.error('Error updating vendor slabs:', error);
    res.status(500).json({ success: false, message: 'Failed to update vendor slabs' });
  }
}

module.exports = {
  getVendors,
  updateVendor,
  updateVendorSlabs
};
