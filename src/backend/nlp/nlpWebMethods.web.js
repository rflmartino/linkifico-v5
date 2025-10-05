// nlpWebMethods.web.js - Web methods for NLP management from frontend

import { Permissions, webMethod } from 'wix-web-module';
import { Logger } from '../utils/logger.js';
import { 
    performNLPTraining,
    initializeNLPSystem,
    testNLPSystem,
    getModelStatus,
    processSingleInput,
    performHealthCheck,
    resetModelAndIncrementVersion
} from './nlpTrainingHelpers.js';

/**
 * Train the NLP model (admin function)
 * This can be called from frontend to retrain the model
 */
export const trainNLPModel = webMethod(Permissions.Anyone, async () => {
    try {
        Logger.log('nlpWebMethods', 'trainNLPModel', 'Starting model training via web method');
        
        const result = await performNLPTraining();
        
        if (result.success) {
            return {
                success: true,
                message: result.message,
                stats: result.stats
            };
        } else {
            return {
                success: false,
                message: result.message,
                error: result.error
            };
        }
        
    } catch (error) {
        Logger.error('nlpWebMethods', 'trainNLPModel', error);
        return {
            success: false,
            message: 'Error training model',
            error: error.message
        };
    }
});

/**
 * Get NLP model status and statistics
 */
export const getNLPModelStatus = webMethod(Permissions.Anyone, async () => {
    try {
        Logger.log('nlpWebMethods', 'getNLPModelStatus', 'Getting model status via web method');
        const result = await getModelStatus();
        Logger.log('nlpWebMethods', 'getNLPModelStatus', 'Model status retrieved successfully');
        return result;
        
    } catch (error) {
        Logger.error('nlpWebMethods', 'getNLPModelStatus', error);
        return {
            success: false,
            error: error.message,
            stats: { isReady: false }
        };
    }
});

/**
 * Test the NLP model with comprehensive test cases
 */
export const testNLPModel = webMethod(Permissions.Anyone, async (testInputs = null) => {
    try {
        // Define test suite if no custom inputs provided
        const testCases = testInputs || [
            'create a new project',
            'add tasks to my project',
            'set budget to 10000',
            'yes that looks good',
            'no change it',
            'what is the project status',
            'help me'
        ];
        
        Logger.log('nlpWebMethods', 'testNLPModel', `Running test with ${testCases.length} cases`);
        
        // Call the existing testNLPSystem function
        const result = await testNLPSystem(testCases);
        
        return result;
        
    } catch (error) {
        Logger.error('nlpWebMethods', 'testNLPModel', error);
        return {
            success: false,
            error: error.message,
            results: []
        };
    }
});

/**
 * Process a single input through the NLP model (for debugging)
 */
export const processNLPInput = webMethod(Permissions.Anyone, async (input) => {
    try {
        const result = await processSingleInput(input);
        
        // Enhanced logging for single input processing
        if (result.success && result.result) {
            Logger.log('nlpWebMethods', 'processNLPInput', 
                `Input: "${input}" -> Intent: ${result.result.intent} (${(result.result.confidence * 100).toFixed(1)}%)`
            );
        }
        
        return result;
        
    } catch (error) {
        Logger.error('nlpWebMethods', 'processNLPInput', error);
        return {
            success: false,
            error: error.message
        };
    }
});

/**
 * Initialize NLP model (ensure it's ready)
 */
export const initializeNLP = webMethod(Permissions.Anyone, async () => {
    try {
        Logger.log('nlpWebMethods', 'initializeNLP', 'Initializing NLP from frontend');
        
        const result = await initializeNLPSystem();
        return result;
        
    } catch (error) {
        Logger.error('nlpWebMethods', 'initializeNLP', error);
        return {
            success: false,
            error: error.message
        };
    }
});

/**
 * Reset NLP model - deletes old model and increments version
 */
export const resetNLPModel = webMethod(Permissions.Anyone, async () => {
    try {
        Logger.log('nlpWebMethods', 'resetNLPModel', 'Starting model reset');
        
        const result = await resetModelAndIncrementVersion();
        
        if (result.success) {
            return {
                success: true,
                message: result.message,
                stats: result.stats
            };
        } else {
            return {
                success: false,
                message: result.message,
                error: result.error
            };
        }
        
    } catch (error) {
        Logger.error('nlpWebMethods', 'resetNLPModel', error);
        return {
            success: false,
            message: 'Error resetting model',
            error: error.message
        };
    }
});

/**
 * Health check for NLP system
 */
export const nlpHealthCheck = webMethod(Permissions.Anyone, async () => {
    try {
        const result = await performHealthCheck();
        return result;
        
    } catch (error) {
        Logger.error('nlpWebMethods', 'nlpHealthCheck', error);
        return {
            success: false,
            error: error.message
        };
    }
});
