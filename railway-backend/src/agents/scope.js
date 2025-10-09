// railway-backend/src/agents/scope.js
// Scope Agent - Defines project scope, objectives, deliverables, and creates stages

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

  const systemPrompt = `You are a Project Scope Definition Agent.

Your role:
- Define clear project scope (what's included and excluded)
- Identify key objectives and benefits
- List concrete deliverables
- Define success criteria
- Create high-level project stages/phases
- Generate a concise, professional project name (if current name is generic like "New Project")

Current project: ${projectData.name}
Current scope: ${JSON.stringify(projectData.scope, null, 2)}
Current stages: ${JSON.stringify(projectData.stages, null, 2)}

Analyze the user's request and respond with JSON:
{
  "projectName": "Concise Professional Project Name",
  "scope": {
    "description": "clear project description",
    "objectives": ["measurable goal 1", "measurable goal 2"],
    "deliverables": ["concrete deliverable 1", "concrete deliverable 2"],
    "outOfScope": ["what we're NOT doing"],
    "successCriteria": ["how we measure success"]
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

Guidelines for projectName:
- Keep it concise (3-6 words)
- Make it descriptive and professional
- Capture the essence of what the project is about
- Examples: "E-Commerce Platform", "Mobile Fitness App", "Corporate Website Redesign"

CRITICAL: Respond with ONLY valid JSON. No explanatory text before or after.`;

  const lastUserMessage = messages[messages.length - 1];

  try {
    const response = await model.invoke([
      { role: "system", content: systemPrompt },
      { role: "user", content: lastUserMessage.content },
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

    // Update project data
    projectData.scope = scopeData.scope;
    projectData.stages = scopeData.stages;
    projectData.status = 'active'; // Move from draft to active once scope is defined
    
    // Update project name if it's still generic and a new name was provided
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

  } catch (error) {
    console.error("Scope agent error:", error);
    return {
      ...state,
      error: error.message,
      next_agent: "end"
    };
  }
}
