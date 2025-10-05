// learningController.js - Learns user patterns and adapts approach over time
// Mirrors Cursor's learning system - continuously improves based on interactions

import { getSecret } from 'wix-secrets-backend';
import { askClaude, askClaudeJSON } from '../utils/aiClient.js';
import { Logger } from '../utils/logger.js';
import { 
    getLearningData,
    saveLearningData,
    createLearningData,
    getReflectionData,
    saveReflectionData,
    createReflectionData 
} from 'backend/data/projectData.js';

async function callClaude(prompt, systemPrompt = null) {
    return await askClaude({
        user: prompt,
        system: systemPrompt || "You are an expert in user behavior analysis and adaptive systems. Analyze interaction patterns and provide insights for system improvement.",
        model: 'claude-3-5-haiku-latest',
        maxTokens: 1000
    });
}

export const learningController = {
    
    // Main learning function
    async learnFromInteraction(projectId, userId, userMessage, execution, chatHistory, learningData, reflectionData) {
        try {
            
            // Use provided learning data instead of fetching
            if (!learningData) {
                learningData = createLearningData(userId);
            }
            
            // Analyze interaction patterns and generate learning insights in one API call
            const t2 = Date.now();
            const analysisAndInsights = await this.analyzeAndGenerateInsights(userMessage, execution, chatHistory, learningData);
            Logger.info('learningController', 'timing:analyzeAndGenerateInsightsMs', { ms: Date.now() - t2 });
            
            // Extract results
            const interactionAnalysis = analysisAndInsights.interactionAnalysis;
            const learningInsights = analysisAndInsights.learningInsights;
            
            // Update user patterns
            const t3 = Date.now();
            const updatedPatterns = await this.updateUserPatterns(learningData, interactionAnalysis);
            Logger.info('learningController', 'timing:updateUserPatternsMs', { ms: Date.now() - t3 });
            
            // Track question effectiveness
            const t4 = Date.now();
            const effectivenessUpdate = await this.trackQuestionEffectiveness(learningData, execution, interactionAnalysis);
            Logger.info('learningController', 'timing:trackQuestionEffectivenessMs', { ms: Date.now() - t4 });
            
            // Update learning data
            learningData.userPatterns = updatedPatterns;
            learningData.questionEffectiveness = effectivenessUpdate.questionEffectiveness;
            learningData.interactionHistory = effectivenessUpdate.interactionHistory;
            learningData.lastUpdated = new Date().toISOString();
            
            // Update reflection log (don't save, just update in memory)
            this.updateReflectionLog(projectId, learningInsights, interactionAnalysis, reflectionData);
            
            const result = {
                learningInsights: learningInsights,
                updatedPatterns: updatedPatterns,
                effectivenessUpdate: effectivenessUpdate,
                updatedLearningData: learningData,
                updatedReflectionData: reflectionData
            };
            Logger.info('learningController', 'learnFromInteraction:end', { ok: true });
            return result;
            
        } catch (error) {
            Logger.error('learningController', 'learnFromInteraction:error', error);
            return {
                learningInsights: null,
                updatedPatterns: null,
                effectivenessUpdate: null
            };
        }
    },
    
    // Combined method: Analyze interaction patterns and generate learning insights in one API call
    async analyzeAndGenerateInsights(userMessage, execution, chatHistory, learningData) {
        try {
            const methodStart = Date.now();
            const prompt = `Analyze these interaction patterns and generate comprehensive learning insights:

User Message: "${userMessage}"
Execution Result: ${JSON.stringify(execution, null, 2)}
Chat History Length: ${chatHistory ? chatHistory.length : 0}
Learning Data: ${JSON.stringify(learningData, null, 2)}

First, analyze the interaction patterns:
- Response quality (high|medium|low)
- Engagement level (high|medium|low) 
- Communication style (detailed|brief|mixed)
- Preferred question type (exploratory|direct|mixed)
- Response time (immediate|delayed|contextual)
- Information density (high|medium|low)
- Clarity level (clear|unclear|mixed)
- Cooperation level (high|medium|low)

Then, generate learning insights including:
- User profile analysis
- System improvement recommendations
- Adaptation recommendations
- Effectiveness score

Respond in JSON format:
{
    "interactionAnalysis": {
        "responseQuality": "high|medium|low",
        "engagementLevel": "high|medium|low",
        "communicationStyle": "detailed|brief|mixed",
        "preferredQuestionType": "exploratory|direct|mixed",
        "responseTime": "immediate|delayed|contextual",
        "informationDensity": "high|medium|low",
        "clarityLevel": "clear|unclear|mixed",
        "cooperationLevel": "high|medium|low"
    },
    "learningInsights": {
        "userProfile": {
            "communicationStyle": "detailed|brief|mixed",
            "engagementPattern": "high|medium|low",
            "preferredApproach": "exploratory|direct|mixed"
        },
        "systemImprovements": [
            "recommendation1",
            "recommendation2"
        ],
        "adaptationRecommendations": [
            "adaptation1",
            "adaptation2"
        ],
        "effectivenessScore": 0.0-1.0
    }
}`;

            const response = await callClaude(prompt);
            
            // Parse JSON response
            const jsonMatch = response.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                const result = JSON.parse(jsonMatch[0]);
                Logger.info('learningController', 'timing:analyzeAndGenerateInsights:apiCallMs', { ms: Date.now() - methodStart });
                return result;
            }
            
            // Fallback to simple logic if combined call fails
            return this.getFallbackAnalysisAndInsights(userMessage, execution, learningData);
            
        } catch (error) {
            Logger.error('learningController', 'analyzeAndLearn:error', error);
            // Fallback to simple logic
            return this.getFallbackAnalysisAndInsights(userMessage, execution, learningData);
        }
    },
    
    // Fallback analysis and insights when AI fails
    getFallbackAnalysisAndInsights(userMessage, execution, learningData) {
        const messageLength = userMessage.length;
        const hasQuestions = userMessage.includes('?');
        const hasDetails = messageLength > 100;
        
        const interactionAnalysis = {
            responseQuality: messageLength > 50 ? 'high' : messageLength > 20 ? 'medium' : 'low',
            engagementLevel: messageLength > 100 ? 'high' : messageLength > 50 ? 'medium' : 'low',
            communicationStyle: hasDetails ? 'detailed' : 'brief',
            preferredQuestionType: hasQuestions ? 'exploratory' : 'direct',
            responseTime: 'immediate',
            informationDensity: messageLength > 150 ? 'high' : messageLength > 75 ? 'medium' : 'low',
            clarityLevel: messageLength > 50 ? 'clear' : 'unclear',
            cooperationLevel: messageLength > 30 ? 'high' : 'medium'
        };
        
        const learningInsights = {
            userProfile: {
                communicationStyle: interactionAnalysis.communicationStyle,
                engagementPattern: interactionAnalysis.engagementLevel,
                preferredApproach: interactionAnalysis.preferredQuestionType
            },
            systemImprovements: [
                'Continue monitoring user patterns',
                'Adapt question style based on responses'
            ],
            adaptationRecommendations: [
                'Maintain current approach',
                'Monitor for pattern changes'
            ],
            effectivenessScore: 0.7
        };
        
        return { interactionAnalysis, learningInsights };
    },
    
    // Update user patterns based on interaction analysis
    async updateUserPatterns(learningData, interactionAnalysis) {
        try {
            const methodStart = Date.now();
            const patterns = learningData.userPatterns || {};
            
            // Update response time pattern
            if (interactionAnalysis.responseTime) {
                patterns.responseTime = this.updateResponseTimePattern(patterns.responseTime, interactionAnalysis.responseTime);
            }
            
            // Update question style preference
            if (interactionAnalysis.preferredQuestionType) {
                patterns.preferredQuestionStyle = this.updateQuestionStylePreference(
                    patterns.preferredQuestionStyle, 
                    interactionAnalysis.preferredQuestionType
                );
            }
            
            // Update engagement level
            if (interactionAnalysis.engagementLevel) {
                patterns.engagementLevel = this.updateEngagementLevel(
                    patterns.engagementLevel, 
                    interactionAnalysis.engagementLevel
                );
            }
            
            // Update communication style
            if (interactionAnalysis.communicationStyle) {
                patterns.communicationStyle = interactionAnalysis.communicationStyle;
            }
            
            // Update project type if we can infer it
            if (interactionAnalysis.projectType) {
                patterns.projectType = interactionAnalysis.projectType;
            }
            
            Logger.info('learningController', 'timing:updateUserPatterns:successMs', { ms: Date.now() - methodStart });
            return patterns;
            
        } catch (error) {
            Logger.error('learningController', 'updateUserPatterns:error', error);
            return learningData.userPatterns || {};
        }
    },
    
    // Update response time pattern
    updateResponseTimePattern(currentPattern, newResponseTime) {
        const patterns = {
            'immediate': 'avg_30_minutes',
            'thoughtful': 'avg_1_hour',
            'delayed': 'avg_2_hours'
        };
        
        const newPattern = patterns[newResponseTime] || 'avg_1_hour';
        
        // If we don't have a current pattern, use the new one
        if (!currentPattern) {
            return newPattern;
        }
        
        // Otherwise, gradually adapt
        const currentToNew = {
            'avg_30_minutes': 0.3,
            'avg_1_hour': 0.5,
            'avg_2_hours': 0.7
        };
        
        const newToNew = {
            'avg_30_minutes': 0.3,
            'avg_1_hour': 0.5,
            'avg_2_hours': 0.7
        };
        
        const currentWeight = currentToNew[currentPattern] || 0.5;
        const newWeight = newToNew[newPattern] || 0.5;
        
        // Weighted average
        const combinedWeight = (currentWeight * 0.7) + (newWeight * 0.3);
        
        if (combinedWeight < 0.4) return 'avg_30_minutes';
        if (combinedWeight < 0.6) return 'avg_1_hour';
        return 'avg_2_hours';
    },
    
    // Update question style preference
    updateQuestionStylePreference(currentStyle, newStyle) {
        if (!currentStyle) {
            return newStyle;
        }
        
        // Simple adaptation - if user responds well to a style, prefer it
        const styleMap = {
            'direct': 'direct',
            'exploratory': 'exploratory',
            'contextual': 'contextual'
        };
        
        return styleMap[newStyle] || currentStyle;
    },
    
    // Update engagement level
    updateEngagementLevel(currentLevel, newLevel) {
        if (!currentLevel) {
            return newLevel;
        }
        
        const levelMap = {
            'high': 3,
            'medium': 2,
            'low': 1
        };
        
        const currentValue = levelMap[currentLevel] || 2;
        const newValue = levelMap[newLevel] || 2;
        
        // Weighted average
        const combinedValue = (currentValue * 0.7) + (newValue * 0.3);
        
        if (combinedValue >= 2.5) return 'high';
        if (combinedValue >= 1.5) return 'medium';
        return 'low';
    },
    
    // Track question effectiveness
    async trackQuestionEffectiveness(learningData, execution, interactionAnalysis) {
        try {
            const methodStart = Date.now();
            let questionEffectiveness = learningData.questionEffectiveness || {};
            let interactionHistory = learningData.interactionHistory || [];
            
            // Track this interaction
            const interaction = {
                timestamp: new Date().toISOString(),
                action: execution.analysis ? execution.analysis.actionExecuted : 'unknown',
                confidence: execution.analysis ? execution.analysis.confidence : 0.5,
                responseQuality: interactionAnalysis.responseQuality,
                engagementLevel: interactionAnalysis.engagementLevel,
                effectiveness: this.calculateEffectiveness(execution, interactionAnalysis)
            };
            
            interactionHistory.push(interaction);
            
            // Keep only last 100 interactions
            if (interactionHistory.length > 100) {
                interactionHistory = interactionHistory.slice(-100);
            }
            
            // Update effectiveness scores
            const action = interaction.action;
            if (action && action !== 'unknown') {
                if (!questionEffectiveness[action]) {
                    questionEffectiveness[action] = {
                        totalInteractions: 0,
                        totalEffectiveness: 0,
                        averageEffectiveness: 0
                    };
                }
                
                questionEffectiveness[action].totalInteractions += 1;
                questionEffectiveness[action].totalEffectiveness += interaction.effectiveness;
                questionEffectiveness[action].averageEffectiveness = 
                    questionEffectiveness[action].totalEffectiveness / questionEffectiveness[action].totalInteractions;
            }
            
            Logger.info('learningController', 'timing:trackQuestionEffectiveness:successMs', { ms: Date.now() - methodStart });
            return {
                questionEffectiveness: questionEffectiveness,
                interactionHistory: interactionHistory
            };
            
        } catch (error) {
            Logger.error('learningController', 'trackQuestionEffectiveness:error', error);
            return {
                questionEffectiveness: learningData.questionEffectiveness || {},
                interactionHistory: learningData.interactionHistory || []
            };
        }
    },
    
    // Calculate effectiveness score
    calculateEffectiveness(execution, interactionAnalysis) {
        let effectiveness = 0.5; // Base score
        
        // Boost for good response quality
        if (interactionAnalysis.responseQuality === 'high') {
            effectiveness += 0.3;
        } else if (interactionAnalysis.responseQuality === 'medium') {
            effectiveness += 0.1;
        }
        
        // Boost for high engagement
        if (interactionAnalysis.engagementLevel === 'high') {
            effectiveness += 0.2;
        } else if (interactionAnalysis.engagementLevel === 'medium') {
            effectiveness += 0.1;
        }
        
        // Boost for high cooperation
        if (interactionAnalysis.cooperationLevel === 'high') {
            effectiveness += 0.2;
        } else if (interactionAnalysis.cooperationLevel === 'medium') {
            effectiveness += 0.1;
        }
        
        // Boost for clear communication
        if (interactionAnalysis.clarityLevel === 'clear') {
            effectiveness += 0.1;
        }
        
        return Math.min(Math.max(effectiveness, 0.0), 1.0);
    },
    
    // Update reflection log
    updateReflectionLog(projectId, learningInsights, interactionAnalysis, reflectionData) {
        try {
            const methodStart = Date.now();
            if (!reflectionData) {
                reflectionData = createReflectionData(projectId);
            }
            
            // Add to analysis history
            reflectionData.analysisHistory.push({
                timestamp: new Date().toISOString(),
                learningInsights: learningInsights,
                interactionAnalysis: interactionAnalysis
            });
            
            // Add to decision log
            reflectionData.decisionLog.push({
                timestamp: new Date().toISOString(),
                decision: 'User pattern adaptation',
                reasoning: learningInsights.adaptationRecommendations,
                effectiveness: learningInsights.effectivenessScore
            });
            
            // Generate improvement suggestions
            reflectionData.improvementSuggestions = learningInsights.systemImprovements;
            reflectionData.lastReflection = new Date().toISOString();
            
            // Don't save reflection data - it will be saved by data manager
            Logger.info('learningController', 'timing:updateReflectionLog:successMs', { ms: Date.now() - methodStart });
            
        } catch (error) {
            Logger.error('learningController', 'updateReflectionLog:error', error);
        }
    },
    
    // Get learning summary
    async getLearningSummary(userId, learningData) {
        try {
            // Use provided learning data (no Redis call)
            if (!learningData) {
                return {
                    status: 'No learning data available',
                    recommendations: ['Start project planning to build user profile']
                };
            }
            
            return {
                userPatterns: learningData.userPatterns,
                interactionCount: learningData.interactionHistory ? learningData.interactionHistory.length : 0,
                questionEffectiveness: learningData.questionEffectiveness,
                lastUpdated: learningData.lastUpdated,
                status: this.getLearningStatus(learningData),
                recommendations: this.generateLearningRecommendations(learningData)
            };
            
        } catch (error) {
            Logger.error('learningController', 'getLearningSummary:error', error);
            return {
                status: 'Learning error',
                recommendations: ['Check system status']
            };
        }
    },
    
    // Get learning status
    getLearningStatus(learningData) {
        if (!learningData || !learningData.interactionHistory) {
            return 'No learning history - new user';
        }
        
        const interactionCount = learningData.interactionHistory.length;
        if (interactionCount < 5) {
            return 'Building user profile - learning patterns';
        } else if (interactionCount < 20) {
            return 'Developing understanding - adapting approach';
        } else {
            return 'Well-established patterns - optimized interactions';
        }
    },
    
    // Generate learning recommendations
    generateLearningRecommendations(learningData) {
        const recommendations = [];
        
        if (!learningData || !learningData.interactionHistory) {
            recommendations.push('Start with standard questions');
            recommendations.push('Observe user response patterns');
        } else {
            const interactionCount = learningData.interactionHistory.length;
            if (interactionCount < 5) {
                recommendations.push('Continue gathering user preferences');
                recommendations.push('Test different interaction styles');
            } else if (interactionCount < 20) {
                recommendations.push('Refine approach based on patterns');
                recommendations.push('Optimize question effectiveness');
            } else {
                recommendations.push('Maintain optimized approach');
                recommendations.push('Monitor for pattern evolution');
            }
        }
        
        return recommendations;
    }
};
