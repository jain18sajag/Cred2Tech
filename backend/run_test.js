const { extractEsrFinancials } = require('./src/services/esrFinancials.service');
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

async function run() {
	try {
		const cases = await p.case.findMany({ include: { bank_statements: true, gst_requests: true, itr_analytics: true } });
		const c = cases.find(a => a.gst_requests.length > 0) || cases[0];
		if (!c) return console.log("No cases found");
		console.log("Running extraction for Case ID", c.id);
		await extractEsrFinancials(c.id);

		const esr = await p.caseEsrFinancials.findUnique({ where: { case_id: c.id } });
		console.log("\n--- EXTRACTED ESR JSON FOR DB ---\n", JSON.stringify(esr, null, 2));

	} catch(e) { console.error(e); } finally { p.$disconnect(); process.exit(0); }
}
run();
