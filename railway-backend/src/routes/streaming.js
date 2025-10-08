// railway-backend/src/routes/streaming.js
// Server-Sent Events endpoint for real-time updates

import express from 'express';
import { runStreamingWorkflow } from '../agents/streaming.js';

const router = express.Router();

/**
 * SSE endpoint - streams agent progress in real-time
 * Client connects and receives events as they happen
 */
router.post('/stream-message', async (req, res) => {
  const { query, projectId, userId } = req.body;
  
  if (!query || !projectId || !userId) {
    return res.status(400).json({ 
      success: false,
      error: 'query, projectId, and userId are required' 
    });
  }

  console.log('🌊 Starting SSE stream for:', projectId);

  // Set headers for Server-Sent Events
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering

  // Send initial connection event
  res.write(`data: ${JSON.stringify({ 
    type: 'connected',
    message: 'Stream connected',
    timestamp: new Date().toISOString()
  })}\n\n`);

  try {
    // Run workflow with streaming
    const finalState = await runStreamingWorkflow(
      query,
      projectId,
      userId,
      (event) => {
        // Send each event to the client as it happens
        res.write(`data: ${JSON.stringify(event)}\n\n`);
      }
    );

    // Send final result
    res.write(`data: ${JSON.stringify({
      type: 'final_result',
      data: {
        projectData: finalState.projectData,
        scopeData: finalState.scopeData,
        schedulerData: finalState.schedulerData,
        updateData: finalState.updateData,
        budgetData: finalState.budgetData,
        analysis: finalState.analysis
      },
      timestamp: new Date().toISOString()
    })}\n\n`);

    // Close the stream
    res.write('data: [DONE]\n\n');
    res.end();

  } catch (error) {
    console.error('❌ SSE stream error:', error);
    
    res.write(`data: ${JSON.stringify({
      type: 'error',
      message: error.message,
      timestamp: new Date().toISOString()
    })}\n\n`);
    
    res.end();
  }
});

/**
 * Polling endpoint - for clients that can't use SSE
 * Returns incremental progress stored in Redis
 */
router.post('/stream-status', async (req, res) => {
  const { streamId } = req.body;
  
  if (!streamId) {
    return res.status(400).json({ 
      success: false,
      error: 'streamId required' 
    });
  }

  // TODO: Implement Redis-based progress tracking
  // For now, just return a placeholder
  res.json({
    success: true,
    streamId: streamId,
    events: [],
    complete: false
  });
});

export default router;

