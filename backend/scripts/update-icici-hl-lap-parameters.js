const { PrismaClient } = require('@prisma/client');
const { normalizeParameter, isCriticalParameter } = require('../src/utils/esrParsers');

const prisma = new PrismaClient();

function buildMapping(baseParams) {
    return {
        "HL": {
            "Salaried": { ...baseParams.HL_COMMON, "hl_min_loan": "500000", "hl_max_tenure": "300 Months", "age_maturity_income": "60", "hl_dbr_foir": "<75k -60%, >75k - 70%" },
            "Net Profit Method": { ...baseParams.HL_COMMON, "hl_min_loan": "500000", "hl_max_tenure": "240 Months", "age_maturity_income": "75", "hl_dbr_foir": "Max 100% (Double whammy - 140%)", "npm_depreciation_fraction": "66.67%" },
            "Banking": { ...baseParams.HL_COMMON, "hl_min_loan": "500000", "hl_max_tenure": "240 Months", "age_maturity_income": "75", "hl_dbr_foir": "No DBR", "banking_abb_multiplier": "2" },
            "GST": { ...baseParams.HL_COMMON, "hl_min_loan": "500000", "hl_max_tenure": "240 Months", "age_maturity_income": "75", "hl_dbr_foir": "Max 100% (Double whammy - 140%)", "gst_industry_margin": "10%" },
            "GRP": { ...baseParams.HL_COMMON, "hl_min_loan": "500000", "hl_max_tenure": "240 Months", "age_maturity_income": "75", "hl_dbr_foir": "No DBR", "grp_annual_receipts_multiplier": "4" },
            "Net Worth Method": { ...baseParams.HL_COMMON, "hl_min_loan": "500000", "hl_max_tenure": "240 Months", "age_maturity_income": "75", "hl_dbr_foir": "Max 100% (Double whammy - 140%)" },
        },
        "LAP": {
            "Salaried": { ...baseParams.LAP_COMMON, "lap_min_loan": "1000000", "lap_max_tenure": "180 Months", "age_maturity_income": "60", "lap_dbr_foir": "<75k -60%, >75k - 70%" },
            "Net Profit Method": { ...baseParams.LAP_COMMON, "lap_min_loan": "1000000", "lap_max_tenure": "180 Months", "age_maturity_income": "70 - in income >1 lacs, 60 if income < 1 lacs", "lap_dbr_foir": "Max 100% (Double whammy - 140%)", "npm_depreciation_fraction": "66.67%" },
            "Banking": { ...baseParams.LAP_COMMON, "lap_min_loan": "1000000", "lap_max_tenure": "180 Months", "age_maturity_income": "75", "lap_dbr_foir": "No DBR", "banking_abb_multiplier": "2" },
            "GST": { ...baseParams.LAP_COMMON, "lap_min_loan": "1000000", "lap_max_tenure": "180 Months", "age_maturity_income": "75", "lap_dbr_foir": "Max 100% (Double whammy - 140%)", "gst_industry_margin": "10%" },
            "GRP": { ...baseParams.LAP_COMMON, "lap_min_loan": "1000000", "lap_max_tenure": "180 Months", "age_maturity_income": "75", "lap_dbr_foir": "No DBR", "grp_annual_receipts_multiplier": "4" },
            "Net Worth Method": { ...baseParams.LAP_COMMON, "lap_min_loan": "1000000", "lap_max_tenure": "180 Months", "age_maturity_income": "75", "lap_dbr_foir": "Max 100% (Double whammy - 140%)" },
        }
    };
}

