// LangGraph workflow orchestrating all agents

import { StateGraph, END } from "@langchain/langgraph";
import { supervisorAgent } from "./supervisor.js";
import { analyzerAgent } from "./analyzer.js";
import { scopeAgent } from "./scope.js";
import { schedulerAgent } from "./scheduler.js";
import { taskUpdaterAgent } from "./taskUpdater.js";
import { budgetAgent } from "./budget.js";

// Define the state structure
const graphState = {
  messages: {
    value: (x, y) => x.concat(y),
    default: () => [],
  },
  projectId: {
    value: (x, y) => y ?? x,
    default: () => null,
  },
  userId: {
    value: (x, y) => y ?? x,
    default: () => null,
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
  scopeData: {
    value: (x, y) => y ?? x,
    default: () => null,
  },
  schedulerData: {
    value: (x, y) => y ?? x,
    default: () => null,
  },
  updateData: {
    value: (x, y) => y ?? x,
    default: () => null,
  },
  budgetData: {
    value: (x, y) => y ?? x,
    default: () => null,
  },
  reasoning: {
    value: (x, y) => y ?? x,
    default: () => "",
  },
  error: {
    value: (x, y) => y ?? x,
    default: () => null,
  }
};

// Create the workflow
const workflow = new StateGraph({
  channels: graphState,
});

// Add all agent nodes
workflow.addNode("supervisor", supervisorAgent);
workflow.addNode("analyzer", analyzerAgent);
workflow.addNode("scope", scopeAgent);
workflow.addNode("scheduler", schedulerAgent);
workflow.addNode("taskUpdater", taskUpdaterAgent);
workflow.addNode("budget", budgetAgent);

// Define routing logic from supervisor
function routeFromSupervisor(state) {
  const nextAgent = state.next_agent;
  
  console.log(`🔀 Routing to: ${nextAgent}`);
  
  if (nextAgent === "end") {
    return END;
  }
  return nextAgent;
}

// All agents return to supervisor for next routing decision
workflow.addEdge("analyzer", "supervisor");
workflow.addEdge("scope", "supervisor");
workflow.addEdge("scheduler", "supervisor");
workflow.addEdge("taskUpdater", "supervisor");
workflow.addEdge("budget", "supervisor");

// Supervisor routes to agents or ends
workflow.addConditionalEdges("supervisor", routeFromSupervisor, {
  analyzer: "analyzer",
  scope: "scope",
  scheduler: "scheduler",
  taskUpdater: "taskUpdater",
  budget: "budget",
  end: END,
});

// Set entry point
workflow.setEntryPoint("supervisor");

// Compile the graph
export const pmGraph = workflow.compile();

// Helper function to run the graph
export async function runPMWorkflow(userQuery, projectId, userId) {
  console.log(`🚀 Starting workflow for project: ${projectId}, user: ${userId}`);
  
  const initialState = {
    messages: [{ role: "user", content: userQuery }],
    projectId: projectId,
    userId: userId,
  };

  const result = await pmGraph.invoke(initialState);
  
  console.log(`✅ Workflow complete`);
  
  return result;
}