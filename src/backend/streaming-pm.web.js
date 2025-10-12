// Wix Backend: src/backend/streaming-pm.web.js
// Polling-based streaming integration with Railway LangGraph agents
// Polls Railway backend every second for progress updates

import { Permissions, webMethod } from 'wix-web-module';
import { fetch } from 'wix-fetch';
import { getSecret } from 'wix-secrets-backend';
import { Logger } from './utils/logger.js';

// No in-memory cache needed - Railway backend stores everything in Redis
// Frontend polls Railway directly via this Wix backend proxy

/**
 * Start a streaming workflow using jobId as streamId
 * Returns jobId that frontend can poll for updates
 */
export const startStreamingWorkflow = webMethod(
  Permissions.Anyone,
  async (jobId, projectId, userId, message) => {
    try {
      Logger.info('streaming-pm', 'startStreamingWorkflow', { 
        jobId, 
        projectId, 
        userId,
        messageLength: message.length 
      });

      // Start Railway workflow directly (Railway stores events in Redis)
      const railwayApiKey = await getSecret('RAILWAY_API_KEY');
      
      const startResponse = await fetch(
        'https://linkifico-v5-production.up.railway.app/api/start-stream',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': railwayApiKey
          },
          body: JSON.stringify({
            streamId: jobId,
            query: message,
            projectId: projectId,
            userId: userId
          })
        }
      );

      if (!startResponse.ok) {
        throw new Error(`Railway start-stream failed: ${startResponse.status}`);
      }

      const startResult = await startResponse.json();
      
      if (!startResult.success) {
        throw new Error(startResult.error || 'Railway failed to start stream');
      }

      Logger.info('streaming-pm', 'railway_workflow_started', { jobId });

      return {
        success: true,
        jobId: jobId,
        message: 'Stream started - poll for updates'
      };

    } catch (error) {
      Logger.error('streaming-pm', 'startStreamingWorkflow', error);
      return {
        success: false,
        error: error.message
      };
    }
  }
);

/**
 * Poll for streaming events using jobId - frontend calls this repeatedly
 * Returns new events since last poll
 */
export const pollStreamEvents = webMethod(
  Permissions.Anyone,
  async (jobId, lastEventIndex = 0) => {
    try {
      Logger.info('streaming-pm', 'pollStreamEvents_called', { 
        jobId, 
        lastEventIndex
      });
      
      // Poll Railway directly instead of using in-memory cache
      // (in-memory cache doesn't work in serverless - different instances!)
      const railwayApiKey = await getSecret('RAILWAY_API_KEY');
      
      const pollResponse = await fetch(
        'https://linkifico-v5-production.up.railway.app/api/stream-status',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': railwayApiKey
          },
          body: JSON.stringify({
            streamId: jobId,
            lastEventIndex: lastEventIndex
          })
        }
      );

      if (!pollResponse.ok) {
        throw new Error(`Railway poll failed: ${pollResponse.status}`);
      }

      const pollResult = await pollResponse.json();
      
      Logger.info('streaming-pm', 'pollStreamEvents_success', { 
        jobId, 
        newEventCount: pollResult.events?.length || 0,
        totalEvents: pollResult.totalEvents,
        complete: pollResult.complete,
        hasFinalResult: !!pollResult.finalResult
      });
      
      return {
        success: pollResult.success,
        events: pollResult.events || [],
        complete: pollResult.complete,
        error: pollResult.error,
        finalResult: pollResult.finalResult,
        totalEvents: pollResult.totalEvents
      };

    } catch (error) {
      Logger.error('streaming-pm', 'pollStreamEvents_error', error.message);
      return {
        success: false,
        error: error.message,
        complete: true
      };
    }
  }
);

// No additional functions needed - Wix backend now acts as a simple proxy
// All state management is handled by Railway backend using Redis