const COMMON_PARAMS = {
    HL_COMMON: {
        "hl_max_loan": "No Capping",
        "hl_roi_min": "7.60%",
        "hl_roi_max": "8.35%",
        "hl_pf_min": "0.50%",
        "hl_pf_max": "1%",
        "age_maturity_non_income": "75",
        "bureau_cutoff": "700",
        "hl_ltv_upto_30": "90%",
        "hl_ltv_30_75": "80%",
        "hl_ltv_above_75": "75%",
        "hl_ltv_commercial": "75%",
        "hl_ltv_industrial": "40%",
        "hl_ltv_plot": "75%"
    },
    LAP_COMMON: {
        "lap_max_loan": "No Capping",
        "lap_roi_min": "8.25%",
        "lap_roi_max": "8.5%",
        "lap_pf_min": "0.50%",
        "lap_pf_max": "1%",
        "age_maturity_non_income": "75",
        "bureau_cutoff": "700",
        "lap_ltv_res_self": "70%",
        "lap_ltv_res_rented": "70%",
        "lap_ltv_res_vacant": "70%",
        "lap_ltv_com_self": "70%",
        "lap_ltv_com_rented": "70%",
        "lap_ltv_com_vacant": "70%",
        "lap_ltv_ind_self": "40%",
        "lap_ltv_ind_rented": "40%",
        "lap_ltv_ind_vacant": "---", // Trigger manual review
        "lap_ltv_mix_self": "70%",
        "lap_ltv_mix_rented": "70%",
        "lap_ltv_mix_vacant": "70%",
        "lap_ltv_plot_self": "40%",
        "lap_ltv_plot_rented": "40%",
        "lap_ltv_plot_vacant": "40%",
        "lap_ltv_special": "50%"
    }
};

const ICICI_EXCEL_MAPPING = buildMapping(COMMON_PARAMS);

