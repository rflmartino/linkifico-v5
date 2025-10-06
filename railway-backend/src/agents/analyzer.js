import { ChatAnthropic } from "@langchain/anthropic";

const model = new ChatAnthropic({
  modelName: "claude-3-5-haiku-20241022",
  temperature: 0,
  anthropicApiKey: process.env.ANTHROPIC_API_KEY,
});

export async function analyzerAgent(state) {
  const { messages, projectData } = state;

  const systemPrompt = `You are a Project Analysis Agent specialized in PMI methodology.

Your role:
- Analyze the current project state
- Identify missing information (scope, budget, timeline, resources, etc.)
- Detect potential risks or gaps
- Provide actionable recommendations

Current project: ${JSON.stringify(projectData || {}, null, 2)}

Analyze thoroughly and respond with JSON:
{
  "status": "complete|incomplete|at_risk",
  "missing_items": ["list of missing critical info"],
  "risks": ["identified risks"],
  "recommendations": ["suggested next steps"],
  "completeness_score": 0-100
}`;

  const lastUserMessage = messages[messages.length - 1];

  const response = await model.invoke([
    { role: "system", content: systemPrompt },
    { role: "user", content: lastUserMessage.content },
  ]);

  let analysis;
  try {
    analysis = JSON.parse(response.content);
  } catch (e) {
    analysis = {
      status: "error",
      message: "Failed to analyze project",
      raw: response.content,
    };
  }

  return {
    ...state,
    messages: [...messages, { role: "assistant", content: response.content }],
    analysis: analysis,
    next_agent: "end", // Analyzer completes and returns to supervisor
  };
}
