// railway-backend/src/agents/scope.js
// Optimized Scope Agent - Uses code logic to select focused prompts based on state

import { ChatAnthropic } from "@langchain/anthropic";
import { getProjectData, saveProjectData } from '../data/projectData.js';
import { parseResponseContent } from './parseResponse.js';

const model = new ChatAnthropic({
  modelName: "claude-3-5-haiku-20241022",
  temperature: 0,
  anthropicApiKey: process.env.ANTHROPIC_API_KEY,
});

// PROMPT 1: Gather info and create stages
const GATHER_AND_CREATE_PROMPT = `You are a Project Scope Definition Agent for project management.

Current mode: GATHER INFO AND CREATE STAGES

WORKFLOW:
1. Check conversation history - what project type did user mention?
2. Do you have timeline and budget? 
   - NO → Ask for them
   - YES → Create stages immediately

INFORMATION YOU NEED:
- Target completion date
- Total budget

RESPONSE FORMAT 1 - Missing timeline or budget:
{
  "needsMoreInfo": true,
  "responseText": "I'll create your [project type] project plan. I need:\\n\\n1. Target completion date?\\n2. Total budget?",
  "reasoning": "missing timeline and/or budget"
}

RESPONSE FORMAT 2 - Have timeline AND budget:
{
  "needsMoreInfo": true,
  "responseText": "I've created [X] stages for your [project type]:\\n\\n1. Stage Name - description\\n2. Stage Name - description\\n...\\n\\nReply 'yes' to proceed with detailed tasks and budget allocation.",
  "reasoning": "presenting stages for approval",
  "stages": [
    {
      "id": "stage_1",
      "name": "Stage Name",
      "order": 1,
      "status": "not_started"
    }
  ]
}

CRITICAL:
- Review ALL messages to find project type
- When you have timeline + budget, immediately create stages (Format 2)
- stages array is REQUIRED in Format 2
- Create 3-6 stages appropriate for the project type

Use \\n for newlines. Respond with ONLY valid JSON.`;

