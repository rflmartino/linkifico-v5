// railway-backend/src/routes/streaming.js
// Polling-based streaming endpoint with Redis storage

import express from 'express';
import { runStreamingWorkflow } from '../agents/streaming.js';
import { getRedisClient } from '../data/projectData.js';

const router = express.Router();

/**
 * Start a streaming workflow - stores progress in Redis
 * Uses provided streamId (jobId) for consistency
 */
router.post('/start-stream', async (req, res) => {
  const { streamId, query, projectId, userId } = req.body;
  
  if (!query || !projectId || !userId) {
    return res.status(400).json({ 
      success: false,
      error: 'query, projectId, and userId are required' 
    });
  }

  // Use provided streamId or generate one
  const finalStreamId = streamId || `stream_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  
  console.log('🌊 Starting polling-based stream:', finalStreamId);

  // Initialize stream in Redis
  const redis = await getRedisClient();
  await redis.set(`stream:${finalStreamId}`, JSON.stringify({
    events: [],
    complete: false,
    error: null,
    startedAt: Date.now(),
    projectId,
    userId
  }), 'EX', 600); // Expire after 10 minutes

  // Start workflow in background
  processWorkflowWithRedis(finalStreamId, query, projectId, userId).catch(error => {
    console.error('❌ Background workflow error:', error);
  });

  // Return stream ID immediately
  res.json({
    success: true,
    streamId: finalStreamId,
    message: 'Stream started - poll /stream-status for updates'
  });
});

/**
 * Poll for stream updates
 * Returns new events since lastEventIndex
 */
router.post('/stream-status', async (req, res) => {
  const { streamId, lastEventIndex = 0 } = req.body;
  
  if (!streamId) {
    return res.status(400).json({ 
      success: false,
      error: 'streamId required' 
    });
  }

  try {
    const redis = await getRedisClient();
    const streamData = await redis.get(`stream:${streamId}`);
    
    if (!streamData) {
      return res.json({
        success: false,
        error: 'Stream not found or expired',
        complete: false  // Don't give up - let frontend retry
      });
    }

    const stream = JSON.parse(streamData);
    
    // Get new events since lastEventIndex
    const newEvents = stream.events.slice(lastEventIndex);
    
    res.json({
      success: true,
      events: newEvents,
      complete: stream.complete,
      error: stream.error,
      finalResult: stream.finalResult,
      totalEvents: stream.events.length
    });

  } catch (error) {
    console.error('❌ Stream status error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      complete: true
    });
  }
});

/**
 * Process workflow and store events in Redis as they happen
 */
async function processWorkflowWithRedis(streamId, query, projectId, userId) {
  const redis = await getRedisClient();
  
  try {
    console.log(`🔄 Processing workflow for stream: ${streamId}`);
    
    // Import project data functions
    const { getProjectData, createProjectData, saveProjectData } = await import('../data/projectData.js');
    
    // Get or create project data first
    let projectData = await getProjectData(projectId);
    if (!projectData) {
      console.log(`📦 Creating new project for stream: ${projectId}`);
      projectData = await createProjectData(projectId, userId, {
        name: 'New Project'
      });
      await saveProjectData(projectId, projectData);
    }
    
    // Use a lock to prevent race conditions when storing events
    let isUpdating = false;
    const pendingEvents = [];
    
    // Function to safely append event to Redis
    const storeEvent = async (event) => {
      pendingEvents.push(event);
      
      // If already updating, wait for next batch
      if (isUpdating) return;
      
      isUpdating = true;
      
      try {
        // Process all pending events
        while (pendingEvents.length > 0) {
          const eventsToStore = [...pendingEvents];
          pendingEvents.length = 0; // Clear pending
          
          const streamData = await redis.get(`stream:${streamId}`);
          if (streamData) {
            const stream = JSON.parse(streamData);
            stream.events.push(...eventsToStore);
            await redis.set(`stream:${streamId}`, JSON.stringify(stream), 'EX', 600);
            console.log(`📝 Stored ${eventsToStore.length} event(s) for ${streamId}, total now: ${stream.events.length}`);
          }
        }
      } finally {
        isUpdating = false;
      }
    };
    
    // Run workflow with event callback - store events as they happen
    const finalState = await runStreamingWorkflow(
      query,
      projectId,
      userId,
      async (event) => {
        await storeEvent(event);
      }
    );
    
    // Wait for any pending events to be stored
    while (isUpdating || pendingEvents.length > 0) {
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    
    // Now mark as complete and store final result
    const streamData = await redis.get(`stream:${streamId}`);
    if (streamData) {
      const stream = JSON.parse(streamData);
      stream.complete = true;
      
      console.log(`🔍 Checking finalState for aiResponse:`);
      console.log(`   - Has scopeData: ${!!finalState.scopeData}`);
      console.log(`   - Has analysis: ${!!finalState.analysis}`);
      console.log(`   - Has direct_answer: ${!!finalState.direct_answer}`);
      console.log(`   - Has messages: ${!!finalState.messages}, length: ${finalState.messages?.length || 0}`);
      console.log(`   - finalState keys: ${Object.keys(finalState || {})}`);
      
      if (finalState.scopeData) {
        console.log(`   - scopeData structure: ${JSON.stringify(Object.keys(finalState.scopeData))}`);
      }
      
      // Create AI response from the workflow results
      let aiResponse = "I've analyzed your project and created the initial structure.";
      
      if (finalState.scopeData) {
        // CHECK: Is the agent asking for more info or is scope complete?
        if (finalState.scopeData.needsMoreInfo === true && finalState.scopeData.responseText) {
          // Agent is asking questions - use the responseText
          aiResponse = finalState.scopeData.responseText;
          console.log(`❓ Scope agent asking for info: ${aiResponse.substring(0, 100)}...`);
        } else if (finalState.scopeData.scope) {
          // Scope is complete - format a comprehensive response
          const scope = finalState.scopeData.scope;
          aiResponse = `✅ **Project Scope Defined**\n\n`;
          
          if (scope?.description) {
            aiResponse += `**Overview:** ${scope.description}\n\n`;
          }
          
          if (scope?.objectives && scope.objectives.length > 0) {
            aiResponse += `**Objectives:**\n${scope.objectives.map(obj => `• ${obj}`).join('\n')}\n\n`;
          }
          
          if (scope?.deliverables && scope.deliverables.length > 0) {
            aiResponse += `**Key Deliverables:**\n${scope.deliverables.map(del => `• ${del}`).join('\n')}\n\n`;
          }
          
          if (scope?.budget) {
            aiResponse += `**Budget:** ${scope.budget}\n\n`;
          }
          
          if (scope?.timeline) {
            aiResponse += `**Timeline:** ${scope.timeline.startDate} to ${scope.timeline.targetEndDate}\n\n`;
          }
          
          if (finalState.scopeData.stages && finalState.scopeData.stages.length > 0) {
            aiResponse += `**Project Stages:**\n${finalState.scopeData.stages.map((stage, idx) => 
              `${idx + 1}. ${stage.name} (${stage.status})`
            ).join('\n')}`;
          }
          
          console.log(`✅ Scope complete: ${aiResponse.substring(0, 100)}...`);
        } else if (finalState.scopeData.responseText) {
          // Agent provided responseText but no scope (stages created, waiting for approval)
          aiResponse = finalState.scopeData.responseText;
          console.log(`📋 Scope agent stages created: ${aiResponse.substring(0, 100)}...`);
        } else {
          // Fallback - shouldn't happen but just in case
          console.warn(`⚠️ scopeData exists but no responseText or scope found`);
        }
      } else if (finalState.analysis) {
        aiResponse = finalState.analysis.summary || "Project analysis completed.";
      } else if (finalState.direct_answer) {
        aiResponse = finalState.direct_answer;
      } else if (finalState.messages && finalState.messages.length > 0) {
        // Find the last assistant message
        const assistantMessages = finalState.messages.filter(msg => msg.role === 'assistant');
        const lastAssistantMsg = assistantMessages[assistantMessages.length - 1];
        
        if (lastAssistantMsg && lastAssistantMsg.content) {
          aiResponse = lastAssistantMsg.content;
          console.log(`📝 Using assistant message content as aiResponse: ${aiResponse.substring(0, 100)}...`);
        } else {
          console.warn(`⚠️ Last message exists but no assistant content found`);
          console.warn(`⚠️ Messages: ${JSON.stringify(finalState.messages.map(m => ({ role: m.role, hasContent: !!m.content, contentPreview: m.content?.substring(0, 50) })), null, 2)}`);
        }
      } else {
        console.warn(`⚠️ No scopeData, analysis, direct_answer, or messages found in finalState`);
      }
      
      console.log(`🎯 Final aiResponse being sent: ${aiResponse.substring(0, 150)}...`);
      
      // Get the latest project data to include name and email
      const updatedProjectData = await getProjectData(projectId);
      
      stream.finalResult = {
        projectData: {
          ...(finalState.projectData || updatedProjectData),
          aiResponse: aiResponse  // Ensure AI response is included
        },
        projectName: (finalState.projectData || updatedProjectData)?.name || 'New Project',
        projectEmail: (finalState.projectData || updatedProjectData)?.email || '',
        scopeData: finalState.scopeData,
        schedulerData: finalState.schedulerData,
        updateData: finalState.updateData,
        budgetData: finalState.budgetData,
        analysis: finalState.analysis
      };
      
      console.log(`💾 Storing finalResult with aiResponse (${aiResponse.length} chars)`);
      console.log(`   Project: ${stream.finalResult.projectName}`);
      console.log(`   Email: ${stream.finalResult.projectEmail}`);
      
      await redis.set(`stream:${streamId}`, JSON.stringify(stream), 'EX', 600);
      console.log(`✅ Stream ${streamId} completed with ${stream.events.length} events`);
    }

  } catch (error) {
    console.error(`❌ Workflow error for ${streamId}:`, error);
    
    // Store error in Redis
    const streamData = await redis.get(`stream:${streamId}`);
    if (streamData) {
      const stream = JSON.parse(streamData);
      stream.complete = true;
      stream.error = error.message;
      await redis.set(`stream:${streamId}`, JSON.stringify(stream), 'EX', 600);
    }
  }
}

export default router;

