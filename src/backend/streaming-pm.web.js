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
 * Start a streaming workflow
 * Returns streamId that frontend can poll for updates
 */
export const startStreamingWorkflow = webMethod(
  Permissions.Anyone,
  async (projectId, userId, message) => {
    const streamId = `stream_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    try {
      Logger.info('streaming-pm', 'startStreamingWorkflow', { 
        streamId, 
        projectId, 
        userId,
        messageLength: message.length 
      });

      // Initialize stream cache
      streamCache.set(streamId, {
        events: [],
        complete: false,
        error: null,
        startedAt: Date.now(),
        finalResult: null,
        railwayStreamId: null,
        lastEventIndex: 0
      });

      // Start Railway stream and begin polling
      startRailwayStreamAndPoll(streamId, projectId, userId, message).catch(error => {
        Logger.error('streaming-pm', 'startRailwayStreamAndPoll_error', error);
        const cache = streamCache.get(streamId);
        if (cache) {
          cache.error = error.message;
          cache.complete = true;
        }
      });

      return {
        success: true,
        streamId: streamId,
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
 * Poll for streaming events - frontend calls this repeatedly
 * Returns new events since last poll
 */
export const pollStreamEvents = webMethod(
  Permissions.Anyone,
  async (streamId, lastEventIndex = 0) => {
    try {
      const cache = streamCache.get(streamId);
      
      if (!cache) {
        return {
          success: false,
          error: 'Stream not found or expired',
          complete: true
        };
      }

      // Get new events since lastEventIndex
      const newEvents = cache.events.slice(lastEventIndex);
      
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
  for (const [streamId, cache] of streamCache.entries()) {
    if (now - cache.startedAt > CACHE_EXPIRY_MS) {
      streamCache.delete(streamId);
      Logger.info('streaming-pm', 'cleanupExpiredStreams', { streamId, age: now - cache.startedAt });
    }
  }
}

// Run cleanup every minute
setInterval(cleanupExpiredStreams, 60000);

/**
 * Start Railway stream and poll for updates every second
 */
async function startRailwayStreamAndPoll(streamId, projectId, userId, message) {
  try {
    const railwayApiKey = await getSecret('RAILWAY_API_KEY');
    const cache = streamCache.get(streamId);
    
    if (!cache) {
      Logger.warn('streaming-pm', 'startRailwayStreamAndPoll_cache_lost', { streamId });
      return;
    }

    Logger.info('streaming-pm', 'starting_railway_stream', { streamId });

    // Start the stream on Railway
    const startResponse = await fetch(
      'https://linkifico-v5-production.up.railway.app/api/start-stream',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': railwayApiKey
        },
        body: JSON.stringify({
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
    const railwayStreamId = startResult.streamId;

    Logger.info('streaming-pm', 'railway_stream_started', { streamId, railwayStreamId });

    // Store Railway stream ID
    cache.railwayStreamId = railwayStreamId;

    // Start polling Railway for updates
    pollRailwayStream(streamId, railwayStreamId, railwayApiKey);

  } catch (error) {
    Logger.error('streaming-pm', 'startRailwayStreamAndPoll_failed', error);
    const cache = streamCache.get(streamId);
    if (cache) {
      cache.error = error.message;
      cache.complete = true;
    }
  }
}

/**
 * Poll Railway backend every second for new events
 */
async function pollRailwayStream(streamId, railwayStreamId, railwayApiKey) {
  const cache = streamCache.get(streamId);
  
  if (!cache) {
    Logger.warn('streaming-pm', 'pollRailwayStream_cache_lost', { streamId });
    return;
  }

  try {
    Logger.info('streaming-pm', 'polling_railway', { streamId, lastEventIndex: cache.lastEventIndex });

    // Poll Railway for updates
    const pollResponse = await fetch(
      'https://linkifico-v5-production.up.railway.app/api/stream-status',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': railwayApiKey
        },
        body: JSON.stringify({
          streamId: railwayStreamId,
          lastEventIndex: cache.lastEventIndex
        })
      }
    );

    if (!pollResponse.ok) {
      throw new Error(`Railway poll failed: ${pollResponse.status}`);
    }

    const pollResult = await pollResponse.json();

    // Update cache with new events
    if (pollResult.success && pollResult.events && pollResult.events.length > 0) {
      cache.events.push(...pollResult.events);
      cache.lastEventIndex = pollResult.totalEvents;
      Logger.info('streaming-pm', 'received_events', { 
        streamId, 
        newEvents: pollResult.events.length,
        totalEvents: cache.events.length 
      });
    }

    // Check if complete
    if (pollResult.complete) {
      cache.complete = true;
      cache.error = pollResult.error;
      cache.finalResult = pollResult.finalResult;
      Logger.info('streaming-pm', 'stream_complete', { streamId, totalEvents: cache.events.length });
      return;
    }

    // Continue polling if not complete
    if (streamCache.has(streamId)) {
      setTimeout(() => pollRailwayStream(streamId, railwayStreamId, railwayApiKey), 1000);
    }

  } catch (error) {
    Logger.error('streaming-pm', 'pollRailwayStream_error', error);
    cache.error = error.message;
    cache.complete = true;
  }
}