// PROMPT 2: Modify stages or finalize scope
const MODIFY_AND_APPROVE_PROMPT = `You are a Project Scope Definition Agent.

Current mode: MODIFY STAGES OR FINALIZE SCOPE

Stages already exist. The user is either:
1. Requesting modifications to stages
2. Approving the stages

Your job:
- If user wants changes, modify the stages and ask for approval again
- If user approves, create the complete scope and finish

RESPONSE FORMAT - Modify Stages:
{
  "needsMoreInfo": true,
  "responseText": "I've updated the stages:\\n\\n1. Stage Name\\n2. Stage Name\\n...\\n\\nAre you happy now?",
  "reasoning": "modified stages based on feedback",
  "stages": [
    {
      "id": "stage_1",
      "name": "Updated Stage Name",
      "order": 1,
      "status": "not_started"
    }
  ]
}

RESPONSE FORMAT - User Approved:
{
  "needsMoreInfo": false,
  "projectName": "Professional Project Name",
  "scope": {
    "description": "clear project description",
    "objectives": ["measurable goal 1", "measurable goal 2"],
    "deliverables": ["concrete deliverable 1", "concrete deliverable 2"],
    "outOfScope": ["what we're NOT doing"],
    "successCriteria": ["how we measure success"],
    "budget": "USD 40,000",
    "timeline": {
      "startDate": "2025-10-12",
      "targetEndDate": "2026-04-12"
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
  "reasoning": "user approved, scope complete"
}

APPROVAL DETECTION:
Look for: "yes", "looks good", "perfect", "approve", "proceed", "continue", "go ahead"

GUIDELINES:
- Modify stages based on user feedback
- When user approves, create complete scope with objectives, deliverables, timeline, budget
- Set needsMoreInfo: false only when user approves

Use \\n for newlines. Respond with ONLY valid JSON.`;

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

  // DECISION LOGIC: Pick the right prompt based on state
  let systemPrompt;
  const hasStages = projectData.stages && projectData.stages.length > 0;
  const hasScope = projectData.scope && projectData.scope.description;

  if (!hasStages) {
    // No stages yet - gather info and create stages
    console.log(`📋 Scope Agent Mode: GATHER_AND_CREATE`);
    systemPrompt = GATHER_AND_CREATE_PROMPT;
  } else if (hasStages && !hasScope) {
    // Stages exist but scope not finalized - modify or approve
    console.log(`📋 Scope Agent Mode: MODIFY_AND_APPROVE`);
    systemPrompt = MODIFY_AND_APPROVE_PROMPT;
  } else {
    // Scope is complete - shouldn't be here
    console.log(`⚠️ Scope Agent: Scope already complete`);
    return {
      ...state,
      messages: [...messages, { 
        role: "assistant", 
        content: "The project scope is already defined. How can I help you further?" 
      }],
      next_agent: "end"
    };
  }

  // Add current project context to the prompt
  const contextualPrompt = `${systemPrompt}

CURRENT PROJECT CONTEXT:
Project Name: ${projectData.name}
Current Stages: ${JSON.stringify(projectData.stages, null, 2)}
Current Scope: ${JSON.stringify(projectData.scope, null, 2)}`;

  try {
    // ONE AI CALL with the focused prompt
    console.log(`📨 Scope agent invoking Claude with ${messages.length} messages`);
    console.log(`📨 Messages:`, messages.map(m => ({ role: m.role, contentLength: m.content?.length || 0 })));
    
    const response = await model.invoke([
      { role: "system", content: contextualPrompt },
      ...messages, // Pass full conversation history
    ]);

    // Parse response
    let scopeData;
    try {
      scopeData = parseResponseContent(response);
    } catch (e) {
      console.error("❌ SCOPE AGENT JSON PARSE ERROR");
      console.error("Parse error:", e.message);
      console.error("Raw AI response type:", typeof response.content);
      console.error("Raw AI response:", response.content);
      
      // Handle empty array response from Claude API
      if (Array.isArray(response.content) && response.content.length === 0) {
        console.error("❌ Claude API returned empty response - possible rate limit or API error");
        return {
          ...state,
          messages: [...messages, { 
            role: "assistant", 
            content: "I encountered an API error. Please try again." 
          }],
          next_agent: "end",
          error: "Claude API returned empty response"
        };
      }
      
      const contentStr = typeof response.content === 'string' 
        ? response.content 
        : JSON.stringify(response.content);
      
      throw new Error(
        `Scope Agent failed to return valid JSON. ` +
        `Parse error: ${e.message}. ` +
        `AI returned: ${contentStr.substring(0, 200)}...`
      );
    }

    // CASE 1: Need more information or asking for approval
    if (scopeData.needsMoreInfo === true) {
      console.log(`❓ Scope agent: ${scopeData.reasoning}`);
      
      // If stages were provided, update them
      if (scopeData.stages && scopeData.stages.length > 0) {
        projectData.stages = scopeData.stages;
        await saveProjectData(projectId, projectData);
        console.log(`📝 Updated project stages (${scopeData.stages.length} stages)`);
      }
      
      // Add response to messages
      const responseMessage = {
        role: "assistant",
        content: scopeData.responseText
      };
      
      return {
        ...state,
        messages: [...messages, responseMessage],
        projectData: projectData,
        scopeData: scopeData,
        next_agent: "end" // End workflow, wait for user response
      };
    }

    // CASE 2: User approved - scope complete
    if (scopeData.needsMoreInfo === false && scopeData.scope) {
      console.log(`✅ Scope agent: ${scopeData.reasoning}`);
      
      // Update project data with complete scope
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
    console.error("❌ Unexpected scope response format:", scopeData);
    console.error("❌ Type:", typeof scopeData);
    console.error("❌ Is Array:", Array.isArray(scopeData));
    console.error("❌ Raw AI response:", response.content);
    console.error("❌ Full scopeData:", JSON.stringify(scopeData, null, 2));
    
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
