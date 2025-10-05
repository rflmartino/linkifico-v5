// Project Workspace Page - Velo Frontend
// Handles project workspace functionality - receives userId and projectId from URL

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
    
    // Hardcoded test user for testing job queue system
    const TEST_USER_ID = 'test_user_123';
    
    logHandshake('page_load', { 
        projectId, 
        userId: TEST_USER_ID, 
        isNewProject: !wixLocation.query.projectId,
        testingMode: true
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

	// Check for existing project and chat history
	let isNewSession = false;
	let existingHistory = [];
	let isNewProject = false;
	
	try {
		// For job queue system, we don't need to load existing data on page load
		// The job queue will handle all data loading when processing jobs
		existingHistory = [];
		isNewSession = true;
		
        const projectJustCreated = isProjectJustCreated();
        isNewProject = true; // Always treat as new project for job queue system
        
        // No need to update page elements on load - job queue will handle this
	} catch (e) {
		logHandshake('backend_check_error', { error: e.message });
	}

	chatEl.onMessage(async (event) => {
        const data = (event && event.data) || {};
        const action = data.action;

        if (action === 'ready') {
            // For job queue system, project info will be updated when jobs complete
            // No need to fetch status on ready
            logHandshake('ready', 'status_ready', { projectId, userId: TEST_USER_ID });
            
            chatEl.postMessage({
                action: 'initialize',
                sessionId,
                projectId,
                userId: TEST_USER_ID,
                projectName: 'New Project'
            });
            
            // Project email will be updated when jobs complete
            
            // Send appropriate content based on session type
            setTimeout(async () => {
                if (isNewProject) {
                    // Handle new project - show user message if exists
                    if (existingHistory.length > 0) {
                        const userMessage = existingHistory.find(msg => msg.role === 'user');
                        if (userMessage) {
                            chatEl.postMessage({
                                action: 'displayMessage',
                                type: 'user',
                                content: userMessage.message,
                                timestamp: userMessage.timestamp
                            });
                        }
                    }
                    
                    chatEl.postMessage({ action: 'updateStatus', status: 'ready' });
                    
                    // No need to poll for AI response - job queue will handle this
                } else if (isNewSession) {
                    // Send welcome message for new sessions
                    chatEl.postMessage({
                        action: 'displayMessage',
                        type: 'assistant',
                        content: '👋 **Welcome to your AI Project Assistant!**\n\nI\'ll help you create a comprehensive project plan by asking about your objectives, budget, timeline, and team.\n\n💡 **Just tell me about your project** - for example: "I need a plan for opening a coffee shop" or "Help me plan a website redesign"',
                        timestamp: new Date().toISOString()
                    });
                } else {
                    // Load existing chat history for returning users
                    chatEl.postMessage({
                        action: 'loadHistory',
                        history: existingHistory
                    });
                    
                    // Extract and display todos from chat history
                    setTimeout(async () => {
                        try {
                            const todosFromHistory = [];
                            
                            existingHistory.forEach(msg => {
                                if (msg.role === 'assistant' && msg.analysis && msg.analysis.todos) {
                                    todosFromHistory.push(...msg.analysis.todos);
                                }
                                if (msg.role === 'assistant' && msg.analysis && msg.analysis.gaps && msg.analysis.gaps.todos) {
                                    todosFromHistory.push(...msg.analysis.gaps.todos);
                                }
                            });
                            
                            const uniqueTodos = todosFromHistory.filter((todo, index, self) => 
                                index === self.findIndex(t => t.id === todo.id)
                            );
                            
                            if (uniqueTodos.length > 0) {
                                chatEl.postMessage({
                                    action: 'displayTodos',
                                    todos: uniqueTodos
                                });
                            }
                        } catch (error) {
                            logHandshake('todos_extraction_error', { error: error.message });
                        }
                    }, 500);
                }
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

            // Submit job to queue using new job queue system
            logHandshake('sendMessage', 'submittingJob', { 
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
                logHandshake('sendMessage', 'jobSubmissionFailed', { 
                    projectId, 
                    userId: TEST_USER_ID, 
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

            logHandshake('sendMessage', 'jobSubmitted', { 
                projectId, 
                userId: TEST_USER_ID, 
                jobId: job.jobId 
            });

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

    // Poll for job results - new job queue system
    async function pollForJobResults(jobId) {
        const maxAttempts = 45; // 45 attempts = 90 seconds max
        let attempts = 0;
        const startedAt = Date.now();
        const intervalMs = 2000;
        const timeoutMs = 90000;

        logHandshake('pollForJobResults', 'start', { jobId, maxAttempts, intervalMs, timeoutMs });

        const poll = async () => {
            attempts++;
            
            try {
                logHandshake('pollForJobResults', 'polling', { jobId, attempt: attempts, elapsed: Date.now() - startedAt });
                
                const results = await processUserRequest({
                    op: 'getJobResults',
                    payload: { jobId: jobId }
                }).catch((error) => {
                    logHandshake('pollForJobResults', 'getJobResults_error', { jobId, error: error.message });
                    return null;
                });
                
                if (!results) {
                    logHandshake('pollForJobResults', 'no_results', { jobId, attempts, elapsed: Date.now() - startedAt });
                    if (Date.now() - startedAt > timeoutMs) {
                        logHandshake('pollForJobResults', 'timeout', { jobId, attempts, duration: Date.now() - startedAt });
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
                
                logHandshake('pollForJobResults', 'got_results', { 
                    jobId, 
                    attempts, 
                    results: JSON.stringify(results, null, 2),
                    elapsed: Date.now() - startedAt 
                });
                
                logHandshake('pollForJobResults', 'statusCheck', { 
                    jobId, 
                    attempts, 
                    status: results.status, 
                    progress: results.progress || 0,
                    elapsed: Date.now() - startedAt 
                });
                
                // Update status based on job status to show proper animations
                if (results.status === 'queued') {
                    chatEl.postMessage({ action: 'updateStatus', status: 'processing' });
                } else if (results.status === 'processing') {
                    // Use the message from the job status as the status
                    const statusMessage = results.message || 'Processing...';
                    chatEl.postMessage({ action: 'updateStatus', status: statusMessage.toLowerCase().replace(/\s+/g, '_') });
                } else if (results.status === 'failed') {
                    chatEl.postMessage({ action: 'updateStatus', status: 'error' });
                }
                
                if (results.status === 'completed') {
                    logHandshake('pollForJobResults', 'completed', { 
                        jobId, 
                        attempts, 
                        duration: Date.now() - startedAt,
                        hasResults: !!results.results,
                        resultKeys: results.results ? Object.keys(results.results) : []
                    });
                    
                    // Display complete results
                    chatEl.postMessage({
                        action: 'displayMessage',
                        type: 'assistant',
                        content: results.results.aiResponse,
                        timestamp: new Date().toISOString()
                    });
                    
                    // Display todos if available
                    if (Array.isArray(results.results.todos) && results.results.todos.length) {
                        logHandshake('pollForJobResults', 'displayingTodos', { jobId, todoCount: results.results.todos.length });
                        chatEl.postMessage({
                            action: 'displayTodos',
                            todos: results.results.todos
                        });
                    }
                    
                    // Update project name if it changed
                    if (results.results.projectData?.name && results.results.projectData.name !== 'New Project') {
                        logHandshake('pollForJobResults', 'updatingProjectName', { jobId, projectName: results.results.projectData.name });
                        chatEl.postMessage({ 
                            action: 'updateProjectName', 
                            projectName: results.results.projectData.name 
                        });
                        await updatePageTitle(results.results.projectData.name);
                    }
                    
                    // Update project email if available
                    if (results.results.projectData?.email) {
                        logHandshake('pollForJobResults', 'updatingProjectEmail', { jobId, projectEmail: results.results.projectData.email });
                        chatEl.postMessage({ 
                            action: 'updateProjectEmail', 
                            projectEmail: results.results.projectData.email 
                        });
                    }
                    
                    chatEl.postMessage({ action: 'updateStatus', status: 'ready' });
                    return;
                }
                
                if (results.status === 'failed') {
                    logHandshake('pollForJobResults', 'failed', { 
                        jobId, 
                        attempts, 
                        duration: Date.now() - startedAt, 
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
                    logHandshake('pollForJobResults', 'maxAttemptsReached', { jobId, attempts, duration: Date.now() - startedAt });
                    chatEl.postMessage({
                        action: 'displayMessage',
                        type: 'system',
                        content: 'Processing is taking longer than expected. Please try again.',
                        timestamp: new Date().toISOString()
                    });
                    chatEl.postMessage({ action: 'updateStatus', status: 'ready' });
                }
                
            } catch (error) {
                logHandshake('pollForJobResults', 'error', { jobId, attempts, error: error.message });
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

    // Function to update page elements for returning users
    async function updatePageElements(projectStatus) {
        try {
            if (projectStatus?.projectData?.name) {
                await updatePageTitle(projectStatus.projectData.name);
            }
        } catch (error) {
            logHandshake('page_elements_error', { error: error.message });
        }
    }

    // Helper function to determine if project was just created
    function isProjectJustCreated() {
        // Check if projectId has recent timestamp (within last 30 seconds)
        const projectTimestamp = projectId.split('_')[1]; // Extract timestamp from proj_TIMESTAMP_randomId
        if (projectTimestamp) {
            const timeDiff = Date.now() - parseInt(projectTimestamp);
            return timeDiff < 30000; // Less than 30 seconds ago
        }
        return false;
    }

});