async function run() {
    const isApply = process.argv.includes('--apply');
    console.log(`\n=== ICICI LENDER PARAMETER UPDATE SCRIPT [${isApply ? 'APPLY MODE' : 'DRY RUN'}] ===\n`);

    // Parse arguments
    let targetUserId = 1; // Default
    let targetLenderId = null;

    process.argv.forEach(arg => {
        if (arg.startsWith('--user-id=')) {
            targetUserId = parseInt(arg.split('=')[1], 10);
        }
        if (arg.startsWith('--lender-id=')) {
            targetLenderId = arg.split('=')[1];
        }
    });

    const stats = { total_checked: 0, total_planned: 0, total_updated: 0, total_skipped: 0, total_failed: 0 };
    const unmatchedSchemes = new Set();
    const unmatchedParameters = new Set();
    const manualReviewRequired = [];

    // 1. Fetch Target Lender Safely
    let lender;
    if (targetLenderId) {
        lender = await prisma.lender.findUnique({ where: { id: targetLenderId } });
        if (!lender) {
            console.error(`Failed to find lender with ID: ${targetLenderId}`);
            process.exit(1);
        }
    } else {
        const matches = await prisma.lender.findMany({ where: { name: { contains: 'ICICI', mode: 'insensitive' } } });
        if (matches.length === 0) {
            console.error("Failed to find any ICICI lender.");
            process.exit(1);
        }
        if (matches.length > 1) {
            console.error("Found multiple matching lenders. Please specify --lender-id=...");
            matches.forEach(m => console.error(` - ${m.id} : ${m.name}`));
            process.exit(1);
        }
        lender = matches[0];
    }
    
    console.log(`Found Lender: ${lender.name} (ID: ${lender.id})`);

    // 2. Fetch HL and LAP Products
    const hlProduct = await prisma.lenderProduct.findFirst({ where: { lender_id: lender.id, product_type: 'HL' } });
    const lapProduct = await prisma.lenderProduct.findFirst({ where: { lender_id: lender.id, product_type: 'LAP' } });

    const products = [];
    if (hlProduct) products.push({ product: hlProduct, mapping: ICICI_EXCEL_MAPPING['HL'] });
    if (lapProduct) products.push({ product: lapProduct, mapping: ICICI_EXCEL_MAPPING['LAP'] });

    // 3. Fetch Parameter Master mapping
    const parameters = await prisma.parameterMaster.findMany();
    const paramKeyToId = {};
    parameters.forEach(p => { paramKeyToId[p.parameter_key] = p.id; });

    let dbOps = [];

    for (const { product, mapping } of products) {
        console.log(`\n--- Processing Product: ${product.product_type} ---`);
        const schemes = await prisma.scheme.findMany({ where: { product_id: product.id } });

        for (const scheme of schemes) {
            const mappedSchemeValues = mapping[scheme.scheme_name];
            if (!mappedSchemeValues) {
                unmatchedSchemes.add(`${product.product_type} - ${scheme.scheme_name}`);
                continue;
            }

            // Fetch existing values for scheme
            const existingValues = await prisma.schemeParameterValue.findMany({
                where: { scheme_id: scheme.id },
                include: { parameter: true }
            });
            const existingParamMap = {};
            existingValues.forEach(ev => existingParamMap[ev.parameter_id] = ev);

            for (const [pKey, rawStr] of Object.entries(mappedSchemeValues)) {
                stats.total_checked++;
                const paramId = paramKeyToId[pKey];
                
                if (!paramId) {
                    unmatchedParameters.add(pKey);
                    stats.total_skipped++;
                    continue;
                }

                // Call normalizeParameter
                let normalizedPayload;
                try {
                    normalizedPayload = normalizeParameter(pKey, rawStr);
                } catch(e) {
                    normalizedPayload = { type: 'unsupported_rule', error: e.message };
                }

                const isCrit = isCriticalParameter(pKey);
                const isFail = normalizedPayload.type === 'unsupported_rule' || normalizedPayload.error || (normalizedPayload.normalized === null && normalizedPayload.type !== 'no_cap');

                if (isCrit && isFail) {
                    manualReviewRequired.push({ product: product.product_type, scheme: scheme.scheme_name, param: pKey, value: rawStr, error: normalizedPayload.error });
                    stats.total_failed++;
                    continue;
                }

                const existingVal = existingParamMap[paramId];
                stats.total_planned++;

                if (!isApply) {
                    console.log(`[DRY RUN] ${product.product_type} > ${scheme.scheme_name} > ${pKey}`);
                    console.log(`  - Old Value:  ${existingVal ? JSON.stringify(existingVal.value) : 'None'}`);
                    console.log(`  - New Raw:    ${rawStr}`);
                    console.log(`  - Normalized: ${JSON.stringify(normalizedPayload)}`);
                    console.log(`  - Action:     Would Update\n`);
                } else {
                    // Queue for transaction
                    dbOps.push(prisma.schemeParameterValue.upsert({
                        where: { scheme_id_parameter_id: { scheme_id: scheme.id, parameter_id: paramId } },
                        update: { value: normalizedPayload, updated_by: targetUserId },
                        create: { scheme_id: scheme.id, parameter_id: paramId, value: normalizedPayload, created_by: targetUserId, updated_by: targetUserId }
                    }));
                }
            }
        }
    }

    if (isApply && dbOps.length > 0) {
        console.log(`\nExecuting ${dbOps.length} updates in transaction...`);
        await prisma.$transaction(dbOps);
        stats.total_updated = dbOps.length;
        console.log("DB Update Complete.");
    }

    console.log("\n================ SUMMARY ================");
    console.log(`Total Cells Checked:    ${stats.total_checked}`);
    console.log(`Total Planned Updates:  ${stats.total_planned}`);
    console.log(`Total Applied Updates:  ${stats.total_updated}`);
    console.log(`Total Skipped:          ${stats.total_skipped}`);
    console.log(`Total Failed (Review):  ${stats.total_failed}`);
    
    if (unmatchedSchemes.size > 0) {
        console.log("\nUnmatched Schemes (Skipped):");
        [...unmatchedSchemes].forEach(s => console.log(`  - ${s}`));
    }
    
    if (unmatchedParameters.size > 0) {
        console.log("\nUnmatched Parameters (Skipped):");
        [...unmatchedParameters].forEach(p => console.log(`  - ${p}`));
    }

    if (manualReviewRequired.length > 0) {
        console.log("\nMANUAL REVIEW REQUIRED (Failed Validation):");
        manualReviewRequired.forEach(r => console.log(`  - ${r.product} | ${r.scheme} | ${r.param} : "${r.value}" -> ${r.error}`));
    }

    process.exit(0);
}

run().catch(e => {
    console.error(e);
    process.exit(1);
});
