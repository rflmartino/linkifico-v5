// railway-backend/src/agents/budget.js
// Budget Agent - Tracks costs, flags overruns, manages budget

import { ChatAnthropic } from "@langchain/anthropic";
import { getProjectData, saveProjectData } from '../data/projectData.js';

const model = new ChatAnthropic({
  modelName: "claude-3-5-haiku-20241022",
  temperature: 0,
  anthropicApiKey: process.env.ANTHROPIC_API_KEY,
});

export async function budgetAgent(state) {
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

  const systemPrompt = `You are a Budget Management Agent.

Your role:
- Track project budget vs actual spending
- Update budget line items
- Calculate remaining budget
- Flag cost overruns as issues
- Provide budget status reports

Current project: ${projectData.name}
Current budget: ${JSON.stringify(projectData.budget, null, 2)}
Current issues: ${JSON.stringify(projectData.issues, null, 2)}

Handle requests like:
- "Set total budget to $100k"
- "We spent $15k on inventory software"
- "How much budget is left?"
- "Add budget line item for marketing: $20k"

Respond with JSON:
{
  "budget": {
    "total": 100000,
    "spent": 15000,
    "remaining": 85000,
    "currency": "USD",
    "lineItems": [
      {
        "id": "budget_1",
        "category": "Category",
        "allocated": 30000,
        "spent": 15000,
        "description": "Description"
      }
    ]
  },
  "newIssues": [
    {
      "id": "issue_x",
      "type": "budget_overrun",
      "severity": "high",
      "title": "Budget exceeded",
      "description": "Category X is $5k over budget",
      "flaggedBy": "budget_agent",
      "flaggedAt": "2025-01-20T10:30:00Z",
      "resolved": false,
      "impact": "Overall project budget at risk"
    }
  ],
  "analysis": "budget status summary"
}

CRITICAL: Respond with ONLY valid JSON. No text before or after.`;

  const lastUserMessage = messages[messages.length - 1];

  try {
    const response = await model.invoke([
      { role: "system", content: systemPrompt },
      { role: "user", content: lastUserMessage.content },
    ]);

    // Parse response
    let budgetData;
    try {
      const cleanContent = response.content
        .replace(/```json\n?/g, "")
        .replace(/```\n?/g, "")
        .trim();
      budgetData = JSON.parse(cleanContent);
    } catch (e) {
      console.error("Failed to parse budget response:", e);
      return {
        ...state,
        error: "Failed to parse budget data",
        rawResponse: response.content
      };
    }

    // Update project budget
    if (budgetData.budget) {
      projectData.budget = budgetData.budget;
    }

    // Add new issues if any
    if (budgetData.newIssues && budgetData.newIssues.length > 0) {
      projectData.issues = [...projectData.issues, ...budgetData.newIssues];
    }

    // Save updated project
    await saveProjectData(projectId, projectData);

    return {
      ...state,
      messages: [...messages, { role: "assistant", content: response.content }],
      projectData: projectData,
      budgetData: budgetData,
      next_agent: "end"
    };

  } catch (error) {
    console.error("Budget agent error:", error);
    return {
      ...state,
      error: error.message,
      next_agent: "end"
    };
  }
}
