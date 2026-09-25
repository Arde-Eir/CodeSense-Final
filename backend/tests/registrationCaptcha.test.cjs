const { after, before, describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes, randomUUID } = require('node:crypto');
const http = require('node:http');
const { Webhook } = require('standardwebhooks');

require('ts-node/register/transpile-only');

const app = require('../src/server.ts').default;
const { validateRegistrationVerification } = require('../src/routes/registrationCaptcha.ts');

describe('Registration reCAPTCHA Auth Hook', () => {
    const secret = `whsec_${randomBytes(32).toString('base64')}`;
    const webhook = new Webhook(secret);
    const originalSecret = process.env.AUTH_HOOK_SECRET;
    let server;
    let baseUrl;

    before(async () => {
        process.env.AUTH_HOOK_SECRET = `v1,${secret}`;
        server = http.createServer(app);
        await new Promise((resolve, reject) => {
            server.once('error', reject);
            server.listen(0, '127.0.0.1', resolve);
        });
        baseUrl = `http://127.0.0.1:${server.address().port}`;
    });

    after(async () => {
        if (originalSecret === undefined) delete process.env.AUTH_HOOK_SECRET;
        else process.env.AUTH_HOOK_SECRET = originalSecret;
        await new Promise((resolve, reject) => {
            server.close(error => error ? reject(error) : resolve());
        });
    });

    function signatureHeaders(body, timestamp) {
        const id = randomUUID();
        return {
            'Content-Type': 'application/json',
            'webhook-id': id,
            'webhook-timestamp': String(Math.floor(timestamp.getTime() / 1000)),
            'webhook-signature': webhook.sign(id, timestamp, body),
        };
    }

    it('rejects unsigned, modified, and expired webhook requests', async () => {
        const body = JSON.stringify({ metadata: { name: 'before-user-created' }, user: { user_metadata: {} } });
        const headers = [
            { 'Content-Type': 'application/json' },
            signatureHeaders(`${body} `, new Date()),
            signatureHeaders(body, new Date(Date.now() - 360_000)),
        ];
        for (const requestHeaders of headers) {
            const response = await fetch(`${baseUrl}/api/auth/before-user-created`, {
                method: 'POST', headers: requestHeaders, body,
            });
            assert.equal(response.status, 401);
            assert.equal((await response.json()).error.http_code, 401);
        }
    });

    it('blocks a signed signup without a token using the Supabase error envelope', async () => {
        const body = JSON.stringify({ metadata: { name: 'before-user-created' }, user: { user_metadata: {} } }, null, 2);
        const response = await fetch(`${baseUrl}/api/auth/before-user-created`, {
            method: 'POST', headers: signatureHeaders(body, new Date()), body,
        });
        assert.equal(response.status, 200);
        const result = await response.json();
        assert.equal(result.error.http_code, 403);
        assert.match(result.error.message, /^RECAPTCHA_REJECTED:/);
    });

    it('blocks signed payloads for the wrong hook', async () => {
        const body = JSON.stringify({ metadata: { name: 'send-email' }, user: { user_metadata: { recaptcha_token: 'unused' } } });
        const response = await fetch(`${baseUrl}/api/auth/before-user-created`, {
            method: 'POST', headers: signatureHeaders(body, new Date()), body,
        });
        assert.equal((await response.json()).error.http_code, 400);
    });

    it('accepts only fresh signup verifications from the configured site and score range', () => {
        const now = Date.now();
        const valid = {
            success: true,
            score: 0.5,
            action: 'signup',
            hostname: 'codesense.example',
            challenge_ts: new Date(now - 1000).toISOString(),
        };
        assert.doesNotThrow(() => validateRegistrationVerification(valid, 0.5, ['codesense.example'], now));
        const invalid = [
            { ...valid, score: 0.49 },
            { ...valid, action: 'login' },
            { ...valid, hostname: 'attacker.example' },
            { ...valid, challenge_ts: new Date(now - 120_001).toISOString() },
            { ...valid, challenge_ts: new Date(now + 1000).toISOString() },
            { success: false, 'error-codes': ['timeout-or-duplicate'] },
        ];
        for (const verification of invalid) {
            assert.throws(() => validateRegistrationVerification(verification, 0.5, ['codesense.example'], now), {
                name: 'RecaptchaRejectedError', statusCode: 403,
            });
        }
    });
});
