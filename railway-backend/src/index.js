import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { runPMWorkflow } from './agents/graph.js';
import { getRedisClient } from './data/projectData.js';
import { createProjectData, saveProjectData, getProjectData } from './data/projectData.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 8080;
const API_KEY = process.env.RAILWAY_API_KEY;

// ============================================================================
// SECURITY MIDDLEWARE
// ============================================================================

// API Key Authentication Middleware
function authenticateApiKey(req, res, next) {
  // Skip authentication for health check
  if (req.path === '/health') {
    return next();
  }

  const providedKey = req.headers['x-api-key'];
  
  if (!API_KEY) {
    console.error('⚠️ WARNING: API_KEY not set in environment variables!');
    console.error('⚠️ API is currently UNSECURED. Set API_KEY immediately!');
    return next(); // Allow requests but log warning
  }
  
  if (!providedKey) {
    console.warn('🔒 Unauthorized request - No API key provided');
    return res.status(401).json({ 
      success: false,
      error: 'Unauthorized - API key required',
      message: 'Include x-api-key header with your request'
    });
  }
  
  if (providedKey !== API_KEY) {
    console.warn('🔒 Unauthorized request - Invalid API key');
    return res.status(401).json({ 
      success: false,
      error: 'Unauthorized - Invalid API key'
    });
  }
  
  // API key is valid
  next();
}

// ============================================================================
// MIDDLEWARE
// ============================================================================

app.use(cors());
app.use(express.json());

// Apply API key authentication to all /api/* routes
app.use('/api/*', authenticateApiKey);

// In-memory job storage (should use Redis in production, but using memory for now)
const jobs = new Map();
const jobResults = new Map();

// Health check endpoint (public - no auth required)
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    message: 'PMaaS Railway Backend with LangGraph is running',
    timestamp: new Date().toISOString(),
    langgraph: 'enabled',
    jobsInQueue: jobs.size,
    secured: !!API_KEY // Indicates if API key is configured
  });
});

// ============================================================================
// JOB QUEUE API ENDPOINTS
// ============================================================================

// Store a new job
app.post('/api/store-job', async (req, res) => {
  try {
    const { job } = req.body;
    
    if (!job || !job.id) {
      return res.status(400).json({ error: 'Job with id is required' });
    }

    console.log(`📥 Storing job: ${job.id}`);
    jobs.set(job.id, job);

    res.json({ 
      success: true,
      message: 'Job stored successfully',
      jobId: job.id
    });

  } catch (error) {
    console.error('❌ Store job failed:', error);
    res.status(500).json({ 
      success: false,
      error: error.message 
    });
  }
});

// Get a job by ID
app.get('/api/get-job/:jobId', async (req, res) => {
  try {
    const { jobId } = req.params;
    
    const job = jobs.get(jobId);
    
    if (!job) {
      return res.status(404).json({ 
        success: false,
        error: 'Job not found',
        job: null
      });
    }

    res.json({ 
      success: true,
      job: job
    });

  } catch (error) {
    console.error('❌ Get job failed:', error);
    res.status(500).json({ 
      success: false,
      error: error.message 
    });
  }
});

// Update job status
app.post('/api/update-job-status', async (req, res) => {
  try {
    const { jobId, status, progress, message } = req.body;
    
    const job = jobs.get(jobId);
    
    if (!job) {
      return res.status(404).json({ 
        success: false,
        error: 'Job not found'
      });
    }

    job.status = status;
    job.progress = progress;
    job.message = message;
    job.updatedAt = new Date().toISOString();

    if (status === 'completed') {
      job.completedAt = new Date().toISOString();
    }

    jobs.set(jobId, job);

    console.log(`📊 Job ${jobId} status updated: ${status} (${progress}%)`);

    res.json({ 
      success: true,
      message: 'Job status updated'
    });

  } catch (error) {
    console.error('❌ Update job status failed:', error);
    res.status(500).json({ 
      success: false,
      error: error.message 
    });
  }
});

// Save job results
app.post('/api/save-job-results', async (req, res) => {
  try {
    const { jobId, results } = req.body;
    
    console.log(`💾 Saving results for job: ${jobId}`);
    jobResults.set(jobId, results);

    res.json({ 
      success: true,
      message: 'Job results saved'
    });

  } catch (error) {
    console.error('❌ Save job results failed:', error);
    res.status(500).json({ 
      success: false,
      error: error.message 
    });
  }
});

// Get job results
app.get('/api/get-job-results/:jobId', async (req, res) => {
  try {
    const { jobId } = req.params;
    
    const results = jobResults.get(jobId);
    
    res.json({ 
      success: true,
      results: results || null
    });

  } catch (error) {
    console.error('❌ Get job results failed:', error);
    res.status(500).json({ 
      success: false,
      error: error.message 
    });
  }
});

