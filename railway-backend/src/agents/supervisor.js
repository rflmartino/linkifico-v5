import { ChatAnthropic } from "@langchain/anthropic";

const model = new ChatAnthropic({
  modelName: "claude-3-5-haiku-20241022",
  temperature: 0,
  anthropicApiKey: process.env.ANTHROPIC_API_KEY,
});

export async function supervisorAgent(state) {
  const { messages, projectData } = state;

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

Current project context: ${JSON.stringify(projectData || {}, null, 2)}

Examples:
- "Create a toy store project" → 'scope' (needs scope definition)
- "Add tasks for website development" → 'scheduler' (needs task creation)
- "Mark homepage design complete" → 'taskUpdater' (updating existing task)
- "We spent $5k on inventory" → 'budget' (budget update)
- "What's missing from this project?" → 'analyzer' (gap analysis)
- "What is PRINCE2?" → 'end' (general question, answer directly)

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
    messages: [...messages, { role: "assistant", content: response.content }],
    next_agent: decision.next_agent,
    reasoning: decision.reasoning,
    direct_answer: decision.direct_answer || null,
  };
}
