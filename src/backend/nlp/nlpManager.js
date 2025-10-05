// nlpManager.js - PURELY LAZY VERSION (No Automatic Initialization)
// @ts-ignore - no types

// Import statements at the very top
const { NlpManager } = require('node-nlp');
import { createClient } from 'redis';
import { getSecret } from 'wix-secrets-backend';
import { Logger } from '../utils/logger.js';

// Import training data - static import (no dynamic imports in Wix Velo)
import { 
    trainingData, 
    responseTemplates, 
    intentActionMap 
} from './nlpTrainingData.js';

// Suppress debug module warnings in serverless environment
process.env.DEBUG = '';
process.env.DEBUG_COLORS = 'false';

class LinkificoNLPManager {
    constructor() {
        this.redis = null;
        this.nlpManager = null;
        this.modelKey = 'linkifico:nlp:model:permanent';  // Changed key for permanence
        this.modelVersionKey = 'linkifico:nlp:version:permanent';
        this.modelBackupKey = 'linkifico:nlp:model:backup'; // Backup copy
        this.currentVersion = '1.0.5'; // Base version, will be updated from Redis
        this.confidenceThreshold = 0.7;
        this.isInitialized = false;
        this.isTraining = false;
        this.isModelTrained = false;
    }

    /**
     * Initialize Redis connection and NLP Manager - PURELY LAZY
     * Only does work when explicitly called by user action
     */
    async initialize() {
        if (this.isInitialized) {
            Logger.log('nlpManager', 'initialize', 'Already initialized');
            return;
        }

        try {
            Logger.log('nlpManager', 'initialize', 'Starting LAZY initialization - user requested');

            // Initialize Redis connection
            await this.initRedis();

            // Load current version from Redis first
            await this.loadCurrentVersion();

            // Create NLP Manager instance
            this.nlpManager = new NlpManager({
                languages: ['en'],
                forceNER: true,
                autoSave: false,
                autoLoad: false,
                modelFileName: false,
                nlu: {
                    useNoneFeature: true,
                    log: false
                },
                ner: {
                    useDuckling: false,
                    useBuiltins: true
                }
            });

            // Try to load existing model from Redis
            const modelLoaded = await this.loadModel();
            
            if (!modelLoaded) {
                Logger.log('nlpManager', 'initialize', 'No existing model found - ready for training');
                this.isModelTrained = false;
            } else {
                Logger.log('nlpManager', 'initialize', 'Existing model loaded successfully');
                this.isModelTrained = true;
            }

            this.isInitialized = true;
            Logger.log('nlpManager', 'initialize', 'LAZY initialization completed - ready for user actions');

        } catch (error) {
            Logger.error('nlpManager', 'initialize', error);
            throw error;
        }
    }

    /**
     * Initialize Redis connection
     */
    async initRedis() {
        try {
            if (!this.redis) {
                const redisUrl = await getSecret('REDIS_CONNECTION_URL');
                this.redis = createClient({
                    url: redisUrl
                });
                await this.redis.connect();
                Logger.log('nlpManager', 'initRedis', 'Redis connected for NLP storage');
            }
        } catch (error) {
            Logger.error('nlpManager', 'initRedis', error);
            throw error;
        }
    }

    /**
     * Load current version from Redis
     */
    async loadCurrentVersion() {
        try {
            await this.initRedis();
            const savedVersion = await this.redis.get(this.modelVersionKey);
            if (savedVersion) {
                this.currentVersion = savedVersion;
                Logger.log('nlpManager', 'loadCurrentVersion', `Loaded version from Redis: ${this.currentVersion}`);
            } else {
                Logger.log('nlpManager', 'loadCurrentVersion', `No saved version in Redis, using default: ${this.currentVersion}`);
            }
        } catch (error) {
            Logger.error('nlpManager', 'loadCurrentVersion', error);
            // Keep default version if Redis fails
        }
    }

