const prisma = require('../../config/db');
const { executePaidApi } = require('../services/wallet.service');
const panService = require('../services/externalApis/pan.service');

exports.fetchPanIntelligence = async (req, res) => {
    try {
        const { customer_id, case_id, consentMethod, pan } = req.body;
        const tenantId = req.user.tenant_id;
        const userId = req.user.id;

        if (!pan) {
            return res.status(400).json({ error: 'PAN is required' });
        }
        if (!customer_id) {
            return res.status(400).json({ error: 'Customer ID is required' });
        }

        const customer = await prisma.customer.findUnique({
            where: { id: customer_id }
        });

        if (!customer || customer.tenant_id !== tenantId) {
            return res.status(403).json({ error: 'Access denied to this customer' });
        }

        await prisma.customerConsent.create({
            data: {
                customer_id,
                case_id: case_id || null,
                consent_type: 'PAN',
                consent_source: consentMethod === 'LINK_SENT' ? 'LINK_SENT' : 'DIRECT_LOGIN',
                status: 'GRANTED',
                granted_at: new Date()
            }
        });

        const idempotencyKey = `${customer_id}_${pan}`;
        
        // Native Idempotency Check first
        const existingProfile = await prisma.customerPanProfile.findUnique({ where: { pan }});
        if (existingProfile) {
            const records = await prisma.customerPanGstinRecord.findMany({ where: { pan_profile_id: existingProfile.id } });
            return res.json({
                status: "SUCCESS",
                gstin: existingProfile.gstin,
                constitution_of_business: existingProfile.constitution_of_business,
                director_names: existingProfile.director_names,
                turnover_range: existingProfile.annual_turnover_range,
                gst_records: records, 
                raw_response: existingProfile.raw_response
            });
        }

        // Clear past FAILED logs for this exact idempotency key so users aren't permanently locked out from retrying after a bad provider API request
        await prisma.apiUsageLog.deleteMany({
            where: {
                tenant_id: tenantId,
                api_code: 'PAN_FETCH',
                idempotency_key: idempotencyKey,
                status: 'FAILED'
            }
        });

        const requestPayload = { customer_id, case_id, pan };

        const result = await executePaidApi({
            apiCode: 'PAN_FETCH',
            tenantId,
            userId,
            customerId: customer_id,
            caseId: case_id || null,
            requestPayload,
            idempotencyKey,
            userRole: req.user.role,
            handlerFunction: async () => {
                const apiResponse = await panService.fetchPanIntelligence(pan);
                
                const gstin = apiResponse.gstin || null;
                const turnOverRange = apiResponse.aggregateTurnOverRange || {};
                const turnoverMin = turnOverRange.minimum || null;
                const turnoverMax = turnOverRange.maximum || null;
                const annualTurnoverStr = apiResponse.annualAggregateTurnOver || null;
                const grossTotalIncome = apiResponse.grossTotalIncome || null;
                const grossIncomeYr = apiResponse.grossTotalIncomeFinancialYear || null;

                const detailed = apiResponse.gstnDetailed || [];
                const primaryGst = detailed[0] || {};
                
                const constitutionOfBusiness = primaryGst.constitutionOfBusiness || null;
                const legalName = primaryGst.legalNameOfBusiness || null;
                const tradeName = primaryGst.tradeNameOfBusiness || null;
                const principalState = primaryGst.principalPlaceState || null;
                const principalCity = primaryGst.principalPlaceCity || null;
                const principalPincode = primaryGst.principalPlacePincode || null;
                const principalAddress = primaryGst.principalPlaceAddress || null;
                const directorNames = primaryGst.directorNames || [];
                
                // Handle potential prior existing pan records in DB safely using upsert to avoid UniqueConstraint break on `pan` string
                const profile = await prisma.customerPanProfile.upsert({
                    where: { pan: pan },
                    update: {
                        gstin,
                        constitution_of_business: constitutionOfBusiness,
                        legal_name: legalName,
                        trade_name: tradeName,
                        principal_state: principalState,
                        principal_city: principalCity,
                        principal_pincode: principalPincode,
                        principal_address: principalAddress,
                        director_names: directorNames.length ? directorNames : null,
                        annual_turnover_range: annualTurnoverStr,
                        turnover_min: turnoverMin,
                        turnover_max: turnoverMax,
                        gross_total_income: grossTotalIncome,
                        income_financial_year: grossIncomeYr,
                        raw_response: apiResponse
                    },
                    create: {
                        customer_id,
                        pan,
                        gstin,
                        constitution_of_business: constitutionOfBusiness,
                        legal_name: legalName,
                        trade_name: tradeName,
                        principal_state: principalState,
                        principal_city: principalCity,
                        principal_pincode: principalPincode,
                        principal_address: principalAddress,
                        director_names: directorNames.length ? directorNames : null,
                        annual_turnover_range: annualTurnoverStr,
                        turnover_min: turnoverMin,
                        turnover_max: turnoverMax,
                        gross_total_income: grossTotalIncome,
                        income_financial_year: grossIncomeYr,
                        raw_response: apiResponse
                    }
                });
                console.log(`[PAN] CustomerPanProfile saved with ID: ${profile.id}`);

                // --- Legacy Compatibility: Save Primary GST Profile ---
                if (gstin) {
                    try {
                        console.log(`[PAN] Syncing legacy GST Profile for ${gstin}...`);
                        const existingGst = await prisma.customerGSTProfile.findFirst({
                            where: { gstin: gstin, customer_id: customer_id }
                        });

                        const gstData = {
                            customer_id,
                            gstin: gstin,
                            filing_status: primaryGst.applicationStatus || 'Active',
                            last_filed_period: 'NA',
                            annual_turnover: turnoverMax || 0,
                            raw_response: primaryGst
                        };

                        if (existingGst) {
                            await prisma.customerGSTProfile.update({
                                where: { id: existingGst.id },
                                data: gstData
                            });
                        } else {
                            await prisma.customerGSTProfile.create({
                                data: gstData
                            });
                        }
                        console.log(`[PAN] Legacy GST Profile synced for ${gstin}`);
                    } catch (gstErr) {
                        console.error('[PAN] Failed to sync legacy GST Profile:', gstErr.message);
                    }
                }

                // --- Robust GSTIN Extraction & Storage ---
                let gstRecordsMap = {};

                // 1. Process gstnRecords (basic list)
                if (apiResponse.gstnRecords && Array.isArray(apiResponse.gstnRecords)) {
                    for (const r of apiResponse.gstnRecords) {
                        if (!r.gstin) continue;
                        gstRecordsMap[r.gstin] = {
                            gstin: r.gstin,
                            registration_name: r.registrationName || null,
                            status: r.applicationStatus || null
                        };
                    }
                }

                // 2. Process gstnDetailed (rich list) and merge/enrich
                if (apiResponse.gstnDetailed && Array.isArray(apiResponse.gstnDetailed)) {
                    for (const d of apiResponse.gstnDetailed) {
                        if (!d.gstin) continue;
                        const existing = gstRecordsMap[d.gstin] || {};
                        gstRecordsMap[d.gstin] = {
                            gstin: d.gstin,
                            registration_name: d.legalNameOfBusiness || existing.registration_name || null,
                            status: d.gstinStatus || existing.status || null
                        };
                    }
                }

                const recordInserts = Object.values(gstRecordsMap).map(r => ({
                    pan_profile_id: profile.id,
                    gstin: r.gstin,
                    registration_name: r.registration_name,
                    status: r.status
                }));

                // Clear previously nested ones if re-running
                await prisma.customerPanGstinRecord.deleteMany({ where: { pan_profile_id: profile.id } });
                
                if (recordInserts.length > 0) {
                    await prisma.customerPanGstinRecord.createMany({
                        data: recordInserts
                    });
                }
                let gstRecords = recordInserts;
                
                // Apply Precedence Rule: GST trade name > GST legal name > PAN verification > MANUAL
                let selectedGst = primaryGst;
                if (req.body.selected_gstin) {
                    selectedGst = detailed.find(d => d.gstin === req.body.selected_gstin) || primaryGst;
                }
                const resolvedTradeName = selectedGst?.tradeNameOfBusiness || null;
                const resolvedLegalName = selectedGst?.legalNameOfBusiness || null;
                const resolvedBusinessName = resolvedTradeName || resolvedLegalName;
                const source = resolvedTradeName ? 'GST_TRADE_NAME' : (resolvedLegalName ? 'GST_LEGAL_NAME' : 'PAN_VERIFICATION');

                await prisma.customer.update({
                    where: { id: customer_id },
                    data: {
                        legal_business_name: resolvedLegalName || customer.legal_business_name,
                        trade_name: resolvedTradeName || customer.trade_name,
                        business_name: resolvedBusinessName || customer.business_name,
                        business_name_source: resolvedBusinessName ? source : customer.business_name_source,
                        entity_type: constitutionOfBusiness || customer.entity_type
                    }
                });

                // Harden: Sync Case snapshots
                const { syncCustomerSnapshots } = require('../services/case.service');
                syncCustomerSnapshots(customer_id, tenantId).catch(err => console.error('Snapshot sync failed:', err));

                return {
                   apiResponse, 
                   gstRecords,
                   normalized: {
                       status: "SUCCESS",
                       gstin,
                       constitution_of_business: constitutionOfBusiness,
                       director_names: directorNames,
                       turnover_range: annualTurnoverStr,
                       gst_records: gstRecords,
                       raw_response: apiResponse
                   }
                };
            }
        });

        if (case_id) {
            await prisma.caseDataPullStatus.upsert({
                where: { case_id },
                update: { pan_status: 'COMPLETE' },
                create: { case_id, pan_status: 'COMPLETE' }
            });
        }

        if (result && result.normalized) {
            return res.json(result.normalized);
        } else {
            // Idempotency cache-hit fallback reconstruct logic from db
            const profile = await prisma.customerPanProfile.findUnique({ where: { pan }});
            if (profile) {
                const records = await prisma.customerPanGstinRecord.findMany({ where: { pan_profile_id: profile.id } });
                return res.json({
                    status: "SUCCESS",
                    gstin: profile.gstin,
                    constitution_of_business: profile.constitution_of_business,
                    director_names: profile.director_names,
                    turnover_range: profile.annual_turnover_range,
                    gst_records: records, 
                    raw_response: profile.raw_response
                });
            } else {
                return res.status(200).json({ status: "SUCCESS", cached: true });
            }
        }

    } catch (error) {
        console.error('PAN Fetch error:', error);
        const statusCode = error.status === 401 ? 502 : (error.status || 500);
        res.status(statusCode).json({
            status: "FAILED",
            error_message: error.message
        });
    }
};

