import './instrument'
import { StrictMode, type ErrorInfo } from 'react'
import { createRoot } from 'react-dom/client'
import { reactErrorHandler } from '@sentry/react'
import App from '@/App'
import '@/base.css'

const handleReactError = reactErrorHandler((error: unknown, errorInfo: ErrorInfo): void => {
  console.error('React render failed', { error, componentStack: errorInfo.componentStack })
})

createRoot(document.getElementById('root')!, {
  onUncaughtError: handleReactError,
  onCaughtError: handleReactError,
  onRecoverableError: handleReactError,
}).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
