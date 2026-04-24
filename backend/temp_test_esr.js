const { generateESR } = require('./src/services/esr.service');

(async () => {
    try {
        const result = await generateESR(11, 1, 1);
        console.log(JSON.stringify(result, null, 2));
        process.exit(0);
    } catch (e) {
        console.error("ESR FAILURE:", e);
        process.exit(1);
    }
})();
