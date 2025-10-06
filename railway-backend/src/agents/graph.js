import { StateGraph, END } from "@langchain/langgraph";
import { supervisorAgent } from "./supervisor.js";
import { analyzerAgent } from "./analyzer.js";

// Define the state structure
const graphState = {
  messages: {
    value: (x, y) => x.concat(y),
    default: () => [],
  },
  projectData: {
    value: (x, y) => y ?? x,
    default: () => ({}),
  },
  next_agent: {
    value: (x, y) => y ?? x,
    default: () => "supervisor",
  },
  analysis: {
    value: (x, y) => y ?? x,
    default: () => null,
  },
  reasoning: {
    value: (x, y) => y ?? x,
    default: () => "",
  },
};

// Create the workflow
const workflow = new StateGraph({
  channels: graphState,
});

// Add nodes
workflow.addNode("supervisor", supervisorAgent);
workflow.addNode("analyzer", analyzerAgent);

// Define routing logic
function routeFromSupervisor(state) {
  const nextAgent = state.next_agent;
  if (nextAgent === "end") {
    return END;
  }
  return nextAgent;
}

// Add edges
workflow.addEdge("analyzer", "supervisor"); // Analyzer returns to supervisor
workflow.addConditionalEdges("supervisor", routeFromSupervisor, {
  analyzer: "analyzer",
  end: END,
});

// Set entry point
workflow.setEntryPoint("supervisor");

// Compile the graph
export const pmGraph = workflow.compile();

// Helper function to run the graph
export async function runPMWorkflow(userQuery, projectData = {}) {
  const initialState = {
    messages: [{ role: "user", content: userQuery }],
    projectData: projectData,
  };

  const result = await pmGraph.invoke(initialState);
  return result;
}
