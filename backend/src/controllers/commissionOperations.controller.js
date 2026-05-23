const prisma = require('../../config/db');

/**
 * Helper to get Month Year string from Date (e.g., "March 2026")
 */
function getMonthYearString(date) {
    return date.toLocaleString('default', { month: 'long', year: 'numeric' });
}

/**
 * Helper to get period label based on a reference date
 */
function getPeriodLabel(date, referenceDate) {
    const dYear = date.getFullYear();
    const dMonth = date.getMonth();
    
    const refYear = referenceDate.getFullYear();
    const refMonth = referenceDate.getMonth();
    
    if (dYear === refYear && dMonth === refMonth) return 'Current Month';
    
    let prevYear = refYear;
    let prevMonth = refMonth - 1;
    if (prevMonth < 0) {
        prevMonth = 11;
        prevYear -= 1;
    }
    
    if (dYear === prevYear && dMonth === prevMonth) return 'Previous Month';
    
    return 'Older';
}

exports.getSalesIncentives = async (req, res) => {
    try {
        const { tenant_id, hierarchy_path } = req.user;
        const { month, team_member_id, product_type, search } = req.query;

        // 1. Base visibility where clause
        const baseWhere = {
            tenant_id,
            case_entity: {
                created_by: {
                    hierarchy_path: { startsWith: hierarchy_path }
                }
            }
        };

        // 2. Fetch all raw ledgers for this user's visibility
        // We fetch everything to compute summary and extract available dropdown options.
        // For very large datasets this might need pagination, but for Phase 1 it's correct.
        const allLedgers = await prisma.commissionLedger.findMany({
            where: baseWhere,
            include: {
                case_entity: {
                    include: {
                        created_by: true,
                        customer: true
                    }
                },
                disbursement: true
            },
            orderBy: { created_at: 'desc' }
        });

        // 3. Extract dynamic available months and team members
        const availableMonthsSet = new Set();
        const availableMembersMap = new Map();
        
        allLedgers.forEach(ledger => {
            availableMonthsSet.add(getMonthYearString(ledger.created_at));
            if (ledger.case_entity?.created_by) {
                const creator = ledger.case_entity.created_by;
                availableMembersMap.set(creator.id, creator.name);
            }
        });

        const availableMonths = Array.from(availableMonthsSet);
        // If no records, fallback to current month
        if (availableMonths.length === 0) {
            availableMonths.push(getMonthYearString(new Date()));
        }

        const availableTeamMembers = Array.from(availableMembersMap.entries()).map(([id, name]) => ({ id, name }));

        // 4. Determine Reference Month for filtering/summary
        const selectedMonthStr = month || availableMonths[0];
        // Parse the selected month back to a date for relative comparison
        const referenceDate = new Date(selectedMonthStr + " 1"); // e.g., "March 2026 1"

        // 5. Apply explicit filters to the dataset for the list view
        let filteredLedgers = allLedgers;

        if (month) {
            filteredLedgers = filteredLedgers.filter(l => getMonthYearString(l.created_at) === month);
        } else {
            // Default to most recent available month if none specified
            filteredLedgers = filteredLedgers.filter(l => getMonthYearString(l.created_at) === availableMonths[0]);
        }

        if (team_member_id && team_member_id !== 'all') {
            filteredLedgers = filteredLedgers.filter(l => l.case_entity?.created_by_user_id === parseInt(team_member_id));
        }

        if (product_type && product_type !== 'all') {
            filteredLedgers = filteredLedgers.filter(l => l.product_type === product_type);
        }

        if (search) {
            const lowerSearch = search.toLowerCase();
            filteredLedgers = filteredLedgers.filter(l => {
                const caseIdStr = `CASE-${l.case_id}`.toLowerCase();
                const custName = (l.case_entity?.customer?.business_name || '').toLowerCase();
                return caseIdStr.includes(lowerSearch) || custName.includes(lowerSearch);
            });
        }

        // 6. Compute Summary Table Data (Relative to referenceDate, but using ALL ledgers regardless of team/product filter to show overall business health, or filtered? Usually summary is filtered. Let's use filteredLedgers to make filters affect summary).
        // Actually, if they select "March 2026", Current Month is March, Previous is Feb, but filteredLedgers only contains March. 
        // We should compute summary over `allLedgers` applying team/product/search filters, but NOT the month filter.
        let summarySourceLedgers = allLedgers;
        if (team_member_id && team_member_id !== 'all') {
            summarySourceLedgers = summarySourceLedgers.filter(l => l.case_entity?.created_by_user_id === parseInt(team_member_id));
        }
        if (product_type && product_type !== 'all') {
            summarySourceLedgers = summarySourceLedgers.filter(l => l.product_type === product_type);
        }
        
        const summaryBuckets = {
            'Current Month': { cases: new Set(), volume: 0, eligible: 0, paid: 0, pending: 0 },
            'Previous Month': { cases: new Set(), volume: 0, eligible: 0, paid: 0, pending: 0 },
            'Older': { cases: new Set(), volume: 0, eligible: 0, paid: 0, pending: 0 }
        };

        summarySourceLedgers.forEach(l => {
            const period = getPeriodLabel(l.created_at, referenceDate);
            const bucket = summaryBuckets[period];
            
            bucket.cases.add(l.case_id);
            // Sum volume only once per disbursement. Since we group ledgers, let's just sum positive BASE_COMMISSION disbursement amounts
            if (l.entry_type === 'BASE_COMMISSION' && !l.is_reversed) {
                 bucket.volume += parseFloat(l.disbursed_amount || 0);
            }
            
            const comm = parseFloat(l.calculated_commission || 0);
            
            // Reversal entries are naturally negative, so summing them reduces the eligible pool
            if (l.status === 'PAID') {
                bucket.paid += comm;
            } else if (l.status === 'PENDING' || l.status === 'INVOICED') {
                bucket.pending += comm;
            }
            // All valid statuses contribute to eligible (except CANCELLED without value)
            if (l.status !== 'CANCELLED' || l.entry_type === 'REVERSAL') {
                bucket.eligible += comm;
            }
        });

        const summaryData = [
            { 
                period: 'Current Month', 
                cases: summaryBuckets['Current Month'].cases.size, 
                volume: summaryBuckets['Current Month'].volume,
                eligible: summaryBuckets['Current Month'].eligible,
                paid: summaryBuckets['Current Month'].paid,
                pending: summaryBuckets['Current Month'].pending
            },
            { 
                period: 'Previous Month', 
                cases: summaryBuckets['Previous Month'].cases.size, 
                volume: summaryBuckets['Previous Month'].volume,
                eligible: summaryBuckets['Previous Month'].eligible,
                paid: summaryBuckets['Previous Month'].paid,
                pending: summaryBuckets['Previous Month'].pending
            },
            { 
                period: 'Older', 
                cases: summaryBuckets['Older'].cases.size, 
                volume: summaryBuckets['Older'].volume,
                eligible: summaryBuckets['Older'].eligible,
                paid: summaryBuckets['Older'].paid,
                pending: summaryBuckets['Older'].pending
            }
        ];

        // 7. Group list data by Employee
        const employeesMap = new Map();

        filteredLedgers.forEach(l => {
            const creator = l.case_entity?.created_by;
            if (!creator) return;

            if (!employeesMap.has(creator.id)) {
                employeesMap.set(creator.id, {
                    id: creator.id,
                    name: creator.name,
                    hasPddPending: false, // We'll compute this if we include PDD tasks, mock as false for now unless we query PDD
                    metrics: { cases: new Set(), volume: 0, payout: 0 },
                    casesMap: new Map() // case_id -> case row
                });
            }

            const emp = employeesMap.get(creator.id);
            emp.metrics.cases.add(l.case_id);
            
            if (l.entry_type === 'BASE_COMMISSION' && !l.is_reversed) {
                 emp.metrics.volume += parseFloat(l.disbursed_amount || 0);
            }

            // Ensure case exists in map
            if (!emp.casesMap.has(l.case_id)) {
                emp.casesMap.set(l.case_id, {
                    id: l.case_id,
                    caseId: `CASE-${l.case_id}`,
                    customer: l.case_entity?.customer?.business_name || l.case_entity?.customer_name || 'Unknown',
                    product: l.product_type,
                    disbAmt: 0,
                    payout: 0,
                    subvention: null,
                    netPayable: 0,
                    status: l.status,
                    pddPending: false, // Future integration
                    ledgers: []
                });
            }

            const caseRow = emp.casesMap.get(l.case_id);
            caseRow.ledgers.push(l);
            
            const comm = parseFloat(l.calculated_commission || 0);
            emp.metrics.payout += comm;
            caseRow.netPayable += comm;
            caseRow.payout += comm;
            
            if (l.entry_type === 'BASE_COMMISSION' && !l.is_reversed) {
                 caseRow.disbAmt += parseFloat(l.disbursed_amount || 0);
            }
            
            // Priority status mapping (if any ledger is Draft/Pending, show it, etc)
            // Just use the latest status for now
            caseRow.status = l.status;
        });

        // Convert Map back to array
        const employeesData = Array.from(employeesMap.values()).map(emp => {
            return {
                id: emp.id,
                name: emp.name,
                hasPddPending: Array.from(emp.casesMap.values()).some(c => c.pddPending),
                metrics: {
                    cases: emp.metrics.cases.size,
                    volume: emp.metrics.volume,
                    payout: emp.metrics.payout
                },
                cases: Array.from(emp.casesMap.values())
            };
        });

        res.status(200).json({
            success: true,
            data: {
                summaryData,
                employeesData,
                availableMonths,
                availableTeamMembers
            }
        });

    } catch (error) {
        console.error('[Commission Operations] Error fetching sales incentives:', error);
        res.status(500).json({ error: 'Failed to fetch sales incentives' });
    }
};