// Get queued jobs
app.get('/api/get-queued-jobs', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 5;
    
    const queuedJobs = Array.from(jobs.values())
      .filter(job => job.status === 'queued')
      .slice(0, limit);

    res.json({ 
      success: true,
      jobs: queuedJobs
    });

  } catch (error) {
    console.error('❌ Get queued jobs failed:', error);
    res.status(500).json({ 
      success: false,
      error: error.message 
    });
  }
});

// ============================================================================
// JOB PROCESSING ENDPOINTS
// ============================================================================

// Process a message job
app.post('/api/process-message-job', async (req, res) => {
  try {
    const { job } = req.body;
    
    console.log(`🤖 Processing message job: ${job.id}`);
    console.log(`📝 Message: ${job.input.message}`);
    
    const { projectId, userId, input } = job;
    
    // Get or create project data
    let projectData = await getProjectData(projectId);
    if (!projectData) {
      console.log(`📦 Creating new project: ${projectId}`);
      projectData = createProjectData(projectId, userId, {
        name: 'Untitled Project'
      });
      await saveProjectData(projectId, projectData);
    }

    // Run the LangGraph workflow
    const result = await runPMWorkflow(input.message, projectId, userId);

    console.log(`✅ Message job completed: ${job.id}`);

    // Return the result
    res.json({ 
      success: true,
      result: {
        aiResponse: result.direct_answer || result.reasoning || 'Analysis complete',
        projectData: result.projectData || projectData,
        analysis: result.analysis,
        scopeData: result.scopeData,
        schedulerData: result.schedulerData,
        updateData: result.updateData,
        budgetData: result.budgetData
      }
    });

  } catch (error) {
    console.error('❌ Process message job failed:', error);
    res.status(500).json({ 
      success: false,
      error: error.message,
      result: null
    });
  }
});

// Process an init job
app.post('/api/process-init-job', async (req, res) => {
  try {
    const { job } = req.body;
    
    console.log(`🤖 Processing init job: ${job.id}`);
    
    const { projectId, userId, input } = job;
    
    // Create new project
    const projectData = createProjectData(projectId, userId, {
      name: input.projectName || 'New Project'
    });
    await saveProjectData(projectId, projectData);

    // Run the LangGraph workflow with initial message
    const initialMessage = input.initialMessage || 'Initialize this project';
    const result = await runPMWorkflow(initialMessage, projectId, userId);

    console.log(`✅ Init job completed: ${job.id}`);

    res.json({ 
      success: true,
      result: {
        message: result.direct_answer || 'Project initialized',
        projectData: result.projectData || projectData,
        analysis: result.analysis
      }
    });

  } catch (error) {
    console.error('❌ Process init job failed:', error);
    res.status(500).json({ 
      success: false,
      error: error.message,
      result: null
    });
  }
});

// Process an analyze job
app.post('/api/process-analyze-job', async (req, res) => {
  try {
    const { job } = req.body;
    
    console.log(`🤖 Processing analyze job: ${job.id}`);
    
    const { projectId, userId } = job;
    
    // Get project data
    let projectData = await getProjectData(projectId);
    if (!projectData) {
      return res.status(404).json({ 
        success: false,
        error: 'Project not found',
        result: null
      });
    }

    // Run the LangGraph workflow with analyze request
    const result = await runPMWorkflow('Analyze this project for completeness and gaps', projectId, userId);

    console.log(`✅ Analyze job completed: ${job.id}`);

    res.json({ 
      success: true,
      result: {
        message: result.direct_answer || 'Analysis complete',
        analysis: result.analysis,
        projectData: result.projectData || projectData
      }
    });

  } catch (error) {
    console.error('❌ Process analyze job failed:', error);
    res.status(500).json({ 
      success: false,
      error: error.message,
      result: null
    });
  }
});

// ============================================================================
// LEGACY ENDPOINTS (for backwards compatibility)
// ============================================================================

// LangGraph-powered project analysis endpoint
app.post('/api/analyze-project', async (req, res) => {
  try {
    const { query, projectData } = req.body;
    
    if (!query) {
      return res.status(400).json({ error: 'Query is required' });
    }

    console.log('🤖 Starting LangGraph workflow...');
    console.log('Query:', query);

    // Extract projectId and userId from projectData if available
    const projectId = projectData?.projectId || projectData?.id || `proj_${Date.now()}`;
    const userId = projectData?.userId || 'default_user';

    // Run the multi-agent workflow
    const result = await runPMWorkflow(query, projectId, userId);

    console.log('✅ Workflow complete');

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

// Simple test endpoint
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
  console.log(`💼 Job Queue API enabled`);
});