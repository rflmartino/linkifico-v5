// Project Portfolio Page - Velo Frontend
// Manages user project portfolio with HTML embed integration

import wixUsers from 'wix-users';
import wixLocation from 'wix-location';
import { processUserRequest } from 'backend/entrypoint.web.js';
import { logToBackend } from 'backend/utils/webLogger.web.js';

// ========================================
// TEST MODE CONFIGURATION
// ========================================
// Set to true for development/testing with hardcoded users
// Set to false for production with real Wix users
const TEST_MODE = true;

// Test user profiles (no scenario constraints - they use real backend data)
const TEST_USERS = {
    'test_user_001': {
        id: 'test_user_001',
        email: 'test.user@linkifico.com',
        loggedIn: true
    },
    'test_user_002': {
        id: 'test_user_002', 
        email: 'new.user@linkifico.com',
        loggedIn: true
    },
    'test_user_003': {
        id: 'test_user_003',
        email: 'premium.user@linkifico.com',
        loggedIn: true
    }
};

// Current active test user (change this to test different users)
const ACTIVE_TEST_USER = 'test_user_001';
// ========================================

let currentUser = null;
let portfolioHtmlElement = null;

$w.onReady(async function () {
    try {
        await logToBackend('Project-Portfolio', 'onReady', { message: 'Page loading...' });
        
        // Initialize user authentication
        await initializeUser();
        
        // Initialize HTML embed
        await initializePortfolioEmbed();
        
        // Load portfolio data automatically after HTML embed is ready
        setTimeout(async () => {
            await handleLoadPortfolio();
        }, 1000);
        
        await logToBackend('Project-Portfolio', 'onReady', { 
            message: 'PAGE FULLY INITIALIZED: All systems ready',
            testMode: TEST_MODE,
            activeTestUser: TEST_MODE ? ACTIVE_TEST_USER : null,
            userId: currentUser?.id,
            htmlElementReady: !!portfolioHtmlElement,
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        await logToBackend('Project-Portfolio', 'onReady', null, error);
    }
});

// Initialize user authentication
async function initializeUser() {
    try {
        if (TEST_MODE) {
            // Use hardcoded test user
            const testUser = TEST_USERS[ACTIVE_TEST_USER];
            if (!testUser) {
                throw new Error(`Test user '${ACTIVE_TEST_USER}' not found in TEST_USERS`);
            }
            
            currentUser = testUser;
            
            await logToBackend('Project-Portfolio', 'initializeUser', {
                message: 'TEST MODE: Using hardcoded test user',
                testMode: true,
                userId: currentUser.id,
                email: currentUser.email
            });
            
        } else {
            // Use real Wix user authentication
            currentUser = wixUsers.currentUser;
            
            if (!currentUser.loggedIn) {
                await logToBackend('Project-Portfolio', 'initializeUser', { message: 'User not logged in, redirecting...' });
                wixLocation.to('/login');
                return;
            }
            
            await logToBackend('Project-Portfolio', 'initializeUser', {
                message: 'PRODUCTION MODE: User authenticated',
                testMode: false,
                userId: currentUser.id,
                email: currentUser.email
            });
        }
        
    } catch (error) {
        await logToBackend('Project-Portfolio', 'initializeUser', null, error);
        if (!TEST_MODE) {
            wixLocation.to('/login');
        }
    }
}

// Initialize the HTML embed for portfolio view
async function initializePortfolioEmbed() {
    try {
        portfolioHtmlElement = $w('#htmlPortfolioView');
        
        if (!portfolioHtmlElement) {
            await logToBackend('Project-Portfolio', 'initializePortfolioEmbed', null, 'HTML element #htmlPortfolioView not found');
            return;
        }
        
        await logToBackend('Project-Portfolio', 'initializePortfolioEmbed', { 
            message: 'HTML element found, setting up communication',
            elementType: portfolioHtmlElement.type
        });
        
        // Set up message listener for HTML embed communication
        portfolioHtmlElement.onMessage((event) => {
            handlePortfolioMessage(event);
        });
        
        // Set HTML content directly (alternative approach)
        // portfolioHtmlElement.html = `your HTML content here`;
        
        await logToBackend('Project-Portfolio', 'initializePortfolioEmbed', { 
            message: 'HTML embed communication setup complete'
        });
        
    } catch (error) {
        await logToBackend('Project-Portfolio', 'initializePortfolioEmbed', null, error);
    }
}

// Handle messages from the HTML embed
async function handlePortfolioMessage(event) {
    const { type, data } = event.data;
    
    await logToBackend('Project-Portfolio', 'handlePortfolioMessage', { type: type, message: 'Received message from embed' });
    
    try {
        switch (type) {
            case 'LOAD_PORTFOLIO':
                await handleLoadPortfolio();
                break;
                
            case 'NEW_PROJECT':
                await handleNewProject();
                break;
                
            case 'CREATE_PROJECT':
                await handleCreateProject(data.templateName, data.userInput);
                break;
                
            case 'OPEN_PROJECT':
                await handleOpenProject(data.projectId);
                break;
                
            case 'ARCHIVE_PROJECT':
                await handleArchiveProject(data.projectId);
                break;
                
            case 'RESTORE_PROJECT':
                await handleRestoreProject(data.projectId);
                break;
                
            case 'DELETE_PROJECT':
                await handleDeleteProject(data.projectId);
                break;
                
            default:
                await logToBackend('Project-Portfolio', 'handlePortfolioMessage', { 
                    message: 'Unknown message type received',
                    type: type,
                    level: 'warning'
                });
        }
        
    } catch (error) {
        await logToBackend('Project-Portfolio', 'handlePortfolioMessage', { type: type }, error);
        await sendToEmbed('ERROR', null, error.message);
    }
}

// Load user's portfolio data
async function handleLoadPortfolio() {
    try {
        await logToBackend('Project-Portfolio', 'handleLoadPortfolio', { 
            message: 'Loading portfolio data...',
            testMode: TEST_MODE,
            userId: currentUser.id
        });
        
        // Always call real backend (test mode only affects user authentication)
        const response = await processUserRequest({
            op: 'loadPortfolio',
            projectId: 'portfolio', // Dummy projectId for portfolio operations
            userId: currentUser.id,
            sessionId: `portfolio_${Date.now()}`,
            payload: {}
        });
        
        await logToBackend('Project-Portfolio', 'handleLoadPortfolio', { 
            message: TEST_MODE ? 'TEST MODE: Portfolio loaded from backend with test user' : 'PRODUCTION MODE: Portfolio loaded from backend',
            testMode: TEST_MODE,
            totalProjects: response.data?.totalProjects || 0
        });
        
        if (response.success) {
            await sendToEmbed('PORTFOLIO_DATA', response);
        } else {
            await logToBackend('Project-Portfolio', 'handleLoadPortfolio', null, 'Failed to load portfolio: ' + (response.error || 'Unknown error'));
            await sendToEmbed('PORTFOLIO_ERROR', null, response.error || 'Failed to load portfolio');
        }
        
    } catch (error) {
        await logToBackend('Project-Portfolio', 'handleLoadPortfolio', null, error);
        await sendToEmbed('PORTFOLIO_ERROR', null, error.message);
    }
}

// Handle new project creation (legacy - opens modal)
async function handleNewProject() {
    try {
        await logToBackend('Project-Portfolio', 'handleNewProject', { 
            message: 'Opening new project modal...',
            testMode: TEST_MODE
        });
        
        // The HTML embed will handle showing the modal
        // This function is kept for compatibility
        
    } catch (error) {
        await logToBackend('Project-Portfolio', 'handleNewProject', null, error);
        await sendToEmbed('ERROR', null, error.message);
    }
}

// Handle project creation with template and user input
async function handleCreateProject(templateName, userInput) {
    const transitionStartTime = Date.now();
    
    try {
        await logToBackend('Project-Portfolio', 'handleCreateProject', { 
            message: 'TRANSITION START: Creating project with template',
            templateName: templateName,
            inputLength: userInput.length,
            testMode: TEST_MODE,
            transitionId: transitionStartTime
        });
        
        // Generate new project ID
        const newProjectId = generateNewProjectId();
        
        await logToBackend('Project-Portfolio', 'handleCreateProject', { 
            message: 'BACKEND CALL START: Calling processUserRequest init',
            projectId: newProjectId,
            transitionId: transitionStartTime
        });
        
        // Call backend to initialize project with user input
        const backendStartTime = Date.now();
        const response = await processUserRequest({
            op: 'init',
            projectId: newProjectId,
            userId: currentUser.id,
            sessionId: `create_${Date.now()}`,
            payload: { 
                templateName: templateName,
                projectName: 'Untitled Project', // AI will rename based on input
                initialMessage: userInput 
            }
        });
        
        const backendDuration = Date.now() - backendStartTime;
        
        if (response.success) {
            await logToBackend('Project-Portfolio', 'handleCreateProject', { 
                message: 'BACKEND CALL SUCCESS: Project created, starting AI processing',
                projectId: newProjectId,
                backendDurationMs: backendDuration,
                transitionId: transitionStartTime
            });
            
            // Start AI processing asynchronously (non-blocking)
            try {
                await logToBackend('Project-Portfolio', 'handleCreateProject', { 
                    message: 'AI PROCESSING START: Starting async intelligence loop',
                    projectId: newProjectId,
                    initialMessage: userInput
                });
                
                // Submit job to queue - don't await, let it run in background
                processUserRequest({
                    op: 'submitJob',
                    projectId: newProjectId,
                    userId: currentUser.id,
                    sessionId: `create_${Date.now()}`,
                    payload: { 
                        jobType: 'init',
                        initialMessage: userInput,
                        templateName: 'simple_waterfall',
                        projectName: projectName
                    }
                }).then((result) => {
                    logToBackend('Project-Portfolio', 'handleCreateProject', { 
                        message: 'JOB SUBMITTED: Project initialization job queued',
                        projectId: newProjectId,
                        jobId: result.jobId
                    });
                }).catch((aiError) => {
                    logToBackend('Project-Portfolio', 'handleCreateProject', null, 
                        `JOB SUBMISSION ERROR: ${aiError.message} (ProjectId: ${newProjectId})`);
                });
                
            } catch (aiError) {
                await logToBackend('Project-Portfolio', 'handleCreateProject', null, 
                    `AI PROCESSING SETUP ERROR: ${aiError.message} (ProjectId: ${newProjectId})`);
                // Continue with navigation even if AI processing setup fails
            }
            
            // Navigate to workspace with the new project (using single quotes for Wix compatibility)
            wixLocation.to('/project-workspace?projectId=' + newProjectId + '&userId=' + currentUser.id);
            
        } else {
            const errorMessage = 'BACKEND CALL FAILED: ' + (response.error || 'Unknown error') + ' (Duration: ' + backendDuration + 'ms, TransitionId: ' + transitionStartTime + ')';
            await logToBackend('Project-Portfolio', 'handleCreateProject', null, errorMessage);
            await sendToEmbed('ERROR', null, response.error || 'Failed to create project');
        }
        
    } catch (error) {
        const errorMessage = 'TRANSITION ERROR: ' + error.message + ' (TransitionId: ' + transitionStartTime + ', Duration: ' + (Date.now() - transitionStartTime) + 'ms)';
        await logToBackend('Project-Portfolio', 'handleCreateProject', null, errorMessage);
        await sendToEmbed('ERROR', null, error.message);
    }
}

// Generate new project ID
function generateNewProjectId() {
    const timestamp = Date.now();
    const randomId = Math.random().toString(36).substring(2, 8);
    return `proj_${timestamp}_${randomId}`;
}

// Handle opening a project
async function handleOpenProject(projectId) {
    const transitionStartTime = Date.now();
    
    try {
        await logToBackend('Project-Portfolio', 'handleOpenProject', { 
            message: 'TRANSITION START: Opening existing project',
            projectId: projectId, 
            testMode: TEST_MODE,
            transitionId: transitionStartTime
        });
        
        // Log navigation attempt
        await logToBackend('Project-Portfolio', 'handleOpenProject', { 
            message: 'NAVIGATION START: Redirecting to workspace for existing project',
            projectId: projectId,
            userId: currentUser.id,
            targetUrl: '/project-workspace?projectId=' + projectId + '&userId=' + currentUser.id,
            transitionId: transitionStartTime
        });
        
        // Navigate to project workspace with userId parameter (using single quotes for Wix compatibility)
        wixLocation.to('/project-workspace?projectId=' + projectId + '&userId=' + currentUser.id);
        
    } catch (error) {
        logToBackend('Project-Portfolio', 'handleOpenProject', null, `TRANSITION ERROR: ${error.message} (ProjectId: ${projectId}, TransitionId: ${transitionStartTime})`);
        await sendToEmbed('ERROR', null, error.message);
    }
}

// Handle archiving a project
async function handleArchiveProject(projectId) {
    try {
        await logToBackend('Project-Portfolio', 'handleArchiveProject', { 
            projectId: projectId, 
            message: 'Archiving project',
            testMode: TEST_MODE
        });
        
        // Always call real backend (test mode only affects user authentication)
        const response = await processUserRequest({
            op: 'archiveProject',
            projectId: 'portfolio',
            userId: currentUser.id,
            sessionId: `archive_${Date.now()}`,
            payload: { projectId }
        });
        
        await sendToEmbed('ARCHIVE_RESPONSE', response);
        
    } catch (error) {
        await logToBackend('Project-Portfolio', 'handleArchiveProject', { projectId: projectId }, error);
        await sendToEmbed('ERROR', null, error.message);
    }
}

// Handle restoring a project
async function handleRestoreProject(projectId) {
    try {
        await logToBackend('Project-Portfolio', 'handleRestoreProject', { 
            projectId: projectId, 
            message: 'Restoring project',
            testMode: TEST_MODE
        });
        
        // Always call real backend (test mode only affects user authentication)
        const response = await processUserRequest({
            op: 'restoreProject',
            projectId: 'portfolio',
            userId: currentUser.id,
            sessionId: `restore_${Date.now()}`,
            payload: { projectId }
        });
        
        await sendToEmbed('RESTORE_RESPONSE', response);
        
    } catch (error) {
        await logToBackend('Project-Portfolio', 'handleRestoreProject', { projectId: projectId }, error);
        await sendToEmbed('ERROR', null, error.message);
    }
}

// Handle deleting a project
async function handleDeleteProject(projectId) {
    try {
        await logToBackend('Project-Portfolio', 'handleDeleteProject', { 
            projectId: projectId, 
            message: 'Deleting project',
            testMode: TEST_MODE
        });
        
        // Always call real backend (test mode only affects user authentication)
        const response = await processUserRequest({
            op: 'deleteProject',
            projectId: 'portfolio',
            userId: currentUser.id,
            sessionId: `delete_${Date.now()}`,
            payload: { projectId }
        });
        
        await sendToEmbed('DELETE_RESPONSE', response);
        
    } catch (error) {
        await logToBackend('Project-Portfolio', 'handleDeleteProject', { projectId: projectId }, error);
        await sendToEmbed('ERROR', null, error.message);
    }
}

// Send message to HTML embed
async function sendToEmbed(type, data, error = null) {
    try {
        if (!portfolioHtmlElement) {
            await logToBackend('Project-Portfolio', 'sendToEmbed', null, 'Cannot send message - HTML element not initialized');
            return;
        }
        
        const message = {
            type: type,
            data: data,
            error: error
        };
        
        await logToBackend('Project-Portfolio', 'sendToEmbed', { 
            type: type, 
            message: 'Sending to embed',
            messageStructure: JSON.stringify({
                type: type,
                hasData: !!data,
                hasError: !!error,
                dataKeys: data ? Object.keys(data) : 'none'
            })
        });
        
        portfolioHtmlElement.postMessage(message);
        
        await logToBackend('Project-Portfolio', 'sendToEmbed', { 
            type: type, 
            message: 'Message sent successfully to embed'
        });
        
    } catch (error) {
        await logToBackend('Project-Portfolio', 'sendToEmbed', null, error);
    }
}


// Export functions for potential external access
export { handleLoadPortfolio, handleNewProject };
