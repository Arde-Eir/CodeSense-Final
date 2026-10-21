import { createHmac } from 'node:crypto';
import { Router, json, type NextFunction, type Request, type Response } from 'express';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { captureException } from '@sentry/node';

interface LoginCredentials {
    playerName: string;
    secretCode: string;
}

interface LoginProfile {
    id: string;
    is_banned: boolean | null;
    ban_reason: string | null;
}

type LoginResponse = { access_token: string; refresh_token: string } | { error: string };
type LoginError = Error & { statusCode: number; retryAfter?: number };

const router = Router();

function loginError(message: string, statusCode: number): LoginError {
    return Object.assign(new Error(message), { name: 'PlayerLoginError', statusCode });
}

function readCredentials(body: Partial<LoginCredentials> | null | undefined): LoginCredentials {
    if (typeof body?.playerName !== 'string' || !body.playerName.trim() || body.playerName.length > 256 ||
        typeof body.secretCode !== 'string' || !body.secretCode || body.secretCode.length > 1024) {
        throw loginError('Enter a player name and secret code within the supported length limits.', 400);
    }
    return { playerName: body.playerName.trim(), secretCode: body.secretCode };
}

function readConfiguration(): { url: string; secret: string } {
    const url = process.env.SUPABASE_URL?.trim();
    const secret = process.env.SUPABASE_SECRET_KEY?.trim();
    if (!url || !URL.canParse(url) || !['https:', 'http:'].includes(new URL(url).protocol) || !secret) {
        console.error('Player sign-in configuration is incomplete', { required: ['SUPABASE_URL', 'SUPABASE_SECRET_KEY'] });
        throw loginError('Player-name sign-in is not configured. Contact an administrator.', 503);
    }
    const endpoint = new URL(url);
    if (endpoint.username || endpoint.password || endpoint.search || endpoint.hash ||
        (endpoint.protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(endpoint.hostname))) {
        console.error('Player sign-in requires HTTPS outside local development', { field: 'SUPABASE_URL' });
        throw loginError('Player-name sign-in is not configured. Contact an administrator.', 503);
    }
    if (!secret.startsWith('sb_secret_')) {
        console.error('Player sign-in requires a current Supabase secret API key', { field: 'SUPABASE_SECRET_KEY' });
        throw loginError('Player-name sign-in is not configured. Contact an administrator.', 503);
    }
    return { url, secret };
}

/** Retry transient transport failures without recording credentials or query values. */
const fetchSupabase: typeof fetch = async (input, init): Promise<globalThis.Response> => {
    for (let attempt = 1; attempt <= 2; attempt += 1) {
        try {
            const response = await fetch(input instanceof globalThis.Request ? input.clone() : input, {
                ...init, signal: AbortSignal.timeout(3000),
            });
            if (response.status >= 500 && attempt < 2) {
                console.warn('Player sign-in service request failed', { attempt, statusCode: response.status });
                await response.body?.cancel();
                continue;
            }
            return response;
        } catch (error) {
            console.warn('Player sign-in service request failed', {
                attempt, errorType: error instanceof Error ? error.name : typeof error,
            });
            if (attempt === 2) throw error;
        }
    }
    throw loginError('The Supabase sign-in service exhausted its connection attempts.', 503);
};

function createLoginClient(url: string, secret: string, clientIp: string): SupabaseClient {
    return createClient(url, secret, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
        global: { fetch: fetchSupabase, headers: { 'Sb-Forwarded-For': clientIp } },
    });
}

async function checkLoginLimit(client: SupabaseClient, secret: string, clientIp: string, playerName: string): Promise<void> {
    const ipHash = createHmac('sha256', secret).update(clientIp).digest('hex');
    const playerHash = createHmac('sha256', secret).update(playerName.toLowerCase()).digest('hex');
    const { data, error } = await client.rpc('consume_player_login_attempt', {
        p_ip_bucket: `ip:${ipHash}`, p_player_bucket: `player:${playerHash}`,
    });
    if (error) {
        console.error('Shared player sign-in limit failed', { code: error.code, action: 'Check the profile preparation migration and backend Supabase key.' });
        throw loginError('Sign-in protection is temporarily unavailable. Try again shortly.', 503);
    }
    if (typeof data !== 'number' || !Number.isSafeInteger(data) || data < 0) {
        throw loginError('The sign-in protection service returned an invalid retry interval.', 502);
    }
    if (data > 0) {
        throw Object.assign(loginError('Too many sign-in attempts. Wait before trying again.', 429), { retryAfter: data });
    }
}

