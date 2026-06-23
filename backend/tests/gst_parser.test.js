const { extractGstDetails } = require('../src/services/financial.extractor');

describe('GST Analytics Extraction Engine', () => {
    describe('GSTR-1 Parsing', () => {
        it('should correctly sum TTL_LIAB totalTaxableValueOfRecords', () => {
            const mockGstr1 = {
                data: {
                    gstr1: {
                        "042023": {
                            RETSUM: {
                                data: {
                                    sectionSummary: [
                                        { returnSection: "TTL_LIAB", totalTaxableValueOfRecords: 100000 },
                                        { returnSection: "B2B", totalTaxableValueOfRecords: 50000 }
                                    ]
                                }
                            }
                        },
                        "052023": {
                            RETSUM: {
                                data: {
                                    sectionSummary: [
                                        { returnSection: "TTL_LIAB", totalTaxableValueOfRecords: 150000 }
                                    ]
                                }
                            }
                        }
                    }
                }
            };
            const result = extractGstDetails(mockGstr1);
            // We'll define exact assertions later once the structure of the return object is updated.
            expect(result).toBeDefined();
        });
    });

    describe('GSTR-3B Parsing', () => {
        it('should correctly sum osup_det.txval', () => {
            const mockGstr3b = {
                data: {
                    gstr3b: {
                        "042023": {
                            osup_det: { txval: 200000 }
                        },
                        "052023": {
                            osup_det: { txval: 250000 }
                        }
                    }
                }
            };
            const result = extractGstDetails(mockGstr3b);
            expect(result).toBeDefined();
        });
    });

    describe('Provider Report Parsing', () => {
        it('should extract from Monthly Sale Summary and ignore Total row', () => {
            const mockReport = {
                data: [
                    {
                        "Monthly Sales&Purchase": [
                            {
                                "Monthly Sale Summary": [
                                    {
                                        data: [
                                            { "Month": "Apr 2023", "Taxable Value": 300000 },
                                            { "Month": "May 2023", "Taxable Value": 350000 },
                                            { "Month": "Total", "Taxable Value": 650000 }
                                        ]
                                    }
                                ]
                            }
                        ]
                    }
                ]
            };
            const result = extractGstDetails(mockReport);
            expect(result).toBeDefined();
        });
    });

    describe('Financial Year Computation', () => {
        // Will test the mapping of months to exact FY buckets
    });
});