const signzyService = require('../services/externalApis/signzy.service');

exports.verifyPan = async (req, res) => {
    try {
        const { pan, customer_id, case_id, is_coapplicant, applicant_id } = req.body;
        const tenantId = req.user.tenant_id;
        const userId = req.user.id;

        if (!pan) return res.status(400).json({ error: 'PAN is required' });
        if (!customer_id) return res.status(400).json({ error: 'Customer ID is required' });
        if (!case_id) return res.status(400).json({ error: 'Case ID is required' });

        const customer = await prisma.customer.findUnique({ where: { id: customer_id } });
        if (!customer || customer.tenant_id !== tenantId) {
            return res.status(403).json({ error: 'Access denied to this customer' });
        }

        // Security check and lock check for co-applicant
        if (is_coapplicant && applicant_id) {
            const applicant = await prisma.applicant.findUnique({
                where: { id: parseInt(applicant_id, 10) },
                include: { case: true }
            });
            if (!applicant || applicant.case_id !== parseInt(case_id, 10) || applicant.case.tenant_id !== tenantId) {
                return res.status(403).json({ error: 'Access denied to this applicant' });
            }
            if (applicant.pan_verified) {
                return res.status(400).json({ error: 'PAN is already verified for this applicant and cannot be modified.' });
            }
        } else {
            // Security check and lock check for primary applicant
            const primaryApp = await prisma.applicant.findFirst({
                where: { case_id: parseInt(case_id, 10), type: 'PRIMARY' }
            });
            if (primaryApp && primaryApp.pan_verified) {
                return res.status(400).json({ error: 'PAN is already verified for this customer and cannot be modified.' });
            }
        }

        const idempotencyKey = `SIGNZY_PAN_${customer_id}_${pan}`;
        
        // Execute paid API wrapper using PAN_FETCH billing bucket for now
        const result = await executePaidApi({
            apiCode: 'PAN_FETCH',
            tenantId,
            userId,
            customerId: customer_id,
            caseId: case_id || null,
            requestPayload: { customer_id, pan },
            idempotencyKey,
            userRole: req.user.role,
            handlerFunction: async () => {
                const apiResponse = await signzyService.verifyPanSimple(pan);
                
                return {
                   status: "SUCCESS",
                   name: apiResponse.name,
                   dob: apiResponse.dob,
                   panStatus: apiResponse.panStatus,
                   rawResponse: apiResponse.rawResponse
                };
            }
        });

        // Apply DB Updates (runs whether fresh or cached)
        if (is_coapplicant && applicant_id) {
            await prisma.applicant.update({
                where: { id: parseInt(applicant_id, 10) },
                data: {
                    name: result.name,
                    dob: result.dob,
                    pan_verified: true,
                    pan_verified_at: new Date(),
                    pan_verification_status: 'SUCCESS',
                    pan_verification_reference: result.panStatus || null,
                    pan_verified_name: result.name,
                    pan_verified_dob: result.dob,
                    pan_verification_response: result.rawResponse || null,
                    pan_verified_by_user_id: userId
                }
            });
        } else {
            const primaryApp = await prisma.applicant.findFirst({
                where: { case_id: parseInt(case_id, 10), type: 'PRIMARY' }
            });
            if (primaryApp) {
                await prisma.applicant.update({
                    where: { id: primaryApp.id },
                    data: {
                        pan_verified: true,
                        pan_verified_at: new Date(),
                        pan_verification_status: 'SUCCESS',
                        pan_verification_reference: result.panStatus || null,
                        pan_verified_name: result.name,
                        pan_verified_dob: result.dob,
                        pan_verification_response: result.rawResponse || null,
                        pan_verified_by_user_id: userId
                    }
                });
            }

            // Precedence: Only update customer business name if no GST name is set
            const resolvedBusinessName = customer.legal_business_name || customer.trade_name;
            await prisma.customer.update({
                where: { id: customer_id },
                data: {
                    business_name: resolvedBusinessName || result.name || customer.business_name,
                    business_name_source: resolvedBusinessName ? customer.business_name_source : 'PAN_VERIFICATION',
                    pan_holder_name: result.name || customer.pan_holder_name,
                    proprietor_name: result.name || customer.proprietor_name,
                    dob: result.dob || customer.dob
                }
            });

            // Sync Case snapshot
            const { syncCustomerSnapshots } = require('../services/case.service');
            syncCustomerSnapshots(customer_id, tenantId).catch(err => console.error('Snapshot sync failed:', err));
        }

        res.json(result);
    } catch (error) {
        console.error('PAN Verify error:', error);
        res.status(500).json({ status: "FAILED", error_message: error.message });
    }
};

