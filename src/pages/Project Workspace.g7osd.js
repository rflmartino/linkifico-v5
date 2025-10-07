// Project Workspace Page - Velo Frontend
// Updated for Railway Backend Integration with Job Queue System

import { processUserRequest, testBackend } from 'backend/entrypoint.web.js';
import wixLocation from 'wix-location';
import { session } from 'wix-storage';
import { logToBackend } from 'backend/utils/webLogger.web.js';

// Essential logging function - only for key handshake points
function logHandshake(operation, data = null) {
    const timestamp = new Date().toLocaleTimeString();
    console.log(`[${timestamp}] 🔧 ${operation}`, data || '');
    logToBackend('Project-Workspace', operation, data);
}

$w.onReady(async function () {
    const chatEl = $w('#mainChatDisplay');

    // Get projectId from URL parameters (or generate new one)
    const projectId = wixLocation.query.projectId || generateNewProjectId();
    
    // Hardcoded test user for testing
    const TEST_USER_ID = 'test_user_123';
    
    logHandshake('page_load', { 
        projectId, 
        userId: TEST_USER_ID, 
        isNewProject: !wixLocation.query.projectId
    });

    // Test backend connectivity
    try {
        const testResult = await testBackend();
        logHandshake('backend_test', testResult);
    } catch (error) {
        logHandshake('backend_test_error', { error: error.message });
    }

    let sessionId = session.getItem('chatSessionId');
    if (!sessionId) {
        sessionId = `sess_${Date.now()}`;
        session.setItem('chatSessionId', sessionId);
    }

    // For new implementation, we start fresh each session
    let isNewSession = true;
    let isNewProject = !wixLocation.query.projectId;

    chatEl.onMessage(async (event) => {
        const data = (event && event.data) || {};
        const action = data.action;

        if (action === 'ready') {
            logHandshake('chat_ready', { projectId, userId: TEST_USER_ID });
            
            chatEl.postMessage({
                action: 'initialize',
                sessionId,
                projectId,
                userId: TEST_USER_ID,
                projectName: 'New Project'
            });
            
            // Send welcome message for new projects
            setTimeout(async () => {
                if (isNewProject) {
                    chatEl.postMessage({
                        action: 'displayMessage',
                        type: 'assistant',
                        content: '👋 **Welcome to your AI Project Manager!**\n\nI\'ll help you create and manage your project with specialized agents for:\n\n🎯 **Scope Definition** - Define objectives and deliverables\n📅 **Scheduling** - Create tasks with timelines\n✅ **Task Management** - Update progress and track completion\n💰 **Budget Tracking** - Monitor costs and spending\n📊 **Project Analysis** - Assess health and identify gaps\n\n💡 **Just tell me about your project** - for example:\n- "I need to create a toy store project"\n- "Add tasks for the development phase"\n- "What\'s the current project status?"',
                        timestamp: new Date().toISOString()
                    });
                }
                chatEl.postMessage({ action: 'updateStatus', status: 'ready' });
            }, 300);
            return;
        }

        if (action === 'typing') {
            chatEl.postMessage({ action: 'updateStatus', status: 'typing' });
            return;
        }

        if (action === 'stopTyping') {
            chatEl.postMessage({ action: 'updateStatus', status: 'ready' });
            return;
        }

        if (action === 'sendMessage') {
            const userMessage = (data.message || '').trim();
            if (!userMessage) return;

            // Display user message immediately
            chatEl.postMessage({
                action: 'displayMessage',
                type: 'user',
                content: userMessage,
                timestamp: new Date().toISOString()
            });

            chatEl.postMessage({ action: 'updateStatus', status: 'processing' });

            // Submit job to queue using job queue system
            logHandshake('submitting_job', { 
                projectId, 
                userId: TEST_USER_ID, 
                messageLength: userMessage.length 
            });

            const job = await processUserRequest({
                op: 'submitJob',
                projectId,
                userId: TEST_USER_ID,
                sessionId,
                payload: {
                    jobType: 'sendMessage',
                    message: userMessage
                }
            }).catch(() => ({ success: false }));

            if (!job || !job.success) {
                logHandshake('job_submission_failed', { 
                    error: job?.message || 'Unknown error' 
                });
                chatEl.postMessage({ 
                    action: 'displayMessage', 
                    type: 'system', 
                    content: 'Failed to submit job. Please try again.', 
                    timestamp: new Date().toISOString() 
                });
                chatEl.postMessage({ action: 'updateStatus', status: 'ready' });
                return;
            }

            logHandshake('job_submitted', { jobId: job.jobId });

            // Poll for job results
            pollForJobResults(job.jobId);
        }
    });

    // Generate new project ID for new projects
    function generateNewProjectId() {
        const timestamp = Date.now();
        const randomId = Math.random().toString(36).substring(2, 8);
        return `proj_${timestamp}_${randomId}`;
    }

    // Poll for job results - job queue system
    async function pollForJobResults(jobId) {
        const maxAttempts = 45; // 45 attempts = 90 seconds max
        let attempts = 0;
        const startedAt = Date.now();
        const intervalMs = 2000;
        const timeoutMs = 90000;

        logHandshake('polling_start', { jobId, maxAttempts });

        const poll = async () => {
            attempts++;
            
            try {
                const results = await processUserRequest({
                    op: 'getJobResults',
                    payload: { jobId: jobId }
                }).catch((error) => {
                    logHandshake('polling_error', { jobId, error: error.message });
                    return null;
                });
                
                if (!results) {
                    if (Date.now() - startedAt > timeoutMs) {
                        logHandshake('polling_timeout', { jobId, attempts });
                        chatEl.postMessage({
                            action: 'displayMessage',
                            type: 'system',
                            content: 'Processing timed out. Please try again.',
                            timestamp: new Date().toISOString()
                        });
                        chatEl.postMessage({ action: 'updateStatus', status: 'ready' });
                        return;
                    }
                    setTimeout(poll, intervalMs);
                    return;
                }
                
                logHandshake('polling_status', { 
                    jobId, 
                    attempts, 
                    status: results.status, 
                    progress: results.progress || 0
                });
                
                // Update status based on job status
                if (results.status === 'queued') {
                    chatEl.postMessage({ action: 'updateStatus', status: 'queued' });
                } else if (results.status === 'processing') {
                    chatEl.postMessage({ action: 'updateStatus', status: 'processing' });
                } else if (results.status === 'failed') {
                    chatEl.postMessage({ action: 'updateStatus', status: 'error' });
                }
                
                if (results.status === 'completed') {
                    logHandshake('job_completed', { 
                        jobId, 
                        attempts, 
                        duration: Date.now() - startedAt
                    });
                    
                    // Display AI response
                    if (results.results?.aiResponse) {
                        chatEl.postMessage({
                            action: 'displayMessage',
                            type: 'assistant',
                            content: results.results.aiResponse,
                            timestamp: new Date().toISOString()
                        });
                    }
                    
                    // Display project data if available
                    if (results.results?.projectData) {
                        const projectData = results.results.projectData;
                        
                        // Update project name
                        if (projectData.name && projectData.name !== 'Untitled Project') {
                            chatEl.postMessage({ 
                                action: 'updateProjectName', 
                                projectName: projectData.name 
                            });
                            updatePageTitle(projectData.name);
                        }
                        
                        // Display scope if available
                        if (projectData.scope && projectData.scope.description) {
                            chatEl.postMessage({
                                action: 'displayMessage',
                                type: 'system',
                                content: `📋 **Project Scope:** ${projectData.scope.description}`,
                                timestamp: new Date().toISOString()
                            });
                        }
                        
                        // Display stages if available
                        if (projectData.stages && projectData.stages.length > 0) {
                            const stagesText = projectData.stages
                                .map(s => `${s.order}. ${s.name} (${s.status})`)
                                .join('\n');
                            chatEl.postMessage({
                                action: 'displayMessage',
                                type: 'system',
                                content: `📊 **Project Stages:**\n${stagesText}`,
                                timestamp: new Date().toISOString()
                            });
                        }
                        
                        // Display tasks if available
                        if (projectData.tasks && projectData.tasks.length > 0) {
                            const tasksText = projectData.tasks
                                .map(t => `- ${t.title} (${t.status})`)
                                .join('\n');
                            chatEl.postMessage({
                                action: 'displayMessage',
                                type: 'system',
                                content: `✅ **Tasks:**\n${tasksText}`,
                                timestamp: new Date().toISOString()
                            });
                        }
                        
                        // Display budget if available
                        if (projectData.budget && projectData.budget.total > 0) {
                            chatEl.postMessage({
                                action: 'displayMessage',
                                type: 'system',
                                content: `💰 **Budget:** ${projectData.budget.currency} ${projectData.budget.total.toLocaleString()} (Spent: ${projectData.budget.spent.toLocaleString()})`,
                                timestamp: new Date().toISOString()
                            });
                        }
                    }
                    
                    // Display analysis if available
                    if (results.results?.analysis) {
                        const analysis = results.results.analysis;
                        if (analysis.gaps && analysis.gaps.length > 0) {
                            const gapsText = analysis.gaps
                                .map(g => `- ${g.description} (${g.severity})`)
                                .join('\n');
                            chatEl.postMessage({
                                action: 'displayMessage',
                                type: 'system',
                                content: `⚠️ **Gaps Identified:**\n${gapsText}`,
                                timestamp: new Date().toISOString()
                            });
                        }
                    }
                    
                    chatEl.postMessage({ action: 'updateStatus', status: 'ready' });
                    return;
                }
                
                if (results.status === 'failed') {
                    logHandshake('job_failed', { 
                        jobId, 
                        error: results.message 
                    });
                    chatEl.postMessage({
                        action: 'displayMessage',
                        type: 'system',
                        content: `Processing failed: ${results.message}`,
                        timestamp: new Date().toISOString()
                    });
                    chatEl.postMessage({ action: 'updateStatus', status: 'ready' });
                    return;
                }
                
                // Still processing, continue polling
                if (attempts < maxAttempts) {
                    setTimeout(poll, intervalMs);
                } else {
                    logHandshake('polling_max_attempts', { jobId, attempts });
                    chatEl.postMessage({
                        action: 'displayMessage',
                        type: 'system',
                        content: 'Processing is taking longer than expected. Please try again.',
                        timestamp: new Date().toISOString()
                    });
                    chatEl.postMessage({ action: 'updateStatus', status: 'ready' });
                }
                
            } catch (error) {
                logHandshake('polling_error', { jobId, error: error.message });
                chatEl.postMessage({ action: 'updateStatus', status: 'ready' });
            }
        };
        
        // Start polling
        poll();
    }

    // Function to update page title with project name
    async function updatePageTitle(projectName) {
        try {
            if (projectName && projectName !== 'Project Chat' && projectName !== 'Untitled Project') {
                if (typeof document !== 'undefined') {
                    document.title = `${projectName} - PMaaS`;
                }
            }
        } catch (error) {
            logHandshake('page_title_error', { error: error.message });
        }
    }
});
