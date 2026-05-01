const prisma = require('../../config/db');

async function getVendors() {
  // Using raw queries as prisma generate might be blocked by file locks
  const vendors = await prisma.$queryRaw`SELECT * FROM vendors ORDER BY id ASC`;
  const slabs = await prisma.$queryRaw`SELECT * FROM vendor_slabs ORDER BY from_calls ASC`;

  // Attach slabs to their respective vendors
  const vendorsWithSlabs = vendors.map(vendor => ({
    id: vendor.vendor_id,
    name: vendor.name,
    website: vendor.website,
    apiType: vendor.api_type,
    role: vendor.role,
    period: `${new Date(vendor.contract_start).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })} – ${new Date(vendor.contract_end).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}`,
    billingModel: vendor.billing_model,
    status: vendor.status,
    mtdCalls: 0, // In a real scenario, this would be computed from ApiUsageLog
    mtdCost: 0,
    slabs: slabs.filter(s => s.vendor_id === vendor.id).map(s => ({
      from: s.from_calls,
      to: s.to_calls,
      rate: s.rate
    }))
  }));

  // Fetch actual API calls for the rolling 30 days (acts as MTD for UI visibility)
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  
  const mtdLogs = await prisma.$queryRaw`
    SELECT api_code, COUNT(*) as count 
    FROM api_usage_logs 
    WHERE created_at >= ${thirtyDaysAgo} AND status = 'SUCCESS'
    GROUP BY api_code
  `;

  const callsByCode = {};
  mtdLogs.forEach(row => {
    callsByCode[row.api_code] = Number(row.count);
  });

  vendorsWithSlabs.forEach(v => {
    // 1. Calculate actual MTD calls based on API type
    let calls = 0;
    if (v.apiType === 'ITR') calls = (callsByCode['ITR_ANALYTICS'] || 0) + (callsByCode['ITR_FETCH'] || 0);
    if (v.apiType === 'GST') calls = (callsByCode['GST_FETCH'] || 0);
    if (v.apiType === 'Banking') calls = (callsByCode['BANK_ANALYSIS'] || 0);
    if (v.apiType === 'Bureau') calls = (callsByCode['BUREAU_PULL'] || 0);
    
    // In a real multi-vendor setup, api_usage_logs would have a vendor_id.
    // For this prototype, we assign all calls for the apiType to this vendor.
    v.mtdCalls = calls;

    // 2. Calculate actual cost based on slabs
    let cost = 0;
    const sortedSlabs = [...v.slabs].sort((a, b) => a.from - b.from);

    if (v.billingModel === 'Per Call (Flat)') {
       const rate = sortedSlabs.length > 0 ? sortedSlabs[0].rate : 0;
       cost = v.mtdCalls * rate;
    } else {
       // Step-wise Volume Slabs calculation
       for (const slab of sortedSlabs) {
         const lowerBound = slab.from === 0 ? 1 : slab.from;
         const upperBound = slab.to === null ? Infinity : slab.to;
         
         if (v.mtdCalls >= lowerBound) {
            const callsInThisSlab = Math.min(v.mtdCalls, upperBound) - lowerBound + 1;
            cost += callsInThisSlab * slab.rate;
         }
       }
    }

    v.mtdCost = cost;
  });

  return vendorsWithSlabs;
}

async function updateVendor(vendorId, data) {
  const { name, apiType, role, contract_start, contract_end, billingModel, status } = data;
  
  let updates = [];
  if (name) updates.push(prisma.$executeRaw`UPDATE vendors SET name = ${name} WHERE vendor_id = ${vendorId}`);
  if (apiType) updates.push(prisma.$executeRaw`UPDATE vendors SET api_type = ${apiType} WHERE vendor_id = ${vendorId}`);
  if (role) updates.push(prisma.$executeRaw`UPDATE vendors SET role = ${role} WHERE vendor_id = ${vendorId}`);
  if (billingModel) updates.push(prisma.$executeRaw`UPDATE vendors SET billing_model = ${billingModel} WHERE vendor_id = ${vendorId}`);
  if (status) updates.push(prisma.$executeRaw`UPDATE vendors SET status = ${status} WHERE vendor_id = ${vendorId}`);
  
  try {
    if (contract_start) {
      // Basic date parsing to handle frontend strings
      const d = new Date(contract_start);
      if (!isNaN(d)) updates.push(prisma.$executeRaw`UPDATE vendors SET contract_start = ${d} WHERE vendor_id = ${vendorId}`);
    }
    if (contract_end) {
      const d = new Date(contract_end);
      if (!isNaN(d)) updates.push(prisma.$executeRaw`UPDATE vendors SET contract_end = ${d} WHERE vendor_id = ${vendorId}`);
    }
  } catch(e) {
    console.error('Date parsing failed during vendor update', e);
  }

  // Execute all updates sequentially (or via transaction)
  if (updates.length > 0) {
    for (const p of updates) {
      await p;
    }
    await prisma.$executeRaw`UPDATE vendors SET updated_at = NOW() WHERE vendor_id = ${vendorId}`;
  }

  return { success: true };
}

async function updateVendorSlabs(vendorIdStr, slabsData) {
  const vendors = await prisma.$queryRaw`SELECT id FROM vendors WHERE vendor_id = ${vendorIdStr}`;
  if (vendors.length === 0) throw new Error('Vendor not found');
  const vendorDbId = vendors[0].id;

  // Transaction for updating slabs
  await prisma.$transaction([
    prisma.$executeRaw`DELETE FROM vendor_slabs WHERE vendor_id = ${vendorDbId}`,
    ...slabsData.map(slab => 
      prisma.$executeRaw`INSERT INTO vendor_slabs (vendor_id, from_calls, to_calls, rate) VALUES (${vendorDbId}, ${slab.from}, ${slab.to === null ? null : slab.to}, ${slab.rate})`
    )
  ]);

  return { success: true };
}

module.exports = {
  getVendors,
  updateVendor,
  updateVendorSlabs
};
