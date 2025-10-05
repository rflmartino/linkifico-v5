// projectData.js - PMI-Aligned Project Data Structure with Redis Integration
// PURE STORAGE ONLY - NO CALCULATIONS by AI - controllers handle intelligence

import { createClient } from 'redis';
import { getSecret } from 'wix-secrets-backend';
import { Logger } from '../utils/logger.js';

// Redis client (lazy)
let redisClient = null;
export async function getRedisClient() {
    if (!redisClient) {
        const redisUrl = await getSecret('REDIS_CONNECTION_URL');
        redisClient = createClient({ url: redisUrl });
        await redisClient.connect();
    }
    return redisClient;
}

// No legacy fields/constants – templates drive structure via templateData

// Redis Key Structure
export const REDIS_KEYS = {
    PROJECT: (projectId) => `project:${projectId}`,
    KNOWLEDGE: (userId, projectId) => `knowledge:${userId}:${projectId}`,
    GAPS: (userId, projectId) => `gaps:${userId}:${projectId}`,
    LEARNING: (userId) => `learning:${userId}`,
    REFLECTION: (userId, projectId) => `reflection:${userId}:${projectId}`,
    CHAT_HISTORY: (userId, projectId) => `chat:${userId}:${projectId}`,
    PROCESSING: (processingId) => `processing:${processingId}`,
    USER_PROJECTS: (userId) => `user:${userId}:projects`
};

// Project Data Structure
export const createProjectData = (projectId, templateName = 'simple_waterfall', initialData = {}) => {
    return {
        id: projectId,
        name: initialData.name || 'Untitled Project',
        templateName: templateName,
        // Reserved for future tier gating (ignored by simple_waterfall)
        maturityLevel: initialData.maturityLevel || 'basic',
        // Template-specific container (e.g., objectives/tasks/budget/people for simple_waterfall)
        templateData: initialData.templateData || {},
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
    };
};

// Knowledge Data Structure
export const createKnowledgeData = (projectId, analysis = {}) => {
    return {
        projectId: projectId,
        confidence: analysis.confidence || 0.0,
        lastAnalyzed: new Date().toISOString(),
        knownFacts: analysis.knownFacts || [],
        uncertainties: analysis.uncertainties || [],
        analysisHistory: analysis.analysisHistory || []
    };
};

// Gap Analysis Data Structure
export const createGapData = (projectId, gaps = {}) => {
    return {
        projectId: projectId,
        criticalGaps: gaps.criticalGaps || [],
        priorityScore: gaps.priorityScore || 0.0,
        nextAction: gaps.nextAction || null,
        reasoning: gaps.reasoning || '',
        todos: gaps.todos || [],
        lastUpdated: new Date().toISOString()
    };
};

// Learning Data Structure
export const createLearningData = (userId, patterns = {}) => {
    return {
        userId: userId,
        userPatterns: {
            responseTime: patterns.responseTime || 'avg_2_hours',
            preferredQuestionStyle: patterns.preferredQuestionStyle || 'direct',
            engagementLevel: patterns.engagementLevel || 'medium',
            projectType: patterns.projectType || 'general'
        },
        questionEffectiveness: patterns.questionEffectiveness || {},
        interactionHistory: patterns.interactionHistory || [],
        lastUpdated: new Date().toISOString()
    };
};

// Reflection Log Data Structure
export const createReflectionData = (projectId, reflection = {}) => {
    return {
        projectId: projectId,
        analysisHistory: reflection.analysisHistory || [],
        decisionLog: reflection.decisionLog || [],
        improvementSuggestions: reflection.improvementSuggestions || [],
        lastReflection: new Date().toISOString()
    };
};

// Redis Operations
export async function saveProjectData(projectId, projectData) {
    const t = Date.now();
    const client = await getRedisClient();
    const key = REDIS_KEYS.PROJECT(projectId);
    await client.set(key, JSON.stringify(projectData));
    const ms = Date.now() - t;
    try { Logger.info('projectData', 'timing:saveProjectDataMs', { ms }); } catch {}
}

