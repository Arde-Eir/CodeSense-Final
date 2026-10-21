import * as Sentry from '@sentry/react'

const dsn: string | undefined = import.meta.env.VITE_SENTRY_DSN

if (dsn) {
  if (!URL.canParse(dsn)) {
    throw new TypeError('VITE_SENTRY_DSN must be the DSN from the Sentry React project settings.')
  }
  const url = new URL(dsn)
  if (!['https:', 'http:'].includes(url.protocol) || !url.username || !/\/\d+$/.test(url.pathname)) {
    throw new TypeError('VITE_SENTRY_DSN must include an HTTP(S) endpoint, public key, and numeric project ID.')
  }

  Sentry.init({
    dsn,
    environment: import.meta.env.MODE,
    // Console output and editor interactions may contain learner code.
    maxBreadcrumbs: 0,
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: false,
      httpBodies: [],
      urlQueryParams: false,
      stackFrameVariables: false,
    },
  })
}
