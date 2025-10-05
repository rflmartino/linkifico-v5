// gapDetectionController.js - Identifies critical missing information
// Mirrors Cursor's gap analysis - finds what's blocking progress

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
    createGapData, 
    saveGapData, 
    getGapData
} from 'backend/data/projectData.js';
import nlpManager from 'backend/nlp/nlpManager.js';

async function callClaude(prompt, systemPrompt = null) {
    return await askClaude({
        user: prompt,
        system: systemPrompt || "You are a PMaaS (Project Management as a Service) gap analysis system. Identify missing project management information: budget, timeline, deliverables, resources. Focus on actionable gaps that block project execution.",
        model: 'claude-3-5-haiku-latest',
        maxTokens: 1000
    });
}

export const gapDetectionController = {
    
    // Main gap identification function
    async identifyGaps(projectId, analysis, projectData, existingGapData = null, template = null) {
        try {
            // Template-driven missing areas (Phase 1): empty or absent area objects
            const areas = (template && template.areas) || [];
            const missingFields = areas
                .filter(a => !projectData?.templateData?.[a.id] || Object.keys(projectData.templateData[a.id]).length === 0)
                .map(a => a.id);
            
            // Try NLP first with confidence gate
            const nlpResult = await this.tryNLPProcessing(projectData, analysis, missingFields);
            
            let gapAnalysisAndAction;
            if (nlpResult.success) {
                gapAnalysisAndAction = nlpResult.gapAnalysis;
            } else {
                // Fallback to Haiku for low confidence or unknown intents
                gapAnalysisAndAction = await this.analyzeGapsAndDetermineAction(projectData, analysis, missingFields);
            }
            
            // Extract results
            const gapAnalysis = gapAnalysisAndAction.gapAnalysis;
            const prioritizedGaps = gapAnalysisAndAction.prioritizedGaps;
            const nextAction = gapAnalysisAndAction.nextAction;
            
            // Build todos from prioritized gaps (include completion state based on current projectData)
            const todos = this.buildTodosFromGaps(prioritizedGaps, gapAnalysis, nextAction, projectData);

            // Create or update gap data structure
            const gapData = existingGapData || createGapData(projectId, {
                criticalGaps: prioritizedGaps,
                priorityScore: this.calculatePriorityScore(prioritizedGaps),
                nextAction: nextAction.action,
                reasoning: nextAction.reasoning,
                todos: todos
            });
            
            // Update gap data with new analysis
            gapData.criticalGaps = prioritizedGaps;
            gapData.priorityScore = this.calculatePriorityScore(prioritizedGaps);
            gapData.nextAction = nextAction.action;
            gapData.reasoning = nextAction.reasoning;
            gapData.todos = todos;
            gapData.lastUpdated = new Date().toISOString();
            
            return {
                criticalGaps: prioritizedGaps,
                priorityScore: gapData.priorityScore,
                nextAction: nextAction.action,
                reasoning: nextAction.reasoning,
                gapAnalysis: gapAnalysis,
                todos: todos,
                gapData: gapData
            };
            
        } catch (error) {
            Logger.error('gapDetectionController', 'identifyGaps_error', { projectId, error: error.message });
            return {
                criticalGaps: Object.values(PROJECT_FIELDS),
                priorityScore: 1.0,
                nextAction: 'ask_about_scope',
                reasoning: 'Gap analysis failed - need basic project information',
                gapAnalysis: null
            };
        }
    },
    
    // Try NLP processing first with confidence gate
    async tryNLPProcessing(projectData, analysis, missingFields) {
        try {
            const confidenceThreshold = 0.8; // 80% confidence threshold
            
            // Build context string for NLP processing
            const contextString = this.buildNLPContextString(projectData, analysis, missingFields);
            
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
            
            // Convert NLP intent to gap analysis
            const gapAnalysis = this.convertNLPToGapAnalysis(nlpResult, projectData, analysis, missingFields);
            
            return {
                success: true,
                intent: nlpResult.intent,
                confidence: nlpResult.confidence,
                gapAnalysis: gapAnalysis
            };
            
        } catch (error) {
            Logger.error('gapDetectionController', 'tryNLPProcessing:error', error);
            return {
                success: false,
                reason: `NLP error: ${error.message}`,
                confidence: 0
            };
        }
    },
    
    // Build context string for NLP processing
    buildNLPContextString(projectData, analysis, missingFields) {
        const parts = [];
        
        // Add missing fields information
        if (missingFields && missingFields.length > 0) {
            parts.push(missingFields.join(' ') + ' missing');
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
        
        // Add project data completeness
        if (projectData && projectData.templateData) {
            const completedAreas = Object.keys(projectData.templateData).filter(area => 
                projectData.templateData[area] && Object.keys(projectData.templateData[area]).length > 0
            );
            const emptyAreas = Object.keys(projectData.templateData).filter(area => 
                !projectData.templateData[area] || Object.keys(projectData.templateData[area]).length === 0
            );
            
            if (completedAreas.length > 0) {
                parts.push(completedAreas.join(' ') + ' complete');
            }
            if (emptyAreas.length > 0) {
                parts.push(emptyAreas.join(' ') + ' empty');
            }
        }
        
        return parts.join(' ');
    },
    
    // Convert NLP result to gap analysis
    convertNLPToGapAnalysis(nlpResult, projectData, analysis, missingFields) {
        const intent = nlpResult.intent;
        const confidence = nlpResult.confidence;
        
        // Map NLP intent to gap analysis structure
        const gapMappings = {
            'gap.critical_objectives': {
                gapAnalysis: {
                    gaps: [
                        {
                            field: 'objectives',
                            criticality: 'critical',
                            reasoning: 'Objectives are missing - this is critical and blocks all planning.',
                            impact: 'blocks_everything'
                        }
                    ],
                    overallCompleteness: analysis?.completeness || 0.2,
                    criticalGapsCount: 1
                },
                prioritizedGaps: ['objectives'],
                nextAction: {
                    action: 'ask_about_objectives',
                    reasoning: 'Objectives are the foundation - we need to define them first.',
                    priority: 'critical'
                }
            },
            'gap.high_priority_budget': {
                gapAnalysis: {
                    gaps: [
                        {
                            field: 'budget',
                            criticality: 'high',
                            reasoning: 'Budget information is missing - this is high priority for planning.',
                            impact: 'blocks_execution_planning'
                        }
                    ],
                    overallCompleteness: analysis?.completeness || 0.4,
                    criticalGapsCount: 0
                },
                prioritizedGaps: ['budget'],
                nextAction: {
                    action: 'ask_about_budget',
                    reasoning: 'Budget is needed to determine project feasibility and scope.',
                    priority: 'high'
                }
            },
            'gap.medium_tasks': {
                gapAnalysis: {
                    gaps: [
                        {
                            field: 'tasks',
                            criticality: 'medium',
                            reasoning: 'Tasks and deliverables need to be defined for execution planning.',
                            impact: 'blocks_execution_delivery'
                        }
                    ],
                    overallCompleteness: analysis?.completeness || 0.6,
                    criticalGapsCount: 0
                },
                prioritizedGaps: ['tasks'],
                nextAction: {
                    action: 'ask_about_tasks',
                    reasoning: 'Task definition is needed to understand project scope.',
                    priority: 'medium'
                }
            },
            'gap.low_people': {
                gapAnalysis: {
                    gaps: [
                        {
                            field: 'people',
                            criticality: 'low',
                            reasoning: 'Stakeholder and team information would help with coordination.',
                            impact: 'affects_coordination'
                        }
                    ],
                    overallCompleteness: analysis?.completeness || 0.8,
                    criticalGapsCount: 0
                },
                prioritizedGaps: ['people'],
                nextAction: {
                    action: 'ask_about_people',
                    reasoning: 'Team structure affects project coordination and success.',
                    priority: 'low'
                }
            },
            'gap.prioritize_multiple': {
                gapAnalysis: {
                    gaps: missingFields.map(field => ({
                        field: field,
                        criticality: this.determineCriticality(field),
                        reasoning: `Multiple gaps detected - ${field} needs attention.`,
                        impact: this.determineImpact(field)
                    })),
                    overallCompleteness: analysis?.completeness || 0.3,
                    criticalGapsCount: missingFields.filter(f => this.determineCriticality(f) === 'critical').length
                },
                prioritizedGaps: this.prioritizeGaps(missingFields),
                nextAction: {
                    action: 'ask_about_objectives', // Default to objectives if multiple gaps
                    reasoning: 'Multiple gaps require prioritization based on project impact.',
                    priority: 'critical'
                }
            },
            'gap.all_complete': {
                gapAnalysis: {
                    gaps: [],
                    overallCompleteness: 1.0,
                    criticalGapsCount: 0
                },
                prioritizedGaps: [],
                nextAction: {
                    action: 'provide_recommendation',
                    reasoning: 'All areas are well-defined - project is ready for execution.',
                    priority: 'low'
                }
            }
        };
        
        // Get base gap analysis from mapping
        let gapAnalysis = gapMappings[intent] || {
            gapAnalysis: {
                gaps: missingFields.map(field => ({
                    field: field,
                    criticality: 'medium',
                    reasoning: `Gap analysis for ${field}.`,
                    impact: 'affects_planning'
                })),
                overallCompleteness: analysis?.completeness || 0.5,
                criticalGapsCount: 0
            },
            prioritizedGaps: missingFields,
            nextAction: {
                action: 'ask_about_objectives',
                reasoning: 'Default gap analysis for unrecognized intent.',
                priority: 'medium'
            }
        };
        
        return gapAnalysis;
    },
    
    // Helper methods for gap analysis
    determineCriticality(field) {
        const criticalityMap = {
            'objectives': 'critical',
            'budget': 'high',
            'tasks': 'medium',
            'people': 'low'
        };
        return criticalityMap[field] || 'medium';
    },
    
    determineImpact(field) {
        const impactMap = {
            'objectives': 'blocks_everything',
            'budget': 'blocks_execution_planning',
            'tasks': 'blocks_execution_delivery',
            'people': 'affects_coordination'
        };
        return impactMap[field] || 'affects_planning';
    },
    
    prioritizeGaps(fields) {
        // Priority order: objectives (critical), budget (high), tasks (medium), people (low)
        const priorityOrder = ['objectives', 'budget', 'tasks', 'people'];
        return priorityOrder.filter(field => fields.includes(field));
    },
    
    // Build a simple TODO checklist from prioritized gaps
    buildTodosFromGaps(prioritizedGaps, gapAnalysis, nextAction, projectData) {
        const byField = new Map();
        if (gapAnalysis && gapAnalysis.gaps) {
            gapAnalysis.gaps.forEach(g => byField.set(g.field, g));
        }
        const priorityMap = { critical: 'critical', high: 'high', medium: 'medium', low: 'low' };
            const titleMap = {};
        
            return prioritizedGaps.map(field => {
            const gap = byField.get(field) || { criticality: 'high', reasoning: '' };
                const action = `ask_about_${field}`;
            const completed = this.isAreaCompleted(field, projectData && projectData.templateData ? projectData.templateData : {});
            return {
                id: `todo_${field}`,
                    title: titleMap[field] || `Clarify ${field}`,
                reason: gap.reasoning || `Clarify ${field} to progress`,
                priority: priorityMap[gap.criticality] || 'high',
                action: action,
                isNext: nextAction && nextAction.action === action,
                completed: !!completed
            };
        });
    },

    // Determine if a template area is considered completed based on available data
    isAreaCompleted(areaId, templateData) {
        try {
            const td = templateData || {};
            switch (areaId) {
                case 'objectives': {
                    const obj = td.objectives || {};
                    return !!(obj.description && obj.description.trim().length > 0) || Array.isArray(obj.goals) && obj.goals.length > 0 || Array.isArray(obj.acceptanceCriteria) && obj.acceptanceCriteria.length > 0;
                }
                case 'tasks': {
                    const tasks = td.tasks || {};
                    return Array.isArray(tasks.tasks) && tasks.tasks.length > 0 || !!tasks.deadline || Array.isArray(tasks.dependencies) && tasks.dependencies.length > 0;
                }
                case 'budget': {
                    const budget = td.budget || {};
                    return budget.total != null && budget.total !== '' || (Array.isArray(budget.lineItems) && budget.lineItems.length > 0) || (typeof budget.spent === 'number' && budget.spent > 0);
                }
                case 'people': {
                    const people = td.people || {};
                    return Array.isArray(people.stakeholders) && people.stakeholders.length > 0 || Array.isArray(people.team) && people.team.length > 0;
                }
                default:
                    // For unknown areas, consider incomplete unless there is any key present
                    const area = td[areaId];
                    return !!(area && Object.keys(area).length > 0);
            }
        } catch (_) {
            return false;
        }
    },
    
    // Combined method: Analyze gaps and determine next action in one API call
    async analyzeGapsAndDetermineAction(projectData, analysis, missingFields) {
        try {
            const prompt = `Analyze these PMaaS (Project Management as a Service) gaps, determine their criticality, prioritize them, and determine the next action:

Project Data: ${JSON.stringify(projectData, null, 2)}
Analysis: ${JSON.stringify(analysis, null, 2)}
Missing Fields: ${JSON.stringify(missingFields, null, 2)}

FOCUS ON PRACTICAL PROJECT MANAGEMENT GAPS:
- Budget: Missing financial constraints and spending limits
- Timeline: Missing deadlines and milestone dates
- Deliverables: Missing specific outputs and results
- Resources: Missing team members and responsibilities

For each missing field, provide:
1. Criticality level (critical|high|medium|low)
2. Impact on project execution (blocks_everything|blocks_planning|blocks_execution|minor_impact)
3. Dependencies (what other gaps this depends on)
4. Reasoning (why this gap blocks project management)

Then prioritize the gaps and determine the next action.

Respond in JSON format:
{
    "gapAnalysis": {
        "gaps": [
            {
                "field": "objectives",
                "criticality": "critical",
                "impact": "blocks_planning",
                "dependencies": [],
                "reasoning": "Without deliverables, cannot plan timeline, budget, or resources"
            }
        ]
    },
    "prioritizedGaps": ["objectives", "budget", "timeline"],
    "nextAction": {
        "action": "ask_about_objectives",
        "question": "What specific deliverables do you need from this project?",
        "reasoning": "Deliverables are critical for project planning"
    }
}`;

            const parsed = await askClaudeJSON({
                user: prompt,
                system: `You are a PMaaS (Project Management as a Service) gap analysis system.

ROLE: Identify missing project management information that blocks execution:
- Budget amounts and financial constraints
- Specific deadlines and milestone dates  
- Deliverable requirements and outputs
- Resource availability and team assignments

FOCUS: Actionable gaps that prevent concrete project planning.
AVOID: Abstract business strategy gaps, market analysis gaps.

Return ONLY valid JSON with the requested structure. Focus on practical project management gaps.`,
                model: 'claude-3-5-haiku-latest',
                maxTokens: 1200
            });

            if (parsed && parsed.gapAnalysis && parsed.prioritizedGaps && parsed.nextAction) {
                return parsed;
            }

            // Fallback to simple logic if combined call fails
            return this.getFallbackGapAnalysisAndAction(missingFields);
            
        } catch (error) {
            Logger.error('gapDetectionController', 'analyzeGapsAndPlanAction:error', error);
            // Fallback to simple logic
            return this.getFallbackGapAnalysisAndAction(missingFields);
        }
    },
    
    // Fallback gap analysis and action when AI fails
    getFallbackGapAnalysisAndAction(missingFields) {
        const gaps = [];
        const prioritizedGaps = [];
        
        missingFields.forEach(field => {
            gaps.push({
                field,
                criticality: field === 'objectives' ? 'critical' : (field === 'tasks' ? 'high' : 'medium'),
                impact: field === 'objectives' ? 'blocks_everything' : (field === 'tasks' ? 'blocks_planning' : 'blocks_execution'),
                dependencies: field === 'tasks' ? ['objectives'] : [],
                reasoning: `Area '${field}' is missing in templateData`
            });
            prioritizedGaps.push(field);
        });
        
        // Determine next action based on top priority gap
        const topGap = prioritizedGaps[0];
        let nextAction;
        
        nextAction = {
            action: topGap ? `ask_about_${topGap}` : 'ask_about_objectives',
            question: topGap ? `Tell me about ${topGap}` : 'What are your main objectives?',
            reasoning: 'Focus on missing area first'
        };
        
        return {
            gapAnalysis: { gaps: gaps },
            prioritizedGaps: prioritizedGaps,
            nextAction: nextAction
        };
    },
    
    
    // Calculate overall priority score
    calculatePriorityScore(prioritizedGaps) {
        if (!prioritizedGaps || prioritizedGaps.length === 0) {
            return 0.0;
        }
        
        // Higher score = more critical gaps remain
        const criticalityScores = { 'critical': 1.0, 'high': 0.8, 'medium': 0.6, 'low': 0.4 };
        let totalScore = 0.0;
        
        prioritizedGaps.forEach((gap, index) => {
            // Weight by position (first gap is most critical)
            const positionWeight = 1.0 - (index * 0.1);
            const gapScore = criticalityScores['critical'] || 0.5; // Default to critical
            totalScore += gapScore * positionWeight;
        });
        
        return Math.min(totalScore, 1.0);
    },
    
    // Get gap summary
    async getGapSummary(projectId, gapData) {
        try {
            // Use provided gap data (no Redis call)
            if (!gapData) {
                return {
                    criticalGaps: [],
                    priorityScore: 0.0,
                    status: 'No gap analysis available',
                    recommendations: ['Run gap analysis']
                };
            }
            
            return {
                criticalGaps: gapData.criticalGaps,
                priorityScore: gapData.priorityScore,
                nextAction: gapData.nextAction,
                reasoning: gapData.reasoning,
                lastUpdated: gapData.lastUpdated,
                status: this.getGapStatus(gapData.priorityScore),
                recommendations: this.generateGapRecommendations(gapData)
            };
            
        } catch (error) {
            Logger.error('gapDetectionController', 'getGapSummary:error', error);
            return {
                criticalGaps: [],
                priorityScore: 1.0,
                status: 'Gap analysis error',
                recommendations: ['Check system status']
            };
        }
    },
    
    // Get gap status description
    getGapStatus(priorityScore) {
        if (priorityScore >= 0.8) return 'Critical gaps - immediate attention needed';
        if (priorityScore >= 0.6) return 'High priority gaps - plan to address soon';
        if (priorityScore >= 0.4) return 'Medium priority gaps - schedule for resolution';
        if (priorityScore >= 0.2) return 'Low priority gaps - monitor and address as needed';
        return 'Minimal gaps - project well-defined';
    },
    
    // Generate gap recommendations
    generateGapRecommendations(gapData) {
        const recommendations = [];
        
        if (gapData.priorityScore >= 0.8) {
            recommendations.push('Address critical gaps immediately');
            recommendations.push('Focus on ' + gapData.criticalGaps[0] + ' first');
        } else if (gapData.priorityScore >= 0.6) {
            recommendations.push('Plan to address high-priority gaps');
            recommendations.push('Consider impact on project timeline');
        } else if (gapData.priorityScore >= 0.4) {
            recommendations.push('Schedule gap resolution activities');
            recommendations.push('Monitor for new gaps as project progresses');
        } else {
            recommendations.push('Project gaps are manageable');
            recommendations.push('Continue with current planning approach');
        }
        
        return recommendations;
    }
};
