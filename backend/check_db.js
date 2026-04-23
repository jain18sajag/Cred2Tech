const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

async function check() {
    try {
        const banks = await p.bankStatementAnalysisRequest.findMany({ orderBy: { id: 'desc' }, take: 1 });
        const gsts = await p.gstrAnalyticsRequest.findMany({ orderBy: { id: 'desc' }, take: 1 });
        const itrs = await p.itrAnalyticsRequest.findMany({ orderBy: { id: 'desc' }, take: 1 });

        console.log("BANK RAW KEYS:", Object.keys(banks[0]?.raw_download_response || {}));
        if (banks[0]?.raw_download_response?.result) {
			console.log("BANK RESULT KEYS:", Object.keys(banks[0].raw_download_response.result));
		}
		
        console.log("GST RAW TYPE:", typeof gsts[0]?.raw_gst_data);
		if (gsts[0] && typeof gsts[0].raw_gst_data === 'object' && gsts[0].raw_gst_data !== null) {
			console.log("GST RAW KEYS:", Object.keys(gsts[0].raw_gst_data));
			if (gsts[0].raw_gst_data["Monthly Sale Summary"]) {
				console.log("Monthly Sale Summary:", gsts[0].raw_gst_data["Monthly Sale Summary"].length, "items");
			} else {
				console.log("MISSING Monthly Sale Summary -> found:", Object.keys(gsts[0].raw_gst_data).slice(0, 5));
			}
		}

        console.log("ITR RAW TYPE:", typeof itrs[0]?.analytics_payload);
		if (itrs[0] && typeof itrs[0].analytics_payload === 'object' && itrs[0].analytics_payload !== null) {
			console.log("ITR RAW KEYS:", Object.keys(itrs[0].analytics_payload));
			if (itrs[0].analytics_payload.ITR) {
				console.log("ITR.ITR3:", !!itrs[0].analytics_payload.ITR.ITR3);
			} else if (itrs[0].analytics_payload.result) {
				console.log("ITR RESULT KEYS:", Object.keys(itrs[0].analytics_payload.result));
				if (itrs[0].analytics_payload.result.ITR) {
					console.log("ITR in result");
				}
			}
		}

    } catch(e) {
		console.error(e);
	} finally {
        p.$disconnect();
    }
}
check();
