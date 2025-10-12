// railway-backend/src/agents/scope.js
// Enhanced Scope Agent - Asks follow-up questions using the messages array

import { ChatAnthropic } from "@langchain/anthropic";
import { getProjectData, saveProjectData } from '../data/projectData.js';
import { parseResponseContent } from './parseResponse.js';

const model = new ChatAnthropic({
  modelName: "claude-3-5-haiku-20241022",
  temperature: 0,
  anthropicApiKey: process.env.ANTHROPIC_API_KEY,
});

export async function scopeAgent(state) {
  const { messages, projectId, userId } = state;

  // Load current project data
  let projectData = await getProjectData(projectId);
  if (!projectData) {
    console.error(`Project ${projectId} not found`);
    return {
      ...state,
      error: "Project not found"
    };
  }

  const systemPrompt = `You are a Project Scope Definition Agent with conversational capabilities.

Your role:
- Analyze user input to understand their project
- Identify what critical information is MISSING
- Ask intelligent follow-up questions to gather missing info
- Only create full scope when you have enough information

Current project: ${projectData.name}
Current scope: ${JSON.stringify(projectData.scope, null, 2)}
Current stages: ${JSON.stringify(projectData.stages, null, 2)}

CRITICAL INFORMATION NEEDED:
- Project type/description (what is being built/opened)
- Timeline: Target completion/opening date
- Budget: Total project budget
- Key constraints: Location specifics, team size, existing resources

DECISION LOGIC:
1. Analyze ALL messages in conversation history to see what info you already have
2. If MISSING critical information → Respond with "needsMoreInfo: true" and provide questions
3. If you have ENOUGH information → Respond with "needsMoreInfo: false" and create full scope

Respond with JSON in ONE of these formats:

FORMAT 1 - Need More Info (return questions as text):
{
  "needsMoreInfo": true,
  "responseText": "Great! To create a solid project plan, I need a few more details:\n\n1. What's your target opening/completion date?\n2. What's your total budget for this project?\n3. Do you have a location secured?",
  "reasoning": "why these questions are needed"
}

FORMAT 2 - Ready to Create Scope:
{
  "needsMoreInfo": false,
  "projectName": "Concise Professional Project Name",
  "scope": {
    "description": "clear project description",
    "objectives": ["measurable goal 1", "measurable goal 2"],
    "deliverables": ["concrete deliverable 1", "concrete deliverable 2"],
    "outOfScope": ["what we're NOT doing"],
    "successCriteria": ["how we measure success"],
    "budget": "£500,000" or null,
    "timeline": {
      "startDate": "2025-11-01",
      "targetEndDate": "2026-06-01"
    }
  },
  "stages": [
    {
      "id": "stage_1",
      "name": "Stage Name",
      "order": 1,
      "status": "not_started"
    }
  ],
  "reasoning": "why this scope makes sense"
}

GUIDELINES:
- Be conversational and helpful in questions
- Ask specific questions, not vague ones
- Don't ask about things you can reasonably infer
- Questions should be actionable and clear
- Prioritize: budget, timeline, location status
- Only ask 2-4 questions at a time (don't overwhelm)

CRITICAL: Respond with ONLY valid JSON. No explanatory text before or after.`;

  try {
    const response = await model.invoke([
      { role: "system", content: systemPrompt },
      ...messages, // Pass full conversation history
    ]);

    // Parse response
    let scopeData;
    try {
      scopeData = parseResponseContent(response);
    } catch (e) {
      console.error("Failed to parse scope response:", e);
      return {
        ...state,
        error: "Failed to parse scope data",
        rawResponse: response.content,
        next_agent: "end"
      };
    }

    // CASE 1: Need more information - add questions to messages
    if (scopeData.needsMoreInfo === true) {
      console.log(`❓ Scope agent needs more info, asking questions`);
      
      // Add the questions as an assistant message
      const questionsMessage = {
        role: "assistant",
        content: scopeData.responseText
      };
      
      return {
        ...state,
        messages: [...messages, questionsMessage],
        projectData: projectData,
        next_agent: "end" // End workflow, wait for user response
      };
    }

    // CASE 2: Have enough info - create full scope
    if (scopeData.needsMoreInfo === false && scopeData.scope) {
      console.log(`✅ Scope agent has enough info, creating full scope`);
      
      // Update project data
      projectData.scope = scopeData.scope;
      projectData.stages = scopeData.stages;
      projectData.status = 'active';
      
      // Update project name if it's still generic
      if (scopeData.projectName && 
          (projectData.name === 'New Project' || projectData.name === 'Untitled Project')) {
        projectData.name = scopeData.projectName;
        console.log(`📝 Project renamed to: ${projectData.name}`);
      }

      // Save updated project
      await saveProjectData(projectId, projectData);

      return {
        ...state,
        messages: [...messages, { role: "assistant", content: response.content }],
        projectData: projectData,
        scopeData: scopeData,
        next_agent: "end"
      };
    }

    // CASE 3: Unexpected format
    console.error("Unexpected scope response format:", scopeData);
    return {
      ...state,
      error: "Unexpected response format from scope agent",
      next_agent: "end"
    };

  } catch (error) {
    console.error("Scope agent error:", error);
    return {
      ...state,
      error: error.message,
      next_agent: "end"
    };
  }
}
