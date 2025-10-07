// railway-backend/src/agents/taskUpdater.js
// Task Updater Agent - Updates existing tasks and flags scheduling issues

import { ChatAnthropic } from "@langchain/anthropic";
import { getProjectData, saveProjectData } from '../data/projectData.js';
import { parseResponseContent } from './parseResponse.js';

const model = new ChatAnthropic({
  modelName: "claude-3-5-haiku-20241022",
  temperature: 0,
  anthropicApiKey: process.env.ANTHROPIC_API_KEY,
});

export async function taskUpdaterAgent(state) {
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

  const systemPrompt = `You are a Task Update Agent that processes natural language task updates.

Your role:
- Update task status, dates, assignments based on user input
- Detect delays and flag them as issues
- Recalculate dependent task impacts when dates change
- Mark tasks as completed and record completion date

Current project: ${projectData.name}
All tasks: ${JSON.stringify(projectData.tasks, null, 2)}
Current issues: ${JSON.stringify(projectData.issues, null, 2)}

Examples of updates:
- "Mark homepage design complete" → find task, set status='completed', set completedAt
- "Delay inventory setup by 2 weeks" → find task, adjust dates, check dependencies, flag if critical
- "Assign website development to John" → find task, set assignedTo="John"

Respond with JSON:
{
  "updatedTasks": [
    {
      "id": "task_1",
      "status": "completed",
      "completedAt": "2025-01-20T10:30:00Z",
      ...other fields
    }
  ],
  "newIssues": [
    {
      "id": "issue_1",
      "type": "delay",
      "severity": "high",
      "title": "Critical task delayed",
      "description": "Task X delayed by 2 weeks, impacts milestone Y",
      "flaggedBy": "task_updater",
      "flaggedAt": "2025-01-20T10:30:00Z",
      "resolved": false,
      "impact": "Delays project by 1 week"
    }
  ],
  "reasoning": "what changed and why"
}

If no tasks match user's description, return empty arrays and explain in reasoning.

CRITICAL: Respond with ONLY valid JSON. No text before or after.`;

  const lastUserMessage = messages[messages.length - 1];

  try {
    const response = await model.invoke([
      { role: "system", content: systemPrompt },
      { role: "user", content: lastUserMessage.content },
    ]);

    // Parse response
    let updateData;
    try {
      updateData = parseResponseContent(response);
    } catch (e) {
      console.error("Failed to parse task updater response:", e);
      return {
        ...state,
        error: "Failed to parse update data",
        rawResponse: response.content,
        next_agent: "end"
      };
    }

    // Apply task updates
    if (updateData.updatedTasks && updateData.updatedTasks.length > 0) {
      updateData.updatedTasks.forEach(updatedTask => {
        const index = projectData.tasks.findIndex(t => t.id === updatedTask.id);
        if (index !== -1) {
          projectData.tasks[index] = { ...projectData.tasks[index], ...updatedTask };
        }
      });
    }

    // Add new issues
    if (updateData.newIssues && updateData.newIssues.length > 0) {
      projectData.issues = [...projectData.issues, ...updateData.newIssues];
    }

    // Save updated project
    await saveProjectData(projectId, projectData);

    return {
      ...state,
      messages: [...messages, { role: "assistant", content: response.content }],
      projectData: projectData,
      updateData: updateData,
      next_agent: "end"
    };

  } catch (error) {
    console.error("Task updater agent error:", error);
    return {
      ...state,
      error: error.message,
      next_agent: "end"
    };
  }
}