// --- LENDER COMMISSION PROTOTYPE APIs ---

exports.getLenderCommissions = async (req, res) => {
    try {
        const { tenant_id } = req.user;
        const { month, lender_name, product_type, search } = req.query;

        const allLedgers = await prisma.commissionLedger.findMany({
            where: { tenant_id },
            include: { case_entity: { include: { customer: true } } },
            orderBy: { created_at: 'desc' }
        });

        const availableMonthsSet = new Set();
        const availableLendersSet = new Set();
        
        allLedgers.forEach(l => {
            availableMonthsSet.add(getMonthYearString(l.created_at));
            if (l.lender_name) availableLendersSet.add(l.lender_name);
        });

        // Add configured lenders for the tenant so dropdowns aren't empty if no ledgers exist
        const configuredLenders = await prisma.tenantLender.findMany({
            where: { tenant_id, is_active: true }
        });
        configuredLenders.forEach(l => {
            if (l.lender_name) availableLendersSet.add(l.lender_name);
        });

        const availableMonths = Array.from(availableMonthsSet);
        if (availableMonths.length === 0) availableMonths.push(getMonthYearString(new Date()));
        const availableLenders = Array.from(availableLendersSet);

        const selectedMonthStr = month || availableMonths[0];
        const referenceDate = new Date(selectedMonthStr + " 1");

        let filteredLedgers = allLedgers;
        if (month) filteredLedgers = filteredLedgers.filter(l => getMonthYearString(l.created_at) === month);
        else filteredLedgers = filteredLedgers.filter(l => getMonthYearString(l.created_at) === availableMonths[0]);

        if (lender_name && lender_name !== 'all') {
            filteredLedgers = filteredLedgers.filter(l => l.lender_name === lender_name);
        }
        if (product_type && product_type !== 'all') {
            filteredLedgers = filteredLedgers.filter(l => l.product_type === product_type);
        }
        if (search) {
            const lowerSearch = search.toLowerCase();
            filteredLedgers = filteredLedgers.filter(l => {
                const caseIdStr = `CASE-${l.case_id}`.toLowerCase();
                const custName = (l.case_entity?.customer?.business_name || '').toLowerCase();
                return caseIdStr.includes(lowerSearch) || custName.includes(lowerSearch);
            });
        }

        let summarySourceLedgers = allLedgers;
        if (lender_name && lender_name !== 'all') summarySourceLedgers = summarySourceLedgers.filter(l => l.lender_name === lender_name);
        if (product_type && product_type !== 'all') summarySourceLedgers = summarySourceLedgers.filter(l => l.product_type === product_type);
        
        const summaryBuckets = {
            'Current Month': { cases: new Set(), volume: 0, eligible: 0, paid: 0, pending: 0 },
            'Previous Month': { cases: new Set(), volume: 0, eligible: 0, paid: 0, pending: 0 },
            'Older': { cases: new Set(), volume: 0, eligible: 0, paid: 0, pending: 0 }
        };

        summarySourceLedgers.forEach(l => {
            const period = getPeriodLabel(l.created_at, referenceDate);
            const bucket = summaryBuckets[period];
            
            bucket.cases.add(l.case_id);
            if (l.entry_type === 'BASE_COMMISSION' && !l.is_reversed) bucket.volume += parseFloat(l.disbursed_amount || 0);
            const comm = parseFloat(l.calculated_commission || 0);
            
            if (l.status === 'PAID') bucket.paid += comm;
            else if (l.status === 'PENDING' || l.status === 'INVOICED') bucket.pending += comm;
            if (l.status !== 'CANCELLED' || l.entry_type === 'REVERSAL') bucket.eligible += comm;
        });

        const summaryData = ['Current Month', 'Previous Month', 'Older'].map(period => ({
            period,
            cases: summaryBuckets[period].cases.size,
            volume: summaryBuckets[period].volume,
            eligible: summaryBuckets[period].eligible,
            paid: summaryBuckets[period].paid,
            pending: summaryBuckets[period].pending
        }));

        const lendersMap = new Map();

        filteredLedgers.forEach(l => {
            const lName = l.lender_name || 'Unknown Lender';
            if (!lendersMap.has(lName)) {
                lendersMap.set(lName, {
                    lender_name: lName,
                    hasPddPending: false,
                    metrics: { cases: new Set(), volume: 0, gross_commission: 0, pending_amount: 0 },
                    casesMap: new Map()
                });
            }

            const lenderObj = lendersMap.get(lName);
            lenderObj.metrics.cases.add(l.case_id);
            if (l.entry_type === 'BASE_COMMISSION' && !l.is_reversed) lenderObj.metrics.volume += parseFloat(l.disbursed_amount || 0);
            
            const comm = parseFloat(l.calculated_commission || 0);
            lenderObj.metrics.gross_commission += comm;
            if (l.status === 'PENDING' || l.status === 'INVOICED') lenderObj.metrics.pending_amount += comm;

            if (!lenderObj.casesMap.has(l.case_id)) {
                lenderObj.casesMap.set(l.case_id, {
                    id: l.case_id,
                    caseId: `CASE-${l.case_id}`,
                    customer: l.case_entity?.customer?.business_name || 'Unknown',
                    product: l.product_type,
                    disbAmt: 0,
                    payout: 0,
                    subvention: 0,
                    netPayable: 0,
                    status: l.status,
                    pddPending: false,
                    ledgers: []
                });
            }

            const caseRow = lenderObj.casesMap.get(l.case_id);
            caseRow.ledgers.push(l);
            caseRow.netPayable += comm;
            caseRow.payout += comm;
            if (l.entry_type === 'BASE_COMMISSION' && !l.is_reversed) caseRow.disbAmt += parseFloat(l.disbursed_amount || 0);
            caseRow.status = l.status;
        });

        const lendersData = Array.from(lendersMap.values()).map(l => ({
            ...l,
            metrics: { ...l.metrics, cases: l.metrics.cases.size },
            cases: Array.from(l.casesMap.values())
        }));

        res.status(200).json({ 
            success: true, 
            data: { 
                summaryData, 
                lendersData, 
                availableMonths, 
                availableLenders,
                hasAnyRecords: allLedgers.length > 0
            } 
        });
    } catch (error) {
        console.error('[Commission Operations] Error fetching lender commissions:', error);
        res.status(500).json({ error: 'Failed to fetch lender commissions' });
    }
};