    /**
     * Train the NLP model with minimal training data
     */
    async trainModel() {
        if (this.isTraining) {
            Logger.warn('nlpManager', 'trainModel', 'Training already in progress');
            return false;
        }

        try {
            this.isTraining = true;
            this.isModelTrained = false;
            Logger.log('nlpManager', 'trainModel', 'Starting NLP model training');

            // Create fresh NLP manager for training - NO FILE SYSTEM
            this.nlpManager = new NlpManager({
                languages: ['en'],
                forceNER: true,
                autoSave: false,      // NO file save
                autoLoad: false,      // NO file load
                modelFileName: false, // NO model file
                nlu: {
                    useNoneFeature: true,
                    log: false
                },
                ner: {
                    useDuckling: false,
                    useBuiltins: true
                }
            });

            // Use training data from static import

            // Add training data from file
            for (const example of trainingData) {
                this.nlpManager.addDocument('en', example.text, example.intent);
            }

            // Add responses from file
            for (const [intent, responses] of Object.entries(responseTemplates)) {
                for (const response of responses) {
                    this.nlpManager.addAnswer('en', intent, response);
                }
            }

            Logger.log('nlpManager', 'trainModel', `Added ${trainingData.length} training examples with ${Object.keys(responseTemplates).length} intent responses`);

            // TRAIN the model - this should NOT try to save to file system
            const startTime = Date.now();
            await this.nlpManager.train();
            const trainingTime = Date.now() - startTime;

            // Mark as trained
            this.isModelTrained = true;

            Logger.log('nlpManager', 'trainModel', `Training completed in ${trainingTime}ms`);

            // Test the model immediately after training
            const testResult = await this.testModelAfterTraining();
            Logger.log('nlpManager', 'trainModel', `Post-training test: ${testResult}`);

            // Save model to Redis PERMANENTLY
            await this.saveModel();
            
            // Reload the model from Redis to ensure it's available for immediate testing
            await this.loadModel();

            this.isTraining = false;
            return true;

        } catch (error) {
            this.isTraining = false;
            this.isModelTrained = false;
            Logger.error('nlpManager', 'trainModel', error);
            throw error;
        }
    }

    /**
     * Test model immediately after training
     */
    async testModelAfterTraining() {
        try {
            const testPhrases = [
                'create a new project',
                'add tasks',
                'yes looks good'
            ];

            const results = [];
            for (const phrase of testPhrases) {
                const result = await this.nlpManager.process('en', phrase);
                results.push(`"${phrase}" -> ${result.intent} (${(result.score * 100).toFixed(1)}%)`);
            }
            
            return results.join('; ');
        } catch (error) {
            return `Test failed: ${error.message}`;
        }
    }

    /**
     * Save trained model to Redis PERMANENTLY (NO TTL)
     */
    async saveModel() {
        try {
            if (!this.nlpManager || !this.isModelTrained) {
                throw new Error('NLP Manager not trained');
            }

            await this.initRedis();

            // Export model as JSON (in-memory only)
            const modelData = this.nlpManager.export(true); // minified = true
            
            Logger.log('nlpManager', 'saveModel', `Exporting model data (${modelData.length} chars)`);
            
            // PERMANENT STORAGE - NO TTL!
            await this.redis.set(this.modelKey, modelData); // NO EXPIRATION
            await this.redis.set(this.modelVersionKey, this.currentVersion); // NO EXPIRATION
            
            // Also create a backup copy
            await this.redis.set(this.modelBackupKey, modelData); // NO EXPIRATION
            
            // Set a timestamp for when model was saved
            await this.redis.set('linkifico:nlp:last_saved', new Date().toISOString());

            Logger.log('nlpManager', 'saveModel', `Test model saved to Redis`);
            return true;

        } catch (error) {
            Logger.error('nlpManager', 'saveModel', error);
            return false;
        }
    }

    /**
     * Load model from Redis PERMANENT storage
     */
    async loadModel() {
        try {
            await this.initRedis();

            // Check if model exists in Redis
            const modelData = await this.redis.get(this.modelKey);
            if (!modelData) {
                Logger.log('nlpManager', 'loadModel', 'No permanent model found in Redis');
                
                // Try backup
                const backupData = await this.redis.get(this.modelBackupKey);
                if (backupData) {
                    Logger.log('nlpManager', 'loadModel', 'Found backup model, using that');
                    // Restore from backup
                    await this.redis.set(this.modelKey, backupData);
                    return await this.loadModel(); // Recursive call to load restored model
                }
                
                return false;
            }

            // Check version
            const savedVersion = await this.redis.get(this.modelVersionKey);
            if (savedVersion !== this.currentVersion) {
                Logger.log('nlpManager', 'loadModel', 
                    `Version mismatch (saved: ${savedVersion}, current: ${this.currentVersion}), will retrain`);
                return false;
            }

            // Create fresh NLP manager for loading - NO FILE SYSTEM
            this.nlpManager = new NlpManager({
                languages: ['en'],
                forceNER: true,
                autoSave: false,      // NO file save
                autoLoad: false,      // NO file load
                modelFileName: false, // NO model file
                nlu: {
                    useNoneFeature: true,
                    log: false
                },
                ner: {
                    useDuckling: false,
                    useBuiltins: true
                }
            });

            // Import the model from Redis data
            this.nlpManager.import(modelData);
            this.isModelTrained = true;
            
            Logger.log('nlpManager', 'loadModel', 'PERMANENT model loaded successfully from Redis');
            
            // Test loaded model
            const testResult = await this.testModelAfterTraining();
            Logger.log('nlpManager', 'loadModel', `Post-load test: ${testResult}`);
            
            return true;

        } catch (error) {
            Logger.error('nlpManager', 'loadModel', error);
            this.isModelTrained = false;
            return false;
        }
    }

