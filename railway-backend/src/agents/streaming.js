// railway-backend/src/agents/streaming.js
// Streaming workflow that emits events with real AI reasoning

import { pmGraph } from './graph.js';

/**
 * Run workflow with streaming events
 * Emits events as each agent processes the request
 * Now uses REAL AI reasoning from agents instead of hardcoded messages
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

    // Emit supervisor start - still hardcoded as supervisor doesn't have reasoning field
    onEvent({
      type: 'agent_start',
      agent: 'supervisor',
      message: '🎯 Supervisor: Analyzing request and determining routing...',
      icon: '🎯',
      timestamp: new Date().toISOString()
    });

    await new Promise(resolve => setTimeout(resolve, 200));

    // Run the workflow (invoke returns final state after all agents complete)
    const finalState = await pmGraph.invoke(initialState);

    // Use REAL reasoning from supervisor if available
    if (finalState.reasoning) {
      onEvent({
        type: 'agent_thinking',
        agent: 'supervisor',
        message: finalState.reasoning,
        timestamp: new Date().toISOString()
      });
      await new Promise(resolve => setTimeout(resolve, 300));
    }

    // Extract which agents ran from the final state and emit events with REAL AI reasoning
    if (finalState.scopeData) {
      onEvent({
        type: 'agent_start',
        agent: 'scope',
        message: '📋 Scope Agent: Analyzing project requirements...',
        icon: '📋',
        timestamp: new Date().toISOString()
      });

      await new Promise(resolve => setTimeout(resolve, 500));

      // Use REAL AI reasoning from scope agent
      if (finalState.scopeData.reasoning) {
        onEvent({
          type: 'agent_thinking',
          agent: 'scope',
          message: finalState.scopeData.reasoning,
          timestamp: new Date().toISOString()
        });
      }

      await new Promise(resolve => setTimeout(resolve, 500));

      // Determine message based on whether scope is complete or asking for info
      const scopeCompleteMsg = finalState.scopeData.needsMoreInfo === true
        ? '💬 Scope Agent responded - awaiting more information'
        : '✅ Scope Agent completed - Project scope and stages defined';
      
      onEvent({
        type: 'agent_complete',
        agent: 'scope',
        message: scopeCompleteMsg,
        data: finalState.scopeData,
        timestamp: new Date().toISOString()
      });

      await new Promise(resolve => setTimeout(resolve, 300));
    }

    if (finalState.schedulerData) {
      onEvent({
        type: 'agent_start',
        agent: 'scheduler',
        message: '📅 Scheduler Agent: Creating task breakdown...',
        icon: '📅',
        timestamp: new Date().toISOString()
      });

      await new Promise(resolve => setTimeout(resolve, 500));

      // Use REAL AI reasoning from scheduler agent
      if (finalState.schedulerData.reasoning) {
        onEvent({
          type: 'agent_thinking',
          agent: 'scheduler',
          message: finalState.schedulerData.reasoning,
          timestamp: new Date().toISOString()
        });
      }

      await new Promise(resolve => setTimeout(resolve, 500));

      onEvent({
        type: 'agent_complete',
        agent: 'scheduler',
        message: '✅ Scheduler Agent completed - Tasks and timeline created',
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

      // Use REAL AI reasoning from task updater agent
      if (finalState.updateData.reasoning) {
        onEvent({
          type: 'agent_thinking',
          agent: 'taskUpdater',
          message: finalState.updateData.reasoning,
          timestamp: new Date().toISOString()
        });
      }

      await new Promise(resolve => setTimeout(resolve, 500));

      onEvent({
        type: 'agent_complete',
        agent: 'taskUpdater',
        message: '✅ Task Updater completed - Task updates processed',
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

      // Use REAL AI reasoning from budget agent
      if (finalState.budgetData.analysis) {
        onEvent({
          type: 'agent_thinking',
          agent: 'budget',
          message: finalState.budgetData.analysis,
          timestamp: new Date().toISOString()
        });
      }

      await new Promise(resolve => setTimeout(resolve, 500));

      onEvent({
        type: 'agent_complete',
        agent: 'budget',
        message: '✅ Budget Agent completed - Budget analyzed and updated',
        data: finalState.budgetData,
        timestamp: new Date().toISOString()
      });

      await new Promise(resolve => setTimeout(resolve, 300));
    }

    if (finalState.analysis) {
      onEvent({
        type: 'agent_start',
        agent: 'analyzer',
        message: '🔍 Analyzer: Performing project assessment...',
        icon: '🔍',
        timestamp: new Date().toISOString()
      });

      await new Promise(resolve => setTimeout(resolve, 500));

      // Use REAL AI reasoning from analyzer agent
      if (finalState.analysis.reasoning) {
        onEvent({
          type: 'agent_thinking',
          agent: 'analyzer',
          message: finalState.analysis.reasoning,
          timestamp: new Date().toISOString()
        });
      }

      await new Promise(resolve => setTimeout(resolve, 500));

      onEvent({
        type: 'agent_complete',
        agent: 'analyzer',
        message: '✅ Analysis Agent completed - Project assessment done',
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
 * Get friendly messages for each agent (kept for reference but less used now)
 */
function getAgentMessage(agentName) {
  const messages = {
    supervisor: {
      icon: '🎯',
      start: '🎯 Supervisor: Analyzing request and determining routing...'
    },
    scope: {
      icon: '📋',
      start: '📋 Scope Agent: Analyzing project requirements...'
    },
    scheduler: {
      icon: '📅',
      start: '📅 Scheduler Agent: Creating task breakdown...'
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
      start: '🔍 Analyzer: Performing project assessment...'
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
 * - agent_thinking: Agent's actual AI reasoning (NEW - uses real reasoning from agent)
 * - agent_complete: An agent finishes with results
 * - workflow_complete: Entire workflow finished
 * - workflow_error: An error occurred
 */