async function findLoginProfile(client: SupabaseClient, playerName: string): Promise<LoginProfile> {
    const pattern = playerName.replace(/[\\%_]/g, character => `\\${character}`);
    const { data, error } = await client.from('users').select('id, is_banned, ban_reason')
        .ilike('playername', pattern).limit(2).returns<LoginProfile[]>();
    if (error) {
        console.error('Private player sign-in lookup failed', { code: error.code });
        throw loginError('The account directory is temporarily unavailable. Try again shortly.', 503);
    }
    if (!Array.isArray(data)) throw loginError('The private account directory returned an invalid response.', 502);
    if (data.length !== 1) throw loginError('INVALID_CREDENTIALS', 401);
    const profile = data[0];
    if (!profile || typeof profile !== 'object' || typeof profile.id !== 'string' ||
        (profile.is_banned !== null && typeof profile.is_banned !== 'boolean') ||
        (profile.ban_reason !== null && typeof profile.ban_reason !== 'string')) {
        throw loginError('The private account directory returned an invalid profile.', 502);
    }
    return profile;
}

router.use('/auth/login', (_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
});

router.post('/auth/login', json({ limit: '8kb' }), async (
    req: Request<Record<string, never>, LoginResponse, Partial<LoginCredentials> | null | undefined>,
    res: Response<LoginResponse>,
): Promise<void> => {
    res.setHeader('Cache-Control', 'no-store');
    let client: SupabaseClient | undefined;
    try {
        const credentials = readCredentials(req.body);
        const { url, secret } = readConfiguration();
        if (!req.ip) throw loginError('The sign-in service could not determine the client address.', 503);
        client = createLoginClient(url, secret, req.ip);
        await checkLoginLimit(client, secret, req.ip, credentials.playerName);
        const profile = await findLoginProfile(client, credentials.playerName);
        const { data: account, error: accountError } = await client.auth.admin.getUserById(profile.id);
        if (accountError || typeof account.user?.email !== 'string' || !account.user.email) {
            console.error('Sign-in account lookup failed', { statusCode: accountError?.status, code: accountError?.code });
            throw loginError('The sign-in service could not resolve this account. Contact an administrator.', 503);
        }
        const { data, error } = await client.auth.signInWithPassword({
            email: account.user.email, password: credentials.secretCode,
        });
        if (error) {
            if (error.status === 429) throw Object.assign(loginError('Too many sign-in attempts. Wait before trying again.', 429), { retryAfter: 60 });
            if (error.code === 'email_not_confirmed') throw loginError('Confirm your account email before signing in.', 403);
            if (error.code === 'invalid_credentials' || error.status === 400) throw loginError('INVALID_CREDENTIALS', 401);
            console.error('Supabase password sign-in failed', { statusCode: error.status, code: error.code });
            throw loginError('The password verification service is unavailable. Try again shortly.', 503);
        }
        if (!data.session || data.user?.id !== profile.id) throw loginError('The sign-in service returned an invalid account session.', 502);
        if (profile.is_banned) throw loginError(`ACCOUNT_BANNED${profile.ban_reason ? `: ${profile.ban_reason}` : ''}`, 403);
        res.status(200).json({ access_token: data.session.access_token, refresh_token: data.session.refresh_token });
    } catch (caught) {
        const error = caught instanceof Error ? caught : new Error('The sign-in service failed with an invalid error response.');
        const statusCode = 'statusCode' in error && typeof error.statusCode === 'number' ? error.statusCode : 503;
        if (statusCode >= 500) {
            console.error('Player-name sign-in failed', { statusCode, errorType: error.name, message: error.message });
            captureException(error);
        }
        if ('retryAfter' in error && typeof error.retryAfter === 'number') res.setHeader('Retry-After', error.retryAfter);
        res.status(statusCode).json({ error: statusCode >= 500 && error.name !== 'PlayerLoginError'
            ? 'The sign-in service could not complete the request. Try again shortly.' : error.message });
    } finally {
        await client?.auth.dispose();
    }
});

router.use('/auth/login', (
    error: Error & { type?: string },
    _req: Request,
    res: Response<LoginResponse>,
    next: NextFunction,
): void => {
    if (error.type === 'entity.too.large') {
        res.status(413).json({ error: 'The sign-in request exceeds the supported size limit.' });
        return;
    }
    if (error.type === 'entity.parse.failed') {
        res.status(400).json({ error: 'The sign-in request must contain a valid JSON object.' });
        return;
    }
    next(error);
});

export default router;
