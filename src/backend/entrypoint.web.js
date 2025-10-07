// entrypoint.web.js - Main entry point for intelligent project management chat
// Job Queue System Only - No Legacy Operations

// Data operations now handled by Railway backend
// import { redisData } from './data/redisData.js';
// import { addProjectToUser } from './data/projectData.js';

// Portfolio controller is still needed for portfolio operations
// import { portfolioController } from './controllers/portfolioController.js';
import { Permissions, webMethod } from 'wix-web-module';
import { fetch } from 'wix-fetch';
import { getSecret } from 'wix-secrets-backend';
import { Logger } from './utils/logger.js';
import { getTemplate } from './templates/templatesRegistry.js';

// ============================================================================
// SECURITY: API KEY MANAGEMENT
// ============================================================================

// Cache the API key to avoid multiple secret reads
let cachedApiKey = null;

async function getRailwayApiKey() {
    if (cachedApiKey) {
        return cachedApiKey;
    }
    
    try {
        cachedApiKey = await getSecret('RAILWAY_API_KEY');
        if (!cachedApiKey) {
            Logger.error('entrypoint', 'getRailwayApiKey', new Error('RAILWAY_API_KEY not found in secrets'));
            throw new Error('Railway API key not configured');
        }
        return cachedApiKey;
    } catch (error) {
        Logger.error('entrypoint', 'getRailwayApiKey', error);
        throw new Error('Failed to retrieve Railway API key');
    }
}

// Helper to create authenticated headers
async function getAuthenticatedHeaders() {
    const apiKey = await getRailwayApiKey();
    return {
        'Content-Type': 'application/json',
        'x-api-key': apiKey
    };
}

// Railway API helper functions for job queue operations
async function storeJobInRailway(job) {
    const headers = await getAuthenticatedHeaders();
    const response = await fetch(
        'https://linkifico-v5-production.up.railway.app/api/store-job',
        {
            method: 'POST',
            headers: headers,
            body: JSON.stringify({ job })
        }
    );
    return response.json();
}

async function getJobFromRailway(jobId) {
    const headers = await getAuthenticatedHeaders();
    const response = await fetch(
        `https://linkifico-v5-production.up.railway.app/api/get-job/${jobId}`,
        { 
            method: 'GET',
            headers: headers
        }
    );
    const data = await response.json();
    return data.job || null;
}

async function updateJobStatusInRailway(jobId, status, progress, message) {
    const headers = await getAuthenticatedHeaders();
    const response = await fetch(
        'https://linkifico-v5-production.up.railway.app/api/update-job-status',
        {
            method: 'POST',
            headers: headers,
            body: JSON.stringify({ jobId, status, progress, message })
        }
    );
    return response.json();
}

async function saveJobResultsInRailway(jobId, results) {
    const headers = await getAuthenticatedHeaders();
    const response = await fetch(
        'https://linkifico-v5-production.up.railway.app/api/save-job-results',
        {
            method: 'POST',
            headers: headers,
            body: JSON.stringify({ jobId, results })
        }
    );
    return response.json();
}

async function getJobResultsFromRailway(jobId) {
    const headers = await getAuthenticatedHeaders();
    const response = await fetch(
        `https://linkifico-v5-production.up.railway.app/api/get-job-results/${jobId}`,
        { 
            method: 'GET',
            headers: headers
        }
    );
    const data = await response.json();
    return data.results || null;
}

async function getQueuedJobsFromRailway(limit) {
    const headers = await getAuthenticatedHeaders();
    const response = await fetch(
        `https://linkifico-v5-production.up.railway.app/api/get-queued-jobs?limit=${limit}`,
        { 
            method: 'GET',
            headers: headers
        }
    );
    const data = await response.json();
    return data.jobs || [];
}

// Job processing functions that call Railway backend
async function processJobMessageViaRailway(job) {
    try {
        Logger.info('entrypoint', 'railway_process_message_start', { jobId: job.id });
        
        const headers = await getAuthenticatedHeaders();
        const response = await fetch(
            'https://linkifico-v5-production.up.railway.app/api/process-message-job',
            {
                method: 'POST',
                headers: headers,
                body: JSON.stringify({ job })
            }
        );
        
        if (!response.ok) {
            const errorText = await response.text();
            const errorMsg = `HTTP ${response.status}: ${response.statusText}`;
            Logger.error('entrypoint', 'railway_process_message_error', new Error(errorMsg), { 
                jobId: job.id, 
                status: response.status,
                statusText: response.statusText,
                errorBody: errorText
            });
            return null;
        }
        
        const data = await response.json();
        
        Logger.info('entrypoint', 'railway_process_message_complete', { 
            jobId: job.id,
            hasResult: !!data.result,
            success: data.success,
            dataKeys: Object.keys(data)
        });
        
        return data.result || null;
    } catch (error) {
        Logger.error('entrypoint', 'railway_process_message_exception', error, { 
            jobId: job.id
        });
        return null;
    }
}

