// entrypoint.web.js - Main entry point for intelligent project management chat
// Job Queue System Only - No Legacy Operations

import { redisData } from './data/redisData.js';
import { addProjectToUser } from './data/projectData.js';

import { selfAnalysisController } from './controllers/selfAnalysisController.js';
import { gapDetectionController } from './controllers/gapDetectionController.js';
import { actionPlanningController } from './controllers/actionPlanningController.js';
import { executionController } from './controllers/executionController.js';
import { learningController } from './controllers/learningController.js';
import { portfolioController } from './controllers/portfolioController.js';
import { Permissions, webMethod } from 'wix-web-module';
import { Logger } from './utils/logger.js';
import { getTemplate } from './templates/templatesRegistry.js';

// Simple test function to verify backend is working
export const testBackend = webMethod(Permissions.Anyone, async () => {
    Logger.info('entrypoint', 'testBackend_called', { timestamp: Date.now() });
    return { success: true, message: 'Backend is working', timestamp: Date.now() };
});

// Main job queue function - all operations go through job queue
// VERSION: 2025-01-03-15:35 - Added debug logging
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
    
    // Job queue operations
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
    
    // Portfolio operations (still needed for Project Portfolio page)
    if (op === 'loadPortfolio') {
        return await portfolioController.getUserPortfolio(userId);
    }
    if (op === 'archiveProject') {
        return await portfolioController.archiveProject(userId, payload?.projectId || projectId);
    }
    if (op === 'restoreProject') {
        return await portfolioController.restoreProject(userId, payload?.projectId || projectId);
    }
    if (op === 'deleteProject') {
        return await portfolioController.deleteProject(userId, payload?.projectId || projectId);
    }
    
    // No other operations supported - job queue system only
    Logger.warn('entrypoint', 'unknown_operation', { op, projectId, userId });
    return { success: false, message: `Unknown operation: ${op}. Only job queue and portfolio operations are supported.` };
});

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
        
        await redisData.saveJob(job);
        
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
        
        const job = await redisData.getJob(jobId);
        
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
        Logger.info('entrypoint', 'getJobResults_debug_start', { 
            jobId, 
            jobIdType: typeof jobId,
            jobIdLength: jobId ? jobId.length : 0
        });
        
        const job = await redisData.getJob(jobId);
        
        if (!job) {
            Logger.warn('entrypoint', 'getJobResults_jobNotFound', { jobId });
            return { success: false, message: 'Job not found' };
        }
        
        Logger.info('entrypoint', 'getJobResults_jobStatus', { 
            jobId, 
            status: job.status, 
            progress: job.progress || 0 
        });
        
        // DEBUG: Log the full job object to see what we're getting
        Logger.info('entrypoint', 'getJobResults_debug', { 
            jobId, 
            fullJob: JSON.stringify(job, null, 2),
            jobStatusType: typeof job.status,
            isQueued: job.status === 'queued'
        });
        
        // If job is queued, process it now (on-demand processing)
        if (job.status === 'queued') {
            Logger.info('entrypoint', 'getJobResults_processingQueued', { jobId });
            await processJob(jobId);
            // Refresh job data after processing
            const updatedJob = await redisData.getJob(jobId);
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
        
        // Get complete results
        const results = await redisData.getJobResults(jobId);
        
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

// Process a single job - called by background worker
export async function processJob(jobId) {
    try {
        Logger.info('entrypoint', 'processJob_start', { jobId });
        
        const job = await redisData.getJob(jobId);
        
        if (!job) {
            Logger.error('entrypoint', 'processJob_jobNotFound', { jobId });
            return;
        }
        
        Logger.info('entrypoint', 'processJob_jobDetails', { 
            jobId, 
            jobType: job.type, 
            projectId: job.projectId, 
            userId: job.userId 
        });
        
        // Mark job as processing
        await redisData.updateJobStatus(jobId, 'processing', 10, 'Starting processing...');
        
        let result;
        
        // Route to appropriate processor based on job type
        switch (job.type) {
            case 'sendMessage':
                Logger.info('entrypoint', 'processJob_processingMessage', { jobId });
                result = await processJobMessage(job);
                break;
            case 'init':
                Logger.info('entrypoint', 'processJob_processingInit', { jobId });
                result = await processJobInit(job);
                break;
            case 'analyze':
                Logger.info('entrypoint', 'processJob_processingAnalyze', { jobId });
                result = await processJobAnalyze(job);
                break;
            default:
                throw new Error(`Unknown job type: ${job.type}`);
        }
        
        Logger.info('entrypoint', 'processJob_processingComplete', { 
            jobId, 
            hasResult: !!result,
            resultKeys: result ? Object.keys(result) : []
        });
        
        // Save complete results
        await redisData.saveJobResults(jobId, result);
        
        // Mark job as completed
        await redisData.updateJobStatus(jobId, 'completed', 100, 'Processing complete');
        
        Logger.info('entrypoint', 'job_completed', { 
            jobId, 
            jobType: job.type,
            completedAt: new Date().toISOString()
        });
        
    } catch (error) {
        Logger.error('entrypoint', 'processJob_error', { 
            jobId, 
            error: error.message,
            stack: error.stack
        });
        
        // Mark job as failed
        await redisData.updateJobStatus(jobId, 'failed', 0, `Processing failed: ${error.message}`);
    }
}

// Process message job - EXACTLY 2 Redis operations (1 read, 1 save)
async function processJobMessage(job) {
    const { projectId, userId, sessionId, input } = job;
    
    Logger.info('entrypoint', 'processJobMessage_start', { 
        jobId: job.id, 
        projectId,
        userId,
        messageLength: input.message?.length || 0 
    });
    
    // REDIS OPERATION 1: Load all data at the beginning
    let allData = await redisData.loadAllData(projectId, userId);
    
    // Check if this is a truly new project (no existing data in Redis)
    const existingProjectData = await redisData.getProjectData(projectId);
    const isNewProject = !existingProjectData;
    
    Logger.info('entrypoint', 'processJobMessage_projectCheck', { 
        jobId: job.id, 
        projectId, 
        isNewProject,
        hasExistingData: !!existingProjectData
    });
    
    // Generate project email if not already set (regardless of whether project data existed)
    Logger.info('entrypoint', 'processJobMessage_emailCheck', { 
        jobId: job.id, 
        projectId, 
        hasEmail: !!allData.projectData.email,
        emailValue: allData.projectData.email,
        emailType: typeof allData.projectData.email
    });
    
    if (!allData.projectData.email) {
        try {
            const emailData = await redisData.generateUniqueProjectEmail();
            allData.projectData.email = emailData.email;
            allData.projectData.emailId = emailData.emailId;
            
            // Save email mapping
            await redisData.saveEmailMapping(emailData.email, projectId);
            
            Logger.info('entrypoint', 'processJobMessage_emailGenerated', { 
                jobId: job.id, 
                projectId, 
                email: emailData.email,
                emailId: emailData.emailId
            });
        } catch (error) {
            Logger.error('entrypoint', 'processJobMessage_emailGenerationFailed', { 
                jobId: job.id, 
                projectId, 
                error: error.message 
            });
            // Continue without email - don't fail the whole process
        }
    } else {
        Logger.info('entrypoint', 'processJobMessage_emailAlreadyExists', { 
            jobId: job.id, 
            projectId, 
            existingEmail: allData.projectData.email
        });
    }
    
    Logger.info('entrypoint', 'processJobMessage_dataLoaded', { 
        jobId: job.id, 
        chatHistoryLength: allData.chatHistory?.length || 0,
        hasProjectData: !!allData.projectData
    });
    
    // Add user message to history
    let chatHistory = allData.chatHistory || [];
    const userMessageExists = chatHistory.some(msg => 
        msg.role === 'user' && 
        msg.message === input.message && 
        msg.sessionId === sessionId
    );
    
    if (!userMessageExists) {
        chatHistory.push({
            role: 'user',
            message: input.message,
            timestamp: new Date().toISOString(),
            sessionId: sessionId
        });
    }
    
    allData.chatHistory = chatHistory;
    
    // Process through intelligence loop - controllers pass data between each other
    const response = await processIntelligenceLoopWithDataFlow(projectId, userId, input.message, allData);
    
    Logger.info('entrypoint', 'processJobMessage_intelligenceComplete', { 
        jobId: job.id, 
        hasResponse: !!response,
        responseLength: response?.message?.length || 0,
        hasAnalysis: !!response?.analysis
    });
    
    // Add AI response to history
    chatHistory.push({
        role: 'assistant',
        message: response.message,
        timestamp: new Date().toISOString(),
        sessionId: sessionId,
        analysis: response.analysis
    });
    
    allData.chatHistory = chatHistory;
    
    // Extract todos from response
    const todosFromAnalysis = (response.analysis && response.analysis.gaps && response.analysis.gaps.todos) ? response.analysis.gaps.todos : [];
    const todosFromAllData = allData.todos || [];
    const todosFromGaps = (response.analysis && response.analysis.todos) ? response.analysis.todos : [];
    
    const finalTodos = todosFromAnalysis.length > 0 ? todosFromAnalysis :
                      todosFromAllData.length > 0 ? todosFromAllData :
                      todosFromGaps;
    
    Logger.info('entrypoint', 'processJobMessage_todosExtracted', { 
        jobId: job.id, 
        todoCount: finalTodos.length,
        todosFromAnalysis: todosFromAnalysis.length,
        todosFromAllData: todosFromAllData.length,
        todosFromGaps: todosFromGaps.length
    });
    
    // REDIS OPERATION 2: Save all data at the end
    await redisData.saveAllData(projectId, userId, allData);
    
    Logger.info('entrypoint', 'processJobMessage_dataSaved', { 
        jobId: job.id, 
        finalChatHistoryLength: chatHistory.length
    });
    
    // Return complete results
        return {
        aiResponse: response.message,
        todos: finalTodos,
        projectData: allData.projectData,
        analysis: response.analysis,
        chatHistory: chatHistory
    };
}

// Process init job
async function processJobInit(job) {
    const { projectId, userId, input } = job;
    
    // REDIS OPERATION 1: Load all data at the beginning
    let allData = await redisData.loadAllData(projectId, userId);
    if (!allData.projectData) {
        allData.projectData = redisData.createDefaultProjectData(projectId);
    }
    
    // Initialize project with template
    const template = getTemplate(input.templateName || 'simple_waterfall');
    const initialMessage = input.initialMessage || 'Start';
    
    // Process through intelligence loop
    const response = await processIntelligenceLoopWithDataFlow(projectId, userId, initialMessage, allData);
    
    // REDIS OPERATION 2: Save all data at the end
    await redisData.saveAllData(projectId, userId, allData);
    
    return { 
        message: response.message,
        projectData: allData.projectData,
        analysis: response.analysis
    };
}

// Process analyze job
async function processJobAnalyze(job) {
    const { projectId, userId } = job;
    
    // REDIS OPERATION 1: Load all data at the beginning
    let allData = await redisData.loadAllData(projectId, userId);
    
    // Trigger analysis
    const template = getTemplate('simple_waterfall');
    const response = await processIntelligenceLoopWithDataFlow(projectId, userId, 'Analyze current project status', allData);
    
    // REDIS OPERATION 2: Save all data at the end
    await redisData.saveAllData(projectId, userId, allData);
    
    return {
        message: response.message,
        analysis: response.analysis,
        projectData: allData.projectData
    };
}

// Intelligence processing loop - NO Redis calls, controllers pass data between each other
async function processIntelligenceLoopWithDataFlow(projectId, userId, message, allData) {
    try {
        const template = getTemplate('simple_waterfall');
        
        // Initialize default data structures if missing
        if (!allData.knowledgeData) {
            allData.knowledgeData = { insights: [], patterns: [], recommendations: [] };
        }
        if (!allData.gapData) {
            allData.gapData = { gaps: [], priorities: [], todos: [] };
        }
        if (!allData.learningData) {
            allData.learningData = { lessons: [], improvements: [], adaptations: [] };
        }
        if (!allData.reflectionData) {
            allData.reflectionData = { reflections: [], insights: [], decisions: [] };
        }
        
        // 1. Self Analysis - Pass data to controller, get updated data back
        const analysis = await selfAnalysisController.analyzeProject(projectId, allData.projectData, allData.chatHistory, allData.knowledgeData, template);
        if (analysis.knowledgeData) {
            allData.knowledgeData = analysis.knowledgeData;
        }
        
        // 2. Gap Detection - Pass updated data to controller, get updated data back
        const gaps = await gapDetectionController.identifyGaps(projectId, analysis, allData.projectData, allData.gapData, template);
        if (gaps.gapData) {
            allData.gapData = gaps.gapData;
        }
        
        // 3. Action Planning - Pass updated data to controller, get updated data back
        const actionPlan = await actionPlanningController.planAction(projectId, userId, gaps, analysis, allData.chatHistory, allData.learningData, template);
        if (actionPlan.updatedLearningData) {
            allData.learningData = actionPlan.updatedLearningData;
        }
        
        // 4. Execution - Pass updated data to controller, get final response
        const execution = await executionController.executeAction(projectId, userId, message, actionPlan, allData.projectData, template);
        
        // Update project data with any changes made by execution controller
        if (execution.analysis?.updatedProjectData) {
            allData.projectData = execution.analysis.updatedProjectData;
        }
        
        // Regenerate gaps and todos with updated project data
        const updatedGaps = await gapDetectionController.identifyGaps(projectId, analysis, allData.projectData, allData.gapData, template);
        if (updatedGaps.gapData) {
            allData.gapData = updatedGaps.gapData;
        }
        
        // Attach updated gaps and todos to response
        const response = {
            message: execution.message,
            analysis: {
                ...execution.analysis,
                gaps: updatedGaps.gapData,
                todos: updatedGaps.gapData?.todos || []
            }
        };
        
        // 5. Learning - Run in background (non-blocking, no Redis calls)
        learningController.learnFromInteraction(projectId, userId, message, execution, allData.chatHistory, allData.learningData, allData.reflectionData)
            .then((result) => {
                if (result.updatedLearningData) {
                    allData.learningData = result.updatedLearningData;
                }
                if (result.updatedReflectionData) {
                    allData.reflectionData = result.updatedReflectionData;
                }
                // Separate Redis call for learning data
                redisData.saveAllData(projectId, userId, allData).catch(console.error);
            })
            .catch((error) => {
                Logger.error('entrypoint', 'learning_error', error, { projectId, userId });
            });
        
        return response;
        
    } catch (error) {
        Logger.error('entrypoint', 'processIntelligenceLoopWithDataFlow_error', { 
            projectId,
            userId,
            error: error.message,
            stack: error.stack
        });
        
        return {
            message: "I apologize, but I encountered an error while processing your request. Please try again.",
            analysis: {
                error: error.message,
                gaps: { gaps: [], todos: [] }
            }
        };
    }
}

// Process queued jobs in batch
async function processQueuedJobs(limit = 5) {
    try {
        const queuedJobs = await redisData.getQueuedJobs(limit);
        
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