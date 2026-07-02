import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import analyzeRoutes from './routes/analyze';

const app = express();

// Vercel provides process.env.PORT; 3000 is our local fallback
const PORT = process.env.PORT || 3000;
const LOG_ANALYSIS_REQUESTS = process.env.LOG_ANALYSIS_REQUESTS === 'true';
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 60;
const RATE_LIMIT_MAX_ANALYZE_REQUESTS = 20;

type RateBucket = {
    windowStart: number;
    count: number;
};

type HttpError = Error & {
    status?: number;
    statusCode?: number;
    type?: string;
    expose?: boolean;
    body?: string;
    limit?: number;
    length?: number;
};

const apiRateBuckets = new Map<string, RateBucket>();
const analyzeRateBuckets = new Map<string, RateBucket>();

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
    'https://ubiquitous-peony-399ebd.netlify.app',
    ...envOrigins,
];

app.set('trust proxy', 1);

app.use((_req: Request, res: Response, next: NextFunction) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-site');
    next();
});

function createHttpError(message: string, statusCode: number): HttpError {
    const error = new Error(message) as HttpError;
    error.statusCode = statusCode;
    return error;
}

function getClientKey(req: Request): string {
    return req.ip || req.socket.remoteAddress || 'unknown';
}

function isRateLimited(
    buckets: Map<string, RateBucket>,
    key: string,
    now: number,
    maxRequests: number,
): boolean {
    const bucket = buckets.get(key);
    if (!bucket || now - bucket.windowStart >= RATE_LIMIT_WINDOW_MS) {
        buckets.set(key, { windowStart: now, count: 1 });
        return false;
    }

    bucket.count += 1;
    return bucket.count > maxRequests;
}

function pruneExpiredRateBuckets(buckets: Map<string, RateBucket>, now: number): void {
    for (const [key, bucket] of buckets.entries()) {
        if (now - bucket.windowStart >= RATE_LIMIT_WINDOW_MS * 2) {
            buckets.delete(key);
        }
    }
}

app.use(cors({
    origin: (origin, callback) => {
        // Allow if:
        // - No origin (Postman/Curl)
        // - In our allowedOrigins list or CORS_ORIGINS
        if (
            !origin ||
            allowedOrigins.includes(origin)
        ) {
            callback(null, true);
        } else {
            console.warn('CORS origin blocked', { origin });
            callback(createHttpError(`Origin is not allowed by CORS: ${origin}`, 403));
        }
    },
    credentials: true
}));

app.use('/api', (req: Request, res: Response, next: NextFunction) => {
    const now = Date.now();
    const key = getClientKey(req);
    pruneExpiredRateBuckets(apiRateBuckets, now);
    pruneExpiredRateBuckets(analyzeRateBuckets, now);

    if (isRateLimited(apiRateBuckets, key, now, RATE_LIMIT_MAX_REQUESTS)) {
        res.status(429).json({
            success: false,
            errors: [{
                type: 'semantic',
                severity: 'error',
                message: `Too many API requests from ${key}. Wait 60 seconds and try again.`,
                line: 0
            }],
            warnings: [],
            tokens: [],
            ast: null,
            safetyChecks: [],
            cfg: { nodes: [], edges: [] },
            cognitiveComplexity: 0,
            cyclomaticComplexity: { score: 0, rating: 'low', interpretation: '' },
            gamification: { xpEarned: 0, qualityBonus: 0, levelTitle: 'Squire' },
            symbolicExecution: [],
            logs: [],
            explanations: ['Status: API rate limit exceeded.']
        });
        return;
    }

    if (req.path === '/analyze' && isRateLimited(analyzeRateBuckets, key, now, RATE_LIMIT_MAX_ANALYZE_REQUESTS)) {
        res.status(429).json({
            success: false,
            errors: [{
                type: 'semantic',
                severity: 'error',
                message: `Too many analysis requests from ${key}. Wait 60 seconds and try again.`,
                line: 0
            }],
            warnings: [],
            tokens: [],
            ast: null,
            safetyChecks: [],
            cfg: { nodes: [], edges: [] },
            cognitiveComplexity: 0,
            cyclomaticComplexity: { score: 0, rating: 'low', interpretation: '' },
            gamification: { xpEarned: 0, qualityBonus: 0, levelTitle: 'Squire' },
            symbolicExecution: [],
            logs: [],
            explanations: ['Status: Analysis rate limit exceeded.']
        });
        return;
    }

    next();
});

// Enable parsing of JSON bodies (1 MB max to guard against oversized payloads)
app.use(bodyParser.json({ limit: '1mb' }));

/**
 * 2. REQUEST LOGGING
 */
app.use((req: Request, _res: Response, next: NextFunction) => {
    if (LOG_ANALYSIS_REQUESTS && req.path === '/api/analyze') {
        const rawSrc = req.body?.sourceCode;
        const src = typeof rawSrc === 'string' ? rawSrc : '';
        console.log(`[analysis] request received: ${src.length} source characters`);
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

app.use((req: Request, res: Response) => {
  console.warn('Route not found', { method: req.method, path: req.path });
  res.status(404).json({
    success: false,
    errors: [{
      type: 'semantic' as const,
      severity: 'error' as const,
      message: `Route not found: ${req.method} ${req.path}`,
      line: 0
    }],
    warnings: [],
    tokens: [],
    ast: null,
    safetyChecks: [],
    cfg: { nodes: [], edges: [] },
    cognitiveComplexity: 0,
    cyclomaticComplexity: { score: 0, rating: 'low', interpretation: '' },
    gamification: { xpEarned: 0, qualityBonus: 0 },
    symbolicExecution: [],
    logs: [],
    explanations: ['❌ **Status:** API route not found.']
  });
});

/**
 * 4. GLOBAL ERROR HANDLER
 */
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const httpError = err as HttpError;
    const message = httpError?.message ?? 'Unexpected backend error';
    const statusCode = getErrorStatusCode(httpError);
    console.error('Backend error', {
        message,
        statusCode,
        type: httpError?.type,
        limit: httpError?.limit,
        length: httpError?.length,
    });
    const isSyntactic = httpError?.name === 'SyntaxError' || message.includes('Expected');
    res.status(statusCode).json({
        success: false,
        errors: [{
            type: isSyntactic ? 'syntactic' : 'semantic',
            severity: 'error',
            message,
            line: 0
        }],
        warnings: [],
        tokens: [],
        ast: null,
        safetyChecks: [],
        cfg: { nodes: [], edges: [] },
        cognitiveComplexity: 0,
        cyclomaticComplexity: { score: 0, rating: 'low', interpretation: '' },
        gamification: { xpEarned: 0, qualityBonus: 0, levelTitle: 'Squire' },
        symbolicExecution: [],
        logs: [],
        explanations: ["The engine encountered an unexpected structure and stopped."]
    });
});

function getErrorStatusCode(error: HttpError): number {
    if (typeof error.statusCode === 'number') return error.statusCode;
    if (typeof error.status === 'number') return error.status;
    if (error.type === 'entity.too.large') return 413;
    if (error.type === 'entity.parse.failed') return 400;
    return 500;
}

/**
 * 5. SERVER EXECUTION LOGIC
 * Only run app.listen when this file is executed directly. Serverless hosts can
 * import the Express app without binding a second listener.
 */
if (require.main === module) {
    app.listen(PORT, () => {
        console.log(`✅ CodeSense Backend is running on port ${PORT}`);
    });
}

export default app;
