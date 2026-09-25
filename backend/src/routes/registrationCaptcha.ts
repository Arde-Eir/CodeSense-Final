import { Router, raw, type Request, type Response } from 'express';
import { Webhook, WebhookVerificationError } from 'standardwebhooks';

interface RegistrationHookPayload {
    metadata: { name: string };
    user: { user_metadata: { recaptcha_token: string } };
}

interface RecaptchaSuccess {
    success: true;
    score: number;
    action: string;
    hostname: string;
    challenge_ts: string;
}

interface RecaptchaFailure {
    success: false;
    'error-codes'?: string[];
}

interface HookResponse {
    error?: { http_code: number; message: string };
}

type RegistrationError = Error & { statusCode: number };

const router = Router();
const VERIFY_URL = 'https://www.google.com/recaptcha/api/siteverify';

function registrationError(name: string, message: string, statusCode: number): RegistrationError {
    return Object.assign(new Error(message), { name, statusCode });
}

function requireEnvironment(name: string): string {
    const value = process.env[name]?.trim();
    if (!value) {
        throw registrationError('RecaptchaConfigurationError', `${name} is required on the backend for registration verification.`, 500);
    }
    return value;
}

function readHookSecret(): string {
    const secret = requireEnvironment('AUTH_HOOK_SECRET');
    if (!/^v1,whsec_[A-Za-z0-9+/]+={0,2}$/.test(secret)) {
        throw registrationError('RecaptchaConfigurationError', 'AUTH_HOOK_SECRET must be the v1,whsec_ signing secret from Supabase Authentication > Hooks.', 500);
    }
    return secret.slice(3);
}

function readMinimumScore(): number {
    const score = Number(requireEnvironment('RECAPTCHA_MIN_SCORE'));
    if (!Number.isFinite(score) || score < 0 || score > 1) {
        throw registrationError('RecaptchaConfigurationError', 'RECAPTCHA_MIN_SCORE must be a number between 0 and 1.', 500);
    }
    return score;
}

function readAllowedHostnames(): string[] {
    const hostnames = requireEnvironment('RECAPTCHA_ALLOWED_HOSTNAMES').split(',').map(hostname => hostname.trim());
    if (hostnames.some(hostname => !/^[a-z0-9]+(?:[a-z0-9.-]*[a-z0-9])?$/.test(hostname))) {
        throw registrationError('RecaptchaConfigurationError', 'RECAPTCHA_ALLOWED_HOSTNAMES must contain comma-separated lowercase hostnames without schemes, paths, ports, or wildcards.', 500);
    }
    return hostnames;
}

function readRegistrationToken(body: string): string {
    const payload: RegistrationHookPayload = JSON.parse(body);
    if (!payload || payload.metadata?.name !== 'before-user-created') {
        throw registrationError('RegistrationPayloadError', 'Expected a Supabase before-user-created hook payload.', 400);
    }
    const token = payload.user?.user_metadata?.recaptcha_token;
    if (typeof token !== 'string' || token.trim().length === 0 || token.length > 8192) {
        throw registrationError('RecaptchaRejectedError', 'RECAPTCHA_REJECTED: A fresh registration verification token is required. Submit the registration form again.', 403);
    }
    return token;
}

function readVerificationResponse(body: string): RecaptchaSuccess | RecaptchaFailure {
    const result: RecaptchaSuccess | RecaptchaFailure = JSON.parse(body);
    if (!result || typeof result.success !== 'boolean') {
        throw registrationError('RecaptchaResponseError', 'Google reCAPTCHA siteverify returned an invalid success field.', 502);
    }
    if (!result.success) {
        if (result['error-codes'] !== undefined && (!Array.isArray(result['error-codes']) || result['error-codes'].some(code => typeof code !== 'string'))) {
            throw registrationError('RecaptchaResponseError', 'Google reCAPTCHA siteverify returned invalid error codes.', 502);
        }
        return result;
    }
    if (typeof result.score !== 'number' || !Number.isFinite(result.score) || result.score < 0 || result.score > 1 ||
        typeof result.action !== 'string' || typeof result.hostname !== 'string' ||
        typeof result.challenge_ts !== 'string' || !Number.isFinite(Date.parse(result.challenge_ts))) {
        throw registrationError('RecaptchaResponseError', 'Google reCAPTCHA siteverify returned invalid score, action, hostname, or challenge timestamp fields.', 502);
    }
    return result;
}

