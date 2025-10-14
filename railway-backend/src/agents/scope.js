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

// PROMPT 1: Parse conversation and validate info
const PARSE_AND_VALIDATE_PROMPT = `You are a Project Scope Definition Agent.

Current mode: PARSE CONVERSATION AND VALIDATE INFO

EXTRACTION RULES:
- Project Type: Look for "toy store", "restaurant", "website", "app", "event", "construction", "marketing", etc.
- Timeline: Look for "ready by [date]", "deadline [date]", "finish by [date]", "need by [date]"
- Budget: Look for "budget of [amount]", "have [amount] dollars", "cost [amount]", "spend [amount]"

EXAMPLES:
- "toy store in mall" → projectType: "retail store opening"
- "ready by December 1st" → timeline: "2024-12-01"
- "budget of 30000 dollars" → budget: "$30,000"

RESPONSE FORMAT 1 - Missing timeline or budget:
{
  "needsMoreInfo": true,
  "responseText": "I'll create your [project type] project plan. I need:\\n\\n1. Target completion date?\\n2. Total budget?",
  "reasoning": "missing timeline and/or budget",
  "parsedInfo": {
    "projectType": "retail store opening" | "NOT FOUND",
    "timeline": "2024-12-01" | "NOT FOUND", 
    "budget": "$30,000" | "NOT FOUND"
  }
}

RESPONSE FORMAT 2 - Have timeline AND budget (create stages):
{
  "needsMoreInfo": true,
  "responseText": "I've created [X] stages for your [project type]:\\n\\n1. Stage Name - description\\n2. Stage Name - description\\n...\\n\\nReply 'yes' to proceed with detailed tasks and budget allocation.",
  "reasoning": "presenting stages for approval - waiting for user confirmation",
  "parsedInfo": {
    "projectType": "retail store opening",
    "timeline": "2024-12-01", 
    "budget": "$30,000"
  },
  "stages": [
    {
      "id": "stage_1",
      "name": "Stage Name",
      "order": 1,
      "status": "not_started"
    },
    {
      "id": "stage_2", 
      "name": "Another Stage",
      "order": 2,
      "status": "not_started"
    }
  ]
}

CRITICAL JSON RULES:
- Each stage object MUST have ALL 4 fields: id, name, order, status
- No trailing commas after the last field in objects
- All field names must be in double quotes
- All string values must be in double quotes

RULES:
- If missing timeline OR budget → use Format 1
- If you have timeline AND budget → use Format 2 (include stages array)
- Always fill parsedInfo to show what you extracted
- Use "NOT FOUND" for missing information
- Create 3-6 stages appropriate for the project type

STAGE GUIDELINES:
- Retail stores: Planning, Location Selection, Store Design, Inventory, Setup, Launch
- Software projects: Planning, Development, Testing, Deployment, Launch
- Events: Planning, Logistics, Marketing, Setup, Execution
- Construction: Planning, Permits, Construction, Inspection, Completion

Respond with ONLY valid JSON.`;

// PROMPT 2: Create stages (info already validated)
const GATHER_AND_CREATE_PROMPT = `You are a Project Scope Definition Agent.

Current mode: CREATE STAGES (info already validated)

You have confirmed project type, timeline, and budget. Create appropriate stages.

RESPONSE FORMAT:
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

STAGE GUIDELINES:
- Retail stores: Planning, Setup, Inventory, Marketing, Launch
- Software projects: Planning, Development, Testing, Deployment, Launch
- Events: Planning, Logistics, Marketing, Setup, Execution
- Construction: Planning, Permits, Construction, Inspection, Completion

Create 3-6 stages appropriate for the project type. Use \\n for newlines. Respond with ONLY valid JSON.`;

// PROMPT 3: Modify stages or finalize scope
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
  "responseText": "I've updated the stages:\\n\\n1. Stage Name\\n2. Stage Name\\n...\\n\\nReply 'yes' to proceed with detailed tasks and budget allocation.",
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

MODIFICATION DETECTION:
Look for: "change", "modify", "update", "different", "add", "remove", "no", "not happy", "don't like"

GUIDELINES:
- If user wants modifications, update stages and set needsMoreInfo: true
- If user approves, create complete scope and set needsMoreInfo: false
- Always ask for confirmation after modifications

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
  const hasParsedInfo = projectData.parsedInfo && 
                       projectData.parsedInfo.projectType !== "NOT FOUND" &&
                       projectData.parsedInfo.timeline !== "NOT FOUND" &&
                       projectData.parsedInfo.budget !== "NOT FOUND";

  if (!hasParsedInfo) {
    // Step 1: Parse conversation and extract project info
    console.log(`📋 Scope Agent Mode: PARSE_AND_VALIDATE`);
    systemPrompt = PARSE_AND_VALIDATE_PROMPT;
  } else if (hasParsedInfo && !hasStages) {
    // Step 2: Create stages (we have all info needed)
    console.log(`📋 Scope Agent Mode: GATHER_AND_CREATE`);
    systemPrompt = GATHER_AND_CREATE_PROMPT;
  } else if (hasStages && !hasScope) {
    // Step 3: Handle user feedback on stages (approve or modify)
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
Current Parsed Info: ${JSON.stringify(projectData.parsedInfo, null, 2)}
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
      console.log(`📨 Scope agent raw response:`, typeof response.content, response.content);
      scopeData = parseResponseContent(response);
      console.log(`✅ Scope agent parsed response:`, scopeData);
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
      
      // If parsedInfo was provided, save it
      if (scopeData.parsedInfo) {
        projectData.parsedInfo = scopeData.parsedInfo;
        console.log(`📝 Updated parsedInfo:`, scopeData.parsedInfo);
      }
      
      // If stages were provided, update them
      if (scopeData.stages && scopeData.stages.length > 0) {
        projectData.stages = scopeData.stages;
        console.log(`📝 Updated project stages (${scopeData.stages.length} stages)`);
      }
      
      // Save updated project data
      await saveProjectData(projectId, projectData);
      
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
        messages: [...messages, { role: "assistant", content: scopeData.responseText }],
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
