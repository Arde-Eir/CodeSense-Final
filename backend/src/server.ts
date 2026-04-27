import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import analyzeRoutes from './routes/analyze';

const app = express();

// Vercel provides process.env.PORT; 3000 is our local fallback
const PORT = process.env.PORT || 3000;

/**
 * 1. DYNAMIC CORS CONFIGURATION
 * Updated to allow local development, production, and VS Code Dev Tunnels.
 */
const envOrigins = (process.env.CORS_ORIGINS ?? '')
  .split(',')
  .map(o => o.trim())
  .filter(Boolean);

const allowedOrigins = [
    'http://localhost:5173',
    'http://localhost:4173',
    'https://code-sense-final-lsif.vercel.app',
    'https://codesense-4f57.up.railway.app',
    ...envOrigins,
];

app.use(cors({
    origin: (origin, callback) => {
        // Allow if:
        // - No origin (Postman/Curl)
        // - In our allowedOrigins list
        // - It's a Vercel preview branch (.vercel.app)
        // - It's a VS Code Dev Tunnel (.devtunnels.ms)
        if (
            !origin ||
            allowedOrigins.includes(origin) ||
            origin.endsWith('.vercel.app') ||
            origin.endsWith('.devtunnels.ms') ||
            origin.endsWith('.netlify.app')
        ) {
            callback(null, true);
        } else {
            console.error(`CORS Blocked: Origin ${origin} is not allowed.`);
            callback(new Error('Not allowed by CORS'));
        }
    },
    credentials: true
}));

// Enable parsing of JSON bodies (1 MB max to guard against oversized payloads)
app.use(bodyParser.json({ limit: '1mb' }));

/**
 * 2. REQUEST LOGGING
 */
app.use((req: Request, _res: Response, next: NextFunction) => {
    if (req.path === '/api/analyze') {
        const snippet = req.body.sourceCode?.substring(0, 40).replace(/\n/g, ' ');
        console.log(`\n--- [DEBUG] New Analysis Request ---`);
        console.log(`Source Snippet: ${snippet}${req.body.sourceCode?.length > 40 ? '...' : ''}`);
    }
    next();
});

/**
 * 3. ROUTE REGISTRATION
 */
app.use('/api', analyzeRoutes);

// Simple Health Check for Vercel
app.get('/', (_req, res) => {
    res.status(200).send('CodeSense Analysis Engine is Online.');
});

// ✅ ADD THIS — catches any unmatched route
app.use((req: Request, res: Response) => {
  console.error(`❌ 404 - Route not found: ${req.method} ${req.path}`);
  res.status(200).json({
    success: false,
    errors: [{
      type: 'semantic' as const,
      severity: 'error' as const,
      message: `Route not found: ${req.method} ${req.path}`,
      line: 0
    }],
    tokens: [],
    ast: null,
    safetyChecks: [],
    cfg: { nodes: [], edges: [] },
    cognitiveComplexity: 0,
    gamification: { xpEarned: 0, qualityBonus: 0 },
    symbolicExecution: [],
    explanations: ['❌ **Status:** API route not found.']
  });
});

/**
 * 4. GLOBAL ERROR HANDLER
 */
app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    console.error(`🔥 Backend Error: ${err.message}`, err);
    const isSyntactic = err.name === 'SyntaxError' || err.message.includes('Expected');
    res.status(200).json({
        success: false,
        errors: [{
            type: isSyntactic ? 'syntactic' : 'semantic',
            message: err.message,
            line: err.location?.start?.line || 0
        }],
        safetyChecks: [],
        cfg: { nodes: [], edges: [] },
        explanations: ["The engine encountered an unexpected structure and stopped."]
    });
});

/**
 * 5. SERVER EXECUTION LOGIC
 * Only run app.listen locally to avoid conflict with Vercel's serverless wrapper.
 */
app.listen(PORT, () => {
    console.log(`✅ CodeSense Backend is running on port ${PORT}`);
});

export default app;