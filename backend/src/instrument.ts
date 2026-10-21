import * as Sentry from '@sentry/node';

const dsn: string | undefined = process.env.SENTRY_DSN;

if (dsn) {
    if (!URL.canParse(dsn)) {
        throw new TypeError('SENTRY_DSN must be the DSN from the Sentry Express project settings.');
    }
    const url = new URL(dsn);
    if (!['https:', 'http:'].includes(url.protocol) || !url.username || !/\/\d+$/.test(url.pathname)) {
        throw new TypeError('SENTRY_DSN must include an HTTP(S) endpoint, public key, and numeric project ID.');
    }

    Sentry.init({
        dsn,
        environment: process.env.SENTRY_ENVIRONMENT,
        release: process.env.SENTRY_RELEASE,
        // Console output may contain learner code or registration details.
        maxBreadcrumbs: 0,
        dataCollection: {
            userInfo: false,
            cookies: false,
            httpHeaders: false,
            httpBodies: [],
            urlQueryParams: false,
            stackFrameVariables: false,
        },
    });
}
