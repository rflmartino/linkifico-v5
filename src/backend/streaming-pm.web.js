// Wix Backend: src/backend/streaming-pm.web.js
// Real-time streaming integration with Railway LangGraph agents
// Uses fast-polling to simulate SSE streaming

import { Permissions, webMethod } from 'wix-web-module';
import { fetch } from 'wix-fetch';
import { getSecret } from 'wix-secrets-backend';
import { Logger } from './utils/logger.js';

// In-memory cache for streaming events (per stream session)
// In production, you might want to use Wix Data or external cache
const streamCache = new Map();

// Cache expiry time (5 minutes)
const CACHE_EXPIRY_MS = 5 * 60 * 1000;

/**
 * Start a streaming workflow - initiates Railway SSE stream
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
        finalResult: null
      });

      // Start the SSE stream in background (don't await)
      processSSEStream(streamId, projectId, userId, message).catch(error => {
        Logger.error('streaming-pm', 'processSSEStream_background_error', error);
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
 * Process SSE stream from Railway backend
 * Collects events and stores them in cache for polling
 */
async function processSSEStream(streamId, projectId, userId, message) {
  try {
    const railwayApiKey = await getSecret('RAILWAY_API_KEY');
    const railwayUrl = 'https://linkifico-v5-production.up.railway.app/api/stream-message';

    Logger.info('streaming-pm', 'processSSEStream_start', { streamId, projectId, userId });

    const response = await fetch(railwayUrl, {
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
    });

    if (!response.ok) {
      throw new Error(`Railway request failed: ${response.status} ${response.statusText}`);
    }

    // Read the SSE stream
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    
    let buffer = '';
    const cache = streamCache.get(streamId);
    
    if (!cache) {
      Logger.warn('streaming-pm', 'processSSEStream_cache_lost', { streamId });
      return;
    }

    while (true) {
      const { done, value } = await reader.read();
      
      if (done) {
        Logger.info('streaming-pm', 'processSSEStream_complete', { 
          streamId, 
          totalEvents: cache.events.length 
        });
        cache.complete = true;
        break;
      }

      // Decode chunk
      buffer += decoder.decode(value, { stream: true });
      
      // Process complete events (separated by \n\n)
      const lines = buffer.split('\n\n');
      buffer = lines.pop() || ''; // Keep incomplete line in buffer

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6); // Remove 'data: ' prefix
          
          if (data === '[DONE]') {
            cache.complete = true;
            Logger.info('streaming-pm', 'processSSEStream_done', { streamId });
            continue;
          }

          try {
            const event = JSON.parse(data);
            cache.events.push(event);

            // Capture final result
            if (event.type === 'final_result') {
              cache.finalResult = event.data;
            }

            Logger.info('streaming-pm', 'event_received', { 
              streamId, 
              eventType: event.type,
              eventIndex: cache.events.length - 1
            });

          } catch (parseError) {
            Logger.error('streaming-pm', 'event_parse_error', parseError);
          }
        }
      }
    }

  } catch (error) {
    Logger.error('streaming-pm', 'processSSEStream_error', error);
    const cache = streamCache.get(streamId);
    if (cache) {
      cache.error = error.message;
      cache.complete = true;
      cache.events.push({
        type: 'error',
        message: error.message,
        timestamp: new Date().toISOString()
      });
    }
    throw error;
  }
}

/**
 * Legacy method for backwards compatibility
 * Processes message without streaming (waits for complete result)
 */
export const sendMessageNoStreaming = webMethod(
  Permissions.Anyone,
  async (projectId, userId, message) => {
    try {
      const railwayApiKey = await getSecret('RAILWAY_API_KEY');
      
      Logger.info('streaming-pm', 'sendMessageNoStreaming', { projectId, userId });

      const response = await fetch(
        'https://linkifico-v5-production.up.railway.app/api/process-message',
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

      const result = await response.json();

      return {
        success: result.success || true,
        result: result
      };

    } catch (error) {
      Logger.error('streaming-pm', 'sendMessageNoStreaming', error);
      return {
        success: false,
        error: error.message
      };
    }
  }
);

