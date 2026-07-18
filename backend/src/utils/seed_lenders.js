const prisma = require('../../config/db');

const LENDERS = [
  { name: 'ICICI Bank', code: 'ICICI' },
  { name: 'HDFC Bank', code: 'HDFC' },
  { name: 'India Shelters', code: 'INDIA_SHELTERS' },
  { name: 'Piramal', code: 'PIRAMAL' },
  { name: 'Tata Capital Housing Finance Ltd', code: 'TATA_HOUSING', legacyCodes: ['TATACAPITAL'] }
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

const LENDER_SCHEMES = {
  INDIA_SHELTERS: ['Salaried', 'ITR Based', 'Assessed Income Program'],
  PIRAMAL: ['Salaried', 'Cash Profit Method', 'Banking', 'GRP', 'LIP', 'Low LTV', 'Gross Margin Method', 'Assessed Income Program'],
  TATA_HOUSING: ['Salaried', 'Net Profit Method', 'Banking', 'GST', 'GRP', 'LIP', 'Low LTV']
};

const LENDER_EXCLUDED_SCHEMES = {
  INDIA_SHELTERS: ['Banking', 'GRP', 'LIP', 'Low LTV', 'Gross Margin Method'],
  TATA_HOUSING: ['Net Worth Method', 'Any other method']
};

async function seedLendersIfMissing(options = {}) {
  try {
    const lenderCodes = Array.isArray(options.lenderCodes) ? new Set(options.lenderCodes) : null;
    for (const lenderData of LENDERS.filter(item => !lenderCodes || lenderCodes.has(item.code))) {
      let lender = await prisma.lender.findFirst({
        where: { code: { in: [lenderData.code, ...(lenderData.legacyCodes || [])] } }
      });
      if (!lender) {
        lender = await prisma.lender.create({
          data: { name: lenderData.name, code: lenderData.code }
        });
        console.log(`[startup] Created lender: ${lender.name}`);
      } else {
        lender = await prisma.lender.update({
          where: { id: lender.id },
          data: { name: lenderData.name, code: lenderData.code }
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

        const excludedSchemes = LENDER_EXCLUDED_SCHEMES[lenderData.code] || [];
        if (excludedSchemes.length > 0) {
          await prisma.scheme.updateMany({
            where: {
              product_id: product.id,
              scheme_name: { in: excludedSchemes },
              status: 'ACTIVE'
            },
            data: { status: 'INACTIVE' }
          });
        }

        for (const schemeName of (LENDER_SCHEMES[lenderData.code] || SCHEMES)) {
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
    throw error;
  }
}

module.exports = seedLendersIfMissing;
