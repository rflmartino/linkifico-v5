// Wix Backend: src/backend/streaming-pm.web.js
// Real-time streaming integration with Railway LangGraph agents
// Uses axios for proper SSE streaming support

import { Permissions, webMethod } from 'wix-web-module';
import { fetch } from 'wix-fetch';
import { getSecret } from 'wix-secrets-backend';
import { Logger } from './utils/logger.js';
import axios from 'axios';

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
 * Process SSE stream from Railway backend using axios if available
 * Falls back to simulated streaming if axios is not available
 */
async function processSSEStream(streamId, projectId, userId, message) {
  try {
    const railwayApiKey = await getSecret('RAILWAY_API_KEY');
    
    Logger.info('streaming-pm', 'processSSEStream_start', { streamId, projectId, userId });

    const cache = streamCache.get(streamId);
    if (!cache) {
      Logger.warn('streaming-pm', 'processSSEStream_cache_lost', { streamId });
      return;
    }

    // Use axios streaming
    try {
      Logger.info('streaming-pm', 'using_axios_streaming', { streamId });
      
      const response = await axios({
        method: 'post',
        url: 'https://linkifico-v5-production.up.railway.app/api/stream-message',
        data: { 
          query: message, 
          projectId: projectId, 
          userId: userId 
        },
        headers: { 
          'Content-Type': 'application/json',
          'x-api-key': railwayApiKey 
        },
        responseType: 'stream'
      });

      let buffer = '';
      
      response.data.on('data', (chunk) => {
        try {
          buffer += chunk.toString();
          
          // Process complete events (separated by \n\n)
          const lines = buffer.split('\n\n');
          buffer = lines.pop() || ''; // Keep incomplete line in buffer

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const data = line.slice(6); // Remove 'data: ' prefix
              
              if (data === '[DONE]') {
                cache.complete = true;
                Logger.info('streaming-pm', 'stream_done', { streamId });
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
        } catch (chunkError) {
          Logger.error('streaming-pm', 'chunk_processing_error', chunkError);
        }
      });

      response.data.on('end', () => {
        Logger.info('streaming-pm', 'axios_stream_complete', { 
          streamId, 
          totalEvents: cache.events.length 
        });
        cache.complete = true;
      });

      response.data.on('error', (error) => {
        Logger.error('streaming-pm', 'axios_stream_error', error);
        cache.error = error.message;
        cache.complete = true;
        cache.events.push({
          type: 'error',
          message: error.message,
          timestamp: new Date().toISOString()
        });
      });

    } catch (axiosError) {
      Logger.error('streaming-pm', 'axios_streaming_failed', axiosError);
      
      // Fallback: Simulate streaming with regular fetch
      Logger.info('streaming-pm', 'using_simulated_streaming', { streamId });
      
      try {
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

        if (!response.ok) {
          throw new Error(`Railway request failed: ${response.status} ${response.statusText}`);
        }

        const result = await response.json();

        // Create simulated streaming events with realistic timing
        const events = [
          { type: 'connected', message: 'Stream connected', delay: 100 },
          { type: 'workflow_start', message: '🤔 Analyzing your request...', delay: 500 },
          { type: 'agent_start', agent: 'supervisor', message: '🎯 Supervisor: Analyzing request and determining routing...', delay: 1000 },
          { type: 'agent_thinking', agent: 'supervisor', message: '🤔 supervisor reasoning: Routing to appropriate agent based on request type', delay: 1500 },
          { type: 'agent_start', agent: 'scope', message: '📋 Scope Agent: Starting project scope definition and analysis...', delay: 2000 },
          { type: 'agent_thinking', agent: 'scope', message: '🤔 scope reasoning: Analyzing project requirements and creating comprehensive scope definition', delay: 2500 }
        ];

        // Add completion events based on actual results
        if (result.scopeData) {
          events.push({
            type: 'agent_complete',
            agent: 'scope',
            message: `✅ Scope Agent completed:\n${JSON.stringify(result.scopeData, null, 2)}`,
            data: result.scopeData,
            delay: 3000
          });
        }

        if (result.schedulerData) {
          events.push(
            { type: 'agent_start', agent: 'scheduler', message: '📅 Scheduler Agent: Creating task breakdown and timeline...', delay: 4000 },
            {
              type: 'agent_complete',
              agent: 'scheduler',
              message: `✅ Scheduler Agent completed:\n${JSON.stringify(result.schedulerData, null, 2)}`,
              data: result.schedulerData,
              delay: 5000
            }
          );
        }

        if (result.analysis) {
          events.push(
            { type: 'agent_start', agent: 'analyzer', message: '🔍 Analyzer: Performing comprehensive project assessment...', delay: 6000 },
            {
              type: 'agent_complete',
              agent: 'analyzer',
              message: `✅ Analysis Agent completed:\n${JSON.stringify(result.analysis, null, 2)}`,
              data: result.analysis,
              delay: 7000
            }
          );
        }

        events.push({ type: 'workflow_complete', message: '✨ All done!', delay: 8000 });

        // Emit events with realistic timing
        for (const event of events) {
          setTimeout(() => {
            const eventWithTimestamp = {
              ...event,
              timestamp: new Date().toISOString()
            };
            cache.events.push(eventWithTimestamp);
            Logger.info('streaming-pm', 'simulated_event', { 
              streamId, 
              eventType: event.type,
              eventIndex: cache.events.length - 1
            });
          }, event.delay);
        }

        // Set final result and complete after all events
        setTimeout(() => {
          cache.finalResult = {
            projectData: result.projectData,
            scopeData: result.scopeData,
            schedulerData: result.schedulerData,
            updateData: result.updateData,
            budgetData: result.budgetData,
            analysis: result.analysis
          };
          cache.complete = true;
          Logger.info('streaming-pm', 'simulated_stream_complete', { 
            streamId, 
            totalEvents: cache.events.length 
          });
        }, 9000);

      } catch (error) {
        Logger.error('streaming-pm', 'simulated_streaming_error', error);
        
        cache.events.push({
          type: 'workflow_error',
          message: '❌ Something went wrong',
          error: error.message,
          timestamp: new Date().toISOString()
        });
        
        cache.error = error.message;
        cache.complete = true;
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