exports.getInvoiceCandidates = async (req, res) => {
    try {
        const { tenant_id } = req.user;
        const { month, lender_name, product_type } = req.query;

        const allPendingLedgers = await prisma.commissionLedger.findMany({
            where: { tenant_id, status: 'PENDING' },
            include: { case_entity: { include: { customer: true } } }
        });

        let candidates = allPendingLedgers;
        if (month) candidates = candidates.filter(l => getMonthYearString(l.created_at) === month);
        if (lender_name && lender_name !== 'all') candidates = candidates.filter(l => l.lender_name === lender_name);
        if (product_type && product_type !== 'all') candidates = candidates.filter(l => l.product_type === product_type);

        const casesMap = new Map();
        candidates.forEach(l => {
            if (!casesMap.has(l.case_id)) {
                casesMap.set(l.case_id, {
                    id: l.case_id,
                    ledger_ids: [],
                    caseId: `CASE-${l.case_id}`,
                    customer: l.case_entity?.customer?.business_name || 'Unknown',
                    disbAmt: 0,
                    payout: 0,
                    status: l.status
                });
            }
            const caseRow = casesMap.get(l.case_id);
            caseRow.ledger_ids.push(l.id);
            caseRow.payout += parseFloat(l.calculated_commission || 0);
            if (l.entry_type === 'BASE_COMMISSION' && !l.is_reversed) caseRow.disbAmt += parseFloat(l.disbursed_amount || 0);
        });

        res.status(200).json({ success: true, data: Array.from(casesMap.values()) });
    } catch (error) {
        console.error('[Commission Operations] Error fetching invoice candidates:', error);
        res.status(500).json({ error: 'Failed to fetch invoice candidates' });
    }
};

