import { ChatAnthropic } from "@langchain/anthropic";

const model = new ChatAnthropic({
  modelName: "claude-3-5-haiku-20241022",
  temperature: 0,
  anthropicApiKey: process.env.ANTHROPIC_API_KEY,
});

export async function supervisorAgent(state) {
  const { messages, projectData } = state;

  // Determine workflow state
  const hasStages = projectData?.stages && projectData.stages.length > 0;
  const hasScope = projectData?.scope && projectData.scope.description;
  const hasTasks = projectData?.tasks && projectData.tasks.length > 0;
  
  let workflowState = "INITIAL";
  if (!hasStages && !hasScope) {
    workflowState = "NEEDS_SCOPE";
  } else if (hasStages && !hasScope) {
    workflowState = "SCOPE_IN_PROGRESS";
  } else if (hasScope && !hasTasks) {
    workflowState = "NEEDS_TASKS";
  } else {
    workflowState = "ACTIVE";
  }

  const systemPrompt = `You are a Project Management Supervisor Agent.

Your role:
- Analyze incoming requests about projects
- Decide which specialized agent should handle the request
- Route to the appropriate agent or answer directly if it's a general question

Available agents:
- 'scope': Define project scope, objectives, deliverables, create stages
- 'scheduler': Create detailed tasks under stages with timelines and dependencies
- 'taskUpdater': Update existing tasks, mark complete, handle delays
- 'budget': Track costs, manage budget, flag overruns
- 'analyzer': Analyze project completeness, identify gaps
- 'end': Finish workflow (use for general questions or when done)

WORKFLOW STATE: ${workflowState}
- NEEDS_SCOPE: No stages yet → route to 'scope'
- SCOPE_IN_PROGRESS: Stages exist but scope not finalized → route to 'scope'
- NEEDS_TASKS: Scope complete but no tasks → route to 'scheduler'
- ACTIVE: Project has scope and tasks

Current project state:
- Has stages: ${hasStages}
- Has scope: ${hasScope}
- Has tasks: ${hasTasks}
Project data: ${JSON.stringify(projectData || {}, null, 2)}

ROUTING LOGIC:
- If NEEDS_SCOPE or SCOPE_IN_PROGRESS → route to 'scope' (unless explicit budget/task request)
- If NEEDS_TASKS → route to 'scheduler'
- If user mentions budget/costs → 'budget'
- If user asks for analysis/gaps → 'analyzer'
- If task updates → 'taskUpdater'
- If general question → 'end' with direct_answer

Examples:
- State: NEEDS_SCOPE, Message: "Create toy store" → 'scope'
- State: NEEDS_SCOPE, Message: "Target date is Nov 30" → 'scope' (continuing scope definition)
- State: NEEDS_TASKS, Message: "Add development tasks" → 'scheduler'
- State: ACTIVE, Message: "Mark task complete" → 'taskUpdater'
- State: ACTIVE, Message: "We spent $5k" → 'budget'
- Any state, Message: "What is PRINCE2?" → 'end' (general question)

For general questions not requiring project modification, answer directly and route to 'end'.

Respond with JSON only:
{
  "next_agent": "scope|scheduler|taskUpdater|budget|analyzer|end",
  "reasoning": "why this agent should handle it",
  "direct_answer": "optional: answer if general question"
}`;

  const response = await model.invoke([
    { role: "system", content: systemPrompt },
    ...messages,
  ]);

  let decision;
  try {
    // Handle content as string or array
    let contentText = typeof response.content === 'string' 
      ? response.content 
      : (Array.isArray(response.content) && response.content.length > 0)
        ? response.content[0].text || JSON.stringify(response.content)
        : JSON.stringify(response.content);
    
    const cleanContent = contentText
      .replace(/```json\n?/g, "")
      .replace(/```\n?/g, "")
      .trim();
    decision = JSON.parse(cleanContent);
  } catch (e) {
    console.error("Failed to parse supervisor decision:", e);
    console.error("Response content type:", typeof response.content);
    console.error("Response content:", response.content);
    decision = { 
      next_agent: "end", 
      reasoning: "Failed to parse decision",
      direct_answer: "I encountered an error processing your request. Please try again."
    };
  }

  return {
    ...state,
    // Don't add supervisor routing to messages - it's internal routing, not conversation
    messages: messages,
    next_agent: decision.next_agent,
    reasoning: decision.reasoning,
    direct_answer: decision.direct_answer || null,
  };
}
