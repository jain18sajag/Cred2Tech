const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

async function check() {
    try {
        const banks = await p.bankStatementAnalysisRequest.findMany({ orderBy: { id: 'desc' }, take: 2 });
        for (const b of banks) {
			console.log("BANK:", b.id, "Type of raw:", typeof b.raw_download_response);
			if (typeof b.raw_download_response === 'string') {
				console.log("FIRST 100 chars:", b.raw_download_response.substring(0, 100));
			} else {
				console.log("Keys:", Object.keys(b.raw_download_response || {}));
			}
		}

		console.log("\nFinding a Case with all 3 analytics populated...");
		const cases = await p.case.findMany({
			include: {
				gst_requests: { orderBy: { id: 'desc' }, take: 1 },
				itr_requests: { orderBy: { id: 'desc' }, take: 1 },
				bank_requests: { orderBy: { id: 'desc' }, take: 1 }
			},
			orderBy: { id: 'desc' }
		});

		let foundCaseId = null;
		for (const c of cases) {
			if (c.gst_requests.length > 0 && c.itr_requests.length > 0 && c.bank_requests.length > 0) {
				console.log(`Case ${c.id} has ALL THREE analytics populated!`);
				foundCaseId = c.id;
				break;
			}
		}

		if (!foundCaseId) {
			console.log("Could not find any single Case with GST + ITR + Bank combined.");
			// Let's just find the first case that has at least bank.
			const cB = cases.find(c => c.bank_requests.length > 0);
			if (cB) console.log(`Case ${cB.id} has Bank analytics.`);
		}
    } catch(e) {
		console.error(e);
	} finally {
        p.$disconnect();
    }
}
check();
