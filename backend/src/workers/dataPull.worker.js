const { PrismaClient } = require('@prisma/client');
const crypto = require('crypto');
const pollingConfig = require('../config/polling');
const pgPubSub = require('../services/pgPubSub.service');

// Import vendor services
const itrAnalyticsService = require('../services/externalApis/itrAnalytics.service');
const bankService = require('../services/externalApis/bank.service');
const gstService = require('../services/externalApis/gst.service');
const { determineNotificationRecipient } = require('../services/notification.service');

const prisma = new PrismaClient();

class DataPullWorker {
    constructor() {
        this.interval = null;
        this.isRunning = false;
        this.workerId = crypto.randomUUID();
    }

    start() {
        if (!pollingConfig.ENABLE_AUTOMATED_PULL_TRACKING) {
            console.log('[DataPullWorker] Automated pull tracking is disabled in config.');
            return;
        }
        console.log(`[DataPullWorker] Starting interval. Worker ID: ${this.workerId}`);
        
        // Start PgPubSub listener for safe measure
        pgPubSub.connect();

        this.interval = setInterval(() => {
            if (!this.isRunning) {
                this.processDueJobs();
            }
        }, pollingConfig.PULL_WORKER_INTERVAL_SECONDS * 1000);
    }

    stop() {
        if (this.interval) {
            clearInterval(this.interval);
            console.log('[DataPullWorker] Stopped.');
        }
    }

    async processDueJobs() {
        this.isRunning = true;
        // Watchdog: if a hung awaited call (vendor API, DB) never
        // resolves/rejects, the try/finally below never runs and isRunning
        // stays true forever, silently halting all future polling ticks with
        // no alert. This independently forces isRunning back to false after
        // one lease period so new ticks aren't permanently blocked, even
        // though the original hung call may still be running in the background.
        const watchdogMs = pollingConfig.PULL_JOB_LEASE_SECONDS * 1000;
        const watchdog = setTimeout(() => {
            console.error(`[DataPullWorker] WATCHDOG: processDueJobs exceeded ${watchdogMs}ms without completing — forcing isRunning=false so polling resumes.`);
            this.isRunning = false;
        }, watchdogMs);

        try {
            // 0. Expire jobs that exceeded max attempts or deadlines
            await this.expireJobs();

            // 1. Acquire Jobs using Atomic Lease (Generates unique lock_token per row)
            const jobs = await this.acquireLease();

            if (jobs.length > 0) {
                console.log(`[DataPullWorker] Acquired ${jobs.length} jobs for processing.`);

                // Process sequentially to be safe for wallet deduction and rate limits
                for (const job of jobs) {
                    await this.processJob(job);
                }
            }
        } catch (error) {
            console.error('[DataPullWorker] Error during job processing loop:', error);
        } finally {
            clearTimeout(watchdog);
            this.isRunning = false;
        }
    }

    /**
     * Transitions jobs to EXPIRED if they exceeded configured retries or deadlines
     */
    async expireJobs() {
        try {
            await prisma.$executeRawUnsafe(`
                UPDATE "DataPullBackgroundJob"
                SET status = 'EXPIRED', updated_at = NOW()
                WHERE status IN ('PENDING', 'PROCESSING')
                  AND (attempt_count >= maximum_attempts OR processing_deadline_at <= NOW())
                  AND (locked_at IS NULL OR lock_expires_at < NOW())
            `);
        } catch (error) {
            console.error('[DataPullWorker] Error expiring jobs:', error);
        }
    }

