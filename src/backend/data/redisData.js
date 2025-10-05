// redisData.js - Centralized data management with batch Redis operations
// Reduces Redis calls from 25+ per interaction to just 2 (load + save)

import { Logger } from '../utils/logger.js';
import { 
    getProjectData, saveProjectData,
    getKnowledgeData, saveKnowledgeData,
    getGapData, saveGapData,
    getLearningData, saveLearningData,
    getReflectionData, saveReflectionData,
    getChatHistory, saveChatHistory,
    getProcessing, saveProcessing,
    createProjectData, createKnowledgeData, createGapData, createLearningData, createReflectionData,
    getRedisClient
} from './projectData.js';

export const redisData = {
    
    // Load all data for a project and user in a single Redis operation
    async loadAllData(projectId, userId) {
        try {
            const [
                projectData,
                chatHistory,
                knowledgeData,
                gapData,
                learningData,
                reflectionData
            ] = await Promise.all([
                getProjectData(projectId),
                getChatHistory(projectId, userId),
                getKnowledgeData(projectId, userId),
                getGapData(projectId, userId),
                getLearningData(userId),
                getReflectionData(projectId, userId)
            ]);
            
            return {
                projectData: projectData || this.createDefaultProjectData(projectId),
                chatHistory: chatHistory || [],
                knowledgeData: knowledgeData || this.createDefaultKnowledgeData(projectId),
                gapData: gapData || this.createDefaultGapData(projectId),
                learningData: learningData || this.createDefaultLearningData(userId),
                reflectionData: reflectionData || this.createDefaultReflectionData(projectId)
            };
            
        } catch (error) {
            Logger.error('redisData', 'loadAllData_error', error, { projectId, userId });
            // Return default data structures on error
            return {
                projectData: this.createDefaultProjectData(projectId),
                chatHistory: [],
                knowledgeData: this.createDefaultKnowledgeData(projectId),
                gapData: this.createDefaultGapData(projectId),
                learningData: this.createDefaultLearningData(userId),
                reflectionData: this.createDefaultReflectionData(projectId)
            };
        }
    },

    // Generate unique project email with collision checking
    async generateUniqueProjectEmail() {
        try {
            let attempts = 0;
            
            while (attempts < 10) {
                const emailId = Math.floor(100000 + Math.random() * 900000).toString();
                const email = `project-${emailId}@linkifico.com`;
                
                // Check if email already exists using email-to-project mapping
                const client = await getRedisClient();
                const existingProjectId = await client.get(`email_to_project:${email}`);
                
                if (!existingProjectId) {
                    Logger.info('redisData', 'generateUniqueProjectEmail:success', { 
                        emailId, 
                        email, 
                        attempts: attempts + 1 
                    });
                    return { emailId, email };
                }
                
                attempts++;
                Logger.warn('redisData', 'generateUniqueProjectEmail:collision', { 
                    emailId, 
                    attempt: attempts 
                });
            }
            
            throw new Error('Unable to generate unique project email after 10 attempts');
            
        } catch (error) {
            Logger.error('redisData', 'generateUniqueProjectEmail:error', error);
            throw error;
        }
    },

    // Get project ID by email address (for future email processing)
    async getProjectIdByEmail(email) {
        try {
            const client = await getRedisClient();
            const projectId = await client.get(`email_to_project:${email}`);
            return projectId;
        } catch (error) {
            Logger.error('redisData', 'getProjectIdByEmail:error', error);
            return null;
        }
    },

    // Get project data by project ID
    async getProjectData(projectId) {
        try {
            return await getProjectData(projectId);
        } catch (error) {
            Logger.error('redisData', 'getProjectData:error', error, { projectId });
            return null;
        }
    },

    // Save email-to-project mapping
    async saveEmailMapping(email, projectId) {
        try {
            const client = await getRedisClient();
            await client.set(`email_to_project:${email}`, projectId);
            Logger.info('redisData', 'saveEmailMapping:success', { email, projectId });
        } catch (error) {
            Logger.error('redisData', 'saveEmailMapping:error', error);
            throw error;
        }
    },

    // Delete email-to-project mapping (for cleanup)
    async deleteEmailMapping(email) {
        try {
            const client = await getRedisClient();
            await client.del(`email_to_project:${email}`);
            Logger.info('redisData', 'deleteEmailMapping:success', { email });
        } catch (error) {
            Logger.error('redisData', 'deleteEmailMapping:error', error);
            throw error;
        }
    },

    // Save all data for a project and user in a single Redis operation
    async saveAllData(projectId, userId, allData) {
        try {
            await Promise.all([
                saveProjectData(projectId, allData.projectData),
                saveChatHistory(projectId, userId, allData.chatHistory),
                saveKnowledgeData(projectId, userId, allData.knowledgeData),
                saveGapData(projectId, userId, allData.gapData),
                saveLearningData(userId, allData.learningData),
                saveReflectionData(projectId, userId, allData.reflectionData),
                // Save todos separately for easy retrieval
                this.saveTodos(projectId, userId, allData.todos || [])
            ]);
            
        } catch (error) {
            Logger.error('redisData', 'saveAllData_error', error, { projectId, userId });
            throw error;
        }
    },

    // Save todos separately for easy retrieval by chat UI
    async saveTodos(projectId, userId, todos) {
        try {
            if (!todos || todos.length === 0) {
                return;
            }
            
            const redis = await getRedisClient();
            const todoKey = `todos:${userId}:${projectId}`;
            
            // Save todos with metadata
            const todoData = {
                todos: todos,
                lastUpdated: new Date().toISOString(),
                projectId: projectId,
                userId: userId
            };
            
            await redis.set(todoKey, JSON.stringify(todoData));
            
        } catch (error) {
            Logger.error('redisData', 'saveTodos_error', error, { projectId, userId });
            // Don't throw - todos are also saved in gap data
        }
    },

    // Get todos for a specific project and user
    async getTodos(projectId, userId) {
        try {
            const redis = await getRedisClient();
            const todoKey = `todos:${userId}:${projectId}`;
            
            Logger.info('dataManager', 'getTodos:attempt', { 
                projectId, 
                userId, 
                todoKey 
            });
            
            const todoData = await redis.get(todoKey);
            if (todoData) {
                const parsed = JSON.parse(todoData);
                Logger.info('dataManager', 'getTodos:success', { 
                    projectId, 
                    userId, 
                    todoCount: parsed.todos?.length || 0,
                    todosSample: parsed.todos ? parsed.todos.slice(0, 2).map(t => ({ id: t.id, title: t.title, completed: t.completed })) : 'none'
                });
                return parsed.todos || [];
            }
            
            Logger.info('dataManager', 'getTodos:notFound', { 
                projectId, 
                userId, 
                todoKey 
            });
            return [];
            
        } catch (error) {
            Logger.error('dataManager', 'getTodos:error', error);
            return [];
        }
    },

    // Save processing status for polling
    async saveProcessingStatus(processingId, payload) {
        try {
            await saveProcessing(processingId, payload);
        } catch (error) {
            Logger.error('dataManager', 'saveProcessing:error', error);
        }
    },


    // Delete project and clean up email mapping
    async deleteProject(projectId, userId) {
        try {
            const client = await getRedisClient();
            
            // Load project data to get email for cleanup
            const allData = await this.loadAllData(projectId, userId);
            const projectEmail = allData.projectData?.email;
            
            // Delete all project data
            await Promise.all([
                client.del(`project:${projectId}:${userId}:data`),
                client.del(`project:${projectId}:${userId}:chatHistory`),
                client.del(`project:${projectId}:${userId}:knowledgeData`),
                client.del(`project:${projectId}:${userId}:gapData`),
                client.del(`project:${projectId}:${userId}:learningData`),
                client.del(`project:${projectId}:${userId}:reflectionData`),
                // Clean up email mapping if email exists
                projectEmail ? this.deleteEmailMapping(projectEmail) : Promise.resolve()
            ]);
            
            Logger.info('redisData', 'deleteProject:success', { 
                projectId, 
                userId, 
                email: projectEmail 
            });
            
        } catch (error) {
            Logger.error('redisData', 'deleteProject:error', error);
            throw error;
        }
    },

    // Helper functions to create default data structures
    createDefaultProjectData(projectId) {
        return createProjectData(projectId, 'simple_waterfall', {
            name: 'Untitled Project',
            email: null, // Will be set during project initialization
            emailId: null, // Will be set during project initialization
            maturityLevel: 'basic',
            templateData: {},
            scope: null,
            budget: null,
            timeline: null,
            phases: [],
            tasks: [],
            team: [],
            risks: [],
            status: 'draft'
        });
    },

    createDefaultKnowledgeData(projectId) {
        return createKnowledgeData(projectId, {
            confidence: 0.0,
            knownFacts: [],
            uncertainties: [],
            analysisHistory: []
        });
    },

    createDefaultGapData(projectId) {
        return createGapData(projectId, {
            criticalGaps: [],
            priorityScore: 0.0,
            nextAction: 'ask_about_scope',
            reasoning: 'Initial analysis needed',
            todos: []
        });
    },

    createDefaultLearningData(userId) {
        return createLearningData(userId, {
            userPatterns: {},
            questionEffectiveness: {},
            interactionHistory: [],
            adaptationHistory: []
        });
    },

    createDefaultReflectionData(projectId) {
        return createReflectionData(projectId, {
            analysisHistory: [],
            decisionLog: [],
            improvementSuggestions: []
        });
    },

    // ============================================================================
    // JOB QUEUE FUNCTIONS - For predictable processing architecture
    // ============================================================================

    // Save a job to the queue
    async saveJob(job) {
        try {
            Logger.info('redisData', 'saveJob_start', { 
                jobId: job.id, 
                jobType: job.type, 
                projectId: job.projectId 
            });
            
            // Test job serialization first
            let jobJson;
            try {
                jobJson = JSON.stringify(job);
                Logger.info('redisData', 'saveJob_serialization_success', { jobId: job.id, jsonLength: jobJson.length });
            } catch (serializationError) {
                Logger.error('redisData', 'saveJob_serialization_error', serializationError, { jobId: job.id });
                throw new Error(`Job serialization failed: ${serializationError.message}`);
            }
            
            const client = await getRedisClient();
            Logger.info('redisData', 'saveJob_client_obtained', { jobId: job.id });
            
            // Save job data
            await client.set(`jobs:${job.id}`, jobJson);
            Logger.info('redisData', 'saveJob_data_saved', { jobId: job.id });
            
            // Add to queued jobs list
            await client.lPush('jobs:queued', job.id);
            Logger.info('redisData', 'saveJob_added_to_queue', { jobId: job.id });
            
            Logger.info('redisData', 'job_saved', { 
                jobId: job.id, 
                jobType: job.type, 
                projectId: job.projectId 
            });
            
        } catch (error) {
            Logger.error('redisData', 'saveJob_error', error, { 
                jobId: job.id, 
                errorType: typeof error,
                errorConstructor: error.constructor?.name || 'Unknown'
            });
            throw error;
        }
    },

    // Get a job by ID
    async getJob(jobId) {
        try {
            const client = await getRedisClient();
            const jobData = await client.get(`jobs:${jobId}`);
            
            if (jobData) {
                return JSON.parse(jobData);
            }
            
            return null;
            
        } catch (error) {
            Logger.error('redisData', 'getJob_error', error, { jobId });
            return null;
        }
    },

    // Update job status and progress
    async updateJobStatus(jobId, status, progress = null, message = null) {
        try {
            const client = await getRedisClient();
            const job = await this.getJob(jobId);
            
            if (!job) {
                throw new Error(`Job ${jobId} not found`);
            }
            
            // Update job status
            job.status = status;
            if (progress !== null) job.progress = progress;
            if (message !== null) job.message = message;
            
            if (status === 'processing') {
                job.startedAt = Date.now();
            } else if (status === 'completed' || status === 'failed') {
                job.completedAt = Date.now();
            }
            
            // Save updated job
            await client.set(`jobs:${jobId}`, JSON.stringify(job));
            
            // Move job between queues
            if (status === 'processing') {
                await client.lRem('jobs:queued', 0, jobId);
                await client.lPush('jobs:processing', jobId);
            } else if (status === 'completed' || status === 'failed') {
                await client.lRem('jobs:processing', 0, jobId);
                await client.lPush('jobs:completed', jobId);
            }
            
        } catch (error) {
            Logger.error('redisData', 'updateJobStatus_error', { 
                jobId, 
                status, 
                error: error.message 
            });
            throw error;
        }
    },

    // Save job results
    async saveJobResults(jobId, results) {
        try {
            const client = await getRedisClient();
            
            const jobResults = {
                jobId: jobId,
                results: results,
                savedAt: Date.now()
            };
            
            await client.set(`jobs:${jobId}:results`, JSON.stringify(jobResults));
            
        } catch (error) {
            Logger.error('redisData', 'saveJobResults_error', { 
                jobId, 
                error: error.message 
            });
            throw error;
        }
    },

    // Get job results
    async getJobResults(jobId) {
        try {
            const client = await getRedisClient();
            const resultsData = await client.get(`jobs:${jobId}:results`);
            
            if (resultsData) {
                const parsed = JSON.parse(resultsData);
                return parsed.results;
            }
            
            return null;
            
        } catch (error) {
            Logger.error('redisData', 'getJobResults_error', { 
                jobId, 
                error: error.message 
            });
            return null;
        }
    },

    // Get queued jobs for processing
    async getQueuedJobs(limit = 10) {
        try {
            const client = await getRedisClient();
            const jobIds = await client.lRange('jobs:queued', 0, limit - 1);
            
            const jobs = [];
            for (const jobId of jobIds) {
                const job = await this.getJob(jobId);
                if (job) {
                    jobs.push(job);
                }
            }
            
            return jobs;
            
        } catch (error) {
            Logger.error('redisData', 'getQueuedJobs_error', error);
            return [];
        }
    },

    // Clean up old completed jobs
    async cleanupOldJobs(maxAge = 24 * 60 * 60 * 1000) { // 24 hours
        try {
            const client = await getRedisClient();
            const cutoffTime = Date.now() - maxAge;
            
            // Get completed jobs
            const completedJobIds = await client.lRange('jobs:completed', 0, -1);
            
            for (const jobId of completedJobIds) {
                const job = await this.getJob(jobId);
                
                if (job && job.completedAt && job.completedAt < cutoffTime) {
                    // Remove old job data
                    await Promise.all([
                        client.del(`jobs:${jobId}`),
                        client.del(`jobs:${jobId}:results`),
                        client.lRem('jobs:completed', 0, jobId)
                    ]);
                }
            }
            
        } catch (error) {
            Logger.error('redisData', 'cleanupOldJobs_error', error);
        }
    }
};