async function requestVerification(token: string, secret: string): Promise<RecaptchaSuccess | RecaptchaFailure> {
    for (let attempt = 1; attempt <= 2; attempt += 1) {
        try {
            const response = await fetch(VERIFY_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({ secret, response: token }),
                signal: AbortSignal.timeout(1700),
            });
            const body = await response.text();
            if (!response.ok) {
                const safeBody = body.split(secret).join('[redacted]').split(token).join('[redacted]').slice(0, 500);
                throw registrationError('RecaptchaServiceError', `Google reCAPTCHA POST siteverify failed (HTTP ${response.status}): ${safeBody}`, 502);
            }
            return readVerificationResponse(body);
        } catch (caught) {
            if (!(caught instanceof Error)) throw caught;
            console.warn('Registration reCAPTCHA verification request failed', {
                endpoint: VERIFY_URL,
                attempt,
                errorType: caught.name,
            });
            if (attempt === 2) throw caught;
        }
    }
    throw registrationError('RecaptchaServiceError', 'Google reCAPTCHA siteverify exhausted its verification attempts.', 502);
}

/** Validates the server response, including the form action and allowed site. */
export function validateRegistrationVerification(result: RecaptchaSuccess | RecaptchaFailure, minimumScore: number, allowedHostnames: readonly string[], now: number): void {
    if (!result.success) {
        const codes = result['error-codes'] ?? [];
        if (codes.includes('invalid-input-secret') || codes.includes('missing-input-secret')) {
            throw registrationError('RecaptchaConfigurationError', 'Google rejected RECAPTCHA_SECRET_KEY. Configure the secret matching the registration v3 site key.', 500);
        }
        throw registrationError('RecaptchaRejectedError', `RECAPTCHA_REJECTED: Google could not verify this registration (${codes.join(', ') || 'verification unsuccessful'}). Submit the form again.`, 403);
    }
    const age = now - Date.parse(result.challenge_ts);
    if (result.action !== 'signup' || result.score < minimumScore || !allowedHostnames.includes(result.hostname) || age < 0 || age > 120_000) {
        throw registrationError('RecaptchaRejectedError', 'RECAPTCHA_REJECTED: Registration verification did not pass the site, action, score, or expiration checks. Submit the form again.', 403);
    }
}

// Mount before the shared JSON parser: signatures cover the original body bytes.
router.post('/auth/before-user-created', raw({ type: 'application/json', limit: '32kb' }), async (
    req: Request<Record<string, never>, HookResponse, Buffer>,
    res: Response<HookResponse>,
): Promise<void> => {
    res.setHeader('Cache-Control', 'no-store');
    try {
        if (!Buffer.isBuffer(req.body)) {
            throw registrationError('RegistrationPayloadError', 'The registration hook requires an application/json request body.', 400);
        }
        const webhook = new Webhook(readHookSecret());
        webhook.verify(req.body, {
            'webhook-id': req.get('webhook-id') ?? '',
            'webhook-timestamp': req.get('webhook-timestamp') ?? '',
            'webhook-signature': req.get('webhook-signature') ?? '',
        }, { jsonParse: false });
        const token = readRegistrationToken(req.body.toString('utf8'));
        const secret = requireEnvironment('RECAPTCHA_SECRET_KEY');
        const minimumScore = readMinimumScore();
        const allowedHostnames = readAllowedHostnames();
        const verification = await requestVerification(token, secret);
        validateRegistrationVerification(verification, minimumScore, allowedHostnames, Date.now());
        res.status(200).json({});
    } catch (caught) {
        if (caught instanceof WebhookVerificationError) {
            res.status(401).json({ error: { http_code: 401, message: 'Invalid Supabase registration hook signature or timestamp.' } });
            return;
        }
        if (!(caught instanceof Error)) throw caught;
        const statusCode = 'statusCode' in caught && typeof caught.statusCode === 'number' ? caught.statusCode : 502;
        const message = caught instanceof SyntaxError ? 'The registration verification payload is not valid JSON.' : caught.message;
        console.error('Registration verification failed', { errorType: caught.name, statusCode });
        // Supabase reads an error envelope from HTTP 200 and propagates http_code.
        res.status(200).json({ error: { http_code: statusCode, message } });
    }
});

export default router;