exports.resetPan = async (req, res) => {
    try {
        const { applicant_id, case_id } = req.body;
        const tenantId = req.user.tenant_id;
        const userRole = req.user.role;
        const userId = req.user.id;

        if (userRole !== 'DSA_ADMIN' && userRole !== 'SUPER_ADMIN') {
            return res.status(403).json({ error: 'Unauthorized to reset PAN verification. Only admins can reset.' });
        }

        if (!applicant_id) {
            return res.status(400).json({ error: 'Applicant ID is required.' });
        }

        const applicant = await prisma.applicant.findUnique({
            where: { id: parseInt(applicant_id, 10) },
            include: { case: true }
        });

        if (!applicant || applicant.case_id !== parseInt(case_id, 10) || applicant.case.tenant_id !== tenantId) {
            return res.status(403).json({ error: 'Access denied to this applicant.' });
        }

        // Auditing reset in ActivityLog
        await prisma.activityLog.create({
            data: {
                case_id: parseInt(case_id, 10),
                customer_id: applicant.case.customer_id,
                activity_type: 'PAN_RESET',
                description: `PAN verification reset for applicant ${applicant.name || 'Unnamed'} (PAN: ${applicant.pan_number || 'N/A'}) by User #${userId}`,
                performed_by_user_id: userId
            }
        });

        // Reset applicant PAN verification columns
        const updatedApplicant = await prisma.applicant.update({
            where: { id: applicant.id },
            data: {
                pan_verified: false,
                pan_verified_at: null,
                pan_verification_status: null,
                pan_verification_reference: null,
                pan_verified_name: null,
                pan_verified_dob: null,
                pan_verification_response: null,
                name: null,
                dob: null
            }
        });

        // If primary applicant was reset, also update Customer table
        if (applicant.type === 'PRIMARY') {
            await prisma.customer.update({
                where: { id: applicant.case.customer_id },
                data: {
                    business_name: null,
                    business_name_source: null,
                    pan_holder_name: null,
                    proprietor_name: null,
                    dob: null
                }
            });
        }

        res.json({ success: true, applicant: updatedApplicant });
    } catch (error) {
        console.error('PAN Reset error:', error);
        res.status(500).json({ error: 'Failed to reset PAN verification' });
    }
};
