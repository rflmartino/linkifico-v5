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

    // Small delay to let event be stored
    await new Promise(resolve => setTimeout(resolve, 100));

    // Emit supervisor start
    onEvent({
      type: 'agent_start',
      agent: 'supervisor',
      message: '🎯 Supervisor: Analyzing request and determining routing...',
      icon: '🎯',
      timestamp: new Date().toISOString()
    });

    await new Promise(resolve => setTimeout(resolve, 200));

    // Run the workflow (not streaming, but we'll emit events as if they're happening)
    const finalState = await pmGraph.invoke(initialState);

    // Extract which agents ran from the final state and emit events with delays
    if (finalState.scopeData) {
      onEvent({
        type: 'agent_start',
        agent: 'scope',
        message: '📋 Scope Agent: Starting project scope definition and analysis...',
        icon: '📋',
        timestamp: new Date().toISOString()
      });

      await new Promise(resolve => setTimeout(resolve, 500));

      onEvent({
        type: 'agent_thinking',
        agent: 'scope',
        message: '🤔 Scope Agent: Analyzing project requirements and creating comprehensive scope definition',
        timestamp: new Date().toISOString()
      });

      await new Promise(resolve => setTimeout(resolve, 500));

      onEvent({
        type: 'agent_complete',
        agent: 'scope',
        message: `✅ Scope Agent completed:\n${JSON.stringify(finalState.scopeData, null, 2)}`,
        data: finalState.scopeData,
        timestamp: new Date().toISOString()
      });

      await new Promise(resolve => setTimeout(resolve, 300));
    }

    if (finalState.schedulerData) {
      onEvent({
        type: 'agent_start',
        agent: 'scheduler',
        message: '📅 Scheduler Agent: Creating task breakdown and timeline...',
        icon: '📅',
        timestamp: new Date().toISOString()
      });

      await new Promise(resolve => setTimeout(resolve, 500));

      onEvent({
        type: 'agent_complete',
        agent: 'scheduler',
        message: `✅ Scheduler Agent completed:\n${JSON.stringify(finalState.schedulerData, null, 2)}`,
        data: finalState.schedulerData,
        timestamp: new Date().toISOString()
      });

      await new Promise(resolve => setTimeout(resolve, 300));
    }

    if (finalState.updateData) {
      onEvent({
        type: 'agent_start',
        agent: 'taskUpdater',
        message: '✏️ Task Updater: Processing task modifications...',
        icon: '✏️',
        timestamp: new Date().toISOString()
      });

      await new Promise(resolve => setTimeout(resolve, 500));

      onEvent({
        type: 'agent_complete',
        agent: 'taskUpdater',
        message: `✅ Task Updater completed:\n${JSON.stringify(finalState.updateData, null, 2)}`,
        data: finalState.updateData,
        timestamp: new Date().toISOString()
      });

      await new Promise(resolve => setTimeout(resolve, 300));
    }

    if (finalState.budgetData) {
      onEvent({
        type: 'agent_start',
        agent: 'budget',
        message: '💰 Budget Agent: Analyzing financial requirements...',
        icon: '💰',
        timestamp: new Date().toISOString()
      });

      await new Promise(resolve => setTimeout(resolve, 500));

      onEvent({
        type: 'agent_complete',
        agent: 'budget',
        message: `✅ Budget Agent completed:\n${JSON.stringify(finalState.budgetData, null, 2)}`,
        data: finalState.budgetData,
        timestamp: new Date().toISOString()
      });

      await new Promise(resolve => setTimeout(resolve, 300));
    }

    if (finalState.analysis) {
      onEvent({
        type: 'agent_start',
        agent: 'analyzer',
        message: '🔍 Analyzer: Performing comprehensive project assessment...',
        icon: '🔍',
        timestamp: new Date().toISOString()
      });

      await new Promise(resolve => setTimeout(resolve, 500));

      onEvent({
        type: 'agent_complete',
        agent: 'analyzer',
        message: `✅ Analysis Agent completed:\n${JSON.stringify(finalState.analysis, null, 2)}`,
        data: finalState.analysis,
        timestamp: new Date().toISOString()
      });

      await new Promise(resolve => setTimeout(resolve, 300));
    }

    // Emit completion event
    onEvent({
      type: 'workflow_complete',
      message: '✨ All done!',
      timestamp: new Date().toISOString()
    });

    console.log(`✅ Streaming workflow complete`);
    
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

