// actionPlanningController.js - Plans optimal next actions based on gaps and user patterns
// Mirrors Cursor's suggestion system - determines best next step

import { getSecret } from 'wix-secrets-backend';
import { askClaude, askClaudeJSON } from '../utils/aiClient.js';
import { Logger } from '../utils/logger.js';
import { 
    getLearningData,
    saveLearningData,
    createLearningData 
} from 'backend/data/projectData.js';
import nlpManager from 'backend/nlp/nlpManager.js';

async function callClaude(prompt, systemPrompt = null) {
    return await askClaude({
        user: prompt,
        system: systemPrompt || "You are a PMaaS (Project Management as a Service) strategist. Focus on practical project management: budget, timeline, deliverables, resources. Ask actionable questions that help create concrete project plans.",
        model: 'claude-3-5-haiku-latest',
        maxTokens: 1000
    });
}

export const actionPlanningController = {
    
    // Main action planning function
    async planAction(projectId, userId, gaps, analysis, chatHistory, learningData) {
        try {
            // Use provided learning data instead of fetching
            
            // Analyze conversation context
            const conversationContext = await this.analyzeConversationContext(chatHistory, analysis);
            
            // Try NLP first with confidence gate
            const nlpStart = Date.now();
            const nlpResult = await this.tryNLPProcessing(gaps, conversationContext, analysis);
            Logger.info('actionPlanningController', 'timing:nlpProcessingMs', { ms: Date.now() - nlpStart });
            
            let actionPlan;
            if (nlpResult.success) {
                Logger.info('actionPlanningController', 'nlpSuccess', { 
                    intent: nlpResult.intent, 
                    confidence: nlpResult.confidence,
                    usedNLP: true 
                });
                
                actionPlan = nlpResult.actionPlan;
            } else {
                // Fallback to Haiku for low confidence or unknown intents
                Logger.info('actionPlanningController', 'nlpFallback', { 
                    reason: nlpResult.reason,
                    usedNLP: false 
                });
                
                actionPlan = await this.generateActionPlan(gaps, learningData, conversationContext, analysis);
            }
            
            // Update learning data with planning decision (don't save, just update in memory)
            this.updateLearningFromPlanning(userId, actionPlan, learningData);
            
            Logger.info('actionPlanningController', 'planAction:end', { action: actionPlan?.action });
            return {
                ...actionPlan,
                updatedLearningData: learningData
            };
            
        } catch (error) {
            Logger.error('actionPlanningController', 'planAction:error', error);
            return {
                action: 'ask_about_scope',
                question: 'What exactly are you trying to accomplish with this project?',
                reasoning: 'Action planning failed - defaulting to scope question',
                timing: 'immediate',
                confidence: 0.5
            };
        }
    },
    
    // Try NLP processing first with confidence gate
    async tryNLPProcessing(gaps, conversationContext, analysis) {
        try {
            const confidenceThreshold = 0.8; // 80% confidence threshold
            
            // Build context string for NLP processing
            const contextString = this.buildNLPContextString(gaps, conversationContext, analysis);
            
            // Get complete analysis from NLP (includes intent, confidence, and response)
            const nlpResult = await nlpManager.processInput(contextString);
            
            if (!nlpResult || nlpResult.confidence < confidenceThreshold) {
                return {
                    success: false,
                    reason: `Low confidence: ${nlpResult?.confidence || 0} < ${confidenceThreshold}`,
                    confidence: nlpResult?.confidence || 0
                };
            }
            
            // Check if NLP provided a response
            if (!nlpResult.answer) {
                return {
                    success: false,
                    reason: `No response from NLP for intent: ${nlpResult.intent}`,
                    confidence: nlpResult.confidence
                };
            }
            
            // Convert NLP intent to action plan
            const actionPlan = this.convertNLPToActionPlan(nlpResult, gaps, conversationContext);
            
            return {
                success: true,
                intent: nlpResult.intent,
                confidence: nlpResult.confidence,
                actionPlan: actionPlan
            };
            
        } catch (error) {
            Logger.error('actionPlanningController', 'tryNLPProcessing:error', error);
            return {
                success: false,
                reason: `NLP error: ${error.message}`,
                confidence: 0
            };
        }
    },
    
    // Build context string for NLP processing
    buildNLPContextString(gaps, conversationContext, analysis) {
        const parts = [];
        
        // Add gap information
        if (gaps && gaps.criticalGaps && gaps.criticalGaps.length > 0) {
            parts.push(gaps.criticalGaps.join(' ') + ' missing');
        }
        
        // Add conversation stage
        if (conversationContext) {
            parts.push(conversationContext.conversationStage || 'initial');
            parts.push(conversationContext.totalMessages || '0');
            parts.push('messages');
            
            // Add engagement level
            if (conversationContext.userEngagement) {
                parts.push(conversationContext.userEngagement);
                parts.push('engagement');
            }
            
            // Add response pattern
            if (conversationContext.responsePattern) {
                parts.push(conversationContext.responsePattern);
                parts.push('responses');
            }
        }
        
        // Add analysis information
        if (analysis) {
            if (analysis.completeness !== undefined) {
                const completenessLevel = analysis.completeness > 0.8 ? 'complete' : 
                                        analysis.completeness > 0.5 ? 'partial' : 'incomplete';
                parts.push(completenessLevel);
            }
            
            if (analysis.missingFields && analysis.missingFields.length > 0) {
                parts.push(analysis.missingFields.join(' ') + ' incomplete');
            }
        }
        
        return parts.join(' ');
    },
    
    // Convert NLP result to action plan
    convertNLPToActionPlan(nlpResult, gaps, conversationContext) {
        const intent = nlpResult.intent;
        const confidence = nlpResult.confidence;
        
        // Map NLP intent to action plan structure
        const actionMappings = {
            'action.ask_objectives': {
                action: 'ask_about_objectives',
                question: 'What are your main objectives for this project?',
                reasoning: 'Objectives are critical foundation for planning',
                timing: 'immediate',
                confidence: confidence
            },
            'action.ask_budget': {
                action: 'ask_about_budget',
                question: 'What budget do you have available for this project?',
                reasoning: 'Budget information needed for resource planning',
                timing: 'immediate',
                confidence: confidence
            },
            'action.ask_tasks': {
                action: 'ask_about_tasks',
                question: 'What specific tasks or deliverables do you need?',
                reasoning: 'Task definition required for execution planning',
                timing: 'immediate',
                confidence: confidence
            },
            'action.ask_people': {
                action: 'ask_about_people',
                question: 'Who will be involved in this project?',
                reasoning: 'Stakeholder identification needed for coordination',
                timing: 'immediate',
                confidence: confidence
            },
            'action.provide_recommendation': {
                action: 'provide_recommendation',
                question: 'Based on our discussion, here are my recommendations.',
                reasoning: 'Project is well-defined, ready for recommendations',
                timing: 'immediate',
                confidence: confidence
            },
            'action.request_clarification': {
                action: 'request_clarification',
                question: 'I want to make sure I understand correctly - could you clarify?',
                reasoning: 'Clarification needed for better understanding',
                timing: 'immediate',
                confidence: confidence
            },
            'action.continue_planning': {
                action: 'continue_planning',
                question: 'Let\'s continue building your project plan.',
                reasoning: 'Partial information available, continue planning',
                timing: 'immediate',
                confidence: confidence
            }
        };
        
        // Get base action plan from mapping
        let actionPlan = actionMappings[intent] || {
            action: 'ask_about_objectives',
            question: 'What are your main objectives for this project?',
            reasoning: 'Default action for unrecognized intent',
            timing: 'immediate',
            confidence: confidence
        };
        
        // Adapt question style based on conversation context
        if (conversationContext && conversationContext.userEngagement) {
            actionPlan = this.adaptQuestionStyle(actionPlan, conversationContext.userEngagement);
        }
        
        return actionPlan;
    },
    
    // Adapt question style based on user engagement
    adaptQuestionStyle(actionPlan, engagementLevel) {
        const adaptedPlan = { ...actionPlan };
        
        switch (engagementLevel) {
            case 'high':
                // More detailed questions for engaged users
                if (actionPlan.action === 'ask_about_objectives') {
                    adaptedPlan.question = 'Could you describe in detail what you want to achieve with this project?';
                } else if (actionPlan.action === 'ask_about_budget') {
                    adaptedPlan.question = 'What financial resources are allocated for this project, and are there any budget constraints?';
                }
                break;
                
            case 'low':
                // More direct questions for less engaged users
                if (actionPlan.action === 'ask_about_objectives') {
                    adaptedPlan.question = 'What\'s the main goal?';
                } else if (actionPlan.action === 'ask_about_budget') {
                    adaptedPlan.question = 'What\'s your budget?';
                }
                break;
                
            default:
                // Keep original question for medium engagement
                break;
        }
        
        return adaptedPlan;
    },
    
    // Analyze conversation context
    async analyzeConversationContext(chatHistory, analysis) {
        try {
            if (!chatHistory || chatHistory.length === 0) {
                return {
                    conversationStage: 'initial',
                    userEngagement: 'unknown',
                    questionFrequency: 0,
                    responsePattern: 'unknown'
                };
            }
            
            // Analyze recent conversation patterns
            const recentMessages = chatHistory.slice(-10);
            const userMessages = recentMessages.filter(msg => msg.role === 'user');
            const assistantMessages = recentMessages.filter(msg => msg.role === 'assistant');
            
            // Calculate engagement metrics
            const questionFrequency = assistantMessages.length / Math.max(userMessages.length, 1);
            const avgResponseLength = userMessages.reduce((sum, msg) => sum + msg.message.length, 0) / Math.max(userMessages.length, 1);
            
            // Determine conversation stage
            let conversationStage = 'initial';
            if (chatHistory.length > 20) {
                conversationStage = 'detailed';
            } else if (chatHistory.length > 10) {
                conversationStage = 'planning';
            } else if (chatHistory.length > 5) {
                conversationStage = 'exploration';
            }
            
            // Determine user engagement level
            let userEngagement = 'medium';
            if (avgResponseLength > 100) {
                userEngagement = 'high';
            } else if (avgResponseLength < 30) {
                userEngagement = 'low';
            }
            
            return {
                conversationStage: conversationStage,
                userEngagement: userEngagement,
                questionFrequency: questionFrequency,
                responsePattern: this.analyzeResponsePattern(userMessages),
                avgResponseLength: avgResponseLength,
                totalMessages: chatHistory.length
            };
            
        } catch (error) {
            Logger.error('actionPlanningController', 'analyzeConversationContext:error', error);
            return {
                conversationStage: 'initial',
                userEngagement: 'medium',
                questionFrequency: 1.0,
                responsePattern: 'unknown'
            };
        }
    },
    
    // Analyze user response patterns
    analyzeResponsePattern(userMessages) {
        if (!userMessages || userMessages.length === 0) {
            return 'unknown';
        }
        
        const patterns = {
            detailed: 0,
            brief: 0,
            questions: 0,
            statements: 0
        };
        
        userMessages.forEach(msg => {
            if (msg.message.length > 100) patterns.detailed++;
            else patterns.brief++;
            
            if (msg.message.includes('?')) patterns.questions++;
            else patterns.statements++;
        });
        
        // Determine dominant pattern
        if (patterns.detailed > patterns.brief) {
            return patterns.questions > patterns.statements ? 'detailed_questions' : 'detailed_statements';
        } else {
            return patterns.questions > patterns.statements ? 'brief_questions' : 'brief_statements';
        }
    },
    
    // Generate action plan using AI
    async generateActionPlan(gaps, learningData, conversationContext, analysis) {
        try {
            const prompt = `Plan the optimal next PMaaS (Project Management as a Service) action:

Gap Analysis: ${JSON.stringify(gaps, null, 2)}
User Learning Patterns: ${JSON.stringify(learningData, null, 2)}
Conversation Context: ${JSON.stringify(conversationContext, null, 2)}
Project Analysis: ${JSON.stringify(analysis, null, 2)}

FOCUS ON PRACTICAL PROJECT MANAGEMENT:
1. What's the most critical missing project information?
2. What question will help create actionable project plans?
3. Prioritize: budget, timeline, deliverables, resources
4. AVOID: Business strategy, competitive advantage, philosophical goals

Generate an action plan in JSON format:
{
    "action": "ask_about_[field]",
    "question": "Direct, practical project management question",
    "reasoning": "Why this action helps create concrete project plans",
    "timing": "immediate|delayed|contextual",
    "confidence": 0.0-1.0,
    "alternativeActions": ["alternative1", "alternative2"],
    "expectedResponse": "What specific project information we expect"
}`;
            const parsed = await askClaudeJSON({
                user: prompt,
                system: `You are a PMaaS (Project Management as a Service) action planning system.

ROLE: Plan questions that gather concrete project management information:
- Budget amounts and financial constraints  
- Specific deadlines and timelines
- Deliverable requirements and outputs
- Resource availability and team members
- Task dependencies and blockers

AVOID: Abstract business strategy questions, market analysis, competitive positioning.

FOCUS: Actionable project details that enable concrete planning with timelines, budgets, and deliverables.

Return ONLY valid JSON with the requested fields. Ask practical questions that help create real project plans.`,
                model: 'claude-3-5-haiku-latest',
                maxTokens: 1000
            });

            if (parsed && parsed.action && parsed.question) {
                return parsed;
            }

            // Fallback action plan if parsing failed
            return this.getFallbackActionPlan(gaps, learningData, conversationContext);
            
        } catch (error) {
            // Soft-fail to fallback without noisy logs
            return this.getFallbackActionPlan(gaps, learningData, conversationContext);
        }
    },
    
    // Fallback action plan when AI fails
    getFallbackActionPlan(gaps, learningData, conversationContext) {
        const topGap = gaps.criticalGaps && gaps.criticalGaps.length > 0 ? gaps.criticalGaps[0] : 'scope';
        
        // Adapt question style based on user patterns
        let questionStyle = 'direct';
        if (learningData && learningData.userPatterns) {
            questionStyle = learningData.userPatterns.preferredQuestionStyle || 'direct';
        }
        
        // Adapt timing based on conversation context
        let timing = 'immediate';
        if (conversationContext && conversationContext.userEngagement === 'low') {
            timing = 'delayed';
        }
        
        const questions = {
            scope: {
                direct: "What specific deliverables do you need from this project?",
                detailed: "What are the key outputs and results you expect to be delivered?",
                exploratory: "What should be completed when this project is finished?"
            },
            timeline: {
                direct: "When do you need this project completed?",
                detailed: "What's your target completion date, and are there any important milestones along the way?",
                exploratory: "What's your timeline for this project?"
            },
            budget: {
                direct: "What's your budget for this project?",
                detailed: "What total budget do you have available, and are there any spending constraints?",
                exploratory: "What financial resources can you allocate to this project?"
            },
            deliverables: {
                direct: "What specific outputs do you need from this project?",
                detailed: "What are the key deliverables and outcomes you expect from this project?",
                exploratory: "What results are you hoping to achieve?"
            },
            dependencies: {
                direct: "What external factors does this project depend on?",
                detailed: "What resources, approvals, or external dependencies are required for this project?",
                exploratory: "What might block or delay this project?"
            }
        };
        
        const question = questions[topGap] && questions[topGap][questionStyle] 
            ? questions[topGap][questionStyle] 
            : questions[topGap] && questions[topGap]['direct']
            ? questions[topGap]['direct']
            : "What exactly are you trying to accomplish with this project?";
        
        return {
            action: `ask_about_${topGap}`,
            question: question,
            reasoning: `Addressing most critical gap: ${topGap}`,
            timing: timing,
            confidence: 0.7,
            alternativeActions: [`ask_about_${topGap}_detailed`, `ask_about_${topGap}_exploratory`],
            expectedResponse: 'Specific information about ' + topGap
        };
    },
    
    // Update learning data from planning decisions
    async updateLearningFromPlanning(userId, actionPlan, learningData) {
        try {
            if (!learningData) {
                learningData = createLearningData(userId);
            }
            
            // Update question effectiveness tracking
            if (!learningData.questionEffectiveness) {
                learningData.questionEffectiveness = {};
            }
            
            // Track this planning decision
            if (!learningData.interactionHistory) {
                learningData.interactionHistory = [];
            }
            
            learningData.interactionHistory.push({
                timestamp: new Date().toISOString(),
                action: actionPlan.action,
                confidence: actionPlan.confidence,
                reasoning: actionPlan.reasoning
            });
            
            // Keep only last 50 interactions
            if (learningData.interactionHistory.length > 50) {
                learningData.interactionHistory = learningData.interactionHistory.slice(-50);
            }
            
            // Update user patterns based on recent interactions
            learningData.userPatterns = this.updateUserPatterns(learningData);
            
            // Return updated learning data (no Redis save - handled by entry point)
            return learningData;
            
        } catch (error) {
            Logger.error('actionPlanningController', 'updateLearningFromPlanning:error', error);
        }
    },
    
    // Update user patterns based on interaction history
    updateUserPatterns(learningData) {
        const patterns = learningData.userPatterns || {};
        
        if (learningData.interactionHistory && learningData.interactionHistory.length > 0) {
            // Analyze recent interaction patterns
            const recentInteractions = learningData.interactionHistory.slice(-10);
            
            // Calculate average confidence
            const avgConfidence = recentInteractions.reduce((sum, interaction) => sum + interaction.confidence, 0) / recentInteractions.length;
            
            // Update engagement level based on confidence
            if (avgConfidence > 0.8) {
                patterns.engagementLevel = 'high';
            } else if (avgConfidence < 0.5) {
                patterns.engagementLevel = 'low';
            } else {
                patterns.engagementLevel = 'medium';
            }
            
            // Update response time based on interaction frequency
            const timeSpan = recentInteractions.length > 1 
                ? new Date(recentInteractions[recentInteractions.length - 1].timestamp) - new Date(recentInteractions[0].timestamp)
                : 0;
            
            if (timeSpan > 0) {
                const avgTimeBetweenInteractions = timeSpan / (recentInteractions.length - 1);
                if (avgTimeBetweenInteractions < 3600000) { // Less than 1 hour
                    patterns.responseTime = 'avg_30_minutes';
                } else if (avgTimeBetweenInteractions < 7200000) { // Less than 2 hours
                    patterns.responseTime = 'avg_1_hour';
                } else {
                    patterns.responseTime = 'avg_2_hours';
                }
            }
        }
        
        return patterns;
    },
    
    // Get action plan summary
    async getActionPlanSummary(userId, learningData) {
        try {
            // Use provided learning data (no Redis call)
            if (!learningData) {
                return {
                    status: 'No learning data available',
                    recommendations: ['Start project planning to build user patterns']
                };
            }
            
            return {
                userPatterns: learningData.userPatterns,
                interactionCount: learningData.interactionHistory ? learningData.interactionHistory.length : 0,
                lastInteraction: learningData.interactionHistory && learningData.interactionHistory.length > 0 
                    ? learningData.interactionHistory[learningData.interactionHistory.length - 1].timestamp 
                    : null,
                status: this.getPlanningStatus(learningData),
                recommendations: this.generatePlanningRecommendations(learningData)
            };
            
        } catch (error) {
            Logger.error('actionPlanningController', 'getActionPlanSummary:error', error);
            return {
                status: 'Action planning error',
                recommendations: ['Check system status']
            };
        }
    },
    
    // Get planning status description
    getPlanningStatus(learningData) {
        if (!learningData || !learningData.interactionHistory) {
            return 'No planning history - new user';
        }
        
        const interactionCount = learningData.interactionHistory.length;
        if (interactionCount < 5) {
            return 'Learning user patterns - building profile';
        } else if (interactionCount < 20) {
            return 'Developing user understanding - adapting approach';
        } else {
            return 'Well-established patterns - optimized planning';
        }
    },
    
    // Generate planning recommendations
    generatePlanningRecommendations(learningData) {
        const recommendations = [];
        
        if (!learningData || !learningData.interactionHistory) {
            recommendations.push('Start with basic project questions');
            recommendations.push('Observe user response patterns');
        } else {
            const interactionCount = learningData.interactionHistory.length;
            if (interactionCount < 5) {
                recommendations.push('Continue gathering user preferences');
                recommendations.push('Test different question styles');
            } else if (interactionCount < 20) {
                recommendations.push('Refine question timing and style');
                recommendations.push('Optimize based on user engagement');
            } else {
                recommendations.push('Maintain optimized approach');
                recommendations.push('Monitor for pattern changes');
            }
        }
        
        return recommendations;
    }
};