    /**
     * Atomically acquires a batch of jobs locking them for this worker instance.
     */
    async acquireLease() {
        const leaseSeconds = pollingConfig.PULL_JOB_LEASE_SECONDS;
        const batchSize = pollingConfig.PULL_WORKER_BATCH_SIZE;

        try {
            // Raw SQL to select and update atomically
            // Uses gen_random_uuid() to generate a unique token PER job
            const result = await prisma.$queryRawUnsafe(`
                UPDATE "DataPullBackgroundJob"
                SET locked_at = NOW(),
                    lock_expires_at = NOW() + INTERVAL '1 second' * $1,
                    locked_by = $2,
                    lock_token = gen_random_uuid(),
                    status = 'PROCESSING'
                WHERE id IN (
                    SELECT id FROM "DataPullBackgroundJob"
                    WHERE (
                        (status = 'PENDING' AND next_run_at <= NOW() AND (locked_at IS NULL OR lock_expires_at < NOW()))
                        OR
                        (status = 'PROCESSING' AND lock_expires_at < NOW())
                    )
                    AND attempt_count < maximum_attempts
                    AND processing_deadline_at > NOW()
                    AND maximum_attempts IS NOT NULL
                    AND processing_deadline_at IS NOT NULL
                    AND flow_type IS NOT NULL
                    ORDER BY COALESCE(next_run_at, lock_expires_at) ASC
                    FOR UPDATE SKIP LOCKED
                    LIMIT $3
                )
                RETURNING *;
            `, leaseSeconds, this.workerId, batchSize);

            return result;
        } catch (error) {
            console.error('[DataPullWorker] Failed to acquire lease:', error);
            return [];
        }
    }

    /**
     * Recheck fencing lock and module status to ensure no callback arrived midway
     */
    async verifyLeaseAndStatus(jobId, lockToken) {
        const job = await prisma.dataPullBackgroundJob.findFirst({
            where: {
                id: jobId,
                lock_token: lockToken,
                locked_by: this.workerId,
                status: 'PROCESSING'
            }
        });
        return !!job;
    }

    classifyVendorError(error, job) {
        let isFailed = false;
        let isExpired = false;
        const httpStatus = error.status || error.response?.status || 500;
        
        // 401/403 are terminal authentication failures, we shouldn't retry
        if (httpStatus === 401 || httpStatus === 403) {
            isFailed = true;
        } else if (httpStatus === 404) {
            // For signzy, 404 sometimes means terminal
            isFailed = true;
        } else if (httpStatus >= 400 && httpStatus < 500 && httpStatus !== 429) {
            // Bad requests usually mean terminal failure unless it's a 429 rate limit
            isFailed = true;
        }

        return { isFailed, isExpired, httpStatus };
    }

