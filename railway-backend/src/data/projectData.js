// railway-backend/src/data/projectData.js
// Redis connection and operations for Railway backend

import { createClient } from 'redis';

// Redis client (singleton)
let redisClient = null;

export async function getRedisClient() {
  if (!redisClient) {
    redisClient = createClient({
      url: process.env.REDIS_CONNECTION_URL
    });
    
    redisClient.on('error', (err) => console.error('Redis Client Error', err));
    await redisClient.connect();
    console.log('✅ Redis connected');
  }
  return redisClient;
}

// Redis Key Structure
export const REDIS_KEYS = {
  PROJECT: (projectId) => `project:${projectId}`,
  CHAT_HISTORY: (userId, projectId) => `chat:${userId}:${projectId}`,
  USER_PROJECTS: (userId) => `user:${userId}:projects`
};

// ============================================================================
// PROJECT DATA OPERATIONS
// ============================================================================

// Create new project with clean structure
export function createProjectData(projectId, userId, initialData = {}) {
  return {
    id: projectId,
    userId: userId,
    name: initialData.name || 'Untitled Project',
    status: 'draft', // draft, active, completed, archived
    
    // Scope (owned by Scope Agent)
    scope: initialData.scope || {
      description: '',
      objectives: [],
      deliverables: [],
      outOfScope: [],
      successCriteria: []
    },
    
    // Stages (owned by Scope Agent)
    stages: initialData.stages || [],
    
    // Tasks (owned by Scheduler + Task Updater)
    tasks: initialData.tasks || [],
    
    // Budget (owned by Budget Agent)
    budget: initialData.budget || {
      total: 0,
      spent: 0,
      currency: 'USD',
      lineItems: []
    },
    
    // Timeline
    timeline: initialData.timeline || {
      startDate: null,
      endDate: null,
      milestones: []
    },
    
    // Issues (flagged by any agent)
    issues: initialData.issues || [],
    
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

// Save project data
export async function saveProjectData(projectId, projectData) {
  const client = await getRedisClient();
  projectData.updatedAt = new Date().toISOString();
  await client.set(REDIS_KEYS.PROJECT(projectId), JSON.stringify(projectData));
  console.log(`💾 Saved project: ${projectId}`);
}

// Get project data
export async function getProjectData(projectId) {
  const client = await getRedisClient();
  const data = await client.get(REDIS_KEYS.PROJECT(projectId));
  return data ? JSON.parse(data) : null;
}

// Delete project
export async function deleteProject(projectId) {
  const client = await getRedisClient();
  await client.del(REDIS_KEYS.PROJECT(projectId));
  console.log(`🗑️  Deleted project: ${projectId}`);
}

// ============================================================================
// CHAT HISTORY OPERATIONS (user-specific)
// ============================================================================

// Save chat history for a user's project conversation
export async function saveChatHistory(userId, projectId, chatHistory) {
  const client = await getRedisClient();
  const key = REDIS_KEYS.CHAT_HISTORY(userId, projectId);
  await client.set(key, JSON.stringify(chatHistory));
}

// Get chat history for a user's project conversation
export async function getChatHistory(userId, projectId) {
  const client = await getRedisClient();
  const key = REDIS_KEYS.CHAT_HISTORY(userId, projectId);
  const data = await client.get(key);
  return data ? JSON.parse(data) : [];
}

// ============================================================================
// USER PROJECT MAPPING
// ============================================================================

// Get all projects for a user
export async function getUserProjects(userId) {
  const client = await getRedisClient();
  const key = REDIS_KEYS.USER_PROJECTS(userId);
  const data = await client.get(key);
  return data ? JSON.parse(data) : [];
}

// Add project to user's list
export async function addProjectToUser(userId, projectId) {
  const client = await getRedisClient();
  const key = REDIS_KEYS.USER_PROJECTS(userId);
  
  let projects = await getUserProjects(userId);
  
  if (!projects.find(p => p.projectId === projectId)) {
    projects.push({
      projectId: projectId,
      addedAt: new Date().toISOString()
    });
    await client.set(key, JSON.stringify(projects));
  }
}

// Remove project from user's list
export async function removeProjectFromUser(userId, projectId) {
  const client = await getRedisClient();
  const key = REDIS_KEYS.USER_PROJECTS(userId);
  
  let projects = await getUserProjects(userId);
  projects = projects.filter(p => p.projectId !== projectId);
  
  await client.set(key, JSON.stringify(projects));
}
