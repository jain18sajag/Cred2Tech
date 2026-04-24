
require('dotenv').config();
const { extractEsrFinancials } = require('./src/services/esrFinancials.service');
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

async function r() {
  await extractEsrFinancials(11);
  const esr = await p.caseEsrFinancials.findUnique({where:{case_id: 11}});
  console.log('NEW ESR VALUES:\n', JSON.stringify(esr, null, 2));
  process.exit(0);
}
r();