    async processJob(job) {
        // 1. Create Audit Record (Increment attempt)
        const currentAttempt = job.attempt_count + 1;
        
        // Increment attempt count on the job row (Safe to do here since we hold the lock)
        await prisma.dataPullBackgroundJob.update({
            where: { id: job.id },
            data: { attempt_count: currentAttempt }
        });

        const auditLog = await prisma.vendorApiAuditLog.create({
            data: {
                job_id: job.id,
                tenant_id: job.tenant_id,
                case_id: job.case_id,
                applicant_id: job.applicant_id,
                pull_type: job.pull_type,
                provider: job.pull_type === 'GST' ? 'GST_PROVIDER' : (job.pull_type === 'ITR' ? 'ITR_PROVIDER' : 'BANK_PROVIDER'),
                provider_request_id: job.provider_request_id,
                attempt_number: currentAttempt,
                provider_operation: `POLL_${job.pull_type}_${job.flow_type || 'UNKNOWN'}`,
                trigger_source: 'BACKGROUND_RECONCILIATION',
                chargeable: true,
                tenant_wallet_deducted: false, // Background retries don't auto-charge
                started_at: new Date()
            }
        });

        let isCompleted = false;
        let isFailed = false;
        let isExpired = false;
        let finalStatusMsg = null;
        let httpStatus = null;
        let resultState = 'SUCCESS';
        let gstFetchPayload = null;

        try {
            // 2. Network Call based on Pull Type
            if (job.pull_type === 'ITR') {
                if (job.flow_type === 'ITR_ANALYTICS') {
                    if (!job.provider_request_id) throw new Error('Missing referenceId');
                    const res = await itrAnalyticsService.getAnalytics(job.provider_request_id);
                    httpStatus = 200; 
                    
                    if (res && res.excelUrl) {
                        isCompleted = true;
                    } else if (res && res.statusMessage && res.statusMessage.toLowerCase().includes('failed')) {
                        isFailed = true;
                        finalStatusMsg = res.statusMessage;
                    }
                } else if (job.flow_type === 'ITR_FORM') {
                    if (!job.provider_request_id) throw new Error('Missing requestId');
                    const res = await itrAnalyticsService.fetchItrForm(job.provider_request_id);
                    httpStatus = 200;

                    if (res && res.files && res.files.length > 0) {
                        isCompleted = true;
                    }
                } else {
                    throw new Error('Unknown ITR flow type, skip processing');
                }
            } else if (job.pull_type === 'GST') {
                if (!job.provider_request_id) throw new Error('Missing requestId');
                const res = await gstService.fetchData(job.provider_request_id);
                httpStatus = 200;
                
                if (hasUsableGstFetchPayload(res)) {
                    gstFetchPayload = res;
                    isCompleted = true;
                }
            } else if (job.pull_type === 'BANK') {
                if (!job.provider_request_id) throw new Error('Missing reportId');
                const res = await bankService.retrieveWorkOrder(job.provider_request_id);
                httpStatus = 200;
                
                if (res && res.status === 'COMPLETED') {
                    isCompleted = true;
                } else if (res && res.status === 'FAILED') {
                    isFailed = true;
                }
            }

        } catch (error) {
            console.error(`[DataPullWorker] Error polling job ${job.id}:`, error);
            httpStatus = error.status || error.response?.status || 500;
            resultState = 'ERROR';
            finalStatusMsg = error.message;

            const classification = this.classifyVendorError(error, job);
            isFailed = classification.isFailed;
            isExpired = classification.isExpired;
        }

        // Post-network audit update
        await prisma.vendorApiAuditLog.update({
            where: { id: auditLog.id },
            data: {
                finished_at: new Date(),
                result_status: resultState,
                http_status: httpStatus,
                error_category: isFailed ? 'TERMINAL_ERROR' : (resultState === 'ERROR' ? 'RETRYABLE_ERROR' : null)
            }
        });

        // 3. Post-network Finalization (Inside short transaction)
        try {
            await prisma.$transaction(async (tx) => {
                // Check if callback completed parent before we mutate!
                let parentReq = null;
                if (job.pull_type === 'ITR') {
                    parentReq = await tx.itrAnalyticsRequest.findUnique({ where: { id: job.module_request_id } });
                } else if (job.pull_type === 'GST') {
                    parentReq = await tx.gstrAnalyticsRequest.findUnique({ where: { id: job.module_request_id } });
                } else if (job.pull_type === 'BANK') {
                    parentReq = await tx.bankStatementAnalysisRequest.findUnique({ where: { id: job.module_request_id } });
                }

                if (!parentReq) {
                    console.log(`[DataPullWorker] Job ${job.id} parent not found. Rolling back job update.`);
                    throw new Error('ROLLBACK_DUE_TO_MISSING_PARENT');
                }

                // If parent is already completed or failed via webhook, rollback any worker finalization!
                if (parentReq.status === 'COMPLETED' || parentReq.status === 'FAILED') {
                    console.log(`[DataPullWorker] Job ${job.id} parent is already ${parentReq.status}. Abandoning worker update to avoid race.`);
                    
                    // We must transition the JOB ONLY to terminal, without touching the parent
                    // This is safe because we haven't touched the parent in this tx yet.
                    await tx.dataPullBackgroundJob.updateMany({
                        where: { id: job.id, lock_token: job.lock_token, locked_by: this.workerId, status: 'PROCESSING' },
                        data: {
                            status: 'COMPLETED',
                            last_error: 'Completed by callback',
                            completed_at: new Date(),
                            locked_at: null,
                            locked_by: null,
                            lock_token: null,
                            lock_expires_at: null
                        }
                    });
                    return; // Skip parent and notification updates entirely.
                }

                // Verify lock
                const stillLocked = await tx.dataPullBackgroundJob.findFirst({
                    where: { id: job.id, lock_token: job.lock_token, locked_by: this.workerId, status: 'PROCESSING' }
                });

                if (!stillLocked) {
                    console.log(`[DataPullWorker] Job ${job.id} lock was broken. Skipping finalization.`);
                    return;
                }

                if (isCompleted || isFailed || isExpired) {
                    const termStatus = isCompleted ? 'COMPLETED' : (isFailed ? 'FAILED' : 'EXPIRED');

                    // Update parent module request status safely
                    if (job.pull_type === 'ITR') {
                        await tx.itrAnalyticsRequest.update({
                            where: { id: job.module_request_id },
                            data: { status: termStatus }
                        });
                    } else if (job.pull_type === 'GST') {
                        await tx.gstrAnalyticsRequest.update({
                            where: { id: job.module_request_id },
                            data: {
                                status: termStatus,
                                raw_fetch_data: gstFetchPayload || undefined
                            }
                        });
                    } else if (job.pull_type === 'BANK') {
                        await tx.bankStatementAnalysisRequest.update({
                            where: { id: job.module_request_id },
                            data: { status: termStatus }
                        });
                    }

                    // Create Notification
                    if (job.case_id) {
                        const initiatorId = parentReq.created_by_user_id || null;
                        const { recipient_user_id, audience_type } = await determineNotificationRecipient(job.tenant_id, job.case_id, initiatorId);
                        
                        const notification = await tx.systemNotification.create({
                            data: {
                                tenant_id: job.tenant_id,
                                case_id: job.case_id,
                                applicant_id: job.applicant_id,
                                pull_type: job.pull_type,
                                status: termStatus,
                                audience_type: audience_type,
                                recipient_user_id: recipient_user_id,
                                message: `Background processing for ${job.pull_type} has ended with status ${termStatus}`,
                                deduplication_key: `${job.tenant_id}_${job.case_id}_${job.pull_type}_${job.module_request_id}_${termStatus}_${currentAttempt}`
                            }
                        });

                        const pgPayload = { event_id: notification.id, tenant_id: job.tenant_id, case_id: job.case_id, pull_type: job.pull_type, status: termStatus };
                        await tx.$executeRawUnsafe(`SELECT pg_notify('case_status_updates', $1)`, JSON.stringify(pgPayload));
                    }

                    // Transition Job
                    await tx.dataPullBackgroundJob.updateMany({
                        where: { id: job.id, lock_token: job.lock_token, locked_by: this.workerId, status: 'PROCESSING' },
                        data: {
                            status: termStatus,
                            last_error: finalStatusMsg,
                            completed_at: termStatus === 'COMPLETED' ? new Date() : null,
                            locked_at: null,
                            locked_by: null,
                            lock_token: null,
                            lock_expires_at: null
                        }
                    });
                } else {
                    // Retry mode
                    // Calculate next run at based on backoff index
                    const scheduleArr = pollingConfig[job.pull_type]?.VENDOR_POLL_DELAYS_MINUTES || 
                                        pollingConfig[job.pull_type]?.RECONCILIATION_DELAYS_MINUTES || 
                                        [15,30,60];
                    const nextIndex = Math.min(currentAttempt, scheduleArr.length - 1);
                    const delayMinutes = scheduleArr[nextIndex];
                    const nextDate = new Date(Date.now() + delayMinutes * 60000);

                    await tx.dataPullBackgroundJob.update({
                        where: { id: job.id },
                        data: {
                            status: 'PENDING',
                            next_run_at: nextDate,
                            locked_at: null,
                            locked_by: null,
                            lock_expires_at: null,
                            lock_token: null,
                            last_error: finalStatusMsg
                        }
                    });
                }
            });
        } catch (txError) {
            console.error(`[DataPullWorker] Transaction error finalizing job ${job.id}:`, txError);
        }

        // 4. Close Audit Log
        try {
            await prisma.vendorApiAuditLog.update({
                where: { id: auditLog.id },
                data: {
                    finished_at: new Date(),
                    result_status: resultState,
                    http_status: httpStatus,
                    error_category: finalStatusMsg ? finalStatusMsg.substring(0, 255) : null
                }
            });
        } catch (auditErr) {
            console.error(`[DataPullWorker] Failed to close audit log ${auditLog.id}:`, auditErr);
        }
    }
}

const worker = new DataPullWorker();
module.exports = worker;

function hasUsableGstFetchPayload(dataRes) {
    if (!dataRes || typeof dataRes !== 'object') return false;
    if (dataRes.gstin || dataRes.gstr1 || dataRes.gstr3b) return true;
    if (dataRes.data?.gstin || dataRes.data?.gstr1 || dataRes.data?.gstr3b) return true;
    if (dataRes.result?.gstin || dataRes.result?.gstr1 || dataRes.result?.gstr3b) return true;
    return false;
}
