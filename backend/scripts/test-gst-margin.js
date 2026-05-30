const assert = require('assert');

function resolveGstIndustryMargin(industryType) {
    const text = String(industryType || '').toLowerCase();

    if (text.includes('manufactur') || text.includes('factory')) return 0.07;
    if (text.includes('retail')) return 0.05;
    if (text.includes('wholesale')) return 0.04;
    if (text.includes('service') || text.includes('supplier of service')) return 0.15;

    return 0.10; // fallback only when industry cannot be identified
}

try {
    assert.strictEqual(resolveGstIndustryMargin('Manufacturing of Goods'), 0.07, 'Manufacturing should be 0.07');
    assert.strictEqual(resolveGstIndustryMargin('Factory unit'), 0.07, 'Factory should be 0.07');
    assert.strictEqual(resolveGstIndustryMargin('Retail trader'), 0.05, 'Retail should be 0.05');
    assert.strictEqual(resolveGstIndustryMargin('Wholesale business'), 0.04, 'Wholesale should be 0.04');
    assert.strictEqual(resolveGstIndustryMargin('Supplier of service'), 0.15, 'Service should be 0.15');
    assert.strictEqual(resolveGstIndustryMargin('IT Service provider'), 0.15, 'Service should be 0.15');
    assert.strictEqual(resolveGstIndustryMargin('Unknown Business'), 0.10, 'Unknown should fallback to 0.10');
    assert.strictEqual(resolveGstIndustryMargin(null), 0.10, 'Null should fallback to 0.10');
    
    // Testing the mock combination of parsing output
    assert.strictEqual(resolveGstIndustryMargin('Retail Business | Partnership'), 0.05, 'Combined retail should be 0.05');

    console.log('All GST margin resolver tests passed! ✅');
} catch (e) {
    console.error('Test Failed:', e.message);
    process.exit(1);
}
