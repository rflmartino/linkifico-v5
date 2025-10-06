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

// Add placeholder nodes for other agents (to be implemented later)
workflow.addNode("planner", async (state) => {
  return {
    ...state,
    messages: [...state.messages, { role: "assistant", content: "Planning agent not yet implemented" }],
    next_agent: "end"
  };
});

workflow.addNode("updater", async (state) => {
  return {
    ...state,
    messages: [...state.messages, { role: "assistant", content: "Updater agent not yet implemented" }],
    next_agent: "end"
  };
});

workflow.addNode("communicator", async (state) => {
  return {
    ...state,
    messages: [...state.messages, { role: "assistant", content: "Communicator agent not yet implemented" }],
    next_agent: "end"
  };
});

// Define routing logic
function routeFromSupervisor(state) {
  const nextAgent = state.next_agent;
  console.log('Routing from supervisor to:', nextAgent);
  
  if (nextAgent === "end") {
    return END;
  }
  
  // Map valid agents to their destinations
  const validAgents = ["analyzer", "planner", "updater", "communicator"];
  if (validAgents.includes(nextAgent)) {
    return nextAgent;
  }
  
  // Default to end if unknown agent
  console.log('Unknown agent, ending workflow:', nextAgent);
  return END;
}

// Add edges
workflow.addEdge("analyzer", "supervisor"); // Analyzer returns to supervisor
workflow.addEdge("planner", "supervisor"); // Planner returns to supervisor
workflow.addEdge("updater", "supervisor"); // Updater returns to supervisor
workflow.addEdge("communicator", "supervisor"); // Communicator returns to supervisor
workflow.addConditionalEdges("supervisor", routeFromSupervisor);

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