async function processJobInitViaRailway(job) {
    const headers = await getAuthenticatedHeaders();
    const response = await fetch(
        'https://linkifico-v5-production.up.railway.app/api/process-init-job',
        {
            method: 'POST',
            headers: headers,
            body: JSON.stringify({ job })
        }
    );
    const data = await response.json();
    return data.result || null;
}

async function processJobAnalyzeViaRailway(job) {
    const headers = await getAuthenticatedHeaders();
    const response = await fetch(
        'https://linkifico-v5-production.up.railway.app/api/process-analyze-job',
        {
            method: 'POST',
            headers: headers,
            body: JSON.stringify({ job })
        }
    );
    const data = await response.json();
    return data.result || null;
}

// Simple test function to verify backend is working
export const testBackend = webMethod(Permissions.Anyone, async () => {
    Logger.info('entrypoint', 'testBackend_called', { timestamp: Date.now() });
    return { success: true, message: 'Backend is working', timestamp: Date.now() };
});

// Direct Railway API call for project analysis
export const analyzeProject = webMethod(
    Permissions.Anyone,
    async (projectData) => {
        try {
            Logger.info('entrypoint', 'analyzeProject_called', { 
                hasProjectData: !!projectData,
                projectId: projectData?.projectId 
            });
            
            const headers = await getAuthenticatedHeaders();
            const response = await fetch(
                'https://linkifico-v5-production.up.railway.app/api/analyze-project',
                {
                    method: 'POST',
                    headers: headers,
                    body: JSON.stringify({
                        query: "Analyze this project for completeness and risks",
                        projectData: projectData
                    })
                }
            );

            const data = await response.json();

            Logger.info('entrypoint', 'analyzeProject_success', { 
                hasAnalysis: !!data.analysis,
                hasResult: !!data.result 
            });

            return {
                success: true,
                analysis: data.analysis,
                result: data.result
            };

        } catch (error) {
            Logger.error('entrypoint', 'analyzeProject_error', error, { 
                hasProjectData: !!projectData 
            });
            
            return {
                success: false,
                error: error.message
            };
        }
    }
);

// Main job queue function - all operations go through job queue to prevent Wix timeouts
// VERSION: 2025-01-03-15:35 - Modified to use Railway backend instead of local Redis
export const processUserRequest = webMethod(Permissions.Anyone, async (requestData) => {
    const { op, projectId, userId, sessionId, payload = {} } = requestData || {};
    
    // CRITICAL DEBUG: Log every call to processUserRequest
    Logger.info('entrypoint', 'processUserRequest_called', { 
        op, 
        projectId, 
        userId, 
        sessionId,
        hasPayload: !!payload,
        payloadKeys: payload ? Object.keys(payload) : []
    });
    
    // Some operations don't require projectId (like getJobResults, getJobStatus)
    const requiresProjectId = !['getJobResults', 'getJobStatus', 'processJobs'].includes(op);
    
    if (!op || (requiresProjectId && !projectId)) {
        Logger.warn('entrypoint', 'processUserRequest_invalid', { op, projectId, userId, requiresProjectId });
        return { success: false, message: 'Invalid request' };
    }
    
    // Essential handshake logging - only for job queue operations
    if (op === 'submitJob' || op === 'getJobStatus' || op === 'getJobResults' || op === 'processJobs') {
        Logger.info('entrypoint', 'operation_start', { op, projectId, userId });
    }
    
    // Job queue operations - these prevent Wix timeouts
    if (op === 'submitJob') {
        return await submitJob(projectId, userId, sessionId, payload);
    }
    if (op === 'getJobStatus') {
        return await getJobStatus(payload?.jobId);
    }
    if (op === 'getJobResults') {
        Logger.info('entrypoint', 'getJobResults_routing', { jobId: payload?.jobId });
        return await getJobResults(payload?.jobId);
    }
    if (op === 'processJobs') {
        return await processQueuedJobs(payload?.limit || 5);
    }
    
    // Portfolio operations - temporarily disabled until portfolio controller is reimplemented
    if (op === 'loadPortfolio') {
        return { success: false, message: 'Portfolio operations temporarily unavailable' };
    }
    if (op === 'archiveProject') {
        return { success: false, message: 'Portfolio operations temporarily unavailable' };
    }
    if (op === 'restoreProject') {
        return { success: false, message: 'Portfolio operations temporarily unavailable' };
    }
    if (op === 'deleteProject') {
        return { success: false, message: 'Portfolio operations temporarily unavailable' };
    }
    
    // No other operations supported - job queue system only
    Logger.warn('entrypoint', 'unknown_operation', { op, projectId, userId });
    return { success: false, message: `Unknown operation: ${op}. Only job queue and portfolio operations are supported.` };
});