export async function getProjectData(projectId) {
    const t = Date.now();
    const client = await getRedisClient();
    const key = REDIS_KEYS.PROJECT(projectId);
    const data = await client.get(key);
    const ms = Date.now() - t;
    try { Logger.info('projectData', 'timing:getProjectDataMs', { ms }); } catch {}
    return data ? JSON.parse(data) : null;
}

export async function saveKnowledgeData(projectId, userId, knowledgeData) {
    const t = Date.now();
    const client = await getRedisClient();
    const key = REDIS_KEYS.KNOWLEDGE(userId, projectId);
    await client.set(key, JSON.stringify(knowledgeData));
    const ms = Date.now() - t;
    try { Logger.info('projectData', 'timing:saveKnowledgeDataMs', { ms }); } catch {}
}

export async function getKnowledgeData(projectId, userId) {
    const t = Date.now();
    const client = await getRedisClient();
    const key = REDIS_KEYS.KNOWLEDGE(userId, projectId);
    const data = await client.get(key);
    const ms = Date.now() - t;
    try { Logger.info('projectData', 'timing:getKnowledgeDataMs', { ms }); } catch {}
    return data ? JSON.parse(data) : null;
}

export async function saveGapData(projectId, userId, gapData) {
    const t = Date.now();
    const client = await getRedisClient();
    const key = REDIS_KEYS.GAPS(userId, projectId);
    await client.set(key, JSON.stringify(gapData));
    const ms = Date.now() - t;
    try { Logger.info('projectData', 'timing:saveGapDataMs', { ms }); } catch {}
}

export async function getGapData(projectId, userId) {
    const t = Date.now();
    const client = await getRedisClient();
    const key = REDIS_KEYS.GAPS(userId, projectId);
    const data = await client.get(key);
    const ms = Date.now() - t;
    try { Logger.info('projectData', 'timing:getGapDataMs', { ms }); } catch {}
    return data ? JSON.parse(data) : null;
}

export async function saveLearningData(userId, learningData) {
    const t = Date.now();
    const client = await getRedisClient();
    const key = REDIS_KEYS.LEARNING(userId);
    await client.set(key, JSON.stringify(learningData));
    const ms = Date.now() - t;
    try { Logger.info('projectData', 'timing:saveLearningDataMs', { ms }); } catch {}
}

export async function getLearningData(userId) {
    const t = Date.now();
    const client = await getRedisClient();
    const key = REDIS_KEYS.LEARNING(userId);
    const data = await client.get(key);
    const ms = Date.now() - t;
    try { Logger.info('projectData', 'timing:getLearningDataMs', { ms }); } catch {}
    return data ? JSON.parse(data) : null;
}

export async function saveReflectionData(projectId, userId, reflectionData) {
    const t = Date.now();
    const client = await getRedisClient();
    const key = REDIS_KEYS.REFLECTION(userId, projectId);
    await client.set(key, JSON.stringify(reflectionData));
    const ms = Date.now() - t;
    try { Logger.info('projectData', 'timing:saveReflectionDataMs', { ms }); } catch {}
}

export async function getReflectionData(projectId, userId) {
    const t = Date.now();
    const client = await getRedisClient();
    const key = REDIS_KEYS.REFLECTION(userId, projectId);
    const data = await client.get(key);
    const ms = Date.now() - t;
    try { Logger.info('projectData', 'timing:getReflectionDataMs', { ms }); } catch {}
    return data ? JSON.parse(data) : null;
}

