import { ViteReactSSG } from 'vite-react-ssg'
import type { RouteRecord } from 'vite-react-ssg'
import * as Sentry from '@sentry/react'
import Root from './Root'
import { ProtectedRoute } from './components/ProtectedRoute.tsx'
import Landing from './pages/Landing.tsx'
import Login from './pages/Login.tsx'
import ResetPassword from './pages/ResetPassword.tsx'
import Dashboard from './pages/dashboard/Dashboard.tsx'
import Billing from './pages/settings/Billing.tsx'
import Pricing from './pages/Pricing.tsx'
import Support from './pages/Support.tsx'
import Privacy from './pages/legal/Privacy'
import Terms from './pages/legal/Terms.tsx'
import Refund from './pages/legal/Refund.tsx'
import Gdpr from './pages/legal/Gdpr.tsx'
import './index.css'

declare global {
  interface Window {
    dataLayer: unknown[]
    gtag: (...args: unknown[]) => void
  }
}

export const routes: RouteRecord[] = [
  {
    path: '/',
    element: <Root />,
    children: [
      { index: true, element: <Landing /> },
      { path: 'login', element: <Login /> },
      { path: 'reset-password', element: <ResetPassword /> },
      { path: 'privacy', element: <Privacy /> },
      { path: 'terms', element: <Terms /> },
      { path: 'refund', element: <Refund /> },
      { path: 'gdpr', element: <Gdpr /> },
      { path: 'pricing', element: <Pricing /> },
      { path: 'support', element: <Support /> },
      {
        path: 'dashboard',
        element: (
          <ProtectedRoute>
            <Dashboard />
          </ProtectedRoute>
        ),
      },
      {
        path: 'dashboard/tasks',
        element: (
          <ProtectedRoute>
            <Dashboard page="tasks" />
          </ProtectedRoute>
        ),
      },
      {
        path: 'dashboard/week',
        element: (
          <ProtectedRoute>
            <Dashboard page="week" />
          </ProtectedRoute>
        ),
      },
      {
        path: 'dashboard/projects',
        element: (
          <ProtectedRoute>
            <Dashboard page="projects" />
          </ProtectedRoute>
        ),
      },
      {
        path: 'dashboard/habits',
        element: (
          <ProtectedRoute>
            <Dashboard page="habits" />
          </ProtectedRoute>
        ),
      },
      {
        path: 'settings/billing',
        element: (
          <ProtectedRoute>
            <Billing />
          </ProtectedRoute>
        ),
      },
    ],
  },
]

export const createRoot = ViteReactSSG({ routes }, ({ isClient }) => {
  // Browser-only side effects (skipped during static build render).
  if (!isClient) return

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
})