    /**
     * Process user input and return intent analysis - REAL IMPLEMENTATION
     */
    async processInput(text, sessionContext = {}) {
        try {
            // Ensure model is ready
            await this.ensureModelReady();

            if (!this.nlpManager || !this.isModelTrained) {
                throw new Error('NLP Manager not available or not trained');
            }

            Logger.log('nlpManager', 'processInput', `Processing: "${text}"`);

            // Process the input with the real trained model
            const result = await this.nlpManager.process('en', text);
            
            Logger.log('nlpManager', 'processInput', `Raw result: intent=${result.intent}, score=${result.score}`);
            
            // Extract relevant information
            const analysis = {
                originalText: text,
                intent: result.intent,
                confidence: result.score,
                entities: result.entities || [],
                sentiment: result.sentiment,
                answer: result.answer,
                
                // Map to our action system
                mappedIntent: null,
                mappedAction: null,
                isHighConfidence: result.score >= this.confidenceThreshold,
                
                // Additional context
                language: result.language,
                domain: result.domain,
                classifications: result.classifications || []
            };

            Logger.log('nlpManager', 'processInput', {
                text: text.substring(0, 50) + '...',
                intent: analysis.intent,
                confidence: analysis.confidence
            });

            return analysis;

        } catch (error) {
            Logger.error('nlpManager', 'processInput', error);
            
            // Return fallback analysis
            return {
                originalText: text,
                intent: 'general.help',
                confidence: 0.3,
                entities: [],
                sentiment: { score: 0, comparative: 0, vote: 'neutral' },
                answer: 'I\'ll help you with that.',
                mappedIntent: 'GENERAL_INQUIRY',
                mappedAction: 'QUERY',
                isHighConfidence: false,
                error: error.message
            };
        }
    }

    /**
     * Ensure model is ready - PURELY LAZY
     * Only initializes when explicitly needed
     */
    async ensureModelReady() {
        if (!this.isInitialized) {
            Logger.log('nlpManager', 'ensureModelReady', 'Model not ready - initializing on demand');
            await this.initialize();
        }
        
        // If no model is trained, try to load from Redis
        if (!this.isModelTrained) {
            Logger.log('nlpManager', 'ensureModelReady', 'No trained model in memory - checking Redis');
            const loaded = await this.loadModel();
            if (!loaded) {
                Logger.log('nlpManager', 'ensureModelReady', 'No trained model - ready for user to train');
                return;
            }
        }
    }

    /**
     * Check if the model has been trained
     */
    hasTrainedModel() {
        return this.isModelTrained && !!this.nlpManager;
    }

    async forceRetrain() {
        return await this.trainModel();
    }

    async cleanup() {
        if (this.redis) {
            await this.redis.quit();
            this.redis = null;
        }
        this.nlpManager = null;
        this.isInitialized = false;
        this.isModelTrained = false;
    }
    
    /**
     * Delete model from Redis storage
     */
    async deleteModel() {
        try {
            if (!this.redis) {
                await this.initRedis();
            }
            
            // Delete model data
            const modelDeleted = await this.redis.del(this.modelKey);
            
            // Delete version info
            await this.redis.del(this.modelVersionKey);
            
            // Delete backup if exists
            await this.redis.del(this.modelBackupKey);
            
            Logger.log('nlpManager', 'deleteModel', `Model deleted: ${modelDeleted > 0 ? 'found and deleted' : 'not found'}`);
            
            return modelDeleted > 0;
            
        } catch (error) {
            Logger.error('nlpManager', 'deleteModel', error);
            return false;
        }
    }
    
    /**
     * Increment version number
     */
    incrementVersion() {
        const versionParts = this.currentVersion.split('.');
        const major = parseInt(versionParts[0]);
        const minor = parseInt(versionParts[1]);
        const patch = parseInt(versionParts[2]);
        
        // Increment patch version
        const newPatch = patch + 1;
        this.currentVersion = `${major}.${minor}.${newPatch}`;
        
        Logger.log('nlpManager', 'incrementVersion', `Version incremented to ${this.currentVersion}`);
    }

}

// Export singleton instance
export default new LinkificoNLPManager();
