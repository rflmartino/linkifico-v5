// Project Workspace Page - Velo Frontend
// Updated for Railway Backend Integration with Streaming Support

import { startStreamingWorkflow, pollStreamEvents } from 'backend/streaming-pm.web.js';
import { testBackend } from 'backend/entrypoint.web.js';
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

            // Generate jobId for this request
            const jobId = `job_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;

            logHandshake('starting_streaming_workflow', { 
                jobId,
                projectId, 
                userId: TEST_USER_ID, 
                messageLength: userMessage.length 
            });

            // Start streaming workflow using jobId
            try {
                const streamStart = await startStreamingWorkflow(
                    jobId,
                    projectId,
                    TEST_USER_ID,
                    userMessage
                );

                if (!streamStart.success) {
                    throw new Error(streamStart.error || 'Failed to start stream');
                }

                logHandshake('stream_started', { jobId });

                // Show initial system message
                chatEl.postMessage({
                    action: 'displayMessage',
                    type: 'system',
                    content: '🤔 Analyzing your request...',
                    timestamp: new Date().toISOString()
                });

                // Start polling for events using jobId
                await pollForStreamingEvents(jobId);

            } catch (error) {
                logHandshake('streaming_error', { error: error.message });
                chatEl.postMessage({
                    action: 'displayMessage',
                    type: 'system',
                    content: '❌ Failed to process request. Please try again.',
                    timestamp: new Date().toISOString()
                });
                chatEl.postMessage({ action: 'updateStatus', status: 'ready' });
            }
        }
    });

    // Generate new project ID for new projects
    function generateNewProjectId() {
        const timestamp = Date.now();
        const randomId = Math.random().toString(36).substring(2, 8);
        return `proj_${timestamp}_${randomId}`;
    }

    // Poll for streaming events using jobId - fast polling to simulate real-time
    async function pollForStreamingEvents(jobId) {
        const maxAttempts = 60; // 60 attempts = 60 seconds max (with 1s intervals)
        let attempts = 0;
        let lastEventIndex = 0;
        const startedAt = Date.now();
        const intervalMs = 1000; // Poll every 1 second for near-real-time updates
        const timeoutMs = 120000; // 2 minutes max

        logHandshake('streaming_poll_start', { jobId, maxAttempts });

        const poll = async () => {
            attempts++;
            
            try {
                const pollResult = await pollStreamEvents(jobId, lastEventIndex);
                
                if (!pollResult.success) {
                    logHandshake('streaming_poll_error', { jobId, error: pollResult.error });
                    
                    if (pollResult.complete) {
                        chatEl.postMessage({
                            action: 'displayMessage',
                            type: 'system',
                            content: `Error: ${pollResult.error}`,
                            timestamp: new Date().toISOString()
                        });
                    chatEl.postMessage({ action: 'updateStatus', status: 'ready' });
                    return;
                }
                
                // Retry if not complete
                if (Date.now() - startedAt < timeoutMs) {
                    setTimeout(poll, intervalMs);
                }
                return;
            }

            // Process new events
            if (pollResult.events && pollResult.events.length > 0) {
                for (const event of pollResult.events) {
                    processStreamEvent(event);
                }
                lastEventIndex = pollResult.totalEvents;
            }

            // Check if complete
            if (pollResult.complete) {
                logHandshake('streaming_complete', { 
                    jobId, 
                    attempts, 
                    duration: Date.now() - startedAt,
                    totalEvents: pollResult.totalEvents
                });

                // Display final result
                if (pollResult.finalResult) {
                    displayFinalResult(pollResult.finalResult);
                }

                chatEl.postMessage({ action: 'updateStatus', status: 'ready' });
                return;
            }

            // Continue polling if not complete
            if (attempts < maxAttempts && Date.now() - startedAt < timeoutMs) {
                setTimeout(poll, intervalMs);
            } else {
                logHandshake('streaming_timeout', { jobId, attempts });
                chatEl.postMessage({
                    action: 'displayMessage',
                    type: 'system',
                    content: 'Processing timed out. Results may be incomplete.',
                    timestamp: new Date().toISOString()
                });
                chatEl.postMessage({ action: 'updateStatus', status: 'ready' });
            }

        } catch (error) {
            logHandshake('streaming_poll_exception', { jobId, error: error.message });
            chatEl.postMessage({ action: 'updateStatus', status: 'ready' });
        }
        };

        // Start polling
        poll();
    }

    // Process individual stream event
    function processStreamEvent(event) {
        logHandshake('stream_event', { type: event.type, agent: event.agent });

        switch (event.type) {
            case 'connected':
            case 'workflow_start':
            case 'agent_start':
            case 'agent_thinking':
            case 'agent_output':
            case 'agent_complete':
            case 'agent_routing':
            case 'workflow_complete':
                // All streaming messages update the same system message
                chatEl.postMessage({
                    action: 'displayMessage',
                    type: 'system',
                    content: event.message,
                    timestamp: event.timestamp
                });
                break;

            case 'workflow_error':
                chatEl.postMessage({
                    action: 'displayMessage',
                    type: 'system',
                    content: `❌ ${event.message}: ${event.error}`,
                    timestamp: event.timestamp
                });
                break;

            default:
                logHandshake('unknown_event_type', { type: event.type });
        }
    }

    // Display final workflow result
    function displayFinalResult(result) {
        const { projectData, scopeData, schedulerData, updateData, budgetData, analysis } = result;

        // Display AI response if available
        if (projectData?.aiResponse) {
            chatEl.postMessage({
                action: 'displayMessage',
                type: 'assistant',
                content: projectData.aiResponse,
                timestamp: new Date().toISOString()
            });
        }

        // Update project name
        if (projectData?.name && projectData.name !== 'Untitled Project') {
            chatEl.postMessage({ 
                action: 'updateProjectName', 
                projectName: projectData.name 
            });
            updatePageTitle(projectData.name);
        }

        // Display scope if available
        if (projectData?.scope?.description || scopeData?.scope?.description) {
            const scopeDesc = projectData?.scope?.description || scopeData?.scope?.description;
            chatEl.postMessage({
                action: 'displayMessage',
                type: 'system',
                content: `📋 **Project Scope:** ${scopeDesc}`,
                timestamp: new Date().toISOString()
            });
        }

        // Display stages if available
        if (projectData?.stages && projectData.stages.length > 0) {
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
        if (projectData?.tasks && projectData.tasks.length > 0) {
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
        if (projectData?.budget && projectData.budget.total > 0) {
            chatEl.postMessage({
                action: 'displayMessage',
                type: 'system',
                content: `💰 **Budget:** ${projectData.budget.currency} ${projectData.budget.total.toLocaleString()} (Spent: ${projectData.budget.spent.toLocaleString()})`,
                timestamp: new Date().toISOString()
            });
        }

        // Display analysis if available
        if (analysis?.gaps && analysis.gaps.length > 0) {
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