export async function saveChatHistory(projectId, userId, chatHistory) {
    const t = Date.now();
    const client = await getRedisClient();
    const key = REDIS_KEYS.CHAT_HISTORY(userId, projectId);
    
    // Skip saving if chatHistory is undefined (not initialized yet)
    if (chatHistory === undefined) {
        try { Logger.info('projectData', 'saveChatHistory:skipped', { projectId, userId, reason: 'undefined' }); } catch {}
        return;
    }
    
    // CRITICAL DEBUG: Log exactly what we're receiving
    try {
        Logger.info('projectData', 'saveChatHistory:input', {
            projectId,
            userId,
            chatHistoryType: typeof chatHistory,
            chatHistoryIsArray: Array.isArray(chatHistory),
            chatHistoryValue: chatHistory,
            chatHistoryStringified: JSON.stringify(chatHistory),
            chatHistoryLength: chatHistory ? chatHistory.length : 'N/A'
        });
    } catch {}
    
    // Ensure chatHistory is an array
    const safeChatHistory = Array.isArray(chatHistory) ? chatHistory : [];
    
    // CRITICAL DEBUG: Log what we're actually saving
    try {
        Logger.info('projectData', 'saveChatHistory:output', {
            projectId,
            userId,
            redisKey: key,
            safeHistoryType: typeof safeChatHistory,
            safeHistoryIsArray: Array.isArray(safeChatHistory),
            safeHistoryValue: safeChatHistory,
            safeHistoryStringified: JSON.stringify(safeChatHistory),
            safeHistoryLength: safeChatHistory.length
        });
    } catch {}
    
    await client.set(key, JSON.stringify(safeChatHistory));
    const ms = Date.now() - t;
    try { Logger.info('projectData', 'timing:saveChatHistoryMs', { ms }); } catch {}
}

export async function getChatHistory(projectId, userId) {
    const t = Date.now();
    const client = await getRedisClient();
    const key = REDIS_KEYS.CHAT_HISTORY(userId, projectId);
    const data = await client.get(key);
    const ms = Date.now() - t;
    
    // Debug logging to see what we're getting from Redis
    try { 
        Logger.info('projectData', 'timing:getChatHistoryMs', { ms }); 
        Logger.info('projectData', 'getChatHistory:debug', {
            projectId,
            userId,
            redisKey: key,
            hasData: !!data,
            dataLength: data ? data.length : 0,
            dataType: typeof data,
            rawData: data // Log the raw data to see what's actually stored
        });
        
        // Parse and log the actual data
        let parsedData = [];
        if (data) {
            try {
                parsedData = JSON.parse(data);
                // Ensure parsedData is an array
                if (!Array.isArray(parsedData)) {
                    Logger.warn('projectData', 'getChatHistory:invalidFormat', {
                        projectId,
                        userId,
                        expectedType: 'array',
                        actualType: typeof parsedData,
                        rawData: data
                    });
                    parsedData = [];
                }
            } catch (parseError) {
                Logger.error('projectData', 'getChatHistory:parseError', {
                    projectId,
                    userId,
                    parseError: parseError.message,
                    rawData: data
                });
                parsedData = [];
            }
        }
        
        Logger.info('projectData', 'getChatHistory:parsed', {
            projectId,
            userId,
            parsedLength: parsedData.length,
            parsedType: typeof parsedData,
            isArray: Array.isArray(parsedData),
            parsedSample: parsedData.length > 0 ? parsedData.slice(0, 2) : 'empty'
        });
    } catch (logError) {
        Logger.error('projectData', 'getChatHistory:logError', { projectId, userId, logError: logError.message });
    }
    
    // Return parsed data or empty array
    if (data) {
        try {
            const parsed = JSON.parse(data);
            return Array.isArray(parsed) ? parsed : [];
        } catch (parseError) {
            Logger.error('projectData', 'getChatHistory:returnParseError', {
                projectId,
                userId,
                parseError: parseError.message,
                rawData: data
            });
            return [];
        }
    }
    return [];
}

// Processing storage for polling
export async function saveProcessing(processingId, payload) {
    const t = Date.now();
    const client = await getRedisClient();
    const key = REDIS_KEYS.PROCESSING(processingId);
    await client.set(key, JSON.stringify(payload));
    const ms = Date.now() - t;
    try { Logger.info('projectData', 'timing:saveProcessingMs', { ms }); } catch {}
}

export async function getProcessing(processingId) {
    const t = Date.now();
    const client = await getRedisClient();
    const key = REDIS_KEYS.PROCESSING(processingId);
    const data = await client.get(key);
    const ms = Date.now() - t;
    try { Logger.info('projectData', 'timing:getProcessingMs', { ms }); } catch {}
    return data ? JSON.parse(data) : null;
}

