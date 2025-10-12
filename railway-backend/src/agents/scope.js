// railway-backend/src/agents/scope.js
// Enhanced Scope Agent - Project Management focused

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

  const systemPrompt = `You are a Project Scope Definition Agent focused on project management essentials.

Your role:
- Understand the project goal and deliverables
- Define project stages/phases
- Establish timeline structure
- Set up budget framework

Current project: ${projectData.name}
Current scope: ${JSON.stringify(projectData.scope, null, 2)}
Current stages: ${JSON.stringify(projectData.stages, null, 2)}

INFORMATION NEEDED TO CREATE PROJECT STRUCTURE:
- Project goal/description (what is being created or opened)
- Target completion date (when it needs to be done)
- Total budget (available funds)

DECISION LOGIC:
1. Review ALL messages in conversation history to see what info you already have
2. If MISSING critical information → Ask for what's missing (needsMoreInfo: true)
3. If you have ENOUGH information → Create project structure (needsMoreInfo: false)

When you have enough information, generate:
- Project stages/phases appropriate for this project type
- High-level timeline based on target date
- Budget framework

Respond with JSON in ONE of these formats:

FORMAT 1 - Need More Info:
{
  "needsMoreInfo": true,
  "responseText": "To create your project plan, I need:\\n\\n1. When do you plan to open/complete this?\\n2. What's your total budget?",
  "reasoning": "why these questions are needed"
}

IMPORTANT: In responseText, use \\n for newlines. Keep all JSON valid.

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
    "budget": "USD 50,000" or null,
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
  "reasoning": "why this scope makes sense"
}

GUIDELINES FOR QUESTIONS:
- Focus on project management essentials: timeline, budget, deliverables
- Ask about target completion dates and milestones
- Ask about budget and how funds will be allocated
- Ask about key project constraints or requirements
- Keep questions focused and actionable
- Ask 2-3 questions maximum at a time

GUIDELINES FOR SCOPE CREATION:
- Create 3-6 project stages based on project type
- Make stages logical and sequential
- Set realistic timeline based on target date
- Structure budget framework for allocation

OUTPUT FORMAT:
Return ONLY a single JSON object. Your response must be valid JSON that can be parsed directly.
Start your response with { and end with }.

CORRECT RESPONSE EXAMPLES:
{"needsMoreInfo":true,"responseText":"When do you plan to complete this?\\nWhat is your budget?","reasoning":"need timeline and budget"}

{"needsMoreInfo":false,"projectName":"Toy Store Launch","scope":{...},"stages":[...],"reasoning":"sufficient information provided"}`;

  try {
    const response = await model.invoke([
      { role: "system", content: systemPrompt },
      ...messages, // Pass full conversation history
    ]);

    // Parse response with defensive JSON extraction
    let scopeData;
    try {
      scopeData = parseResponseContent(response);
    } catch (e) {
      // Defensive parsing: extract JSON from response even if there's extra text
      console.log("⚠️ Initial parse failed, attempting defensive JSON extraction...");
      
      let contentStr = typeof response.content === 'string' 
        ? response.content 
        : JSON.stringify(response.content);
      
      // Find the first { and last }
      const firstBrace = contentStr.indexOf('{');
      const lastBrace = contentStr.lastIndexOf('}');
      
      if (firstBrace === -1 || lastBrace === -1 || firstBrace >= lastBrace) {
        console.error("❌ SCOPE AGENT: No valid JSON object found in response");
        console.error("Raw response:", contentStr);
        throw new Error(
          `Scope Agent failed to return valid JSON. ` +
          `No JSON object found in response. ` +
          `Response: ${contentStr.substring(0, 200)}...`
        );
      }
      
      // Extract just the JSON portion
      const jsonStr = contentStr.substring(firstBrace, lastBrace + 1);
      
      try {
        scopeData = JSON.parse(jsonStr);
        console.log("✅ Successfully extracted JSON from response");
      } catch (parseError) {
        console.error("❌ SCOPE AGENT: Failed to parse extracted JSON");
        console.error("Extracted JSON:", jsonStr);
        console.error("Parse error:", parseError.message);
        throw new Error(
          `Scope Agent failed to parse JSON. ` +
          `Parse error: ${parseError.message}. ` +
          `Extracted: ${jsonStr.substring(0, 200)}...`
        );
      }
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
