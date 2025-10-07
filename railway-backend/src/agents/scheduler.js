// railway-backend/src/agents/scheduler.js
// Scheduler Agent - Creates tasks under stages with dependencies and timelines

import { ChatAnthropic } from "@langchain/anthropic";
import { getProjectData, saveProjectData } from '../data/projectData.js';
import { parseResponseContent } from './parseResponse.js';

const model = new ChatAnthropic({
  modelName: "claude-3-5-haiku-20241022",
  temperature: 0,
  anthropicApiKey: process.env.ANTHROPIC_API_KEY,
});

export async function schedulerAgent(state) {
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

  const systemPrompt = `You are a Project Scheduling Agent specialized in creating detailed task breakdowns.

Your role:
- Create concrete, actionable tasks under each project stage
- Set realistic start and end dates
- Identify task dependencies (which tasks must complete before others)
- Assign appropriate status to each task

Current project: ${projectData.name}
Project timeline: ${JSON.stringify(projectData.timeline, null, 2)}
Project stages: ${JSON.stringify(projectData.stages, null, 2)}
Current tasks: ${JSON.stringify(projectData.tasks, null, 2)}

Guidelines:
- Break stages into 3-8 tasks each
- Keep task durations realistic (few days to few weeks)
- Use dependencies to show critical path
- Task IDs: "task_1", "task_2", etc. (increment from existing)
- Status: "not_started", "in_progress", "completed", "blocked"

Respond with JSON only:
{
  "tasks": [
    {
      "id": "task_1",
      "stageId": "stage_1",
      "title": "Task title",
      "description": "What needs to be done",
      "status": "not_started",
      "startDate": "2025-01-15",
      "endDate": "2025-01-22",
      "dependencies": [],
      "assignedTo": null,
      "completedAt": null
    }
  ],
  "reasoning": "task breakdown logic"
}

CRITICAL: Respond with ONLY valid JSON. No text before or after.`;

  const lastUserMessage = messages[messages.length - 1];

  try {
    const response = await model.invoke([
      { role: "system", content: systemPrompt },
      { role: "user", content: lastUserMessage.content },
    ]);

    // Parse response
    let schedulerData;
    try {
      schedulerData = parseResponseContent(response);
    } catch (e) {
      console.error("Failed to parse scheduler response:", e);
      return {
        ...state,
        error: "Failed to parse scheduler data",
        rawResponse: response.content,
        next_agent: "end"
      };
    }

    // Update project tasks (append or replace based on context)
    if (schedulerData.tasks) {
      projectData.tasks = schedulerData.tasks;
    }

    // Save updated project
    await saveProjectData(projectId, projectData);

    return {
      ...state,
      messages: [...messages, { role: "assistant", content: response.content }],
      projectData: projectData,
      schedulerData: schedulerData,
      next_agent: "end"
    };

  } catch (error) {
    console.error("Scheduler agent error:", error);
    return {
      ...state,
      error: error.message,
      next_agent: "end"
    };
  }
}
