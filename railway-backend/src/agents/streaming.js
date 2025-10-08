// railway-backend/src/agents/streaming.js
// Streaming workflow that emits events as agents work

import { pmGraph } from './graph.js';

/**
 * Run workflow with streaming events
 * Emits events as each agent processes the request
 */
export async function runStreamingWorkflow(userQuery, projectId, userId, onEvent) {
  console.log(`🌊 Starting STREAMING workflow for project: ${projectId}`);
  
  const initialState = {
    messages: [{ role: "user", content: userQuery }],
    projectId: projectId,
    userId: userId,
  };

  try {
    // Emit start event
    onEvent({
      type: 'workflow_start',
      message: '🤔 Analyzing your request...',
      timestamp: new Date().toISOString()
    });

    let currentAgent = null;
    let stepCount = 0;

    // Stream through the graph
    for await (const event of pmGraph.stream(initialState)) {
      stepCount++;
      
      // Extract which node/agent is running
      const nodeNames = Object.keys(event);
      const nodeName = nodeNames[0];
      
      if (!nodeName) continue;

      const nodeState = event[nodeName];
      
      // Detect agent changes
      if (nodeName !== currentAgent) {
        currentAgent = nodeName;
        
        // Emit agent start event
        const agentMessages = getAgentMessage(nodeName);
        onEvent({
          type: 'agent_start',
          agent: nodeName,
          message: agentMessages.start,
          icon: agentMessages.icon,
          timestamp: new Date().toISOString(),
          step: stepCount
        });
      }

      // Show agent reasoning and verbose output as it works
      if (nodeState.reasoning) {
        onEvent({
          type: 'agent_thinking',
          agent: nodeName,
          message: `🤔 ${nodeName} reasoning: ${nodeState.reasoning}`,
          data: nodeState.reasoning,
          timestamp: new Date().toISOString()
        });
      }

      // Check if agent completed work and show detailed results
      if (nodeState.scopeData) {
        onEvent({
          type: 'agent_complete',
          agent: 'scope',
          message: `✅ Scope Agent completed:\n${JSON.stringify(nodeState.scopeData, null, 2)}`,
          data: nodeState.scopeData,
          timestamp: new Date().toISOString()
        });
      }

      if (nodeState.schedulerData) {
        onEvent({
          type: 'agent_complete',
          agent: 'scheduler',
          message: `✅ Scheduler Agent completed:\n${JSON.stringify(nodeState.schedulerData, null, 2)}`,
          data: nodeState.schedulerData,
          timestamp: new Date().toISOString()
        });
      }

      if (nodeState.updateData) {
        onEvent({
          type: 'agent_complete',
          agent: 'taskUpdater',
          message: `✅ Task Updater completed:\n${JSON.stringify(nodeState.updateData, null, 2)}`,
          data: nodeState.updateData,
          timestamp: new Date().toISOString()
        });
      }

      if (nodeState.budgetData) {
        onEvent({
          type: 'agent_complete',
          agent: 'budget',
          message: `✅ Budget Agent completed:\n${JSON.stringify(nodeState.budgetData, null, 2)}`,
          data: nodeState.budgetData,
          timestamp: new Date().toISOString()
        });
      }

      if (nodeState.analysis) {
        onEvent({
          type: 'agent_complete',
          agent: 'analyzer',
          message: `✅ Analysis Agent completed:\n${JSON.stringify(nodeState.analysis, null, 2)}`,
          data: nodeState.analysis,
          timestamp: new Date().toISOString()
        });
      }

      // Show any raw messages or content from agents
      if (nodeState.messages && nodeState.messages.length > 0) {
        const lastMessage = nodeState.messages[nodeState.messages.length - 1];
        if (lastMessage && lastMessage.content) {
          onEvent({
            type: 'agent_output',
            agent: nodeName,
            message: `📝 ${nodeName} output:\n${lastMessage.content}`,
            data: lastMessage.content,
            timestamp: new Date().toISOString()
          });
        }
      }

      // Check if workflow is ending
      if (nodeState.next_agent === 'end') {
        onEvent({
          type: 'agent_routing',
          message: '🎯 Finalizing workflow...',
          timestamp: new Date().toISOString()
        });
      }
    }

    // Get final state
    const finalState = await pmGraph.invoke(initialState);

    // Emit completion event
    onEvent({
      type: 'workflow_complete',
      message: '✨ All done!',
      timestamp: new Date().toISOString(),
      totalSteps: stepCount
    });

    console.log(`✅ Streaming workflow complete (${stepCount} steps)`);
    
    return finalState;

  } catch (error) {
    console.error('❌ Streaming workflow error:', error);
    
    onEvent({
      type: 'workflow_error',
      message: '❌ Something went wrong',
      error: error.message,
      timestamp: new Date().toISOString()
    });
    
    throw error;
  }
}

/**
 * Get friendly messages for each agent
 */
function getAgentMessage(agentName) {
  const messages = {
    supervisor: {
      icon: '🎯',
      start: '🎯 Supervisor: Analyzing request and determining routing...'
    },
    scope: {
      icon: '📋',
      start: '📋 Scope Agent: Starting project scope definition and analysis...'
    },
    scheduler: {
      icon: '📅',
      start: '📅 Scheduler Agent: Creating task breakdown and timeline...'
    },
    taskUpdater: {
      icon: '✏️',
      start: '✏️ Task Updater: Processing task modifications...'
    },
    budget: {
      icon: '💰',
      start: '💰 Budget Agent: Analyzing financial requirements...'
    },
    analyzer: {
      icon: '🔍',
      start: '🔍 Analyzer: Performing comprehensive project assessment...'
    }
  };

  return messages[agentName] || {
    icon: '⚙️',
    start: `⚙️ ${agentName}: Starting processing...`
  };
}

/**
 * Event types that can be emitted:
 * 
 * - workflow_start: Workflow begins
 * - agent_start: An agent starts processing
 * - agent_complete: An agent finishes with results
 * - agent_routing: Supervisor is routing to next agent
 * - workflow_complete: Entire workflow finished
 * - workflow_error: An error occurred
 */

