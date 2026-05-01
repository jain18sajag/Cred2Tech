const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const defaultVendors = [
    {
      vendor_id: 'V-01',
      name: 'Signzy Technologies',
      website: 'signzy.com',
      api_type: 'ITR',
      role: 'Primary',
      contract_start: new Date('2026-01-01T00:00:00.000Z'),
      contract_end: new Date('2026-12-31T23:59:59.000Z'),
      billing_model: 'Volume Slabs',
      status: 'Active'
    },
    {
      vendor_id: 'V-02',
      name: 'Signzy Technologies',
      website: 'signzy.com',
      api_type: 'GST',
      role: 'Primary',
      contract_start: new Date('2026-01-01T00:00:00.000Z'),
      contract_end: new Date('2026-12-31T23:59:59.000Z'),
      billing_model: 'Volume Slabs',
      status: 'Active'
    },
    {
      vendor_id: 'V-03',
      name: 'Signzy Technologies',
      website: 'signzy.com',
      api_type: 'Banking',
      role: 'Backup',
      contract_start: new Date('2026-01-01T00:00:00.000Z'),
      contract_end: new Date('2026-12-31T23:59:59.000Z'),
      billing_model: 'Per Call (Flat)',
      status: 'Active'
    },
    {
      vendor_id: 'V-04',
      name: 'Verify5 Technology',
      website: 'verify5.com',
      api_type: 'Bureau',
      role: 'Primary',
      contract_start: new Date('2025-04-01T00:00:00.000Z'),
      contract_end: new Date('2027-03-31T23:59:59.000Z'),
      billing_model: 'Volume Slabs',
      status: 'Active'
    }
  ];

  for (const v of defaultVendors) {
    // Upsert using raw queries due to potential client typings out of sync
    const existing = await prisma.$queryRaw`SELECT id FROM vendors WHERE vendor_id = ${v.vendor_id}`;
    if (existing.length === 0) {
      await prisma.$executeRaw`
        INSERT INTO vendors (vendor_id, name, website, api_type, role, contract_start, contract_end, billing_model, status, updated_at)
        VALUES (${v.vendor_id}, ${v.name}, ${v.website}, ${v.api_type}, ${v.role}, ${v.contract_start}, ${v.contract_end}, ${v.billing_model}, ${v.status}, NOW())
      `;
      console.log(`Inserted vendor ${v.vendor_id}`);

      // Get the inserted ID
      const newVendor = await prisma.$queryRaw`SELECT id FROM vendors WHERE vendor_id = ${v.vendor_id}`;
      const vId = newVendor[0].id;

      // Insert default slabs
      if (v.billing_model === 'Volume Slabs') {
        await prisma.$executeRaw`INSERT INTO vendor_slabs (vendor_id, from_calls, to_calls, rate) VALUES (${vId}, 0, 500, 45)`;
        await prisma.$executeRaw`INSERT INTO vendor_slabs (vendor_id, from_calls, to_calls, rate) VALUES (${vId}, 501, 1000, 42)`;
        await prisma.$executeRaw`INSERT INTO vendor_slabs (vendor_id, from_calls, to_calls, rate) VALUES (${vId}, 1001, null, 38)`;
      } else {
        await prisma.$executeRaw`INSERT INTO vendor_slabs (vendor_id, from_calls, to_calls, rate) VALUES (${vId}, 0, null, 48)`;
      }
    } else {
      console.log(`Vendor ${v.vendor_id} already exists`);
    }
  }

  console.log('Vendors seeding complete.');
}

main().catch(console.error).finally(() => prisma.$disconnect());
