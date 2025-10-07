// railway-backend/src/agents/analyzer.js
// Analyzer Agent - Analyzes project completeness and identifies gaps

import { ChatAnthropic } from "@langchain/anthropic";
import { getProjectData, saveProjectData } from '../data/projectData.js';
import { parseResponseContent } from './parseResponse.js';

const model = new ChatAnthropic({
  modelName: "claude-3-5-haiku-20241022",
  temperature: 0,
  anthropicApiKey: process.env.ANTHROPIC_API_KEY,
});

export async function analyzerAgent(state) {
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

  const systemPrompt = `You are a Project Analysis Agent that evaluates project completeness and identifies gaps.

Your role:
- Analyze project scope, tasks, budget, and timeline for completeness
- Identify missing elements or potential issues
- Assess project health and readiness
- Provide recommendations for improvement

Current project: ${projectData.name}
Project scope: ${JSON.stringify(projectData.scope, null, 2)}
Project stages: ${JSON.stringify(projectData.stages, null, 2)}
Project tasks: ${JSON.stringify(projectData.tasks, null, 2)}
Project budget: ${JSON.stringify(projectData.budget, null, 2)}
Project issues: ${JSON.stringify(projectData.issues, null, 2)}

Analyze the project and respond with JSON:
{
  "analysis": {
    "completeness": "percentage complete",
    "readiness": "high|medium|low",
    "gaps": [
      {
        "category": "scope|tasks|budget|timeline|team",
        "description": "what's missing",
        "severity": "high|medium|low",
        "recommendation": "what to do about it"
      }
    ],
    "strengths": ["what's working well"],
    "risks": ["potential issues"],
    "recommendations": ["next steps"]
  },
  "reasoning": "analysis rationale"
}

CRITICAL: Respond with ONLY valid JSON. No explanatory text before or after.`;

  const lastUserMessage = messages[messages.length - 1];

  try {
    const response = await model.invoke([
      { role: "system", content: systemPrompt },
      { role: "user", content: lastUserMessage.content },
    ]);

    // Parse response
    let analysisData;
    try {
      analysisData = parseResponseContent(response);
    } catch (e) {
      console.error("Failed to parse analyzer response:", e);
      return {
        ...state,
        error: "Failed to parse analysis data",
        rawResponse: response.content,
        next_agent: "end"
      };
    }

    return {
      ...state,
      messages: [...messages, { role: "assistant", content: response.content }],
      projectData: projectData,
      analysis: analysisData.analysis,
      reasoning: analysisData.reasoning,
      next_agent: "end"
    };

  } catch (error) {
    console.error("Analyzer agent error:", error);
    return {
      ...state,
      error: error.message,
      next_agent: "end"
    };
  }
}