// Job queue functions - modified to use Railway backend instead of local Redis
// These functions prevent Wix timeouts by providing async job processing

// Submit a job to the queue - returns jobId immediately
async function submitJob(projectId, userId, sessionId, payload) {
    try {
        Logger.info('entrypoint', 'submitJob_start', { 
            projectId,
            userId,
            sessionId, 
            payload: JSON.stringify(payload, null, 2) 
        });
        
        const jobId = `job_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        
        const job = {
            id: jobId,
            type: payload.jobType || 'sendMessage',
            projectId,
            userId,
            sessionId,
            input: payload,
            status: 'queued',
            createdAt: new Date().toISOString(),
            progress: 0
        };
        
        Logger.info('entrypoint', 'submitJob_job_created', { 
            jobId, 
            jobType: job.type,
            jobData: JSON.stringify(job, null, 2)
        });
        
        // Store job in Railway backend instead of local Redis
        await storeJobInRailway(job);
        
        Logger.info('entrypoint', 'job_submitted', { jobId, projectId, userId, jobType: job.type });
        
        return {
            success: true,
            jobId: jobId,
            message: 'Job submitted successfully'
        };
        
    } catch (error) {
        Logger.error('entrypoint', 'submitJob_error', error, { 
            projectId, 
            userId, 
            payload: JSON.stringify(payload, null, 2)
        });
        return {
            success: false,
            message: 'Failed to submit job',
            error: error.message || String(error)
        };
    }
}

// Get job status
async function getJobStatus(jobId) {
    try {
        if (!jobId) {
            return { success: false, message: 'Job ID required' };
        }
        
        // Get job status from Railway backend
        const job = await getJobFromRailway(jobId);
        
        if (!job) {
            return { success: false, message: 'Job not found' };
        }
        
        return {
            success: true,
            jobId: jobId,
            status: job.status,
            progress: job.progress || 0,
            message: job.message || 'Job in progress'
        };

    } catch (error) {
        Logger.error('entrypoint', 'getJobStatus_error', error, { jobId });
        return {
            success: false,
            message: 'Failed to get job status',
            error: error.message
        };
    }
}

// Get job results - only returns results when job is 100% complete
async function getJobResults(jobId) {
    try {
        if (!jobId) {
            return { success: false, message: 'Job ID required' };
        }
        
        Logger.info('entrypoint', 'getJobResults_request', { jobId });
        
        // Get job from Railway backend
        const job = await getJobFromRailway(jobId);
        
        if (!job) {
            Logger.warn('entrypoint', 'getJobResults_jobNotFound', { jobId });
            return { success: false, message: 'Job not found' };
        }
        
        Logger.info('entrypoint', 'getJobResults_jobStatus', { 
            jobId, 
            status: job.status, 
            progress: job.progress || 0 
        });
        
        // If job is queued, process it now (on-demand processing)
        if (job.status === 'queued') {
            Logger.info('entrypoint', 'getJobResults_processingQueued', { jobId });
            await processJob(jobId);
            // Refresh job data after processing
            const updatedJob = await getJobFromRailway(jobId);
            if (updatedJob.status !== 'completed') {
                Logger.info('entrypoint', 'getJobResults_processingInProgress', { 
                    jobId, 
                    status: updatedJob.status, 
                    progress: updatedJob.progress || 0 
                });
                return {
                    success: true,
                    jobId: jobId,
                    status: updatedJob.status,
                    progress: updatedJob.progress || 0,
                    message: updatedJob.status === 'failed' ? updatedJob.error : 'Job processing...'
                };
            }
        }
        
        // Only return results if job is 100% complete
        if (job.status !== 'completed') {
            Logger.info('entrypoint', 'getJobResults_notComplete', { 
                jobId, 
                status: job.status, 
                progress: job.progress || 0 
            });
            return {
                success: true,
                jobId: jobId,
                status: job.status,
                progress: job.progress || 0,
                message: job.status === 'failed' ? job.error : 'Job not yet complete'
            };
        }
        
        // Get complete results from Railway backend
        const results = await getJobResultsFromRailway(jobId);
        
        Logger.info('entrypoint', 'getJobResults_complete', { 
            jobId, 
            hasResults: !!results,
            resultsKeys: results ? Object.keys(results) : []
        });
        
        return {
            success: true,
            jobId: jobId,
            status: 'completed',
            results: results,
            completedAt: job.completedAt
        };

    } catch (error) {
        Logger.error('entrypoint', 'getJobResults_error', error, { jobId });
        return {
            success: false,
            message: 'Failed to get job results',
            error: error.message
        };
    }
}

// Process a single job - calls Railway backend for actual processing
export async function processJob(jobId) {
    try {
        Logger.info('entrypoint', 'processJob_start', { jobId });
        
        const job = await getJobFromRailway(jobId);
        
        if (!job) {
            Logger.error('entrypoint', 'processJob_jobNotFound', new Error('Job not found'), { jobId });
            return;
        }
        
        Logger.info('entrypoint', 'processJob_jobDetails', { 
            jobId, 
            jobType: job.type, 
            projectId: job.projectId, 
            userId: job.userId 
        });
        
        // Mark job as processing in Railway backend
        await updateJobStatusInRailway(jobId, 'processing', 10, 'Starting processing...');
        
        let result;
        
        // Route to appropriate processor - all processing now done by Railway
        switch (job.type) {
            case 'sendMessage':
                Logger.info('entrypoint', 'processJob_processingMessage', { jobId });
                result = await processJobMessageViaRailway(job);
                break;
            case 'init':
                Logger.info('entrypoint', 'processJob_processingInit', { jobId });
                result = await processJobInitViaRailway(job);
                break;
            case 'analyze':
                Logger.info('entrypoint', 'processJob_processingAnalyze', { jobId });
                result = await processJobAnalyzeViaRailway(job);
                break;
            default:
                throw new Error(`Unknown job type: ${job.type}`);
        }
        
        Logger.info('entrypoint', 'processJob_processingComplete', { 
            jobId, 
            hasResult: !!result,
            resultKeys: result ? Object.keys(result) : []
        });
        
        // Save complete results in Railway backend
        await saveJobResultsInRailway(jobId, result);
        
        // Mark job as completed in Railway backend
        await updateJobStatusInRailway(jobId, 'completed', 100, 'Processing complete');
        
        Logger.info('entrypoint', 'job_completed', { 
            jobId, 
            jobType: job.type,
            completedAt: new Date().toISOString()
        });
        
    } catch (error) {
        Logger.error('entrypoint', 'processJob_error', error, { 
            jobId
        });
        
        // Mark job as failed in Railway backend
        await updateJobStatusInRailway(jobId, 'failed', 0, `Processing failed: ${error.message}`);
    }
}

// Process queued jobs in batch
async function processQueuedJobs(limit = 5) {
    try {
        // Get queued jobs from Railway backend
        const queuedJobs = await getQueuedJobsFromRailway(limit);
        
        if (queuedJobs.length === 0) {
            return {
                success: true,
                message: 'No queued jobs to process',
                processed: 0
            };
        }
        
        Logger.info('entrypoint', 'processQueuedJobs_start', { 
            jobCount: queuedJobs.length,
            jobIds: queuedJobs.map(j => j.id)
        });
        
        // Process jobs in parallel
        const results = await Promise.allSettled(
            queuedJobs.map(job => processJob(job.id))
        );
        
        const successful = results.filter(r => r.status === 'fulfilled').length;
        const failed = results.filter(r => r.status === 'rejected').length;
        
        Logger.info('entrypoint', 'processQueuedJobs_complete', { 
            total: queuedJobs.length,
            successful,
            failed,
            jobIds: queuedJobs.map(j => j.id)
        });
        
        return {
            success: true,
            message: `Processed ${queuedJobs.length} jobs`,
            processed: queuedJobs.length,
            successful,
            failed
        };
        
    } catch (error) {
        Logger.error('entrypoint', 'processQueuedJobs_error', error);
        return {
            success: false,
            message: 'Failed to process queued jobs',
            error: error.message
        };
    }
}