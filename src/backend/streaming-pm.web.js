// Wix Backend: src/backend/streaming-pm.web.js
// Polling-based streaming integration with Railway LangGraph agents
// Polls Railway backend every second for progress updates

import { Permissions, webMethod } from 'wix-web-module';
import { fetch } from 'wix-fetch';
import { getSecret } from 'wix-secrets-backend';
import { Logger } from './utils/logger.js';

// In-memory cache for streaming events (per stream session)
const streamCache = new Map();

// Cache expiry time (5 minutes)
const CACHE_EXPIRY_MS = 5 * 60 * 1000;

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

      // Initialize stream cache using jobId
      streamCache.set(jobId, {
        events: [],
        complete: false,
        error: null,
        startedAt: Date.now(),
        finalResult: null,
        lastEventIndex: 0
      });

      // Start Railway workflow with polling
      startRailwayWorkflow(jobId, projectId, userId, message).catch(error => {
        Logger.error('streaming-pm', 'startRailwayWorkflow_error', error);
        const cache = streamCache.get(jobId);
        if (cache) {
          cache.error = error.message;
          cache.complete = true;
        }
      });

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
        lastEventIndex,
        cacheSize: streamCache.size,
        cacheHasJob: streamCache.has(jobId)
      });
      
      const cache = streamCache.get(jobId);
      
      if (!cache) {
        Logger.warn('streaming-pm', 'pollStreamEvents_cache_not_found', { 
          jobId,
          cacheKeys: Array.from(streamCache.keys()),
          cacheSize: streamCache.size
        });
        return {
          success: false,
          error: 'Stream not found or expired',
          complete: true
        };
      }

      // Get new events since lastEventIndex
      const newEvents = cache.events.slice(lastEventIndex);
      
      Logger.info('streaming-pm', 'pollStreamEvents_success', { 
        jobId, 
        newEventCount: newEvents.length,
        totalEvents: cache.events.length,
        complete: cache.complete,
        hasFinalResult: !!cache.finalResult
      });
      
      return {
        success: true,
        events: newEvents,
        complete: cache.complete,
        error: cache.error,
        finalResult: cache.finalResult,
        totalEvents: cache.events.length
      };

    } catch (error) {
      Logger.error('streaming-pm', 'pollStreamEvents', error);
      return {
        success: false,
        error: error.message,
        complete: true
      };
    }
  }
);

/**
 * Clean up old stream cache entries
 */
function cleanupExpiredStreams() {
  const now = Date.now();
  for (const [jobId, cache] of streamCache.entries()) {
    if (now - cache.startedAt > CACHE_EXPIRY_MS) {
      streamCache.delete(jobId);
      Logger.info('streaming-pm', 'cleanupExpiredStreams', { jobId, age: now - cache.startedAt });
    }
  }
}

// Run cleanup every minute
setInterval(cleanupExpiredStreams, 60000);

/**
 * Start Railway workflow using jobId as streamId
 */
async function startRailwayWorkflow(jobId, projectId, userId, message) {
  try {
    const railwayApiKey = await getSecret('RAILWAY_API_KEY');
    const cache = streamCache.get(jobId);
    
    if (!cache) {
      Logger.warn('streaming-pm', 'startRailwayWorkflow_cache_lost', { jobId });
      return;
    }

    Logger.info('streaming-pm', 'starting_railway_workflow', { jobId });

    // Start the workflow on Railway using jobId as streamId
    const startResponse = await fetch(
      'https://linkifico-v5-production.up.railway.app/api/start-stream',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': railwayApiKey
        },
        body: JSON.stringify({
          streamId: jobId,  // Use jobId as streamId
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

    // Wait a bit for Railway to initialize the stream in Redis, then start polling
    setTimeout(() => {
      pollRailwayStream(jobId, railwayApiKey);
    }, 500);

  } catch (error) {
    Logger.error('streaming-pm', 'startRailwayWorkflow_failed', error);
    const cache = streamCache.get(jobId);
    if (cache) {
      cache.error = error.message;
      cache.complete = true;
    }
  }
}

/**
 * Poll Railway backend every second for new events using jobId
 */
async function pollRailwayStream(jobId, railwayApiKey) {
  const cache = streamCache.get(jobId);
  
  if (!cache) {
    Logger.warn('streaming-pm', 'pollRailwayStream_cache_lost', { jobId });
    return;
  }

  try {
    Logger.info('streaming-pm', 'polling_railway', { 
      jobId,
      lastEventIndex: cache.lastEventIndex 
    });

    // Poll Railway for updates using jobId as streamId
    const pollResponse = await fetch(
      'https://linkifico-v5-production.up.railway.app/api/stream-status',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': railwayApiKey
        },
        body: JSON.stringify({
          streamId: jobId,  // Use jobId as streamId
          lastEventIndex: cache.lastEventIndex
        })
      }
    );

    if (!pollResponse.ok) {
      throw new Error(`Railway poll failed: ${pollResponse.status}`);
    }

    const pollResult = await pollResponse.json();

    Logger.info('streaming-pm', 'railway_poll_result', {
      jobId,
      success: pollResult.success,
      complete: pollResult.complete,
      hasEvents: !!pollResult.events,
      eventCount: pollResult.events?.length || 0,
      error: pollResult.error
    });

    // Handle stream not found - just keep polling (job might not have started yet)
    if (!pollResult.success) {
      Logger.info('streaming-pm', 'railway_stream_not_ready', { 
        jobId,
        message: 'Stream not ready yet, will retry' 
      });
      
      // Don't mark as error - job might not have started yet
      // Just continue polling
      if (streamCache.has(jobId)) {
        setTimeout(() => pollRailwayStream(jobId, railwayApiKey), 500);
      }
      return;
    }

    // Update cache with new events
    if (pollResult.events && pollResult.events.length > 0) {
      cache.events.push(...pollResult.events);
      cache.lastEventIndex = pollResult.totalEvents;
      Logger.info('streaming-pm', 'received_events', { 
        jobId, 
        newEvents: pollResult.events.length,
        totalEvents: cache.events.length 
      });
    }

    // Check if complete - streaming stops here
    if (pollResult.complete) {
      cache.complete = true;
      cache.error = pollResult.error;
      cache.finalResult = pollResult.finalResult;
      Logger.info('streaming-pm', 'stream_complete', { 
        jobId, 
        totalEvents: cache.events.length,
        hasError: !!pollResult.error 
      });
      return;  // Stop polling - job is finished
    }

    // Continue polling if not complete (job still running)
    if (streamCache.has(jobId)) {
      setTimeout(() => pollRailwayStream(jobId, railwayApiKey), 500);
    }

  } catch (error) {
    Logger.error('streaming-pm', 'pollRailwayStream_error', error);
    cache.error = error.message;
    cache.complete = true;
  }
}
