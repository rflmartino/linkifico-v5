// portfolioController.js - Portfolio management for user projects
// Handles fetching, archiving, restoring, and deleting user projects

import { Logger } from '../utils/logger.js';
import { 
    getProjectData, 
    getChatHistory,
    getUserProjects,
    addProjectToUser,
    removeProjectFromUser,
    archiveProjectForUser,
    restoreProjectForUser,
    deleteProjectCompletely
} from '../data/projectData.js';

export const portfolioController = {
    
    // Get all projects for a user (active and archived)
    async getUserPortfolio(userId) {
        const startTime = Date.now();
        try {
            Logger.info('portfolioController', 'getUserPortfolio:start', { userId });
            
            // Get user's project list from Redis
            const userProjects = await getUserProjects(userId);
            
            if (!userProjects || userProjects.length === 0) {
                Logger.info('portfolioController', 'getUserPortfolio:empty', { userId });
                return {
                    success: true,
                    data: {
                        activeProjects: [],
                        archivedProjects: [],
                        totalProjects: 0
                    }
                };
            }
            
            // Fetch project data for all projects in parallel
            const projectDataPromises = userProjects.map(async (projectInfo) => {
                try {
                    const projectData = await getProjectData(projectInfo.projectId);
                    const chatHistory = await getChatHistory(projectInfo.projectId, userId);
                    
                    if (!projectData) {
                        Logger.warn('portfolioController', 'getUserPortfolio:missingProject', { 
                            projectId: projectInfo.projectId, 
                            userId 
                        });
                        return null;
                    }
                    
                    // Calculate project metrics
                    const taskCount = this.calculateTaskCount(projectData);
                    const milestoneCount = this.calculateMilestoneCount(projectData);
                    const lastUpdated = this.getLastUpdatedDate(projectData, chatHistory);
                    
                    return {
                        projectId: projectInfo.projectId,
                        projectName: projectData.name || 'Untitled Project',
                        templateName: projectData.templateName || 'simple_waterfall',
                        status: projectInfo.status || 'active', // active, archived
                        taskCount,
                        milestoneCount,
                        version: this.calculateVersion(projectData),
                        lastUpdated,
                        createdAt: projectData.createdAt,
                        maturityLevel: projectData.maturityLevel || 'basic'
                    };
                } catch (error) {
                    Logger.error('portfolioController', 'getUserPortfolio:projectError', { 
                        projectId: projectInfo.projectId, 
                        error: error.message 
                    });
                    return null;
                }
            });
            
            // Wait for all project data to be fetched
            const projectResults = await Promise.all(projectDataPromises);
            
            // Filter out null results (missing projects)
            const validProjects = projectResults.filter(project => project !== null);
            
            // Separate active and archived projects
            const activeProjects = validProjects.filter(project => project.status === 'active');
            const archivedProjects = validProjects.filter(project => project.status === 'archived');
            
            // Sort by last updated (most recent first)
            activeProjects.sort((a, b) => new Date(b.lastUpdated) - new Date(a.lastUpdated));
            archivedProjects.sort((a, b) => new Date(b.lastUpdated) - new Date(a.lastUpdated));
            
            const result = {
                success: true,
                data: {
                    activeProjects,
                    archivedProjects,
                    totalProjects: validProjects.length
                }
            };
            
            Logger.info('portfolioController', 'getUserPortfolio:success', { 
                userId, 
                activeCount: activeProjects.length,
                archivedCount: archivedProjects.length,
                totalTime: Date.now() - startTime
            });
            
            return result;
            
        } catch (error) {
            Logger.error('portfolioController', 'getUserPortfolio:error', { userId, error: error.message });
            return {
                success: false,
                error: 'Failed to load portfolio: ' + error.message
            };
        }
    },
    
    // Archive a project for a user
    async archiveProject(userId, projectId) {
        try {
            Logger.info('portfolioController', 'archiveProject:start', { userId, projectId });
            
            await archiveProjectForUser(userId, projectId);
            
            Logger.info('portfolioController', 'archiveProject:success', { userId, projectId });
            return {
                success: true,
                message: 'Project archived successfully'
            };
            
        } catch (error) {
            Logger.error('portfolioController', 'archiveProject:error', { userId, projectId, error: error.message });
            return {
                success: false,
                message: 'Failed to archive project: ' + error.message
            };
        }
    },
    
    // Restore an archived project
    async restoreProject(userId, projectId) {
        try {
            Logger.info('portfolioController', 'restoreProject:start', { userId, projectId });
            
            await restoreProjectForUser(userId, projectId);
            
            Logger.info('portfolioController', 'restoreProject:success', { userId, projectId });
            return {
                success: true,
                message: 'Project restored successfully'
            };
            
        } catch (error) {
            Logger.error('portfolioController', 'restoreProject:error', { userId, projectId, error: error.message });
            return {
                success: false,
                message: 'Failed to restore project: ' + error.message
            };
        }
    },
    
    // Delete a project permanently
    async deleteProject(userId, projectId) {
        try {
            Logger.info('portfolioController', 'deleteProject:start', { userId, projectId });
            
            await deleteProjectCompletely(userId, projectId);
            
            Logger.info('portfolioController', 'deleteProject:success', { userId, projectId });
            return {
                success: true,
                message: 'Project deleted permanently'
            };
            
        } catch (error) {
            Logger.error('portfolioController', 'deleteProject:error', { userId, projectId, error: error.message });
            return {
                success: false,
                message: 'Failed to delete project: ' + error.message
            };
        }
    },
    
    // Helper methods for calculating project metrics
    calculateTaskCount(projectData) {
        try {
            // Check template data for tasks
            if (projectData.templateData && projectData.templateData.tasks) {
                return Array.isArray(projectData.templateData.tasks) ? projectData.templateData.tasks.length : 0;
            }
            
            // Check legacy task structure
            if (projectData.tasks) {
                return Array.isArray(projectData.tasks) ? projectData.tasks.length : 0;
            }
            
            return 0;
        } catch (error) {
            Logger.warn('portfolioController', 'calculateTaskCount:error', error);
            return 0;
        }
    },
    
    calculateMilestoneCount(projectData) {
        try {
            // Check template data for milestones/phases
            if (projectData.templateData && projectData.templateData.phases) {
                return Array.isArray(projectData.templateData.phases) ? projectData.templateData.phases.length : 0;
            }
            
            // Check legacy phase structure
            if (projectData.phases) {
                return Array.isArray(projectData.phases) ? projectData.phases.length : 0;
            }
            
            return 0;
        } catch (error) {
            Logger.warn('portfolioController', 'calculateMilestoneCount:error', error);
            return 0;
        }
    },
    
    calculateVersion(projectData) {
        try {
            // Simple version calculation based on updates
            if (projectData.version) {
                return projectData.version;
            }
            
            // Calculate based on creation and update dates
            const created = new Date(projectData.createdAt);
            const updated = new Date(projectData.updatedAt);
            const daysDiff = Math.floor((updated - created) / (1000 * 60 * 60 * 24));
            
            // Simple versioning: 1.0 + (days / 7) rounded to 1 decimal
            const version = (1.0 + (daysDiff / 7)).toFixed(1);
            return version;
            
        } catch (error) {
            Logger.warn('portfolioController', 'calculateVersion:error', error);
            return '1.0';
        }
    },
    
    getLastUpdatedDate(projectData, chatHistory) {
        try {
            // Get the most recent date from project data or chat history
            const projectUpdated = new Date(projectData.updatedAt || projectData.createdAt);
            
            let lastChatDate = projectUpdated;
            if (chatHistory && chatHistory.length > 0) {
                const lastChat = chatHistory[chatHistory.length - 1];
                if (lastChat && lastChat.timestamp) {
                    lastChatDate = new Date(lastChat.timestamp);
                }
            }
            
            return lastChatDate > projectUpdated ? lastChatDate.toISOString() : projectUpdated.toISOString();
            
        } catch (error) {
            Logger.warn('portfolioController', 'getLastUpdatedDate:error', error);
            return new Date().toISOString();
        }
    }
};
