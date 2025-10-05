// Page Code for NLP Admin (Wix Velo) - WITH WEB LOGGING
import { 
    trainNLPModel, 
    getNLPModelStatus, 
    testNLPModel, 
    initializeNLP,
    processNLPInput,
    resetNLPModel  // Add reset method
} from 'backend/nlp/nlpWebMethods.web.js';

import { logToBackend } from 'backend/utils/webLogger.web.js';
// Remove: import { processSingleInput } from 'backend/nlp/nlpTrainingHelpers.js';

$w.onReady(function () {
    try {
        logToBackend('PMaaS-Dashboard', 'onReady', { 
            message: 'Page ready - LAZY LOADING APPROACH',
            timestamp: new Date().toISOString()
        });
        
        setupHTMLCommunication();
        logToBackend('PMaaS-Dashboard', 'onReady', { message: 'HTML communication setup completed' });
    } catch (error) {
        logToBackend('PMaaS-Dashboard', 'onReady', null, error);
    }
});

function setupHTMLCommunication() {
    try {
        const htmlElement = $w('#htmlNLPConsole');
        
        if (!htmlElement) {
            logToBackend('PMaaS-Dashboard', 'setupHTMLCommunication', null, 'HTML element #htmlNLPConsole not found');
            return;
        }
        
        htmlElement.onMessage((event) => {
            try {
                const data = (event && event.data) || event;
                const action = data.action;
                
                if (action) {
                    logToBackend('PMaaS-Dashboard', 'onMessage', { action: action, requestId: data.requestId });
                    handleHTMLCall(data, htmlElement);
                } else {
                    logToBackend('PMaaS-Dashboard', 'onMessage', { 
                        message: 'Message not processed - no action field',
                        availableFields: Object.keys(data)
                    });
                }
            } catch (error) {
                logToBackend('PMaaS-Dashboard', 'onMessage', null, error);
            }
        });
        
        logToBackend('PMaaS-Dashboard', 'setupHTMLCommunication', { message: 'HTML communication setup complete' });
    } catch (error) {
        logToBackend('PMaaS-Dashboard', 'setupHTMLCommunication', null, error);
    }
}

async function handleHTMLCall(data, htmlElement) {
    const { action, args, requestId } = data;
    
    try {
        let result;
        
        switch (action) {
            case 'getNLPModelStatus':
                result = await getNLPModelStatus();
                break;
                
            case 'trainNLPModel':
                result = await trainNLPModel();
                break;
                
            case 'testNLPModel':
                result = await testNLPModel(...(args || []));
                break;
                
            case 'initializeNLP':
                result = await initializeNLP();
                break;
                
            case 'processNlpInput':
                result = await processNLPInput(data.input);  // Use the web method
                break;
                
            case 'resetNLPModel':
                result = await resetNLPModel();
                break;
                
            case 'test':
                result = { 
                    message: 'Test successful!', 
                    timestamp: new Date().toISOString(),
                    receivedData: data
                };
                break;
                
            default:
                throw new Error(`Unknown action: ${action}`);
        }
        
        logToBackend('PMaaS-Dashboard', 'handleHTMLCall', { 
            action: action, 
            success: true, 
            requestId: requestId 
        });
        sendToHTML(htmlElement, { requestId, success: true, result });
        
    } catch (error) {
        logToBackend('PMaaS-Dashboard', 'handleHTMLCall', null, error);
        sendToHTML(htmlElement, { requestId, success: false, error: error.message });
    }
}

function sendToHTML(htmlElement, data) {
    try {
        htmlElement.postMessage(data);
        logToBackend('PMaaS-Dashboard', 'sendToHTML', { 
            success: data.success, 
            hasRequestId: !!data.requestId,
            hasResult: !!data.result,
            hasError: !!data.error
        });
    } catch (error) {
        logToBackend('PMaaS-Dashboard', 'sendToHTML', null, error);
    }
}