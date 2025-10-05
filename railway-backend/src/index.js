import express from 'express';
import cors from 'cors';

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    message: 'PMAAS Railway Backend is running',
    timestamp: new Date().toISOString()
  });
});

// Test endpoint for project analysis
app.post('/api/analyze-project', async (req, res) => {
  try {
    const { projectData } = req.body;
    
    // Placeholder - we'll add LangGraph here later
    res.json({ 
      message: 'Analysis complete',
      suggestions: [
        'Budget is missing - would you like to add one?',
        'Consider adding key milestones',
        'Define project scope'
      ],
      projectData
    });
  } catch (error) {
    res.status(500).json({ error: 'Analysis failed' });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});