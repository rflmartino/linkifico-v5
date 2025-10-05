// executionController.js - Executes planned actions and processes user responses
// Mirrors Cursor's execution system - processes responses and updates project data

import { getSecret } from 'wix-secrets-backend';
import { askClaude } from '../utils/aiClient.js';
import { 
    getProjectData,
    saveProjectData
} from 'backend/data/projectData.js';
import { redisData } from '../data/redisData.js';
import { Logger } from '../utils/logger.js';
import compromiseSentiment from 'backend/nlp/compromiseSentiment.js';
import nlpManager from 'backend/nlp/nlpManager.js';

async function callClaude(prompt, systemPrompt = null) {
    return await askClaude({
        user: prompt,
        system: systemPrompt || "You are a PMaaS (Project Management as a Service) tool. Ask practical project management questions about budget, timeline, deliverables, and resources. Focus on actionable project planning, not business strategy or philosophical goals.",
        model: 'claude-3-5-haiku-latest',
        maxTokens: 1000
    });
}

export const executionController = {
    
    // Main execution function
    async executeAction(projectId, userId, userMessage, actionPlan, projectData, template = null) {
        try {
            // Step 1: Try NLP first with confidence gate
            const nlpResult = await this.tryNLPProcessing(userMessage, actionPlan, projectData);
            
            if (nlpResult.success) {
                // Update project data with NLP-extracted information
                const updatedProjectData = await this.updateProjectData(projectId, projectData, nlpResult.extractedInfo, template, actionPlan);
                
                // Generate intelligent project name if still using default
                await this.updateProjectNameIfNeeded(projectId, updatedProjectData, userMessage, nlpResult.extractedInfo);
                
                // Generate action-aware response for NLP path
                const actionAwareMessage = this.generateActionAwareResponse(nlpResult.responseMessage, actionPlan.action, userMessage);
                
                const result = {
                    message: actionAwareMessage,
                    analysis: {
                        extractedInfo: nlpResult.extractedInfo,
                        updatedProjectData: updatedProjectData,
                        shouldContinue: true,
                        actionExecuted: nlpResult.action,
                        confidence: nlpResult.confidence,
                        usedNLP: true,
                        intent: nlpResult.intent
                    }
                };
                
                return result;
            }
            
            // Step 2: Fallback to Haiku for low confidence or unknown intents
            // Analyze user sentiment to control verbosity
            const sentimentAnalysis = compromiseSentiment.analyzeForHaiku(userMessage);
            
            // Process user response and generate response in single API call
            const { extractedInfo, responseMessage } = await this.extractAndGenerateResponse(userMessage, actionPlan, projectData, sentimentAnalysis);
            
            // Update project data with extracted information
            const updatedProjectData = await this.updateProjectData(projectId, projectData, extractedInfo, template, actionPlan);
            
            // Generate intelligent project name if still using default
            await this.updateProjectNameIfNeeded(projectId, updatedProjectData, userMessage, extractedInfo);
            
            // Determine if we should continue or wait
            const shouldContinue = this.shouldContinueConversation(extractedInfo, updatedProjectData);
            
            const result = {
                message: responseMessage,
                analysis: {
                    extractedInfo: extractedInfo,
                    updatedProjectData: updatedProjectData,
                    shouldContinue: shouldContinue,
                    actionExecuted: actionPlan.action,
                    confidence: actionPlan.confidence,
                    usedNLP: false
                }
            };
            
            return result;
            
        } catch (error) {
            Logger.error('executionController', 'executeAction_error', { projectId, userId, error: error.message });
            return {
                message: "I understand. Let me help you with that. Could you tell me more about your project?",
                analysis: {
                    extractedInfo: null,
                    updatedProjectData: projectData,
                    shouldContinue: true,
                    actionExecuted: 'fallback',
                    confidence: 0.3
                }
            };
        }
    },
    
    // Try NLP processing first with confidence gate
    async tryNLPProcessing(userMessage, actionPlan, projectData) {
        try {
            const confidenceThreshold = 0.9; // 90% confidence threshold - force Haiku for better extraction
            
            // Get complete analysis from NLP (includes intent, confidence, and response)
            const nlpResult = await nlpManager.processInput(userMessage);
            
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
            
            // Extract information based on intent (simplified)
            const extractedInfo = this.extractInfoFromIntent(nlpResult.intent, userMessage, actionPlan);
            
            return {
                success: true,
                intent: nlpResult.intent,
                confidence: nlpResult.confidence,
                responseMessage: nlpResult.answer, // Use the response from NLP
                extractedInfo: extractedInfo,
                action: nlpResult.mappedAction || actionPlan.action // Use mapped action from NLP
            };
            
        } catch (error) {
            Logger.error('executionController', 'tryNLPProcessing:error', error);
            return {
                success: false,
                reason: `NLP error: ${error.message}`,
                confidence: 0
            };
        }
    },
    
    // Extract information from user message based on intent
    extractInfoFromIntent(intent, userMessage, actionPlan) {
        const extractedInfo = {
            confidence: 0.8, // High confidence for NLP
            extractionQuality: 'high',
            additionalInfo: '',
            needsClarification: []
        };
        
        switch (intent) {
            case 'scope.define':
                // Use new format - direct fields
                extractedInfo.templateArea = 'objectives';
                extractedInfo.objectives = { description: userMessage };
                break;
                
            case 'project.rename':
                // Extract new project name from message
                const newProjectName = this.extractProjectNameFromMessage(userMessage);
                if (newProjectName) {
                    extractedInfo.templateArea = 'project_name';
                    extractedInfo.projectName = newProjectName;
                }
                break;
                
            case 'budget.set':
                // Extract budget numbers from message
                const budgetMatch = userMessage.match(/\$?(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)/);
                if (budgetMatch) {
                    extractedInfo.templateArea = 'budget';
                    extractedInfo.budget = { total: budgetMatch[1] };
                }
                break;
                
            case 'timeline.set':
                extractedInfo.templateArea = 'tasks';
                extractedInfo.tasks = { deadline: userMessage };
                break;
                
            case 'deliverables.define':
                extractedInfo.templateArea = 'tasks';
                extractedInfo.tasks = { tasks: [userMessage] };
                break;
                
            case 'dependencies.define':
                extractedInfo.templateArea = 'tasks';
                extractedInfo.tasks = { dependencies: [userMessage] };
                break;
                
            case 'response.positive':
                extractedInfo.confirmation = true;
                break;
                
            case 'response.negative':
                extractedInfo.confirmation = false;
                break;
                
            default:
                // For other intents, try to extract objectives from general project description
                if (userMessage.toLowerCase().includes('project') || 
                    userMessage.toLowerCase().includes('business') || 
                    userMessage.toLowerCase().includes('plan') ||
                    userMessage.toLowerCase().includes('want to') ||
                    userMessage.toLowerCase().includes('need to') ||
                    userMessage.toLowerCase().includes('going to')) {
                    extractedInfo.templateArea = 'objectives';
                    extractedInfo.objectives = { description: userMessage };
                } else {
                    extractedInfo.additionalInfo = userMessage;
                }
                break;
        }
        
        return extractedInfo;
    },
    
    // Extract project name from user message
    extractProjectNameFromMessage(userMessage) {
        try {
            // Common patterns for project name requests
            const patterns = [
                /(?:change|rename|set|update).*(?:project\s+)?name\s+to\s+(.+?)(?:\.|$)/i,
                /(?:call|name)\s+(?:this\s+project|it)\s+(.+?)(?:\.|$)/i,
                /(?:let'?s\s+)?(?:call|name)\s+(?:this|it)\s+(.+?)(?:\.|$)/i,
                /project\s+name\s+should\s+be\s+(.+?)(?:\.|$)/i,
                /(?:rename|change)\s+(?:to|it\s+to)\s+(.+?)(?:\.|$)/i
            ];
            
            for (const pattern of patterns) {
                const match = userMessage.match(pattern);
                if (match && match[1]) {
                    let extractedName = match[1].trim();
                    
                    // Clean up the extracted name
                    extractedName = extractedName
                        .replace(/['"]/g, '') // Remove quotes
                        .replace(/\s+/g, ' ') // Normalize spaces
                        .trim();
                    
                    // Validate the name
                    if (extractedName.length > 0 && extractedName.length <= 100) {
                        return extractedName;
                    }
                }
            }
            
            return null;
        } catch (error) {
            Logger.error('executionController', 'extractProjectNameFromMessage:error', error);
            return null;
        }
    },
    
    // Update project name if still using default name
    async updateProjectNameIfNeeded(projectId, projectData, userMessage, extractedInfo) {
        try {
            // Skip if user explicitly requested a name change (handled elsewhere)
            if (extractedInfo?.extractedFields?.projectName) {
                return; // User explicitly set a name
            }
            
            // Only update if using default name or empty name
            const currentName = projectData.name || '';
            const isDefaultName = currentName === 'Untitled Project' || currentName === '' || currentName.startsWith('Project Chat');
            
            if (!isDefaultName) {
                return; // User has already set a custom name
            }
            
            // Generate intelligent name from conversation context
            const generatedName = await this.generateIntelligentProjectName(userMessage, extractedInfo, projectData);
            
            if (generatedName && generatedName !== currentName) {
                // Update project data
                projectData.name = generatedName;
                
                // Return updated project data (no Redis save - handled by entry point)
                
                Logger.info('executionController', 'projectNameGenerated', { 
                    projectId, 
                    oldName: currentName, 
                    newName: generatedName 
                });
            }
            
        } catch (error) {
            Logger.error('executionController', 'updateProjectNameIfNeeded:error', error);
            // Don't fail the whole process if name generation fails
        }
    },
    
    // Generate intelligent project name from context with NLP + OpenAI fallback
    async generateIntelligentProjectName(userMessage, extractedInfo, projectData) {
        try {
            // First try to extract from objectives/scope
            const objectives = extractedInfo?.objectives?.description || projectData?.templateData?.objectives?.description || '';
            const scope = projectData?.scope || '';
            
            // Combine relevant context
            const context = [userMessage, objectives, scope].filter(Boolean).join(' ').substring(0, 500);
            
            if (!context.trim()) {
                return null; // Not enough context yet
            }
            
            // Step 1: Try NLP-based project name generation first
            const nlpResult = await this.tryNLPProjectNameGeneration(context);
            
            if (nlpResult.success && nlpResult.confidence >= 0.7) {
                Logger.info('executionController', 'generateIntelligentProjectName:nlpSuccess', {
                    confidence: nlpResult.confidence,
                    generatedName: nlpResult.projectName,
                    method: 'NLP'
                });
                return nlpResult.projectName;
            }
            
            // Step 2: Fallback to OpenAI when NLP confidence < 70%
            Logger.info('executionController', 'generateIntelligentProjectName:nlpFallback', {
                nlpConfidence: nlpResult.confidence,
                reason: nlpResult.reason,
                method: 'OpenAI'
            });
            
            const openaiResult = await this.generateProjectNameWithOpenAI(context);
            
            if (openaiResult) {
                Logger.info('executionController', 'generateIntelligentProjectName:openaiSuccess', {
                    generatedName: openaiResult,
                    method: 'OpenAI'
                });
                return openaiResult;
            }
            
            return null;
            
        } catch (error) {
            Logger.error('executionController', 'generateIntelligentProjectName:error', error);
            return null;
        }
    },
    
    // Try NLP-based project name generation
    async tryNLPProjectNameGeneration(context) {
        try {
            const nlpResult = await nlpManager.processInput(context);
            
            if (!nlpResult || nlpResult.intent !== 'project.name_generate') {
                return {
                    success: false,
                    reason: `Wrong intent: ${nlpResult?.intent || 'unknown'}`,
                    confidence: nlpResult?.confidence || 0
                };
            }
            
            // Extract project name from context using NLP insights
            const projectName = this.extractProjectNameFromContext(context, nlpResult);
            
            if (projectName) {
                return {
                    success: true,
                    confidence: nlpResult.confidence,
                    projectName: projectName
                };
            }
            
            return {
                success: false,
                reason: 'Could not extract project name from context',
                confidence: nlpResult.confidence
            };
            
        } catch (error) {
            Logger.error('executionController', 'tryNLPProjectNameGeneration:error', error);
            return {
                success: false,
                reason: `NLP error: ${error.message}`,
                confidence: 0
            };
        }
    },
    
    // Extract project name from context using NLP insights
    extractProjectNameFromContext(context, nlpResult) {
        try {
            // Common business type patterns
            const businessPatterns = [
                { pattern: /(?:pet|animal|dog|cat)\s+store/i, name: 'Pet Store' },
                { pattern: /coffee\s+shop/i, name: 'Coffee Shop' },
                { pattern: /restaurant/i, name: 'Restaurant' },
                { pattern: /bakery/i, name: 'Bakery' },
                { pattern: /mobile\s+app/i, name: 'Mobile App' },
                { pattern: /website/i, name: 'Website' },
                { pattern: /e-commerce|online\s+store/i, name: 'E-commerce Platform' },
                { pattern: /fitness\s+center|gym/i, name: 'Fitness Center' },
                { pattern: /yoga\s+studio/i, name: 'Yoga Studio' },
                { pattern: /tech\s+startup/i, name: 'Tech Startup' },
                { pattern: /consulting\s+business/i, name: 'Consulting Business' },
                { pattern: /marketing\s+campaign/i, name: 'Marketing Campaign' },
                { pattern: /product\s+launch/i, name: 'Product Launch' },
                { pattern: /food\s+truck/i, name: 'Food Truck' },
                { pattern: /beauty\s+salon/i, name: 'Beauty Salon' },
                { pattern: /hardware\s+store/i, name: 'Hardware Store' },
                { pattern: /bookstore/i, name: 'Bookstore' },
                { pattern: /pharmacy/i, name: 'Pharmacy' },
                { pattern: /veterinary\s+clinic/i, name: 'Veterinary Clinic' },
                { pattern: /dental\s+clinic/i, name: 'Dental Clinic' },
                { pattern: /tutoring\s+service/i, name: 'Tutoring Service' },
                { pattern: /cleaning\s+service/i, name: 'Cleaning Service' },
                { pattern: /landscaping\s+business/i, name: 'Landscaping Business' },
                { pattern: /photography\s+studio/i, name: 'Photography Studio' },
                { pattern: /graphic\s+design\s+agency/i, name: 'Graphic Design Agency' },
                { pattern: /wedding\s+planning/i, name: 'Wedding Planning' },
                { pattern: /event\s+planning/i, name: 'Event Planning' },
                { pattern: /real\s+estate\s+development/i, name: 'Real Estate Development' },
                { pattern: /construction\s+project/i, name: 'Construction Project' },
                { pattern: /home\s+renovation/i, name: 'Home Renovation' },
                { pattern: /office\s+renovation/i, name: 'Office Renovation' }
            ];
            
            // Try to match business patterns
            for (const business of businessPatterns) {
                if (business.pattern.test(context)) {
                    return business.name;
                }
            }
            
            // Try to extract location-based names
            const locationMatch = context.match(/(?:in|at|near|downtown|suburbs|mall|center|plaza|district)\s+([a-zA-Z\s]+)/i);
            if (locationMatch) {
                const location = locationMatch[1].trim();
                // Try to combine with business type
                for (const business of businessPatterns) {
                    if (business.pattern.test(context)) {
                        return `${location} ${business.name}`;
                    }
                }
            }
            
            return null;
            
        } catch (error) {
            Logger.error('executionController', 'extractProjectNameFromContext:error', error);
            return null;
        }
    },
    
    // Generate project name using OpenAI as fallback
    async generateProjectNameWithOpenAI(context) {
        try {
            const prompt = `Based on this project description, generate a concise, professional project name (2-4 words max):

"${context}"

Requirements:
- Professional and clear
- 2-4 words maximum
- No generic words like "project", "plan", "new"
- Focus on the business/goal type
- Examples: "Downtown Coffee Shop", "E-commerce Platform", "Marketing Campaign"

Project name:`;

            const response = await askClaude({
                user: prompt,
                system: "Generate concise, professional project names. Return only the name, no quotes or explanation.",
                model: 'claude-3-5-haiku-latest',
                maxTokens: 50
            });

            // Clean up the response
            const cleanName = response.trim()
                .replace(/['"]/g, '') // Remove quotes
                .replace(/^Project:\s*/i, '') // Remove "Project:" prefix
                .replace(/\.$/, '') // Remove trailing period
                .trim();

            // Validate the name
            if (cleanName.length > 0 && cleanName.length <= 50 && !cleanName.toLowerCase().includes('untitled')) {
                return cleanName;
            }
            
            return null;
            
        } catch (error) {
            Logger.error('executionController', 'generateProjectNameWithOpenAI:error', error);
            return null;
        }
    },
    
    // Generate action-aware response for NLP path
    generateActionAwareResponse(nlpResponse, action, userMessage) {
        const actionQuestions = {
            'ask_about_objectives': [
                "What specific deliverables do you need from this project?",
                "What are the main outputs you're expecting?", 
                "What should be completed when this project is done?",
                "What concrete results do you need delivered?"
            ],
            'ask_about_budget': [
                "What's your budget for this project?",
                "How much funding do you have available?",
                "What's your spending limit?",
                "What total budget can you allocate?"
            ],
            'ask_about_tasks': [
                "What specific work needs to be done?",
                "What are the main tasks to complete?",
                "What activities need to happen?",
                "What work needs to be completed?"
            ],
            'ask_about_people': [
                "Who will be working on this project?",
                "What team members do you have?",
                "Who needs to approve decisions?",
                "Who's involved in this project?"
            ],
            'ask_about_timeline': [
                "When do you need this completed?",
                "What's your target deadline?",
                "How much time do you have?",
                "What's your timeline for this project?"
            ]
        };
        
        const questions = actionQuestions[action];
        if (questions && questions.length > 0) {
            // Pick a random question for variety
            const randomQuestion = questions[Math.floor(Math.random() * questions.length)];
            return `${nlpResponse}\n\n${randomQuestion}`;
        }
        
        return nlpResponse; // Return original if no specific action question
    },
    
    // Get specific instructions for each action type
    getActionInstructions(action) {
        const instructions = {
            'ask_about_objectives': 'IMPORTANT: Ask what specific deliverables or outcomes they want from this project. Focus on concrete results, not abstract goals.',
            'ask_about_budget': 'IMPORTANT: Ask for their budget range or total project budget. Be direct about financial constraints.',
            'ask_about_tasks': 'IMPORTANT: Ask what specific tasks need to be completed or what work needs to be done.',
            'ask_about_people': 'IMPORTANT: Ask who will be working on this project or who needs to approve decisions.',
            'ask_about_timeline': 'IMPORTANT: Ask when they need this project completed or what their target timeline is.',
            'ask_about_deliverables': 'IMPORTANT: Ask what specific outputs, products, or results they need delivered.',
            'acknowledge_input': 'IMPORTANT: Acknowledge their input and ask the next logical project management question.',
            'request_clarification': 'IMPORTANT: Ask for clarification about something specific that was unclear or ambiguous in their message.',
            'provide_recommendation': 'IMPORTANT: Provide specific recommendations or next steps based on the information they\'ve provided.',
            'continue_planning': 'IMPORTANT: Continue the planning conversation by building on what they\'ve shared and asking about the next logical step.'
        };
        
        return instructions[action] || 'IMPORTANT: Acknowledge their input and ask a helpful follow-up question to continue the project planning conversation.';
    },
    
    // Combined extraction and response generation in single API call
    async extractAndGenerateResponse(userMessage, actionPlan, projectData, sentimentAnalysis) {
        try {
            const verbosityInstruction = sentimentAnalysis?.verbosityInstruction || 'normal';
            const actionInstructions = this.getActionInstructions(actionPlan.action);
            const prompt = `User: "${userMessage}"
Action: ${actionPlan.action}
Verbosity: ${verbosityInstruction} (${verbosityInstruction === 'terse' ? 'max 50 words' : verbosityInstruction === 'normal' ? 'max 150 words' : 'max 300 words'})

${actionInstructions}

CRITICAL: Extract ALL information from the user's message. A single message can contain multiple types of information:
- Project objectives/goals/scope (what they want to accomplish)
- Budget amounts, dollar figures, financial information
- Tasks, deliverables, timeline information
- People, team, stakeholders information

IMPORTANT: Fill in ALL relevant fields, not just one. If the user mentions both objectives AND budget, extract BOTH.

Respond in JSON with template-aware fields (simple_waterfall):
{
  "extractedInfo": {
    "confidence": 0.8,
    "templateArea": "objectives|tasks|budget|people|unknown",
    "objectives": { "description": "extract project goals/scope/objectives", "goals": [], "acceptanceCriteria": [] },
    "tasks": { "tasks": [], "deadline": null, "dependencies": [] },
    "budget": { "total": "extract any dollar amounts mentioned", "spent": null, "lineItems": [] },
    "people": { "stakeholders": [], "team": [] },
    "needsClarification": []
  },
  "responseMessage": "Your response following verbosity limits"
}`;

            const response = await askClaude({
                user: prompt,
                system: `You are a PMaaS (Project Management as a Service) tool focused on practical project planning.

ROLE: Ask direct, actionable project management questions about:
- Budget: "What's your budget?" "How much can you spend?"
- Timeline: "When do you need this completed?" "What's your deadline?"
- Deliverables: "What specific outputs do you need?" "What should be delivered?"
- Resources: "Who's working on this?" "What resources do you have?"

AVOID: Abstract business strategy questions, philosophical discussions, competitive advantage questions.

FOCUS: Concrete project details that help create actionable plans with timelines, budgets, and deliverables.

Extract project information and generate action-aware responses that gather practical project management details.`,
                model: 'claude-3-5-haiku-latest',
                maxTokens: 800
            });

            // Parse the JSON response
            const parsedResponse = JSON.parse(response);
            
            Logger.info('executionController', 'extractAndGenerateResponse:success', { 
                extractedConfidence: parsedResponse.extractedInfo?.confidence,
                responseLength: parsedResponse.responseMessage?.length
            });
            
            return {
                extractedInfo: parsedResponse.extractedInfo,
                responseMessage: parsedResponse.responseMessage
            };
            
        } catch (error) {
            Logger.error('executionController', 'extractAndGenerateResponse:error', error);
            return {
                extractedInfo: { confidence: 0.3, needsClarification: ['Unable to parse response'] },
                responseMessage: "I understand. Let me help you with that. Could you tell me more about your project?"
            };
        }
    },
    
    
    // Update project data with extracted information
    async updateProjectData(projectId, projectData, extractedInfo, template = null, actionPlan = null) {
        try {
            const updatedData = { ...projectData };
            updatedData.templateData = { ...(updatedData.templateData || {}) };
            
            if (extractedInfo) {
                // Handle both old format (extractedFields) and new format (direct fields)
                const fields = extractedInfo.extractedFields || extractedInfo;
                const areaId = fields.templateArea || (actionPlan?.targetArea) || null;
                
                // Handle project name changes directly
                if (fields.projectName) {
                    updatedData.name = fields.projectName;
                    Logger.info('executionController', 'projectNameChanged', { 
                        projectId, 
                        oldName: projectData.name, 
                        newName: fields.projectName 
                    });
                }
                
                // Update all extracted areas (new multi-area extraction)
                const areaUpdate = {};
                
                // Handle objectives
                if (fields.objectives && (fields.objectives.description || fields.objectives.goals || fields.objectives.acceptanceCriteria)) {
                    areaUpdate.objectives = { ...(updatedData.templateData.objectives || {}), ...fields.objectives };
                    Logger.info('executionController', 'objectivesUpdated', { 
                        projectId, 
                        description: fields.objectives.description,
                        hasGoals: !!(fields.objectives.goals && fields.objectives.goals.length > 0)
                    });
                }
                
                // Handle tasks
                if (fields.tasks && (fields.tasks.tasks || fields.tasks.deadline || fields.tasks.dependencies)) {
                    areaUpdate.tasks = { ...(updatedData.templateData.tasks || {}), ...fields.tasks };
                    Logger.info('executionController', 'tasksUpdated', { 
                        projectId, 
                        taskCount: fields.tasks.tasks ? fields.tasks.tasks.length : 0,
                        hasDeadline: !!fields.tasks.deadline
                    });
                }
                
                // Handle budget
                if (fields.budget && (fields.budget.total || fields.budget.spent || fields.budget.lineItems)) {
                    areaUpdate.budget = { ...(updatedData.templateData.budget || {}), ...fields.budget };
                    Logger.info('executionController', 'budgetUpdated', { 
                        projectId, 
                        total: fields.budget.total,
                        spent: fields.budget.spent
                    });
                }
                
                // Handle people
                if (fields.people && (fields.people.stakeholders || fields.people.team)) {
                    areaUpdate.people = { ...(updatedData.templateData.people || {}), ...fields.people };
                    Logger.info('executionController', 'peopleUpdated', { 
                        projectId, 
                        stakeholderCount: fields.people.stakeholders ? fields.people.stakeholders.length : 0,
                        teamCount: fields.people.team ? fields.people.team.length : 0
                    });
                }
                
                // Apply all updates
                if (Object.keys(areaUpdate).length > 0) {
                    Object.assign(updatedData.templateData, areaUpdate);
                } else if (areaId && areaId !== 'project_name') {
                    // Fallback: if no structured area object but areaId exists, attach additionalInfo minimally
                    updatedData.templateData[areaId] = { ...(updatedData.templateData[areaId] || {}), note: extractedInfo.additionalInfo || '' };
                }
                
                // Update timestamp
                updatedData.updatedAt = new Date().toISOString();
            }
            
            // Return updated project data (no Redis save - handled by entry point)
            return updatedData;
            
        } catch (error) {
            Logger.error('executionController', 'updateProjectData:error', error);
            return projectData;
        }
    },
    
    
    // Determine if conversation should continue
    shouldContinueConversation(extractedInfo, updatedProjectData) {
        try {
            // Check if we have basic project information
            const hasScope = updatedProjectData.scope && updatedProjectData.scope.length > 10;
            const hasTimeline = updatedProjectData.timeline && updatedProjectData.timeline.length > 5;
            const hasBudget = updatedProjectData.budget && updatedProjectData.budget.length > 5;
            
            // If we have all three, we might be ready for more detailed planning
            if (hasScope && hasTimeline && hasBudget) {
                return true; // Continue to deliverables and dependencies
            }
            
            // If we have at least scope, continue
            if (hasScope) {
                return true;
            }
            
            // If extraction was good, continue
            if (extractedInfo && extractedInfo.confidence > 0.6) {
                return true;
            }
            
            // Default to continue
            return true;
            
        } catch (error) {
            Logger.error('executionController', 'shouldContinueConversation:error', error);
            return true;
        }
    },
    
    // Get execution summary
    async getExecutionSummary(projectId, projectData) {
        try {
            // Use provided project data (no Redis call)
            if (!projectData) {
                return {
                    status: 'No project data available',
                    recommendations: ['Start project planning']
                };
            }
            
            return {
                projectData: projectData,
                completeness: this.calculateCompleteness(projectData),
                lastUpdated: projectData.updatedAt,
                status: this.getExecutionStatus(projectData),
                recommendations: this.generateExecutionRecommendations(projectData)
            };
            
        } catch (error) {
            Logger.error('executionController', 'getExecutionSummary:error', error);
            return {
                status: 'Execution error',
                recommendations: ['Check system status']
            };
        }
    },
    
    // Calculate project completeness
    calculateCompleteness(projectData) {
        const td = projectData?.templateData || {};
        const areas = ['objectives','tasks','budget','people'];
        const total = areas.length;
        const filled = areas.filter(a => td[a] && Object.keys(td[a]).length > 0).length;
        return total ? filled / total : 0;
    },
    
    // Get execution status
    getExecutionStatus(projectData) {
        const completeness = this.calculateCompleteness(projectData);
        
        if (completeness >= 1.0) {
            return 'Project fully defined - ready for detailed planning';
        } else if (completeness >= 0.67) {
            return 'Project mostly defined - minor gaps remain';
        } else if (completeness >= 0.33) {
            return 'Project partially defined - significant gaps remain';
        } else {
            return 'Project needs definition - basic information missing';
        }
    },
    
    // Generate execution recommendations
    generateExecutionRecommendations(projectData) {
        const recommendations = [];
        const completeness = this.calculateCompleteness(projectData);
        
        if (completeness < 0.33) {
            recommendations.push('Define project scope first');
            recommendations.push('Establish basic timeline and budget');
        } else if (completeness < 0.67) {
            recommendations.push('Complete remaining basic information');
            recommendations.push('Start defining deliverables');
        } else if (completeness < 1.0) {
            recommendations.push('Finalize project definition');
            recommendations.push('Begin detailed planning phase');
        } else {
            recommendations.push('Project definition complete');
            recommendations.push('Move to execution planning');
        }
        
        return recommendations;
    }
};
