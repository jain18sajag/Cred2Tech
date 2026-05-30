const fs = require('fs');

async function main() {
  const prisma = require('./config/db');
  const itrRequests = await prisma.itrAnalyticsRequest.findMany({
    where: { case_id: 60 }
  });

  if (itrRequests.length > 0 && itrRequests[0].analytics_payload) {
    const rawPayload = typeof itrRequests[0].analytics_payload === 'string'
      ? JSON.parse(itrRequests[0].analytics_payload)
      : itrRequests[0].analytics_payload;
    
    const itr3 = rawPayload['2024-2025'][0].json.ITR.ITR3;

    function findKeys(obj, path = 'ITR3') {
      if (!obj || typeof obj !== 'object') return;
      Object.entries(obj).forEach(([k, v]) => {
        const currentPath = `${path}.${k}`;
        if (k.toLowerCase().includes('depr') || k.toLowerCase().includes('remun') || k.toLowerCase().includes('partner') || k.toLowerCase().includes('finance') || k.toLowerCase().includes('interest') || k.toLowerCase().includes('salary')) {
          console.log(`${currentPath} = ${typeof v === 'object' ? '[Object]' : v}`);
        }
        findKeys(v, currentPath);
      });
    }

    findKeys(itr3);
  }
}

main().catch(console.error);
