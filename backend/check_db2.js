const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

async function check() {
    try {
        const banks = await p.bankStatementAnalysisRequest.findMany({ orderBy: { id: 'desc' }, take: 1 });
        if (banks[0]?.raw_download_response?.result) {
			const j = banks[0].raw_download_response.result.json;
			console.log("BANK RESULT.JSON TYPE:", typeof j);
			if (typeof j === 'object') {
				console.log("BANK RESULT.JSON KEYS:", Object.keys(j).slice(0,10));
				if (j.monthlyAverageDailyBalance) console.log("HAS Bank Balances:", Array.isArray(j.monthlyAverageDailyBalance));
			} else {
				console.log("BANK RESULT.JSON STRING VAL:", String(j).substring(0,100));
			}
		}

    } catch(e) { console.error(e); } finally { p.$disconnect(); }
}
check();
