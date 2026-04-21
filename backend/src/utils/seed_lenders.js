const prisma = require('../../config/db');

const LENDERS = [
  { name: 'ICICI Bank', code: 'ICICI' },
  { name: 'HDFC Bank', code: 'HDFC' }
];

const PRODUCTS = ['HL', 'LAP'];

const SCHEMES = [
  'Salaried',
  'Net Profit Method',
  'Banking',
  'GST',
  'GRP',
  'LIP',
  'Low LTV',
  'Net Worth Method'
];

async function seedLendersIfMissing() {
  try {
    for (const lenderData of LENDERS) {
      let lender = await prisma.lender.findUnique({ where: { code: lenderData.code } });
      if (!lender) {
        lender = await prisma.lender.create({ data: lenderData });
        console.log(`[startup] Created lender: ${lender.name}`);
      } else {
        lender = await prisma.lender.update({
          where: { code: lenderData.code },
          data: { name: lenderData.name } 
        });
      }

      for (const productType of PRODUCTS) {
        let product = await prisma.lenderProduct.findUnique({
          where: {
            lender_id_product_type: {
              lender_id: lender.id,
              product_type: productType
            }
          }
        });

        if (!product) {
          product = await prisma.lenderProduct.create({
            data: {
              lender_id: lender.id,
              product_type: productType
            }
          });
          console.log(`[startup] Created product: ${productType} for ${lender.name}`);
        }

        for (const schemeName of SCHEMES) {
          let scheme = await prisma.scheme.findFirst({
            where: {
              product_id: product.id,
              scheme_name: schemeName
            }
          });

          if (!scheme) {
            scheme = await prisma.scheme.create({
              data: {
                product_id: product.id,
                scheme_name: schemeName
              }
            });
            console.log(`[startup] Created scheme: ${schemeName} for ${lender.name} - ${productType}`);
          }
        }
      }
    }
    console.log('[startup] Lender Configuration verified.');
  } catch (error) {
    console.error('[startup] Failed to seed lenders configuration:', error);
  }
}

module.exports = seedLendersIfMissing;
