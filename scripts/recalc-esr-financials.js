const { PrismaClient } = require('@prisma/client');
const { extractEsrFinancials } = require('../src/services/esrFinancials.service');
const EsrTraceLogger = require('../src/services/esr/esrTraceLogger');

const prisma = new PrismaClient();

async function run() {
    const args = process.argv.slice(2);
    
    let isDryRun = true; // default to dry run
    let caseId = null;
    let tenantId = null;
    let limit = 1000;
    let verbose = false;
    let exportMapping = false;
    
    for (const arg of args) {
        if (arg === '--apply') {
            isDryRun = false;
        } else if (arg.startsWith('--caseId=')) {
            caseId = parseInt(arg.split('=')[1], 10);
        } else if (arg.startsWith('--tenantId=')) {
            tenantId = parseInt(arg.split('=')[1], 10);
        } else if (arg.startsWith('--limit=')) {
            limit = parseInt(arg.split('=')[1], 10);
        } else if (arg === '--dryRun') {
            isDryRun = true;
        } else if (arg === '--verbose') {
            verbose = true;
        } else if (arg === '--exportMapping') {
            exportMapping = true;
        }
    }

    console.log('================================================');
    console.log('      ESR FINANCIAL RECALCULATION SCRIPT        ');
    console.log('================================================');
    console.log(`Mode:      ${isDryRun ? 'DRY RUN (No DB updates)' : 'APPLY (Writing to DB)'}`);
    console.log(`Target:    ${caseId ? `Case ID ${caseId}` : 'All matching cases'}`);
    console.log('================================================\n');

    const whereClause = {};
    if (caseId) whereClause.case_id = caseId;
    if (tenantId) whereClause.tenant_id = tenantId;

    const cases = await prisma.caseEsrFinancials.findMany({
        where: whereClause,
        take: limit
    });

    if (cases.length === 0) {
        console.log('No cases found matching the criteria.');
        process.exit(0);
    }

    let scanned = 0;
    let changed = 0;
    let skipped = 0;
    let warnings = 0;
    let errors = 0;

    for (const oldRecord of cases) {
        scanned++;
        console.log(`\n--- Processing Case ID: ${oldRecord.case_id} ---`);
        
        try {
            const logger = new EsrTraceLogger({ enabled: true, traceLevel: verbose ? 'verbose' : 'normal' });
            logger.startTrace(oldRecord.case_id, oldRecord.tenant_id, 'Financials Re-Extraction (DRY-RUN)');

            const newRecord = await extractEsrFinancials(oldRecord.case_id, oldRecord.tenant_id, {
                preferRaw: true,
                dryRun: true, // Always do a dry run first to get the new payload
                logger
            });
            
            logger.flushTrace();

            if (!newRecord) {
                console.log(`⚠️ Skipped Case ${oldRecord.case_id} (No extraction payload returned)`);
                skipped++;
                warnings++;
                continue;
            }

            const formatCurrency = (val) => val != null ? `₹${Number(val).toLocaleString('en-IN')}` : 'N/A';
            const formatPercent = (val) => val != null ? `${(Number(val) * 100).toFixed(2)}%` : 'N/A';

            console.log('--- GST Details ---');
            console.log(`GST Industry Type:   ${newRecord.gst_industry_type || 'UNKNOWN'}`);
            console.log(`Margin Source:       ${newRecord.__policy?.gst_margin_source || 'fallback'}`);
            console.log(`Final Margin Used:   ${formatPercent(newRecord.gst_industry_margin)}`);
            console.log(`Final GST Income:    ${formatCurrency(newRecord.gst_income)}`);
            
            console.log('\n--- Banking Details ---');
            console.log(`Banking Policy Used: ${newRecord.__policy?.banking_income_policy || 'ABB_MULTIPLIER (fallback)'}`);
            const abbIncome = (newRecord.bank_avg_balance || 0) * (newRecord.__policy?.banking_abb_multiplier || 2);
            console.log(`ABB Income:          ${formatCurrency(abbIncome)}`);
            console.log(`Monthly Credit:      ${formatCurrency(newRecord.bank_avg_monthly_credit)}`);
            console.log(`Final Bank Income:   ${formatCurrency(newRecord.banking_income)}`);

            console.log('\nComparison:');
            console.table({
                'ITR PAT': { Old: formatCurrency(oldRecord.itr_pat), New: formatCurrency(newRecord.itr_pat) },
                'ITR Depreciation': { Old: formatCurrency(oldRecord.itr_depreciation), New: formatCurrency(newRecord.itr_depreciation) },
                'ITR Finance Cost': { Old: formatCurrency(oldRecord.itr_finance_cost), New: formatCurrency(newRecord.itr_finance_cost) },
                'ITR Gross Receipts': { Old: formatCurrency(oldRecord.itr_gross_receipts), New: formatCurrency(newRecord.itr_gross_receipts) },
                'NPM Monthly Income': { Old: formatCurrency(oldRecord.net_profit_income), New: formatCurrency(newRecord.net_profit_income) },
                'GST Avg Monthly Sales': { Old: formatCurrency(oldRecord.gst_avg_monthly_sales), New: formatCurrency(newRecord.gst_avg_monthly_sales) },
                'GST Industry Margin': { Old: formatPercent(oldRecord.gst_industry_margin), New: formatPercent(newRecord.gst_industry_margin) },
                'GST Income': { Old: formatCurrency(oldRecord.gst_income), New: formatCurrency(newRecord.gst_income) },
                'Bank Avg Balance': { Old: formatCurrency(oldRecord.bank_avg_balance), New: formatCurrency(newRecord.bank_avg_balance) },
                'Bank Monthly Credit': { Old: formatCurrency(oldRecord.bank_avg_monthly_credit), New: formatCurrency(newRecord.bank_avg_monthly_credit) },
                'Banking Income': { Old: formatCurrency(oldRecord.banking_income), New: formatCurrency(newRecord.banking_income) },
                'Selected Method': { Old: oldRecord.selected_income_method || 'N/A', New: newRecord.selected_income_method || 'N/A' },
                'Selected Monthly Income': { Old: formatCurrency(oldRecord.selected_monthly_income), New: formatCurrency(newRecord.selected_monthly_income) }
            });

            // Check if there are meaningful changes
            const keysToCompare = [
                'itr_pat', 'itr_gross_receipts', 'net_profit_income',
                'gst_avg_monthly_sales', 'gst_industry_margin', 'gst_income',
                'bank_avg_balance', 'bank_avg_monthly_credit', 'banking_income',
                'selected_income_method', 'selected_monthly_income'
            ];

            let hasChanges = false;
            for (const key of keysToCompare) {
                const oldVal = oldRecord[key];
                const newVal = newRecord[key];
                
                if (oldVal !== null && newVal !== null && !isNaN(Number(oldVal)) && !isNaN(Number(newVal))) {
                    if (Math.abs(Number(oldVal) - Number(newVal)) > 0.01) {
                        hasChanges = true;
                        break;
                    }
                } else if (String(oldVal) !== String(newVal)) {
                    hasChanges = true;
                    break;
                }
            }

            if (hasChanges) {
                console.log('STATUS: Changes Detected ⚠️');
                changed++;
                
                if (!isDryRun) {
                    console.log(`[APPLY] Updating Database for Case ${oldRecord.case_id}...`);
                    
                    const applyLogger = new EsrTraceLogger({ enabled: true, traceLevel: verbose ? 'verbose' : 'normal' });
                    applyLogger.startTrace(oldRecord.case_id, oldRecord.tenant_id, 'Financials Re-Extraction (APPLY)');
                    
                    await extractEsrFinancials(oldRecord.case_id, oldRecord.tenant_id, {
                        preferRaw: true,
                        dryRun: false,
                        logger: applyLogger
                    });
                    
                    applyLogger.flushTrace();
                    console.log(`[APPLY] Update Complete. Trace written to logs/esr/ESR_CASE_${oldRecord.case_id}.log`);
                }
            } else {
                console.log('STATUS: No changes. ✅');
            }

            if (exportMapping) {
                console.log(`\n[EXPORT] Generating ESR Extracted Fields Path Report for Case ${oldRecord.case_id}...`);
                try {
                    const auditGenerator = require('./generate-esr-audit');
                    await auditGenerator.generate(oldRecord.case_id);
                } catch (auditErr) {
                    console.error(`[EXPORT] Failed to generate audit report for Case ${oldRecord.case_id}:`, auditErr.message);
                }
            }

        } catch (e) {
            console.error(`❌ Error processing Case ${oldRecord.case_id}:`, e.message);
            errors++;
        }
    }

    console.log('\n================================================');
    console.log('                   SUMMARY                      ');
    console.log('================================================');
    console.log(`Cases Scanned:      ${scanned}`);
    console.log(`Cases Changed:      ${changed}`);
    console.log(`Cases Skipped:      ${skipped}`);
    console.log(`Warnings:           ${warnings}`);
    console.log(`Errors:             ${errors}`);
    console.log(`Mode:               ${isDryRun ? 'DRY RUN' : 'APPLY'}`);
    console.log('================================================\n');

    process.exit(errors > 0 ? 1 : 0);
}

run();
