import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { runPMWorkflow } from './agents/graph.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 8080;

// Middleware
app.use(cors());
app.use(express.json());

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    message: 'PMaaS Railway Backend with LangGraph is running',
    timestamp: new Date().toISOString(),
    langgraph: 'enabled'
  });
});

// LangGraph-powered project analysis endpoint
app.post('/api/analyze-project', async (req, res) => {
  try {
    const { query, projectData } = req.body;
    
    if (!query) {
      return res.status(400).json({ error: 'Query is required' });
    }

    console.log('🤖 Starting LangGraph workflow...');
    console.log('Query:', query);
    console.log('Project Data:', projectData);

    // Run the multi-agent workflow
    const result = await runPMWorkflow(query, projectData || {});

    console.log('✅ Workflow complete');
    console.log('Result:', JSON.stringify(result, null, 2));

    res.json({ 
      success: true,
      result: result,
      analysis: result.analysis,
      reasoning: result.reasoning,
      messages: result.messages
    });

  } catch (error) {
    console.error('❌ Analysis failed:', error);
    res.status(500).json({ 
      success: false,
      error: 'Analysis failed',
      message: error.message 
    });
  }
});

// Simple test endpoint (no LangGraph)
app.get('/api/test', (req, res) => {
  res.json({
    message: 'Railway backend is working!',
    timestamp: new Date().toISOString()
  });
});

app.listen(PORT, () => {
  console.log(`🚀 PMaaS Server running on port ${PORT}`);
  console.log(`🤖 LangGraph multi-agent system ready`);
  console.log(`📊 Health check: http://localhost:${PORT}/health`);
});