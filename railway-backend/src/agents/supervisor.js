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
- Route to: 'analyzer', 'planner', 'updater', 'communicator', or 'end'
- Provide clear reasoning for your decision

Current project context: ${JSON.stringify(projectData || {})}

Respond with JSON only:
{
  "next_agent": "analyzer|planner|updater|communicator|end",
  "reasoning": "why this agent should handle it"
}`;

  const response = await model.invoke([
    { role: "system", content: systemPrompt },
    ...messages,
  ]);

  let decision;
  try {
    decision = JSON.parse(response.content);
  } catch (e) {
    decision = { next_agent: "end", reasoning: "Failed to parse decision" };
  }

  return {
    ...state,
    messages: [...messages, { role: "assistant", content: response.content }],
    next_agent: decision.next_agent,
    reasoning: decision.reasoning,
  };
}