// User-to-Projects Mapping Functions
export async function getUserProjects(userId) {
    const t = Date.now();
    const client = await getRedisClient();
    const key = REDIS_KEYS.USER_PROJECTS(userId);
    const data = await client.get(key);
    const ms = Date.now() - t;
    try { Logger.info('projectData', 'timing:getUserProjectsMs', { ms }); } catch {}
    return data ? JSON.parse(data) : [];
}

export async function addProjectToUser(userId, projectId, status = 'active') {
    const t = Date.now();
    const client = await getRedisClient();
    const key = REDIS_KEYS.USER_PROJECTS(userId);
    
    // Get existing projects
    let userProjects = await getUserProjects(userId);
    
    // Check if project already exists
    const existingIndex = userProjects.findIndex(p => p.projectId === projectId);
    
    if (existingIndex >= 0) {
        // Update existing project status
        userProjects[existingIndex].status = status;
        userProjects[existingIndex].updatedAt = new Date().toISOString();
    } else {
        // Add new project
        userProjects.push({
            projectId: projectId,
            status: status,
            addedAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        });
    }
    
    await client.set(key, JSON.stringify(userProjects));
    const ms = Date.now() - t;
    try { Logger.info('projectData', 'timing:addProjectToUserMs', { ms }); } catch {}
}

export async function removeProjectFromUser(userId, projectId) {
    const t = Date.now();
    const client = await getRedisClient();
    const key = REDIS_KEYS.USER_PROJECTS(userId);
    
    // Get existing projects
    let userProjects = await getUserProjects(userId);
    
    // Remove project from list
    userProjects = userProjects.filter(p => p.projectId !== projectId);
    
    await client.set(key, JSON.stringify(userProjects));
    const ms = Date.now() - t;
    try { Logger.info('projectData', 'timing:removeProjectFromUserMs', { ms }); } catch {}
}

export async function archiveProjectForUser(userId, projectId) {
    const t = Date.now();
    const client = await getRedisClient();
    const key = REDIS_KEYS.USER_PROJECTS(userId);
    
    // Get existing projects
    let userProjects = await getUserProjects(userId);
    
    // Find and update project status
    const projectIndex = userProjects.findIndex(p => p.projectId === projectId);
    if (projectIndex >= 0) {
        userProjects[projectIndex].status = 'archived';
        userProjects[projectIndex].archivedAt = new Date().toISOString();
        userProjects[projectIndex].updatedAt = new Date().toISOString();
        
        await client.set(key, JSON.stringify(userProjects));
    }
    
    const ms = Date.now() - t;
    try { Logger.info('projectData', 'timing:archiveProjectForUserMs', { ms }); } catch {}
}

export async function restoreProjectForUser(userId, projectId) {
    const t = Date.now();
    const client = await getRedisClient();
    const key = REDIS_KEYS.USER_PROJECTS(userId);
    
    // Get existing projects
    let userProjects = await getUserProjects(userId);
    
    // Find and update project status
    const projectIndex = userProjects.findIndex(p => p.projectId === projectId);
    if (projectIndex >= 0) {
        userProjects[projectIndex].status = 'active';
        userProjects[projectIndex].restoredAt = new Date().toISOString();
        userProjects[projectIndex].updatedAt = new Date().toISOString();
        
        await client.set(key, JSON.stringify(userProjects));
    }
    
    const ms = Date.now() - t;
    try { Logger.info('projectData', 'timing:restoreProjectForUserMs', { ms }); } catch {}
}

export async function deleteProjectCompletely(userId, projectId) {
    const t = Date.now();
    const client = await getRedisClient();
    
    // Remove from user's project list
    await removeProjectFromUser(userId, projectId);
    
    // Delete all project data
    await Promise.all([
        client.del(REDIS_KEYS.PROJECT(projectId)),
        client.del(REDIS_KEYS.KNOWLEDGE(projectId)),
        client.del(REDIS_KEYS.GAPS(projectId)),
        client.del(REDIS_KEYS.REFLECTION(projectId)),
        client.del(REDIS_KEYS.CHAT_HISTORY(projectId))
    ]);
    
    const ms = Date.now() - t;
    try { Logger.info('projectData', 'timing:deleteProjectCompletelyMs', { ms }); } catch {}
}

// Utility Functions
// Completeness and gaps are now template-driven and computed in controllers


