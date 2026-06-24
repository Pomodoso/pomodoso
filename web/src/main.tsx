import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import * as Sentry from '@sentry/react'
import './index.css'
import App from './App'

declare global {
  interface Window {
    dataLayer: unknown[]
    gtag: (...args: unknown[]) => void
  }
}

// Error reporting — only active when VITE_SENTRY_DSN is set.
if (import.meta.env.VITE_SENTRY_DSN) {
  Sentry.init({
    dsn: import.meta.env.VITE_SENTRY_DSN,
    environment: import.meta.env.MODE,
    // Default 20% trace sampling; override with VITE_SENTRY_TRACES_SAMPLE_RATE.
    tracesSampleRate: Number(import.meta.env.VITE_SENTRY_TRACES_SAMPLE_RATE ?? 0.2),
    // Default integrations already capture uncaught errors + promise rejections;
    // this also forwards explicit console.error(...) calls to Sentry.
    integrations: [Sentry.captureConsoleIntegration({ levels: ['error'] })],
  })
}

// Google Analytics — only loaded when VITE_GA_ID is set (no empty-id requests).
const GA_ID = import.meta.env.VITE_GA_ID as string | undefined
if (GA_ID) {
  const s = document.createElement('script')
  s.async = true
  s.src = `https://www.googletagmanager.com/gtag/js?id=${GA_ID}`
  document.head.appendChild(s)
  window.dataLayer = window.dataLayer || []
  // Must push the `arguments` object exactly like Google's snippet — gtag.js only
  // treats Arguments objects as commands, so a plain array is silently ignored
  // and `config` never fires the page_view. Exposed on window so events can be
  // sent from anywhere (and tested from the console).
  function gtag(..._args: unknown[]) {
    // eslint-disable-next-line prefer-rest-params
    window.dataLayer.push(arguments)
  }
  window.gtag = gtag
  gtag('js', new Date())
  gtag('config', GA_ID)
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