exports.previewInvoice = async (req, res) => {
    try {
        const { tenant_id } = req.user;
        const { ledger_ids, lender_name, month } = req.body;

        const ledgers = await prisma.commissionLedger.findMany({
            where: { tenant_id, id: { in: ledger_ids } },
            include: { case_entity: { include: { customer: true } } }
        });

        const tenant = await prisma.tenant.findUnique({ where: { id: tenant_id } });

        let subtotal = 0;
        const caseMap = new Map();

        ledgers.forEach(l => {
            subtotal += parseFloat(l.calculated_commission || 0);
            if (!caseMap.has(l.case_id)) {
                caseMap.set(l.case_id, {
                    caseId: `CASE-${l.case_id}`,
                    customer: l.case_entity?.customer?.business_name || 'Unknown',
                    product: l.product_type,
                    amount: 0
                });
            }
            caseMap.get(l.case_id).amount += parseFloat(l.calculated_commission || 0);
        });

        const gst = subtotal * 0.18;
        const total = subtotal + gst;

        res.status(200).json({
            success: true,
            data: {
                tenant: { name: tenant.name, pan: tenant.pan_number || 'N/A', gst: tenant.gst_number || 'N/A', state: tenant.state || 'N/A' },
                lender_name: lender_name || 'Selected Lender',
                month,
                invoice_number: `INV-${Date.now()}`,
                invoice_date: new Date().toISOString().split('T')[0],
                cases: Array.from(caseMap.values()),
                subtotal,
                gst,
                total
            }
        });
    } catch (error) {
        console.error('[Commission Operations] Error generating invoice preview:', error);
        res.status(500).json({ error: 'Failed to generate invoice preview' });
    }
};

exports.updateLedgerStatus = async (req, res) => {
    try {
        const { tenant_id } = req.user;
        const { ledgerId } = req.params;
        const { status, remarks } = req.body; // status must be PENDING, INVOICED, PAID, CANCELLED

        const ledger = await prisma.commissionLedger.findFirst({ where: { id: parseInt(ledgerId), tenant_id } });
        if (!ledger) return res.status(404).json({ error: 'Ledger entry not found' });

        const updated = await prisma.commissionLedger.update({
            where: { id: ledger.id },
            data: { status, remarks }
        });

        res.status(200).json({ success: true, data: updated });
    } catch (error) {
        console.error('[Commission Operations] Error updating ledger status:', error);
        res.status(500).json({ error: 'Failed to update ledger status' });
    }
};
