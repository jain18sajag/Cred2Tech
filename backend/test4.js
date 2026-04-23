const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

async function r() {
  const c = await p.case.findUnique({ where: {id: 11}, include: { bank_statements: true }});
  const rawBank = JSON.parse(await require('./src/services/storage/index').getStorageProvider().getStream(await p.document.findUnique({where:{id: c.bank_statements[0].bank_json_document_id}}).then(d=>d.storage_path)).then(async s=>{const c=[];for await(const x of s)c.push(x);return Buffer.concat(c).toString();}));
  console.log('OVERVIEW:', Object.keys(rawBank.overview || {}));
  if (rawBank.overview?.dailyBalance) {
      console.log('DAILY BALANCE KEY!');
  }
  if (rawBank.dailyBalance) {
      console.log('DAILYBALANCE:', Object.keys(rawBank.dailyBalance || {}));
      console.log(JSON.stringify(rawBank.dailyBalance).substring(0, 300));
  }
  process.exit(0);
}
r();
