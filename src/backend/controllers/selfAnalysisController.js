// selfAnalysisController.js - Analyzes current project knowledge and confidence levels
// Mirrors Cursor's codebase analysis - continuously evaluates what the system knows

import { getSecret } from 'wix-secrets-backend';
import { askClaude, askClaudeJSON } from '../utils/aiClient.js';
import { Logger } from '../utils/logger.js';

// Project fields that can have gaps
const PROJECT_FIELDS = {
    objectives: 'objectives',
    budget: 'budget', 
    tasks: 'tasks',
    people: 'people'
};
import { 
    createKnowledgeData, 
    saveKnowledgeData, 
    getKnowledgeData
} from 'backend/data/projectData.js';

// AI wrapper
async function callClaude(prompt, systemPrompt = null) {
    return await askClaude({
        user: prompt,
        system: systemPrompt || "You are an intelligent project management assistant. Analyze project information and provide structured insights.",
        model: 'claude-3-5-haiku-latest',
        maxTokens: 1000
    });
}

export const selfAnalysisController = {
    
    // Main analysis function
    async analyzeProject(projectId, projectData, chatHistory, existingKnowledgeData = null, template = null) {
        try {
            // Template-driven completeness (Phase 1 heuristic): ratio of areas with any data
            const areas = (template && template.areas) || [];
            const totalAreas = areas.length || 1;
            const filledAreas = areas.filter(a => {
                const d = projectData?.templateData?.[a.id];
                return d && Object.keys(d).length > 0;
            }).length;
            const completeness = Math.min(1, Math.max(0, filledAreas / totalAreas));
            const missingFields = areas
                .filter(a => !projectData?.templateData?.[a.id] || Object.keys(projectData.templateData[a.id]).length === 0)
                .map(a => a.id);
            
            // Analyze project context from chat history
            const contextAnalysis = await this.analyzeProjectContext(projectData, chatHistory);
            
            // Determine confidence levels
            const confidence = await this.calculateConfidence(projectData, contextAnalysis, completeness);
            
            // Identify known facts and uncertainties
            const knowledgeAssessment = await this.assessKnowledge(projectData, contextAnalysis, missingFields);
            
            // Create or update knowledge data structure
            const knowledgeData = existingKnowledgeData || createKnowledgeData(projectId, {
                confidence: confidence,
                knownFacts: knowledgeAssessment.knownFacts,
                uncertainties: knowledgeAssessment.uncertainties,
                analysisHistory: []
            });
            
            // Update knowledge data with new analysis
            knowledgeData.confidence = confidence;
            knowledgeData.knownFacts = knowledgeAssessment.knownFacts;
            knowledgeData.uncertainties = knowledgeAssessment.uncertainties;
            knowledgeData.completeness = completeness;
            knowledgeData.missingFields = missingFields;
            knowledgeData.contextAnalysis = contextAnalysis;
            knowledgeData.lastUpdated = new Date().toISOString();
            
            // Add to analysis history
            knowledgeData.analysisHistory.push({
                timestamp: new Date().toISOString(),
                completeness: completeness,
                confidence: confidence,
                missingFields: missingFields
            });
            
            // Routing (template-driven) - lightweight for Phase 1
            const routed = this.routeConversation(chatHistory, template, projectData);

            Logger.info('selfAnalysisController', 'analyzeProject:end', { confidence, completeness });
            return {
                confidence: confidence,
                completeness: completeness,
                knownFacts: knowledgeAssessment.knownFacts,
                uncertainties: knowledgeAssessment.uncertainties,
                missingFields: missingFields,
                contextAnalysis: contextAnalysis,
                knowledgeData: knowledgeData,
                routing: routed
            };
            
        } catch (error) {
            Logger.error('selfAnalysisController', 'analyzeProject:error', error);
            return {
                confidence: 0.0,
                completeness: 0.0,
                knownFacts: [],
                uncertainties: ['Analysis failed'],
                missingFields: Object.values(PROJECT_FIELDS),
                contextAnalysis: null
            };
        }
    },

    // Simple keyword-based router based on template areas (Phase 1)
    routeConversation(chatHistory, template, projectData) {
        try {
            const lastMsg = Array.isArray(chatHistory) && chatHistory.length ? chatHistory[chatHistory.length - 1].message || '' : '';
            if (!template || !template.areas) {
                return {
                    routedTo: 'off_topic',
                    confidence: 0.5,
                    reasoning: 'No template provided; defaulting to off_topic',
                    isProjectRelated: false,
                    tierLevel: projectData?.maturityLevel || 'basic',
                    templateName: projectData?.templateName || 'unknown'
                };
            }
            const text = (lastMsg || '').toLowerCase();
            let best = { id: 'off_topic', score: 0 };
            template.areas.forEach(area => {
                const keywords = area.routingKeywords || [];
                const score = keywords.reduce((acc, kw) => acc + (text.includes(kw.toLowerCase()) ? 1 : 0), 0);
                if (score > best.score) best = { id: area.id, score };
            });
            const routedTo = best.score > 0 ? best.id : 'off_topic';
            return {
                routedTo,
                confidence: Math.min(0.9, 0.4 + best.score * 0.2),
                reasoning: best.score > 0 ? `Matched routing keywords for ${routedTo}` : 'No relevant keywords found',
                isProjectRelated: best.score > 0,
                tierLevel: projectData?.maturityLevel || 'basic',
                templateName: projectData?.templateName || template?.templateName || 'unknown'
            };
        } catch (e) {
            return {
                routedTo: 'off_topic',
                confidence: 0.5,
                reasoning: 'Routing error',
                isProjectRelated: false,
                tierLevel: projectData?.maturityLevel || 'basic',
                templateName: projectData?.templateName || 'unknown'
            };
        }
    },
    
    // Analyze project context from chat history
    async analyzeProjectContext(projectData, chatHistory) {
        try {
            if (!chatHistory || chatHistory.length === 0) {
                return {
                    projectType: 'unknown',
                    complexity: 'low',
                    urgency: 'medium',
                    userEngagement: 'low'
                };
            }
            
            // Extract recent context (last 10 messages)
            const recentMessages = chatHistory.slice(-10);
            const contextText = recentMessages.map(msg => `${msg.role}: ${msg.message}`).join('\n');
            
            const prompt = `Analyze this project conversation context and provide insights:

Project Data: ${JSON.stringify(projectData, null, 2)}
Recent Chat Context: ${contextText}

Provide analysis in JSON format:
{
    "projectType": "business|personal|technical|creative|other",
    "complexity": "low|medium|high",
    "urgency": "low|medium|high",
    "userEngagement": "low|medium|high",
    "keyThemes": ["theme1", "theme2"],
    "progressIndicators": ["indicator1", "indicator2"]
}`;

            const response = await callClaude(prompt);
            
            // Parse JSON response
            const jsonMatch = response.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                return JSON.parse(jsonMatch[0]);
            }
            
            // Fallback analysis
            return {
                projectType: 'general',
                complexity: 'medium',
                urgency: 'medium',
                userEngagement: 'medium',
                keyThemes: [],
                progressIndicators: []
            };
            
        } catch (error) {
            Logger.error('selfAnalysisController', 'analyzeProjectContext:error', error);
            return {
                projectType: 'unknown',
                complexity: 'medium',
                urgency: 'medium',
                userEngagement: 'medium',
                keyThemes: [],
                progressIndicators: []
            };
        }
    },
    
    // Calculate confidence in project knowledge
    async calculateConfidence(projectData, contextAnalysis, completeness) {
        try {
            let confidence = 0.0;
            
            // Base confidence from completeness
            confidence += completeness * 0.4;
            
            // Boosts based on templateData presence
            const td = projectData?.templateData || {};
            if (td.objectives && (td.objectives.description || (td.objectives.goals || []).length)) confidence += 0.15;
            if (td.tasks && (td.tasks.deadline || (td.tasks.tasks || []).length)) confidence += 0.15;
            if (td.budget && (td.budget.total || td.budget.spent)) confidence += 0.1;
            if (td.people && ((td.people.stakeholders || []).length || (td.people.team || []).length)) confidence += 0.1;
            
            // Adjust based on context analysis
            if (contextAnalysis) {
                if (contextAnalysis.complexity === 'high') {
                    confidence *= 0.9; // Reduce confidence for complex projects
                }
                if (contextAnalysis.userEngagement === 'high') {
                    confidence += 0.05; // Boost confidence for engaged users
                }
            }
            
            return Math.min(Math.max(confidence, 0.0), 1.0);
            
        } catch (error) {
            Logger.error('selfAnalysisController', 'calculateConfidence:error', error);
            return 0.0;
        }
    },
    
    // Assess what we know and don't know
    async assessKnowledge(projectData, contextAnalysis, missingFields) {
        try {
            const knownFacts = [];
            const uncertainties = [];
            
            // Analyze known facts from templateData (simple waterfall)
            const td2 = projectData?.templateData || {};
            if (td2.objectives?.description) knownFacts.push(`Objectives: ${td2.objectives.description}`);
            if (td2.tasks?.deadline) knownFacts.push(`Deadline: ${td2.tasks.deadline}`);
            if (td2.budget?.total) knownFacts.push(`Budget total: ${td2.budget.total}`);
            if ((td2.people?.stakeholders || []).length) knownFacts.push(`Stakeholders: ${td2.people.stakeholders.length}`);
            
            // Analyze uncertainties (area-level for Phase 1)
            missingFields.forEach(areaId => {
                uncertainties.push(`Area missing: ${areaId}`);
            });
            
            // Add context-based uncertainties
            if (contextAnalysis) {
                if (contextAnalysis.complexity === 'high') {
                    uncertainties.push('High complexity project - may need detailed planning');
                }
                if (contextAnalysis.urgency === 'high') {
                    uncertainties.push('High urgency - timeline critical');
                }
            }
            
            return {
                knownFacts: knownFacts,
                uncertainties: uncertainties
            };
            
        } catch (error) {
            Logger.error('selfAnalysisController', 'assessKnowledge:error', error);
            return {
                knownFacts: [],
                uncertainties: ['Knowledge assessment failed']
            };
        }
    },
    
    // Get analysis summary
    async getAnalysisSummary(projectId, knowledgeData) {
        try {
            // Use provided knowledge data (no Redis call)
            if (!knowledgeData) {
                return {
                    confidence: 0.0,
                    status: 'No analysis available',
                    recommendations: ['Run initial analysis']
                };
            }
            
            return {
                confidence: knowledgeData.confidence,
                status: this.getConfidenceStatus(knowledgeData.confidence),
                knownFacts: knowledgeData.knownFacts,
                uncertainties: knowledgeData.uncertainties,
                lastAnalyzed: knowledgeData.lastAnalyzed,
                recommendations: this.generateRecommendations(knowledgeData)
            };
            
        } catch (error) {
            Logger.error('selfAnalysisController', 'getAnalysisSummary:error', error);
            return {
                confidence: 0.0,
                status: 'Analysis error',
                recommendations: ['Check system status']
            };
        }
    },
    
    // Get confidence status description
    getConfidenceStatus(confidence) {
        if (confidence >= 0.8) return 'High confidence - well-defined project';
        if (confidence >= 0.6) return 'Medium confidence - some gaps remain';
        if (confidence >= 0.4) return 'Low confidence - significant gaps';
        return 'Very low confidence - project needs definition';
    },
    
    // Generate recommendations based on analysis
    generateRecommendations(knowledgeData) {
        const recommendations = [];
        
        if (knowledgeData.confidence < 0.3) {
            recommendations.push('Define project scope first');
            recommendations.push('Establish timeline and budget');
        } else if (knowledgeData.confidence < 0.6) {
            recommendations.push('Clarify remaining uncertainties');
            recommendations.push('Define deliverables and dependencies');
        } else {
            recommendations.push('Project well-defined - ready for execution');
            recommendations.push('Consider risk assessment and detailed planning');
        }
        
        return recommendations;
    }
};
